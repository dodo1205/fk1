const DebridService = require('./baseService');
const RealDebridClient = require('real-debrid-api');
const { getFileExtension, isVideoFile } = require('../utils/fileUtils');

class RealDebrid extends DebridService {
    constructor(apiKey) {
        super(apiKey);
        this.client = new RealDebridClient(apiKey);
    }

    async checkApiKey() {
        try {
            await this.client.user.get();
            return true;
        } catch (error) {
            console.error('Real-Debrid API key check failed:', error.message);
            return false;
        }
    }

    getInfoHashFromMagnet(magnetLink) {
        const match = magnetLink.match(/urn:btih:([a-zA-Z0-9]+)/i);
        return match ? match[1].toLowerCase() : null;
    }

    async addMagnetOnly(magnetLink) {
        try {
            const result = await this.client.torrents.addMagnet(magnetLink);
            console.log(`[RealDebrid] Magnet added successfully with ID: ${result.id}`);
            return result.id;
        } catch (error) {
            console.error(`[RealDebrid] Error adding magnet:`, error.message);
            return null;
        }
    }

    async getTorrentStatusAndLinks(magnetLink, fileIndex, season, episode, streamType, episodeName) {
        try {
            const infoHash = this.getInfoHashFromMagnet(magnetLink);
            if (!infoHash) throw new Error('Invalid magnet link.');

            const torrents = await this.client.torrents.get();
            const matchingTorrents = torrents.filter(t => t.hash.toLowerCase() === infoHash);
            if (matchingTorrents.length === 0) {
                // If not in list, try adding it. RD handles duplicates gracefully.
                const torrentId = await this.addMagnetOnly(magnetLink);
                if (!torrentId) return { status: 'not_found', links: [] };
                await this.selectFiles(torrentId, fileIndex, season, episode, streamType, episodeName);
                // Give RD a moment to process
                await new Promise(resolve => setTimeout(resolve, 3000)); 
            }
            
            const updatedTorrents = await this.client.torrents.get();
            const finalTorrents = updatedTorrents.filter(t => t.hash.toLowerCase() === infoHash);
            if (finalTorrents.length === 0) return { status: 'not_found', links: [] };

            const torrent = finalTorrents.sort((a, b) => new Date(b.added) - new Date(a.added))[0];
            let torrentInfo = await this.client.torrents.info(torrent.id);

            if (torrentInfo.status === 'waiting_files_selection') {
                await this.selectFiles(torrent.id, fileIndex, season, episode, streamType, episodeName);
                torrentInfo = await this.client.torrents.info(torrent.id);
            }

            const statusMap = {
                'magnet_error': 'error', 'magnet_conversion': 'downloading', 'waiting_files_selection': 'downloading',
                'queued': 'downloading', 'downloading': 'downloading', 'downloaded': 'completed',
                'error': 'error', 'virus': 'error', 'compressing': 'downloading', 'uploading': 'downloading'
            };
            const currentStatus = statusMap[torrentInfo.status] || 'error';

            if (currentStatus !== 'completed' || !torrentInfo.links || torrentInfo.links.length === 0) {
                return { status: currentStatus, links: [] };
            }

            const enrichedFiles = torrentInfo.files.map(file => ({
                ...file,
                extension: getFileExtension(file.path),
                isVideo: isVideoFile(file.path)
            }));

            const bestFile = this.selectBestFile(enrichedFiles, episode, episodeName, { fileIndex, streamType });
            if (!bestFile) return { status: 'error', links: [] };

            const selectedLink = torrentInfo.links.find(link => link.includes(encodeURI(bestFile.path.split('/').pop())));
            if (!selectedLink) return { status: 'error', links: [] };

            return {
                status: 'completed',
                links: [{ url: selectedLink, filename: bestFile.path.split('/').pop() }]
            };
        } catch (error) {
            console.error(`[RealDebrid] Error getting status/links:`, error.message);
            return { status: 'error', links: [] };
        }
    }

    async selectFiles(torrentId, fileIndex, season, episode, streamType, episodeName) {
        const torrentInfo = await this.client.torrents.info(torrentId);
        const enrichedFiles = torrentInfo.files.map(file => ({
            ...file,
            extension: getFileExtension(file.path),
            isVideo: isVideoFile(file.path)
        }));

        const bestFile = this.selectBestFile(enrichedFiles, episode, episodeName, { fileIndex, streamType });
        const filesToSelect = bestFile ? bestFile.id.toString() : 'all';

        await this.client.torrents.selectFiles(torrentId, filesToSelect);
    }

    async unrestrictLink(link) {
        try {
            const result = await this.client.unrestrict.link(link);
            return result.download;
        } catch (error) {
            console.error('[RealDebrid] Error unrestricting link:', error.message);
            throw error;
        }
    }
}

module.exports = RealDebrid;
