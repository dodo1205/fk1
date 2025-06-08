const DebridService = require('./baseService');
const AllDebridClient = require('all-debrid-api');
const { getFileExtension, isVideoFile } = require('../utils/fileUtils');

class AllDebrid extends DebridService {
    constructor(apiKey) {
        super(apiKey);
        this.client = new AllDebridClient(apiKey);
    }

    async checkApiKey() {
        try {
            const check = await this.client.user.get();
            return check.status === 'success';
        } catch (error) {
            console.error('AllDebrid API key check failed:', error.message);
            return false;
        }
    }

    async addMagnetOnly(magnetLink) {
        try {
            const result = await this.client.magnet.upload(magnetLink);
            if (result.status !== 'success' || !result.data.magnets || result.data.magnets.length === 0) {
                throw new Error(result.data.error?.message || 'Failed to upload magnet');
            }
            const magnet = result.data.magnets[0];
            console.log(`[AllDebrid] Magnet added or already present with ID: ${magnet.id}`);
            return magnet.id;
        } catch (error) {
            console.error(`[AllDebrid] Error adding magnet:`, error.message);
            return null;
        }
    }

    async getTorrentStatusAndLinks(magnetLink, fileIndex, season, episode, streamType, episodeName) {
        let magnetId = null;
        try {
            const uploadResult = await this.client.magnet.upload(magnetLink);
            if (uploadResult.status !== 'success' || !uploadResult.data.magnets || uploadResult.data.magnets.length === 0) {
                throw new Error(uploadResult.data.error?.message || 'Failed to upload magnet');
            }
            magnetId = uploadResult.data.magnets[0].id;

            const statusResult = await this.client.magnet.status(magnetId);
            if (statusResult.status !== 'success') {
                throw new Error(statusResult.data.error?.message || 'Failed to get magnet status');
            }
            const magnetInfo = statusResult.data.magnets;

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
            const result = await this.client.link.unlock(link);
            if (result.status !== 'success' || !result.data.link) {
                throw new Error(result.data.error?.message || 'Failed to unrestrict link');
            }
            return result.data.link;
        } catch (error) {
            console.error('[AllDebrid] Error unrestricting link:', error.message);
            throw error;
        }
    }
}

module.exports = AllDebrid;
