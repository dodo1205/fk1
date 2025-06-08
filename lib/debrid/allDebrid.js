const DebridService = require('./baseService');
const { getFileExtension, isVideoFile } = require('../utils/fileUtils');
const { seasonEpisodeInFilename } = require('../utils/episodeUtils'); // Or wherever this utility resides

const AD_API_BASE_URL = 'https://api.alldebrid.com/v4';
const AD_AGENT_NAME = 'myIntegration'; // Replace with your actual agent name if registered

class AllDebrid extends DebridService {
    constructor(apiKey) {
        super(apiKey);
        this.baseUrl = AD_API_BASE_URL;
        this.agentName = AD_AGENT_NAME; // Store agent name
    }

    _getHeaders() {
        // AllDebrid uses Bearer token in Authorization header for API key
        return {
            'Authorization': `Bearer ${this.apiKey}`
        };
    }

    // AllDebrid API calls often require agent name as a query parameter
    _buildUrl(path, params = {}) {
        const url = new URL(`${this.baseUrl}${path}`);
        url.searchParams.append('agent', this.agentName);
        for (const key in params) {
            url.searchParams.append(key, params[key]);
        }
        return url.toString();
    }

    async checkApiKey() {
        // A simple call to check user details can validate the API key
        const url = this._buildUrl('/user');
        const response = await this.request(url, { headers: this._getHeaders() });
        // Expects response.status === "success" and response.data.user to be populated
        return response && response.status === 'success' && response.data && response.data.user;
    }

    async addMagnet(magnetLink, options = {}) {
        const url = this._buildUrl('/magnet/upload');
        const body = new URLSearchParams();
        body.append('magnets[]', magnetLink); // AllDebrid expects magnets as an array

        const response = await this.request(url, {
            method: 'POST',
            headers: this._getHeaders(), // Content-Type will be set by URLSearchParams typically
            body: body.toString()
        }, true); // isTorrentApiCall = true

        // Expected: { status: "success", data: { magnets: [{ id, hash, name, size, ready, ... }] } }
        if (response && response.status === 'success' && response.data && response.data.magnets && response.data.magnets.length > 0) {
            return response.data.magnets[0]; // Return the info for the first (and only) magnet added
        }
        this.logger.error('[AllDebrid] Failed to add magnet or unexpected response:', response);
        return null;
    }

    async _getMagnetStatus(magnetId) {
        const url = this._buildUrl('/magnet/status', { id: magnetId });
        const response = await this.request(url, { headers: this._getHeaders() }, true);
        // Expected: { status: "success", data: { magnets: { id, filename, size, status, statusCode, downloaded, uploaded, seeders, links: [], ... } } }
        if (response && response.status === 'success' && response.data && response.data.magnets) {
            return response.data.magnets;
        }
        return null;
    }

    async unrestrictLink(linkToUnrestrict, options = {}) {
        const url = this._buildUrl('/link/unlock', { link: linkToUnrestrict });
        const response = await this.request(url, { headers: this._getHeaders() });
        // Expected: { status: "success", data: { link, filename, filesize, host, ... } }
        if (response && response.status === 'success' && response.data && response.data.link) {
            return response.data; // Contains the unrestricted link and other info
        }
        return null;
    }
    
    async getAvailabilityBulk(hashesOrMagnets, options = {}) {
        if (!hashesOrMagnets || hashesOrMagnets.length === 0) {
            return {};
        }
        // AllDebrid's /magnet/instant endpoint checks cache.
        // It expects 'magnets[]' as POST data.
        const url = this._buildUrl('/magnet/instant');
        const body = new URLSearchParams();
        hashesOrMagnets.forEach(item => body.append('magnets[]', item));

        const response = await this.request(url, {
            method: 'POST',
            headers: this._getHeaders(),
            body: body.toString()
        }, true);

        // Expected: { status: "success", data: { magnets: [ { magnet, hash, instant, files: [{filename, filesize}] } ] } }
        // We need to transform this into the same structure as RD for consistency: { hash: [...] }
        if (response && response.status === 'success' && response.data && response.data.magnets) {
            const availability = {};
            response.data.magnets.forEach(magnetInfo => {
                if (magnetInfo.hash) { // Ensure hash is present
                    availability[magnetInfo.hash] = magnetInfo.instant ? magnetInfo.files || [{ "filename": "cached", "filesize": 0 }] : [];
                }
            });
            return availability;
        }
        return null;
    }

