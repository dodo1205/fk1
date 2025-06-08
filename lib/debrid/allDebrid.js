const DebridService = require('./baseService');
const allDebridApi = require('../api/allDebridApi');
const { getFileExtension, isVideoFile } = require('../utils/fileUtils');

class AllDebrid extends DebridService {
    constructor(apiKey) {
        super(apiKey);
    }

    async checkApiKey() {
        try {
            await allDebridApi.checkUser(this.apiKey);
            return true;
        } catch (error) {
            console.error('AllDebrid API key check failed:', error.message);
            return false;
        }
    }

    async addMagnetOnly(magnetLink) {
        try {
            const magnet = await allDebridApi.uploadMagnet(magnetLink, this.apiKey);
            console.log(`[AllDebrid] Magnet added or already present with ID: ${magnet.id || magnet.hash}`);
            return magnet.id || magnet.hash;
        } catch (error) {
            console.error(`[AllDebrid] Error adding magnet:`, error.message);
            return null;
        }
    }

    async getTorrentStatusAndLinks(magnetLink, fileIndex, season, episode, streamType, episodeName) {
        let magnetId = null;
        try {
            const uploadedMagnet = await allDebridApi.uploadMagnet(magnetLink, this.apiKey);
            magnetId = uploadedMagnet.id;

            const magnetInfo = await allDebridApi.getMagnetStatus(magnetId, this.apiKey);

            const statusMap = {
                'Queued': 'downloading',
                'Downloading': 'downloading',
                'Uploading': 'downloading',
                'Ready': 'completed',
                'Error': 'error',
                'File Error': 'error'
            };
            const currentStatus = statusMap[magnetInfo.status] || 'error';

            if (currentStatus !== 'completed') {
                return { status: currentStatus, links: [] };
            }

            if (!magnetInfo.links || magnetInfo.links.length === 0) {
                return { status: 'error', links: [] };
            }

            const enrichedFiles = magnetInfo.links.map(link => ({
                ...link,
                url: link.link,
                name: link.filename,
                path: link.filename,
                extension: getFileExtension(link.filename),
                isVideo: isVideoFile(link.filename)
            }));

            const bestFile = this.selectBestFile(enrichedFiles, episode, episodeName, { fileIndex, streamType });

            if (!bestFile) {
                return { status: 'error', links: [] };
            }

            return {
                status: 'completed',
                links: [{ url: bestFile.url, filename: bestFile.filename }]
            };
        } catch (error) {
            console.error(`[AllDebrid] Error getting status/links for magnet ${magnetId || ''}:`, error.message);
            return { status: 'error', links: [] };
        }
    }

    async unrestrictLink(link) {
        try {
            return await allDebridApi.unrestrictLink(link, this.apiKey);
        } catch (error) {
            console.error('[AllDebrid] Error unrestricting link:', error.message);
            throw error;
        }
    }
}

module.exports = AllDebrid;
