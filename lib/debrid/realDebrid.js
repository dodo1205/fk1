const DebridService = require('./baseService');
const { getFileExtension, isVideoFile } = require('../utils/fileUtils'); // Assuming these are still relevant
const { seasonEpisodeInFilename } = require('../utils/episodeUtils'); // Or wherever this utility resides

const RD_API_BASE_URL = 'https://api.real-debrid.com/rest/1.0';

// Helper to extract info hash, assuming it might not be in stringUtils or you want it self-contained
function getInfoHashFromMagnet(magnetLink) {
    const match = magnetLink.match(/urn:btih:([a-zA-Z0-9]+)/i);
    return match ? match[1].toLowerCase() : null;
}

class RealDebrid extends DebridService {
    constructor(apiKey) {
        super(apiKey);
        this.baseUrl = RD_API_BASE_URL;
        // RealDebrid specific rate limits, if different from default
        // this.torrentRateLimit = { limit: 1, periodMs: 2000 }; // Example
    }

    _getHeaders() {
        return {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/x-www-form-urlencoded' // Common for RD form data
        };
    }

    async checkApiKey() {
        const url = `${this.baseUrl}/user`;
        const response = await this.request(url, { headers: this._getHeaders() });
        return response && response.id !== undefined;
    }

    async addMagnet(magnetLink, options = {}) {
        const url = `${this.baseUrl}/torrents/addMagnet`;
        const body = new URLSearchParams({ magnet: magnetLink });
        // Note: Real-Debrid's addMagnet doesn't directly support selecting files by episode number during initial add.
        // File selection happens later via /torrents/selectFiles.
        const response = await this.request(url, {
            method: 'POST',
            headers: this._getHeaders(),
            body: body.toString()
        }, true); // isTorrentApiCall = true

        return response; // Expected: { id: "torrent_id", uri: "...", ... }
    }

    async _getTorrentInfo(torrentId) {
        const url = `${this.baseUrl}/torrents/info/${torrentId}`;
        return await this.request(url, { headers: this._getHeaders() }, true);
    }

    async _selectFiles(torrentId, fileIds) { // fileIds can be a string "all" or comma-separated IDs
        const url = `${this.baseUrl}/torrents/selectFiles/${torrentId}`;
        const body = new URLSearchParams({ files: fileIds });
        // This is a POST request that doesn't typically return a meaningful JSON body for success,
        // but request() will handle non-2xx errors.
        // We might need to adjust request() or how we call it if RD returns 204 No Content on success.
        // For now, assume it returns some JSON or an error.
        // The Python version uses requests.post directly and doesn't check response.
        // Let's assume a successful call to this endpoint means the files are being processed.
        // The base `request` method will return null on error, or an empty object for non-JSON success.
        const response = await this.request(url, {
            method: 'POST',
            headers: this._getHeaders(),
            body: body.toString()
        }, true);
        return response !== null; // True if request didn't fail outright
    }

    async unrestrictLink(link, options = {}) {
        const url = `${this.baseUrl}/unrestrict/link`;
        const body = new URLSearchParams({ link });
        const response = await this.request(url, {
            method: 'POST',
            headers: this._getHeaders(),
            body: body.toString()
        });
        // Expected: { id, filename, filesize, link (original), download (unrestricted), streamable, ... }
        return response;
    }

    async getAvailabilityBulk(hashesOrMagnets, options = {}) {
        if (!hashesOrMagnets || hashesOrMagnets.length === 0) {
            return {};
        }
        const hashes = hashesOrMagnets.map(item => getInfoHashFromMagnet(item) || item).filter(Boolean);
        if (hashes.length === 0) return {};

        const url = `${this.baseUrl}/torrents/instantAvailability/${hashes.join('/')}`;
        const response = await this.request(url, { headers: this._getHeaders() }, true);
        // Response is an object where keys are hashes.
        // Each value is an array if cached, or empty array/specific structure if not.
        // Example: { "hash1": [ { "rd_id": ..., "filename": ..., "filesize": ... } ], "hash2": [] }
        return response;
    }

    async _findBestFileFromTorrentInfo(torrentInfo, streamType, season, episode, fileIndex) {
        if (!torrentInfo || !torrentInfo.files || torrentInfo.files.length === 0) {
            return null;
        }

        const files = torrentInfo.files.map(f => ({
            ...f, // id, path, bytes
            name: f.path.split('/').pop(), // For selectBestFile compatibility
            extension: getFileExtension(f.path),
            isVideo: isVideoFile(f.path)
        }));

        if (streamType === 'series' && season && episode) {
            return this.selectBestFile(files, episode, null, { season, streamType });
        } else if (streamType === 'movie') {
            return this.selectBestFile(files, null, null, { streamType });
        } else if (fileIndex !== undefined && fileIndex !== null) {
            // If a specific fileIndex (which is RD file ID) is requested
            return files.find(f => f.id.toString() === fileIndex.toString());
        }
        // Fallback or general case if not series/movie with specific criteria
        return this.selectBestFile(files, null, null, { streamType });
    }


