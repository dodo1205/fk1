const DebridService = require('./baseService');
const PremiumizeClient = require('premiumize-api');
const { getFileExtension, isVideoFile } = require('../utils/fileUtils');

class Premiumize extends DebridService {
    constructor(apiKey) {
        super(apiKey);
        this.client = new PremiumizeClient(apiKey);
    }

    async checkApiKey() {
        try {
            const accountInfo = await this.client.account.info();
            return accountInfo.status === 'success';
        } catch (error) {
            console.error('Premiumize API key check failed:', error.message);
            return false;
        }
    }

    getInfoHashFromMagnet(magnetLink) {
        const match = magnetLink.match(/urn:btih:([a-zA-Z0-9]+)/i);
        return match ? match[1].toLowerCase() : null;
    }

    async addMagnetOnly(magnetLink) {
        try {
            const result = await this.client.transfer.create(magnetLink);
            if (result.status !== 'success') {
                throw new Error(result.message);
            }
            console.log(`[Premiumize] Magnet added successfully: ${result.name}`);
            return result.id;
        } catch (error) {
            console.error(`[Premiumize] Error adding magnet:`, error.message);
            // Check if it's a duplicate error
            if (error.message && error.message.toLowerCase().includes('duplicate')) {
                console.log('[Premiumize] Magnet is a duplicate, trying to find existing transfer.');
                const infoHash = this.getInfoHashFromMagnet(magnetLink);
                const transfers = await this.client.transfer.list();
                const existing = transfers.transfers.find(t => t.src.toLowerCase().includes(infoHash));
                if (existing) {
                    console.log(`[Premiumize] Found existing duplicate transfer with ID: ${existing.id}`);
                    return existing.id;
                }
            }
            return null;
        }
    }

    async getTorrentStatusAndLinks(magnetLink, fileIndex, season, episode, streamType, episodeName) {
        try {
            const infoHash = this.getInfoHashFromMagnet(magnetLink);
            if (!infoHash) throw new Error('Invalid magnet link.');

            // Premiumize's cache check is for public torrents, not user-specific transfers.
            // We need to check the user's transfer list.
            const transfers = await this.client.transfer.list();
            const transfer = transfers.transfers.find(t => t.src && t.src.toLowerCase().includes(infoHash));

            if (!transfer) {
                return { status: 'not_found', links: [] };
            }

            const statusMap = {
                'seeding': 'completed',
                'finished': 'completed',
                'running': 'downloading',
                'queued': 'downloading',
                'waiting': 'downloading',
                'error': 'error'
            };
            const currentStatus = statusMap[transfer.status] || 'error';

            if (currentStatus !== 'completed') {
                return { status: currentStatus, links: [] };
            }

            // For completed torrents, we need to list the files in the corresponding folder.
            const folderId = transfer.folder_id;
            if (!folderId) {
                throw new Error('Transfer is complete but has no folder_id.');
            }

            const folderContent = await this.client.folder.list(folderId);
            const files = folderContent.content;

            const enrichedFiles = files.map(file => ({
                ...file,
                path: file.name,
                extension: getFileExtension(file.name),
                isVideo: isVideoFile(file.name)
            }));

            const bestFile = this.selectBestFile(enrichedFiles, episode, episodeName, { fileIndex, streamType });
            if (!bestFile) {
                return { status: 'error', links: [] };
            }

            // The 'link' property from the folder list is the direct download link.
            return {
                status: 'completed',
                links: [{ url: bestFile.link, filename: bestFile.name }]
            };

        } catch (error) {
            console.error(`[Premiumize] Error getting status/links:`, error.message);
            return { status: 'error', links: [] };
        }
    }

    // Premiumize links are direct, no unrestrict needed.
}

module.exports = Premiumize;
