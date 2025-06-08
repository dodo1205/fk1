const DebridService = require('./baseService');
const realDebridApi = require('../api/realDebridApi');
const { getFileExtension, isVideoFile } = require('../utils/fileUtils');

class RealDebrid extends DebridService {
    constructor(apiKey) {
        super(apiKey);
    }

    async checkApiKey() {
        try {
            await realDebridApi.checkUser(this.apiKey);
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

    async addMagnetOnly(magnetLink, streamType, episodeNumber, episodeName) {
        try {
            const infoHash = this.getInfoHashFromMagnet(magnetLink);
            if (!infoHash) throw new Error('Invalid magnet link.');

            const addResponse = await realDebridApi.addMagnet(magnetLink, this.apiKey);

            const torrentId = addResponse.id;
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

            const torrents = await realDebridApi.getTorrents(this.apiKey);
            const matchingTorrents = torrents.filter(t => t.hash.toLowerCase() === infoHash);
            if (matchingTorrents.length === 0) return { status: 'not_found', links: [] };

            const torrent = matchingTorrents.sort((a, b) => new Date(b.added) - new Date(a.added))[0];
            let torrentInfo = await realDebridApi.getTorrentInfo(torrent.id, this.apiKey);

            if (torrentInfo.status === 'waiting_files_selection' && episodeNumber) {
                await this.selectFiles(torrent.id, null, null, episodeNumber, streamType, episodeName);
                torrentInfo = await realDebridApi.getTorrentInfo(torrent.id, this.apiKey);
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

    async selectFiles(torrentId, fileIndex, season, episode, streamType, episodeName) {
        const torrentInfo = await realDebridApi.getTorrentInfo(torrentId, this.apiKey);
        const enrichedFiles = torrentInfo.files.map(file => ({
            ...file,
            extension: getFileExtension(file.path),
            isVideo: isVideoFile(file.path)
        }));

        const bestFile = this.selectBestFile(enrichedFiles, episode, episodeName, { fileIndex, streamType });
        const filesToSelect = bestFile ? bestFile.id.toString() : 'all';

        await realDebridApi.selectFiles(torrentId, filesToSelect, this.apiKey);
    }

    async unrestrictLink(link) {
        try {
            return await realDebridApi.unrestrictLink(link, this.apiKey);
        } catch (error) {
            console.error('[RealDebrid] Error unrestricting link:', error.message);
            throw error;
        }
    }
}

module.exports = RealDebrid;
