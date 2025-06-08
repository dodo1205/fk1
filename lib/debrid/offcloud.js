const DebridService = require('./baseService');
const OffcloudClient = require('offcloud-api');
const { getFileExtension, isVideoFile } = require('../utils/fileUtils');

class Offcloud extends DebridService {
    constructor(apiKey) {
        super(apiKey);
        this.client = new OffcloudClient(apiKey);
    }

    async checkApiKey() {
        try {
            // Offcloud API does not have a dedicated user check endpoint.
            // We'll try to list history, which requires a valid key.
            await this.client.cloud.history();
            return true;
        } catch (error) {
            console.error('Offcloud API key check failed:', error.message);
            return false;
        }
    }

    getInfoHashFromMagnet(magnetLink) {
        const match = magnetLink.match(/urn:btih:([a-zA-Z0-9]+)/i);
        return match ? match[1].toLowerCase() : null;
    }

    async addMagnetOnly(magnetLink) {
        try {
            const result = await this.client.cloud.download(magnetLink);
            if (!result || !result.requestId) {
                throw new Error('Failed to add magnet to Offcloud');
            }
            console.log(`[Offcloud] Magnet added successfully with requestId: ${result.requestId}`);
            return result.requestId;
        } catch (error) {
            console.error(`[Offcloud] Error adding magnet:`, error.message);
            return null;
        }
    }

    async getTorrentStatusAndLinks(magnetLink, fileIndex, season, episode, streamType, episodeName) {
        try {
            const infoHash = this.getInfoHashFromMagnet(magnetLink);
            if (!infoHash) throw new Error('Invalid magnet link.');

            const history = await this.client.cloud.history();
            const torrent = history.find(t => t.originalLink && t.originalLink.toLowerCase().includes(infoHash));

            if (!torrent) {
                return { status: 'not_found', links: [] };
            }

            const statusMap = {
                'downloaded': 'completed',
                'created': 'downloading',
                'downloading': 'downloading',
                'error': 'error',
                'canceled': 'error'
            };
            const currentStatus = statusMap[torrent.status] || 'error';

            if (currentStatus !== 'completed') {
                return { status: currentStatus, links: [] };
            }

            // For completed torrents, the download link is constructed.
            const downloadLink = `https://${torrent.server}.offcloud.com/cloud/download/${torrent.requestId}/${torrent.fileName}`;
            
            // Offcloud doesn't provide a file list in the history, so we assume a single file torrent.
            // This is a limitation of the Offcloud API via this library.
            const enrichedFiles = [{
                name: torrent.fileName,
                path: torrent.fileName,
                url: downloadLink,
                extension: getFileExtension(torrent.fileName),
                isVideo: isVideoFile(torrent.fileName)
            }];

            const bestFile = this.selectBestFile(enrichedFiles, episode, episodeName, { fileIndex, streamType });
            if (!bestFile) {
                return { status: 'error', links: [] };
            }

            return {
                status: 'completed',
                links: [{ url: bestFile.url, filename: bestFile.name }]
            };

        } catch (error) {
            console.error(`[Offcloud] Error getting status/links:`, error.message);
            return { status: 'error', links: [] };
        }
    }

    // Offcloud links are direct, no unrestrict needed.
}

module.exports = Offcloud;
