const DebridService = require('./baseService');
const { TorboxApi } = require('@torbox/torbox-api');
const { getFileExtension, isVideoFile } = require('../utils/fileUtils');

class Torbox extends DebridService {
    constructor(apiKey) {
        super(apiKey);
        // The token is the API key for Torbox
        this.client = new TorboxApi({ token: apiKey });
    }

    async checkApiKey() {
        try {
            await this.client.torrent.list();
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
        const torrentsResult = await this.client.torrent.list();
        if (!torrentsResult.success || !torrentsResult.data) {
            return null;
        }
        return torrentsResult.data.find(t => t.hash && t.hash.toLowerCase() === infoHash);
    }

    async addMagnetOnly(magnetLink) {
        try {
            const infoHash = this.getInfoHashFromMagnet(magnetLink);
            if (!infoHash) throw new Error('Invalid magnet link.');

            const existingTorrent = await this.findExistingTorrent(infoHash);
            if (existingTorrent) {
                console.log(`[Torbox] Found existing torrent with ID: ${existingTorrent.id}`);
                return existingTorrent.id;
            }

            const result = await this.client.torrent.create({ magnet: magnetLink });
            if (!result.success || !result.data.torrent_id) {
                throw new Error('Failed to create torrent on Torbox');
            }
            return result.data.torrent_id;
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

            const torrentInfoResult = await this.client.torrent.get({ torrent_id: existingTorrent.id });
            if (!torrentInfoResult.success) {
                 return { status: 'error', links: [] };
            }
            const torrentInfo = torrentInfoResult.data;
            
            const isCompleted = torrentInfo && torrentInfo.files && torrentInfo.files.length > 0 && torrentInfo.progress === 100;
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

            const downloadLinkResult = await this.client.torrent.requestDownload({ torrent_id: existingTorrent.id, file_id: bestFile.id });
            if (!downloadLinkResult.success || !downloadLinkResult.data) {
                return { status: 'error', links: [] };
            }

            return {
                status: 'completed',
                links: [{ url: downloadLinkResult.data, filename: bestFile.name }]
            };
        } catch (error) {
            console.error(`[Torbox] Error getting status/links:`, error.message);
            return { status: 'error', links: [] };
        }
    }
}

module.exports = Torbox;
