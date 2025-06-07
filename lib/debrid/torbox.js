const axios = require('axios');
const DebridService = require('./baseService');
const { selectBestFile, isVideoFile, getFileExtension } = require('../fileUtils');
const FormData = require('form-data');

class Torbox extends DebridService {
    constructor(apiKey) {
        super(apiKey);
        this.baseUrl = 'https://api.torbox.app/v1';
        this.headers = { 'Authorization': `Bearer ${this.apiKey}` };
    }

    async checkApiKey() {
        try {
            const response = await axios.get(`${this.baseUrl}/api/torrents/mylist`, { headers: this.headers });
            return response.data && response.data.success === true;
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
        const torrents = await this.getMyTorrents();
        return torrents.find(t => t.hash && t.hash.toLowerCase() === infoHash);
    }

    async getMyTorrents() {
        try {
            const response = await axios.get(`${this.baseUrl}/api/torrents/mylist`, { headers: this.headers });
            return response.data.success ? response.data.data || [] : [];
        } catch (error) {
            console.error(`[Torbox] Error getting torrents:`, error.message);
            return [];
        }
    }

    async addMagnetOnly(magnetLink) {
        try {
            const infoHash = this.getInfoHashFromMagnet(magnetLink);
            if (!infoHash) throw new Error('Invalid magnet link.');

            const existingTorrent = await this.findExistingTorrent(infoHash);
            if (existingTorrent) return existingTorrent.id;

            const form = new FormData();
            form.append('magnet', magnetLink);
            
            const response = await axios.post(`${this.baseUrl}/api/torrents/createtorrent`, form, {
                headers: { ...this.headers, ...form.getHeaders() }
            });

            if (!response.data.success || !response.data.data.torrent_id) {
                throw new Error('Failed to create torrent.');
            }
            return response.data.data.torrent_id;
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

            const torrentInfo = await this.getTorrentInfo(existingTorrent.id);
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

            const downloadLink = await this.requestDownloadLink(existingTorrent.id, bestFile.id);
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

    async getTorrentInfo(torrentId) {
        const response = await axios.get(`${this.baseUrl}/api/torrents/mylist`, {
            params: { id: torrentId, bypass_cache: true },
            headers: this.headers
        });
        if (!response.data.success) throw new Error('Failed to get torrent info.');
        return response.data.data;
    }

    async requestDownloadLink(torrentId, fileId) {
        const response = await axios.get(`${this.baseUrl}/api/torrents/requestdl`, {
            params: { token: this.apiKey, torrent_id: torrentId, file_id: fileId },
            headers: this.headers
        });
        if (!response.data.success) throw new Error('Failed to generate download link.');
        return response.data.data;
    }
}

module.exports = Torbox;
