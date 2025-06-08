const DebridService = require('./baseService');
const { getFileExtension, isVideoFile } = require('../utils/fileUtils');
const { seasonEpisodeInFilename } = require('../utils/episodeUtils');

// Placeholder for Torbox API URL - replace with actual if known
const TORBOX_API_BASE_URL = 'https://api.torbox.app/v1'; // Example, verify actual URL

// Helper to extract info hash
function getInfoHashFromMagnet(magnetLink) {
    const match = magnetLink.match(/urn:btih:([a-zA-Z0-9]+)/i);
    return match ? match[1].toLowerCase() : null;
}

class Torbox extends DebridService {
    constructor(apiKey) {
        super(apiKey);
        this.baseUrl = TORBOX_API_BASE_URL;
        // Torbox might have specific rate limits, e.g., for link generation
    }

    _getHeaders() {
        // Assuming Torbox uses an API key in a custom header or as a query param.
        // This is a common pattern; adjust if Torbox uses Bearer token or other.
        // For this example, let's assume it's a query parameter handled by _buildUrl or a header.
        // If it's a header like 'X-Api-Key':
        return {
            'X-Api-Key': this.apiKey, // Example header
            'Content-Type': 'application/json'
        };
        // If API key is part of all URLs, _buildUrl would handle it.
    }

    // Helper to build URLs, potentially adding API key if it's a query param for all requests
    _buildUrl(path, queryParams = {}) {
        const url = new URL(`${this.baseUrl}${path}`);
        // Example if API key was a query param: url.searchParams.append('apikey', this.apiKey);
        for (const key in queryParams) {
            url.searchParams.append(key, queryParams[key]);
        }
        return url.toString();
    }

    async checkApiKey() {
        // Example: try to fetch user's torrents list. Success implies valid key.
        const url = this._buildUrl('/torrents/list'); // Adjust endpoint as per Torbox API
        const response = await this.request(url, { headers: this._getHeaders() });
        return response && Array.isArray(response); // Or check for a specific success status in response
    }

    async _findExistingTorrentByHash(infoHash) {
        const url = this._buildUrl('/torrents/list'); // Adjust endpoint
        const torrents = await this.request(url, { headers: this._getHeaders() }, true);
        if (torrents && Array.isArray(torrents)) {
            return torrents.find(t => t.hash && t.hash.toLowerCase() === infoHash);
        }
        return null;
    }

    async addMagnet(magnetLink, options = {}) {
        const infoHash = getInfoHashFromMagnet(magnetLink);
        if (!infoHash) {
            this.logger.error('[Torbox] Invalid magnet link.');
            return null;
        }

        let existingTorrent = await this._findExistingTorrentByHash(infoHash);
        if (existingTorrent) {
            this.logger.log(`[Torbox] Torrent with hash ${infoHash} already exists with ID: ${existingTorrent.id}`);
            return existingTorrent; // Return existing torrent info
        }

        const url = this._buildUrl('/torrents/create'); // Adjust endpoint
        const body = JSON.stringify({ magnet: magnetLink });
        const response = await this.request(url, {
            method: 'POST',
            headers: this._getHeaders(),
            body: body
        }, true);

        // Assuming response contains the new torrent's ID and info
        return response; // e.g., { id: "...", hash: "...", ... }
    }

    async _getTorrentInfo(torrentId) {
        const url = this._buildUrl(`/torrents/${torrentId}/view`); // Adjust endpoint
        return await this.request(url, { headers: this._getHeaders() }, true);
    }

    async _createDownloadLink(torrentId, fileId) {
        const url = this._buildUrl(`/torrents/${torrentId}/files/${fileId}/createlink`); // Adjust endpoint
        const response = await this.request(url, { 
            method: 'POST', // Or GET, depending on Torbox API
            headers: this._getHeaders() 
        });
        // Assuming response contains the direct download link, e.g., { link: "..." }
        return response && response.link ? response.link : null;
    }
    
    // Torbox links are typically direct, so default unrestrictLink is fine.
    // async unrestrictLink(link, options = {}) { return super.unrestrictLink(link, options); }


