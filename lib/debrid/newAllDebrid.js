const BaseDebridService = require('./baseDebridService');

// AllDebrid API constants
const AD_BASE_URL = 'https://api.alldebrid.com/v4';
const AD_AGENT = 'FKStreamAddon'; // Ou un nom d'agent de votre choix

class NewAllDebrid extends BaseDebridService {
    constructor(config) {
        super(config, 'AllDebrid'); // Pass serviceName to base constructor
        // Specific AllDebrid initialization if any
    }

    /**
     * Checks if the AllDebrid API key is valid.
     * @returns {Promise<boolean>}
     */
    async checkApiKey() {
        const url = `${AD_BASE_URL}/user?agent=${AD_AGENT}&apikey=${this.apiKey}`;
        try {
            const response = await this.makeRequest(url, { method: 'get' });
            if (response && response.status === 'success' && response.data && response.data.user) {
                this.logger.info(`[${this.serviceName}] API Key is valid. User: ${response.data.user.username}`);
                return true;
            } else {
                this.logger.error(`[${this.serviceName}] API Key check failed:`, response ? response.error : 'No response');
                return false;
            }
        } catch (error) {
            this.logger.error(`[${this.serviceName}] Error checking API key:`, error.message);
            return false;
        }
    }

    /**
     * Adds a magnet link to AllDebrid.
     * @param {string} magnetLink - The magnet link.
     * @param {object} queryData - Original query data (not directly used by AD for adding magnet, but kept for consistency).
     * @returns {Promise<string|null>} - The ID of the magnet on AllDebrid, or null on failure.
     */
    async addMagnetToService(magnetLink, queryData) {
        const url = `${AD_BASE_URL}/magnet/upload?agent=${AD_AGENT}&apikey=${this.apiKey}`;
        // AllDebrid's magnet upload endpoint expects 'magnets' as a GET parameter or 'magnets[]' for POST form-data.
        // Using GET for simplicity here as per their docs for single magnet.
        // If sending multiple, or if POST is preferred, adjust `makeRequest` options.
        const magnetUploadUrl = `${url}&magnets[]=${encodeURIComponent(magnetLink)}`;

        try {
            // StreamFusion uses POST with form-data for magnets. Let's try that.
            // However, their API docs also show GET /magnet/upload with magnets=<magnet_uri>
            // Let's use GET for a single magnet as it's simpler with current makeRequest
            // If issues arise, we can switch to POST with form-data.
            // For now, let's stick to a GET request structure for /magnet/upload
            // The API seems to prefer `magnets` (plural) as a query param for GET.
            const getUrl = `${AD_BASE_URL}/magnet/upload?agent=${AD_AGENT}&apikey=${this.apiKey}&magnets=${encodeURIComponent(magnetLink)}`;

            const response = await this.makeRequest(getUrl, { method: 'get' });

            if (response && response.status === 'success' && response.data && response.data.magnets && response.data.magnets.length > 0) {
                const magnetInfo = response.data.magnets[0];
                this.logger.info(`[${this.serviceName}] Magnet added/found. ID: ${magnetInfo.id}, Name: ${magnetInfo.filename}, Ready: ${magnetInfo.ready}`);
                return magnetInfo.id; // Return the ID of the magnet
            } else {
                const errorMsg = response && response.error ? response.error.message : 'Unknown error adding magnet';
                this.logger.error(`[${this.serviceName}] Failed to add magnet: ${errorMsg}`);
                return null;
            }
        } catch (error) {
            this.logger.error(`[${this.serviceName}] Error adding magnet to service:`, error.message);
            return null;
        }
    }

