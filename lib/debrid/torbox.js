const DebridService = require('./baseService');
const TorboxClient = require('@torbox/torbox-api');
const { getFileExtension, isVideoFile } = require('../utils/fileUtils');

class Torbox extends DebridService {
    constructor(apiKey) {
        super(apiKey);
        this.client = new TorboxClient({ api_key: apiKey });
    }

    async checkApiKey() {
        try {
            await this.client.torrents.list();
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
        const torrents = await this.client.torrents.list();
        return torrents.find(t => t.hash && t.hash.toLowerCase() === infoHash);
    }

    async addMagnetOnly(magnetLink) {
        try {
            const infoHash = this.getInfoHashFromMagnet(magnetLink);
            if (!infoHash) throw new Error('Invalid magnet link.');

            const existingTorrent = await this.findExistingTorrent(infoHash);
            if (existingTorrent) return existingTorrent.id;

            const result = await this.client.torrents.create(magnetLink);
            return result.torrent_id;
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

            const torrentInfo = await this.client.torrents.get(existingTorrent.id);
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

            const downloadLink = await this.client.torrents.requestDownload(existingTorrent.id, bestFile.id);
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