    async getAvailabilityBulk(hashesOrMagnets, options = {}) {
        this.logger.warn('[Torbox] Bulk availability check is not efficiently supported by Torbox. Checking one by one.');
        const availability = {};
        for (const item of hashesOrMagnets) {
            const hash = getInfoHashFromMagnet(item) || item;
            if (hash) {
                const existing = await this._findExistingTorrentByHash(hash);
                // Torbox doesn't have a clear "cached" vs "not cached" state like RD/AD from list.
                // It's more about whether it's in your account and completed.
                // For simplicity, mark as "available" if found, implying it can be processed.
                // True cache status would require more detailed checks.
                availability[hash] = existing ? [{ filename: existing.name || "cached", filesize: existing.size || 0 }] : [];
            }
        }
        return availability;
    }

    async _findBestFileFromTorrentDetail(torrentDetail, streamType, season, episode) {
        if (!torrentDetail || !torrentDetail.files || torrentDetail.files.length === 0) {
            return null;
        }

        // Adapt Torbox file structure to be compatible with selectBestFile
        const files = torrentDetail.files.map(f => ({
            ...f, // id, name, size (ensure these fields exist in Torbox file object)
            path: f.name, // selectBestFile might expect a 'path'
            extension: getFileExtension(f.name),
            isVideo: isVideoFile(f.name)
        }));

        if (streamType === 'series' && season && episode) {
            return this.selectBestFile(files, episode, null, { season, streamType });
        } else if (streamType === 'movie') {
            return this.selectBestFile(files, null, null, { streamType });
        }
        // Fallback: largest file if no specific criteria match
        return files.length > 0 ? files.reduce((prev, current) => (prev.size > current.size) ? prev : current) : null;
    }

    async getStreamLink(magnetLink, options = {}) {
        const { streamType, season, episode } = options;
        this.logger.log(`[Torbox] Getting stream link for ${streamType}, magnet: ${magnetLink.substring(0,50)}`);

        let torrent = await this.addMagnet(magnetLink); // This handles finding existing or adding new
        if (!torrent || !torrent.id) {
            this.logger.error('[Torbox] Failed to add or find torrent.');
            return null;
        }
        const torrentId = torrent.id;
        this.logger.log(`[Torbox] Using torrent ID: ${torrentId}`);

        // Poll for completion
        this.logger.log(`[Torbox] Waiting for torrent ${torrentId} to complete...`);
        const pollTimeout = 300000; // 5 minutes
        const pollInterval = 15000; // 15 seconds (Torbox status updates might be slow)
        let elapsedTime = 0;
        let torrentDetail = null;
        let isCompleted = false;

        while (elapsedTime < pollTimeout) {
            torrentDetail = await this._getTorrentInfo(torrentId);
            // Torbox completion check: files are present and status is appropriate
            // (e.g., status 'completed', or simply files array is populated and non-empty)
            // This depends heavily on Torbox API response structure for torrent info.
            // Let's assume a 'status' field or presence of 'files' with content.
            if (torrentDetail && torrentDetail.files && torrentDetail.files.length > 0 && (torrentDetail.status === 'completed' || torrentDetail.status === 'ready')) { // Adjust status check
                this.logger.log(`[Torbox] Torrent ${torrentId} completed.`);
                isCompleted = true;
                break;
            } else if (torrentDetail && (torrentDetail.status === 'error' || torrentDetail.status === 'failed')) {
                this.logger.error(`[Torbox] Torrent ${torrentId} failed with status: ${torrentDetail.status}`);
                return null;
            }
            
            this.logger.debug(`[Torbox] Torrent ${torrentId} status: ${torrentDetail ? torrentDetail.status : 'unknown'}. Waiting...`);
            await this._wait(pollInterval);
            elapsedTime += pollInterval;
            torrentDetail = null; // Reset for next poll
        }

        if (!isCompleted || !torrentDetail) {
            this.logger.error(`[Torbox] Timed out or torrent not completed for ID ${torrentId}. Last detail: ${JSON.stringify(torrentDetail)}`);
            return null;
        }

        const bestFile = this._findBestFileFromTorrentDetail(torrentDetail, streamType, season, episode);
        if (!bestFile || !bestFile.id) {
            this.logger.error(`[Torbox] Could not determine best file from torrent ${torrentId}.`);
            return null;
        }

        this.logger.log(`[Torbox] Selected file: ${bestFile.name} (ID: ${bestFile.id})`);
        const finalLink = await this._createDownloadLink(torrentId, bestFile.id);

        if (finalLink) {
            this.logger.log(`[Torbox] Generated download link: ${finalLink}`);
            return finalLink;
        }
        
        this.logger.error(`[Torbox] Failed to create download link for file ${bestFile.id} in torrent ${torrentId}.`);
        return null;
    }
}

module.exports = Torbox;
