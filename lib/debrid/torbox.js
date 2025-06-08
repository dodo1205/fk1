const DebridService = require('./baseService');
const torboxApi = require('../api/torboxApi');
const { getFileExtension, isVideoFile } = require('../utils/fileUtils');

class Torbox extends DebridService {
    constructor(apiKey) {
        super(apiKey);
    }

    async checkApiKey() {
        try {
            await torboxApi.getMyTorrents(this.apiKey);
            return true;
        } catch (error) {
            console.error('[TorboxService] API key check failed:', error.message);
            return false;
        }
    }

    getInfoHashFromMagnet(magnetLink) {
        const match = magnetLink.match(/urn:btih:([a-f0-9]{40})/i); // Standard 40-char hex infohash
        if (!match) {
            const matchBase32 = magnetLink.match(/urn:btih:([a-z2-7]{32})/i); // Base32 encoded infohash
            if (matchBase32) return matchBase32[1].toLowerCase();
        }
        return match ? match[1].toLowerCase() : null;
    }

    async findExistingTorrent(infoHash) {
        if (!infoHash) return null;
        try {
            const torrents = await torboxApi.getMyTorrents(this.apiKey);
            return torrents.find(t => t.hash && t.hash.toLowerCase() === infoHash);
        } catch (error) {
            console.error(`[TorboxService] Error finding existing torrent for hash ${infoHash}:`, error.message);
            return null; // Or rethrow, depending on desired error handling
        }
    }

    /**
     * Checks if a magnet link is already present in the user's Torbox account.
     * This serves as a form of "cache" check.
     * @param {string} magnetLink - The magnet link to check.
     * @returns {Promise<boolean>} - True if the magnet is found, false otherwise.
     */
    async isMagnetCached(magnetLink) {
        const infoHash = this.getInfoHashFromMagnet(magnetLink);
        if (!infoHash) {
            console.warn(`[TorboxService] Could not extract infoHash from magnet for cache check: ${magnetLink}`);
            return false;
        }
        try {
            const existingTorrent = await this.findExistingTorrent(infoHash);
            return !!existingTorrent;
        } catch (error) {
            console.error(`[TorboxService] Error checking if magnet is cached (hash ${infoHash}):`, error.message);
            return false;
        }
    }

    async addMagnetOnly(magnetLink) {
        const infoHash = this.getInfoHashFromMagnet(magnetLink);
        if (!infoHash) {
            console.error('[TorboxService] Invalid magnet link, cannot extract infoHash:', magnetLink);
            throw new Error('Invalid magnet link.');
        }

        try {
            const existingTorrent = await this.findExistingTorrent(infoHash);
            if (existingTorrent && existingTorrent.id) {
                console.log(`[TorboxService] Magnet with hash ${infoHash} already exists with ID: ${existingTorrent.id}`);
                return existingTorrent.id;
            }

            console.log(`[TorboxService] Adding new magnet with hash ${infoHash}`);
            const newTorrentId = await torboxApi.createTorrent(magnetLink, this.apiKey);
            console.log(`[TorboxService] Magnet with hash ${infoHash} added successfully with ID: ${newTorrentId}`);
            return newTorrentId;
        } catch (error) {
            console.error(`[TorboxService] Error adding magnet with hash ${infoHash}:`, error.message);
            return null;
        }
    }

    async getTorrentStatusAndLinks(magnetLink, fileIndex, season, episode, streamType, episodeName) {
        const infoHash = this.getInfoHashFromMagnet(magnetLink);
        if (!infoHash) {
            console.error('[TorboxService] Invalid magnet link for status/links:', magnetLink);
            return { status: 'error', links: [] };
        }

        let torrentId;
        try {
            const existingTorrent = await this.findExistingTorrent(infoHash);
            if (!existingTorrent || !existingTorrent.id) {
                console.log(`[TorboxService] Torrent with hash ${infoHash} not found in user's list. Attempting to add.`);
                // Optionally, you could decide to add it here if that's the desired flow,
                // or return 'not_found' if it must exist.
                // For now, let's assume it must be added first via addMagnetOnly or similar.
                return { status: 'not_found', links: [] };
            }
            torrentId = existingTorrent.id;

            const torrentInfo = await torboxApi.getTorrentInfo(torrentId, this.apiKey);

            // Torbox API doc is not explicit on status strings. Common ones are 'downloading', 'completed', 'error', 'paused'.
            // We'll infer based on file presence and assume 'completed' if files exist.
            // A more robust solution would require Torbox to provide a clear status field.
            const statusMap = {
                // Example mapping, adjust if Torbox provides specific status strings
                'downloading': 'downloading',
                'seeding': 'completed', // Seeding implies completed download
                'completed': 'completed',
                'finished': 'completed',
                'stopped': 'paused', // Or 'error' depending on context
                'paused': 'paused',
                'error': 'error',
                'stalled': 'downloading', // Stalled but could resume
            };
            
            let currentStatus = 'error'; // Default to error
            if (torrentInfo && torrentInfo.status_label) { // Assuming 'status_label' or similar field exists
                 currentStatus = statusMap[torrentInfo.status_label.toLowerCase()] || 'downloading'; // Default to downloading if unknown
            } else if (torrentInfo && torrentInfo.files && torrentInfo.files.length > 0 && torrentInfo.progress === 100) {
                // Fallback: if files exist and progress is 100, assume completed
                currentStatus = 'completed';
            } else if (torrentInfo && torrentInfo.progress < 100) {
                currentStatus = 'downloading';
            }


            if (currentStatus !== 'completed') {
                console.log(`[TorboxService] Torrent ${torrentId} (hash ${infoHash}) status is ${currentStatus}.`);
                return { status: currentStatus, links: [] };
            }

            if (!torrentInfo.files || torrentInfo.files.length === 0) {
                console.error(`[TorboxService] Torrent ${torrentId} (hash ${infoHash}) is completed but has no files listed.`);
                return { status: 'error', links: [] }; // No files to select from
            }

            const enrichedFiles = torrentInfo.files.map(file => ({
                ...file, // id, name, size should be here
                path: file.name, // Assuming 'name' is the full path/filename
                extension: getFileExtension(file.name),
                isVideo: isVideoFile(file.name)
            }));

            const bestFile = this.selectBestFile(enrichedFiles, episode, episodeName, { fileIndex, streamType });
            if (!bestFile || !bestFile.id) { // Torbox file ID is needed
                console.error(`[TorboxService] Could not select a suitable file for torrent ${torrentId} (hash ${infoHash}).`);
                return { status: 'error', links: [] };
            }

            const downloadLink = await torboxApi.requestDownloadLink(torrentId, bestFile.id, this.apiKey);
            if (!downloadLink) {
                console.error(`[TorboxService] Failed to get download link for torrent ${torrentId}, file ${bestFile.id} (hash ${infoHash}).`);
                return { status: 'error', links: [] };
            }

            console.log(`[TorboxService] Successfully retrieved download link for torrent ${torrentId}, file ${bestFile.id} (hash ${infoHash}).`);
            return {
                status: 'completed',
                links: [{ url: downloadLink, filename: bestFile.name }]
            };
        } catch (error) {
            console.error(`[TorboxService] Error getting status/links for torrent ID ${torrentId || 'N/A'} (hash ${infoHash}):`, error.message);
            return { status: 'error', links: [] };
        }
    }
}

module.exports = Torbox;
