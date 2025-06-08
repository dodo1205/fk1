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
            console.error('Torbox API key check failed:', error.message);
            return false;
        }
    }

    getInfoHashFromMagnet(magnetLink) {
        const match = magnetLink.match(/urn:btih:([a-zA-Z0-9]+)/i);
        return match ? match[1].toLowerCase() : null;
    }

    async findExistingTorrent(infoHash) {
        const torrents = await torboxApi.getMyTorrents(this.apiKey);
        return torrents.find(t => t.hash && t.hash.toLowerCase() === infoHash);
    }

    async addMagnetOnly(magnetLink) {
        try {
            const infoHash = this.getInfoHashFromMagnet(magnetLink);
            if (!infoHash) throw new Error('Invalid magnet link.');

            const existingTorrent = await this.findExistingTorrent(infoHash);
            if (existingTorrent) return existingTorrent.id;

            return await torboxApi.createTorrent(magnetLink, this.apiKey);
        } catch (error) {
            console.error(`[Torbox] Error adding magnet:`, error.message);
            return null;
        }
    }

    async getTorrentStatusAndLinks(magnetLink, fileIndex, season, episode, streamType, episodeName) {
        try {
            const infoHash = this.getInfoHashFromMagnet(magnetLink);
            if (!infoHash) throw new Error('Invalid magnet link.');

            const existingTorrent = await this.findExistingTorrent(infoHash);
            if (!existingTorrent) return { status: 'not_found', links: [] };

            const torrentInfo = await torboxApi.getTorrentInfo(existingTorrent.id, this.apiKey);
            const isCompleted = torrentInfo && torrentInfo.files && torrentInfo.files.length > 0;
            const currentStatus = isCompleted ? 'completed' : 'downloading';

            if (currentStatus !== 'completed') {
                return { status: currentStatus, links: [] };
            }

            const enrichedFiles = torrentInfo.files.map(file => ({
                ...file,
                path: file.name,
                extension: getFileExtension(file.name),
                isVideo: isVideoFile(file.name)
            }));

            const bestFile = this.selectBestFile(enrichedFiles, episode, episodeName, { fileIndex, streamType });
            if (!bestFile) return { status: 'error', links: [] };

            const downloadLink = await torboxApi.requestDownloadLink(existingTorrent.id, bestFile.id, this.apiKey);
            if (!downloadLink) return { status: 'error', links: [] };

            return {
                status: 'completed',
                links: [{ url: downloadLink, filename: bestFile.name }]
            };
        } catch (error) {
            console.error(`[Torbox] Error getting status/links:`, error.message);
            return { status: 'error', links: [] };
        }
    }
}

module.exports = Torbox;