    async _findBestFileFromLinks(links, streamType, season, episode) {
        if (!links || links.length === 0) {
            return null;
        }

        const files = links.map(l => ({
            ...l, // link, filename, size
            name: l.filename,
            extension: getFileExtension(l.filename),
            isVideo: isVideoFile(l.filename)
        }));
        
        let bestFile = null;
        if (streamType === 'series' && season && episode) {
            bestFile = this.selectBestFile(files, episode, null, { season, streamType });
        } else if (streamType === 'movie') {
            bestFile = this.selectBestFile(files, null, null, { streamType });
        } else { // Fallback if type is unknown or no specific episode info
            bestFile = files.reduce((prev, current) => (prev.size > current.size) ? prev : current);
        }
        return bestFile;
    }

    async getStreamLink(magnetLink, options = {}) {
        const { streamType, season, episode } = options;

        this.logger.log(`[AllDebrid] Getting stream link for ${streamType}, magnet: ${magnetLink.substring(0,50)}`);

        const addResponse = await this.addMagnet(magnetLink);
        if (!addResponse || !addResponse.id) {
            this.logger.error('[AllDebrid] Failed to add magnet.');
            return null;
        }
        const magnetId = addResponse.id;
        this.logger.log(`[AllDebrid] Magnet added, ID: ${magnetId}`);

        // Poll for completion
        this.logger.log(`[AllDebrid] Waiting for magnet ${magnetId} to be ready...`);
        const pollTimeout = 300000; // 5 minutes
        const pollInterval = 10000; // 10 seconds (AD can be slower to update status)
        let elapsedTime = 0;
        let magnetDetails = null;

        while (elapsedTime < pollTimeout) {
            magnetDetails = await this._getMagnetStatus(magnetId);
            if (magnetDetails && magnetDetails.status === 'Ready') {
                this.logger.log(`[AllDebrid] Magnet ${magnetId} is Ready.`);
                break;
            } else if (magnetDetails && (magnetDetails.status === 'error' || magnetDetails.statusCode === 4)) { // statusCode 4 is error
                 this.logger.error(`[AllDebrid] Magnet ${magnetId} failed with status: ${magnetDetails.status} (Code: ${magnetDetails.statusCode})`);
                 return null;
            }
            this.logger.debug(`[AllDebrid] Magnet ${magnetId} status: ${magnetDetails ? magnetDetails.status : 'unknown'}. Waiting...`);
            await this._wait(pollInterval);
            elapsedTime += pollInterval;
            magnetDetails = null; // Reset for next poll
        }

        if (!magnetDetails || magnetDetails.status !== 'Ready') {
            this.logger.error(`[AllDebrid] Timed out or magnet not ready for ID ${magnetId}. Last status: ${magnetDetails ? magnetDetails.status : 'unknown'}`);
            return null;
        }

        if (!magnetDetails.links || magnetDetails.links.length === 0) {
            this.logger.error(`[AllDebrid] Magnet ${magnetId} is ready but no links found.`);
            return null;
        }

        const bestFile = this._findBestFileFromLinks(magnetDetails.links, streamType, season, episode);
        if (!bestFile || !bestFile.link) {
            this.logger.error(`[AllDebrid] Could not determine best file or link from magnet ${magnetId}.`);
            return null;
        }

        this.logger.log(`[AllDebrid] Selected file: ${bestFile.filename}, link: ${bestFile.link}`);
        const unrestrictedData = await this.unrestrictLink(bestFile.link);

        if (unrestrictedData && unrestrictedData.link) {
            this.logger.log(`[AllDebrid] Unrestricted link: ${unrestrictedData.link}`);
            return unrestrictedData.link;
        }
        
        this.logger.error(`[AllDebrid] Failed to unrestrict link: ${bestFile.link}`);
        return null;
    }
}

module.exports = AllDebrid;