    /**
     * Retrieves the direct streaming link for a torrent previously added to AllDebrid.
     * @param {string} torrentId - The ID of the torrent on AllDebrid.
     * @param {object} queryData - Original query data from Stremio (containing episode, season, filename hints).
     * @returns {Promise<string|null>} - The direct streamable URL or null.
     */
    async getStreamLinkFromService(torrentId, queryData) {
        this.logger.info(`[${this.serviceName}] Getting stream link for torrent ID: ${torrentId}`);

        // 1. Check magnet status until ready
        const checkStatus = async () => {
            const statusUrl = `${AD_BASE_URL}/magnet/status?agent=${AD_AGENT}&apikey=${this.apiKey}&id=${torrentId}`;
            const statusResponse = await this.makeRequest(statusUrl, { method: 'get' });
            if (statusResponse && statusResponse.status === 'success' && statusResponse.data && statusResponse.data.magnets) {
                const magnetData = statusResponse.data.magnets;
                this.logger.debug(`[${this.serviceName}] Torrent ID ${torrentId} status: ${magnetData.status}`);
                // Possible statuses: Queued, Downloading, Uploading, Ready, Error, File Error
                return magnetData.status === 'Ready';
            }
            return false; // Keep waiting if error or not success
        };

        const isReady = await this.waitForReadyStatus(checkStatus, 120000, 5000); // Wait up to 2 minutes

        if (!isReady) {
            this.logger.warn(`[${this.serviceName}] Torrent ${torrentId} not ready after timeout.`);
            // Optionally, you could return a special value or throw an error recognized by the playback endpoint
            // to show the "downloading" video. For now, returning null will lead to that.
            return null; 
        }

        // 2. Get magnet details (which include file links)
        const detailsUrl = `${AD_BASE_URL}/magnet/status?agent=${AD_AGENT}&apikey=${this.apiKey}&id=${torrentId}`;
        const detailsResponse = await this.makeRequest(detailsUrl, { method: 'get' });

        if (!detailsResponse || detailsResponse.status !== 'success' || !detailsResponse.data || !detailsResponse.data.magnets || !detailsResponse.data.magnets.links) {
            this.logger.error(`[${this.serviceName}] Failed to get details for ready torrent ${torrentId}.`);
            return null;
        }

        const files = detailsResponse.data.magnets.links.map(f => ({
            name: f.filename,
            size: f.size, // Size in bytes
            link: f.link, // This is the link that needs to be unrestricted
            id: f.id // AllDebrid provides an ID for each link/file
        }));

        // 3. Select the best file
        const { episode: episodeNumber, season: seasonNumber, type: streamType, episodeName } = queryData;
        const bestFile = this.selectBestFile(files, parseInt(episodeNumber), episodeName, {
            seasonNumber: parseInt(seasonNumber),
            streamType
        });

        if (!bestFile) {
            this.logger.error(`[${this.serviceName}] No suitable file found in torrent ${torrentId} for S${seasonNumber}E${episodeNumber}.`);
            return null;
        }
        this.logger.info(`[${this.serviceName}] Selected file: ${bestFile.name} (Size: ${bestFile.size})`);

        // 4. Unrestrict the selected file's link
        const unrestrictUrl = `${AD_BASE_URL}/link/unlock?agent=${AD_AGENT}&apikey=${this.apiKey}&link=${encodeURIComponent(bestFile.link)}`;
        const unrestrictResponse = await this.makeRequest(unrestrictUrl, { method: 'get' });

        if (unrestrictResponse && unrestrictResponse.status === 'success' && unrestrictResponse.data && unrestrictResponse.data.link) {
            const finalLink = unrestrictResponse.data.link;
            this.logger.info(`[${this.serviceName}] Unrestricted link: ${finalLink}`);
            return finalLink;
        } else {
            const errorMsg = unrestrictResponse && unrestrictResponse.error ? unrestrictResponse.error.message : 'Unknown error unrestricting link';
            this.logger.error(`[${this.serviceName}] Failed to unrestrict link: ${errorMsg}`);
            return null;
        }
    }

    /**
     * Checks if a list of torrent hashes are already cached/available on AllDebrid.
     * AllDebrid's /magnet/instant endpoint can check hashes.
     * @param {Array<string>} hashes - Array of torrent infohashes.
     * @returns {Promise<object>} - Object mapping hashes to boolean (true if cached, false otherwise).
     */
    async checkAvailability(hashes) {
        if (!hashes || hashes.length === 0) {
            return {};
        }
        // AllDebrid's instant availability endpoint expects hashes as GET parameters: &hashes[]=hash1&hashes[]=hash2
        const hashesQueryString = hashes.map(h => `hashes[]=${h}`).join('&');
        const url = `${AD_BASE_URL}/magnet/instant?agent=${AD_AGENT}&apikey=${this.apiKey}&${hashesQueryString}`;
        
        const availabilityResult = {};
        try {
            const response = await this.makeRequest(url, { method: 'get' });
            if (response && response.status === 'success' && response.data && response.data.magnets) {
                response.data.magnets.forEach(magnetStatus => {
                    availabilityResult[magnetStatus.hash.toLowerCase()] = magnetStatus.instant;
                });
                this.logger.info(`[${this.serviceName}] Availability check completed. Results:`, availabilityResult);
            } else {
                this.logger.warn(`[${this.serviceName}] Failed to get availability or unexpected response format. Assuming all unavailable.`, response);
                hashes.forEach(h => availabilityResult[h.toLowerCase()] = false);
            }
        } catch (error) {
            this.logger.error(`[${this.serviceName}] Error checking availability:`, error.message);
            hashes.forEach(h => availabilityResult[h.toLowerCase()] = false);
        }
        return availabilityResult;
    }
}

module.exports = NewAllDebrid;