    async getStreamLink(magnetLink, options = {}) {
        const { streamType, season, episode, fileIndex: requestedFileId } = options;
        const infoHash = getInfoHashFromMagnet(magnetLink);

        if (!infoHash) {
            this.logger.error('[RealDebrid] Invalid magnet link, no info hash found.');
            return null;
        }

        this.logger.log(`[RealDebrid] Getting stream link for ${streamType}, hash: ${infoHash}`);

        // 1. Check if torrent is already in user's list and if desired file is ready
        const torrentsList = await this.request(`${this.baseUrl}/torrents`, { headers: this._getHeaders() }, true);
        if (torrentsList) {
            const existingTorrentSummary = torrentsList.find(t => t.hash.toLowerCase() === infoHash);
            if (existingTorrentSummary) {
                this.logger.log(`[RealDebrid] Found existing torrent summary, ID: ${existingTorrentSummary.id}`);
                const torrentInfo = await this._getTorrentInfo(existingTorrentSummary.id);
                if (torrentInfo && torrentInfo.status === 'downloaded') {
                    const bestFile = this._findBestFileFromTorrentInfo(torrentInfo, streamType, season, episode, requestedFileId);
                    if (bestFile) {
                        const selectedFileInTorrent = torrentInfo.files.find(f => f.id === bestFile.id);
                        // Check if the file is actually selected on RD (selected: 1)
                        // And if the direct links are available in torrentInfo.links
                        if (selectedFileInTorrent && selectedFileInTorrent.selected === 1 && torrentInfo.links && torrentInfo.links.length > 0) {
                            // Find the link corresponding to the bestFile.path
                            // RD links might not be in the same order as files, so match by filename part.
                            const fileNamePart = bestFile.path.split('/').pop();
                            const directLink = torrentInfo.links.find(l => l.includes(encodeURIComponent(fileNamePart)));

                            if (directLink) {
                                this.logger.log(`[RealDebrid] Found ready and selected file in existing torrent. Link: ${directLink}`);
                                const unrestricted = await this.unrestrictLink(directLink);
                                return unrestricted ? unrestricted.download : null;
                            }
                        }
                    }
                }
            }
        }

        // 2. If not found or not ready, add the magnet
        this.logger.log(`[RealDebrid] Torrent not found in ready state or file not selected. Adding magnet: ${magnetLink.substring(0,50)}`);
        const addResponse = await this.addMagnet(magnetLink);
        if (!addResponse || !addResponse.id) {
            this.logger.error('[RealDebrid] Failed to add magnet.');
            return null;
        }
        const torrentId = addResponse.id;
        this.logger.log(`[RealDebrid] Magnet added, torrent ID: ${torrentId}`);

        // 3. Select the files
        // We need to get torrent info first to know the file IDs
        let torrentInfo = await this._getTorrentInfo(torrentId);
        if (!torrentInfo || !torrentInfo.files) {
            this.logger.error(`[RealDebrid] Failed to get info for new torrent ID: ${torrentId}`);
            return null;
        }

        const fileToSelect = this._findBestFileFromTorrentInfo(torrentInfo, streamType, season, episode, requestedFileId);
        if (!fileToSelect) {
            this.logger.warn(`[RealDebrid] No specific file found to select for torrent ${torrentId}. Selecting all video files or largest.`);
            // Fallback: select all video files, or just the largest if no videos.
            let fileIdsToSelect = torrentInfo.files
                .filter(f => isVideoFile(f.path))
                .map(f => f.id.toString());
            if(fileIdsToSelect.length === 0 && torrentInfo.files.length > 0) {
                fileIdsToSelect = [torrentInfo.files.reduce((prev, curr) => prev.bytes > curr.bytes ? prev : curr).id.toString()];
            }
            if(fileIdsToSelect.length > 0) {
                 await this._selectFiles(torrentId, fileIdsToSelect.join(','));
            } else {
                this.logger.error(`[RealDebrid] No files to select in torrent ${torrentId}`);
                return null;
            }
        } else {
            this.logger.log(`[RealDebrid] Selecting file ID: ${fileToSelect.id} (Path: ${fileToSelect.path})`);
            await this._selectFiles(torrentId, fileToSelect.id.toString());
        }
        
        // 4. Poll for completion
        this.logger.log(`[RealDebrid] Waiting for torrent ${torrentId} to complete...`);
        const pollTimeout = 300000; // 5 minutes
        const pollInterval = 5000; // 5 seconds
        let elapsedTime = 0;
        let finalLink = null;

        while (elapsedTime < pollTimeout) {
            torrentInfo = await this._getTorrentInfo(torrentId);
            if (torrentInfo && torrentInfo.status === 'downloaded') {
                this.logger.log(`[RealDebrid] Torrent ${torrentId} completed.`);
                // Ensure the selected file's link is present
                const finalFile = this._findBestFileFromTorrentInfo(torrentInfo, streamType, season, episode, fileToSelect ? fileToSelect.id : requestedFileId);
                if (finalFile && torrentInfo.links && torrentInfo.links.length > 0) {
                     const fileNamePart = finalFile.path.split('/').pop();
                     const directLink = torrentInfo.links.find(l => l.includes(encodeURIComponent(fileNamePart)));
                    if (directLink) {
                        const unrestricted = await this.unrestrictLink(directLink);
                        finalLink = unrestricted ? unrestricted.download : null;
                        break;
                    }
                }
            } else if (torrentInfo && (torrentInfo.status === 'magnet_error' || torrentInfo.status === 'error' || torrentInfo.status === 'virus')) {
                this.logger.error(`[RealDebrid] Torrent ${torrentId} failed with status: ${torrentInfo.status}`);
                return null; // Failed torrent
            }
            
            this.logger.debug(`[RealDebrid] Torrent ${torrentId} status: ${torrentInfo ? torrentInfo.status : 'unknown'}. Waiting...`);
            await this._wait(pollInterval);
            elapsedTime += pollInterval;
        }

        if (!finalLink) {
            this.logger.error(`[RealDebrid] Timed out or failed to get link for torrent ${torrentId}.`);
        }
        return finalLink;
    }
}

module.exports = RealDebrid;
