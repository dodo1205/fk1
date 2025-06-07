const axios = require('axios');
const DebridService = require('./baseService');
const { selectBestFile, isVideoFile, getFileExtension } = require('../fileUtils');

class RealDebrid extends DebridService {
    constructor(apiKey) {
        super(apiKey);
        this.baseUrl = 'https://api.real-debrid.com/rest/1.0';
        this.headers = { 'Authorization': `Bearer ${this.apiKey}` };
    }

    async checkApiKey() {
        try {
            const response = await axios.get(`${this.baseUrl}/user`, { headers: this.headers });
            return response.status === 200;
        } catch (error) {
            console.error('Real-Debrid API key check failed:', error.message);
            return false;
        }
    }

    getInfoHashFromMagnet(magnetLink) {
        const match = magnetLink.match(/urn:btih:([a-zA-Z0-9]+)/i);
        return match ? match[1].toLowerCase() : null;
    }

    async addMagnetOnly(magnetLink, streamType, episodeNumber, episodeName) {
        try {
            const infoHash = this.getInfoHashFromMagnet(magnetLink);
            if (!infoHash) throw new Error('Invalid magnet link.');

            const addResponse = await axios.post(`${this.baseUrl}/torrents/addMagnet`,
                `magnet=${encodeURIComponent(magnetLink)}`,
                { headers: { ...this.headers, 'Content-Type': 'application/x-www-form-urlencoded' } }
            );

            const torrentId = addResponse.data.id;
            if (torrentId && episodeNumber) {
                this.selectFiles(torrentId, null, null, episodeNumber, streamType, episodeName)
                    .catch(err => console.warn(`[RealDebrid] Non-blocking file selection failed: ${err.message}`));
            }
            return torrentId;
        } catch (error) {
            console.error(`[RealDebrid] Error adding magnet:`, error.message);
            return null;
        }
    }

    async getTorrentStatusAndLinks(magnetLink, fileIndex, season, episodeNumber, streamType, episodeName) {
        try {
            const infoHash = this.getInfoHashFromMagnet(magnetLink);
            if (!infoHash) throw new Error('Invalid magnet link.');

            const torrents = await axios.get(`${this.baseUrl}/torrents`, { headers: this.headers });
            const matchingTorrents = torrents.data.filter(t => t.hash.toLowerCase() === infoHash);
            if (matchingTorrents.length === 0) return { status: 'not_found', links: [] };

            const torrent = matchingTorrents.sort((a, b) => new Date(b.added) - new Date(a.added))[0];
            let torrentInfo = await this.getTorrentInfo(torrent.id);

            if (torrentInfo.status === 'waiting_files_selection' && episodeNumber) {
                await this.selectFiles(torrent.id, null, null, episodeNumber, streamType, episodeName);
                torrentInfo = await this.getTorrentInfo(torrent.id);
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
                isVideo: isVideoFile(file.path),
                url: torrentInfo.links[torrentInfo.files.findIndex(f => f.id === file.id)]
            }));

            const bestFile = this.selectBestFile(enrichedFiles, episodeNumber, episodeName, { fileIndex, streamType });
            if (!bestFile) return { status: 'error', links: [] };

            const selectedLink = torrentInfo.links.find(link => link.includes(bestFile.path.split('/').pop()));
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

    async getTorrentInfo(torrentId) {
        const response = await axios.get(`${this.baseUrl}/torrents/info/${torrentId}`, { headers: this.headers });
        return response.data;
    }

    async selectFiles(torrentId, fileIndex, season, episode, streamType, episodeName) {
        const torrentInfo = await this.getTorrentInfo(torrentId);
        const enrichedFiles = torrentInfo.files.map(file => ({
            ...file,
            extension: getFileExtension(file.path),
            isVideo: isVideoFile(file.path)
        }));

        const bestFile = this.selectBestFile(enrichedFiles, episode, episodeName, { fileIndex, streamType });
        const filesToSelect = bestFile ? bestFile.id.toString() : 'all';

        await axios.post(`${this.baseUrl}/torrents/selectFiles/${torrentId}`,
            `files=${filesToSelect}`,
            { headers: { ...this.headers, 'Content-Type': 'application/x-www-form-urlencoded' } }
        );
    }

    async unrestrictLink(link) {
        try {
            const response = await axios.post(`${this.baseUrl}/unrestrict/link`,
                `link=${encodeURIComponent(link)}`,
                { headers: { ...this.headers, 'Content-Type': 'application/x-www-form-urlencoded' } }
            );
            return response.data;
        } catch (error) {
            console.error('[RealDebrid] Error unrestricting link:', error.message);
            throw error;
        }
    }
}

module.exports = RealDebrid;
