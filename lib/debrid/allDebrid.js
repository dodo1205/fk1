const axios = require('axios');
const DebridService = require('./baseService');
const { selectBestFile, isVideoFile, getFileExtension } = require('../fileUtils');

class AllDebrid extends DebridService {
    constructor(apiKey) {
        super(apiKey);
        this.baseUrl = 'https://api.alldebrid.com/v4';
    }

    async checkApiKey() {
        try {
            const response = await axios.get(`${this.baseUrl}/user`, {
                params: { agent: 'FKStream', apikey: this.apiKey }
            });
            return response.data.status === 'success';
        } catch (error) {
            console.error('AllDebrid API key check failed:', error.message);
            return false;
        }
    }

    async addMagnetOnly(magnetLink) {
        try {
            const response = await axios.get(`${this.baseUrl}/magnet/upload`, {
                params: { agent: 'FKStream', apikey: this.apiKey, magnets: magnetLink }
            });

            if (response.data.status !== 'success' || !response.data.data.magnets || response.data.data.magnets.length === 0) {
                const errorMessage = response.data.error ? response.data.error.message : 'Failed to upload magnet or invalid response.';
                throw new Error(errorMessage);
            }

            const magnet = response.data.data.magnets[0];
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
            const uploadResponse = await axios.get(`${this.baseUrl}/magnet/upload`, {
                params: { agent: 'FKStream', apikey: this.apiKey, magnets: magnetLink }
            });

            if (uploadResponse.data.status !== 'success' || !uploadResponse.data.data.magnets || uploadResponse.data.data.magnets.length === 0) {
                throw new Error('Failed to retrieve magnet ID.');
            }
            magnetId = uploadResponse.data.data.magnets[0].id;

            const statusResponse = await axios.get(`${this.baseUrl}/magnet/status`, {
                params: { agent: 'FKStream', apikey: this.apiKey, id: magnetId }
            });

            if (statusResponse.data.status !== 'success') {
                throw new Error(`Failed to get magnet status for ID ${magnetId}.`);
            }

            const magnetInfo = statusResponse.data.data.magnets;
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
            const response = await axios.get(`${this.baseUrl}/link/unlock`, {
                params: { agent: 'FKStream', apikey: this.apiKey, link: link }
            });

            if (response.data.status !== 'success' || !response.data.data.link) {
                const errorMessage = response.data.error ? response.data.error.message : 'Failed to unrestrict link.';
                throw new Error(errorMessage);
            }

            return response.data.data.link;
        } catch (error) {
            console.error('[AllDebrid] Error unrestricting link:', error.message);
            throw error;
        }
    }
}

module.exports = AllDebrid;
