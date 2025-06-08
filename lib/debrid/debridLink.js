const DebridService = require('./baseService');
const DebridLinkClient = require('debrid-link-api');
const { getFileExtension, isVideoFile } = require('../utils/fileUtils');

class DebridLink extends DebridService {
    constructor(apiKey) {
        super(apiKey);
        this.client = new DebridLinkClient(apiKey);
    }

    async checkApiKey() {
        try {
            // Debrid-Link API does not have a dedicated user check endpoint that returns success/fail.
            // We'll try to list torrents, which requires a valid key.
            await this.client.seedbox.list();
            return true;
        } catch (error) {
            console.error('Debrid-Link API key check failed:', error.message);
            return false;
        }
    }

    getInfoHashFromMagnet(magnetLink) {
        const match = magnetLink.match(/urn:btih:([a-zA-Z0-9]+)/i);
        return match ? match[1].toLowerCase() : null;
    }

    async addMagnetOnly(magnetLink) {
        try {
            const result = await this.client.seedbox.add(magnetLink, null, true);
            if (!result.value) {
                throw new Error(result.error || 'Failed to add magnet');
            }
            console.log(`[DebridLink] Magnet added successfully: ${result.value.name}`);
            return result.value.id;
        } catch (error) {
            console.error(`[DebridLink] Error adding magnet:`, error.message);
            return null;
        }
    }

    async getTorrentStatusAndLinks(magnetLink, fileIndex, season, episode, streamType, episodeName) {
        try {
            const infoHash = this.getInfoHashFromMagnet(magnetLink);
            if (!infoHash) throw new Error('Invalid magnet link.');

            const torrents = await this.client.seedbox.list();
            const torrent = torrents.value.find(t => t.hashString && t.hashString.toLowerCase() === infoHash);

            if (!torrent) {
                return { status: 'not_found', links: [] };
            }

            const isCompleted = torrent.downloadPercent === 100;
            const currentStatus = isCompleted ? 'completed' : 'downloading';

            if (currentStatus !== 'completed') {
                return { status: currentStatus, links: [] };
            }

            const enrichedFiles = torrent.files.map(file => ({
                ...file,
                path: file.name,
                extension: getFileExtension(file.name),
                isVideo: isVideoFile(file.name),
                url: file.downloadUrl // Debrid-Link provides the direct URL here
            }));

            const bestFile = this.selectBestFile(enrichedFiles, episode, episodeName, { fileIndex, streamType });
            if (!bestFile) {
                return { status: 'error', links: [] };
            }

            return {
                status: 'completed',
                links: [{ url: bestFile.url, filename: bestFile.name }]
            };

        } catch (error) {
            console.error(`[DebridLink] Error getting status/links:`, error.message);
            return { status: 'error', links: [] };
        }
    }

    // Debrid-Link links are direct, no unrestrict needed.
}

module.exports = DebridLink;
