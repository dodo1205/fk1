const axios = require('axios');
const { настройки } = require('../../settings'); // Placeholder for global settings if needed
const { getFileExtension, isVideoFile } = require('../utils/fileUtils'); // Assuming this is still relevant
const { seasonEpisodeInFilename } = require('../utils/stringUtils'); // Assuming a similar function or we create one

// Default settings - these might be overridden by global settings or specific service needs
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_BASE = 1000; // 1 second
const DEFAULT_TIMEOUT_MS = 30000; // 30 seconds for requests

class BaseDebridService {
    constructor(config, serviceName = 'BaseDebridService') {
        this.config = config;
        this.apiKey = config.apiKey; // Assuming apiKey is part of the user's config for the service
        this.serviceName = serviceName;
        this.logger = console; // Simple logger, can be replaced with a more sophisticated one

        this.httpClient = axios.create({
            timeout: DEFAULT_TIMEOUT_MS,
            // headers: { 'User-Agent': 'FKStreamAddon/1.0' } // Example User-Agent
        });

        // TODO: Implement rate limiting if necessary, similar to StreamFusion's deque approach
        // For now, rate limiting is not implemented in this base class.
    }

    /**
     * Makes an HTTP request with error handling and retries.
     * @param {string} url - The URL to request.
     * @param {object} options - Axios request config (method, data, headers, params, etc.).
     * @param {number} maxRetries - Maximum number of retries.
     * @param {number} retryDelayBase - Base delay for exponential backoff.
     * @returns {Promise<object|null>} - The response data (usually JSON parsed) or null on failure.
     */
    async makeRequest(url, options = {}, maxRetries = DEFAULT_MAX_RETRIES, retryDelayBase = DEFAULT_RETRY_DELAY_BASE) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const response = await this.httpClient(url, options);
                return response.data; // Axios automatically parses JSON
            } catch (error) {
                this.logger.error(`[${this.serviceName}] Request to ${url} failed (attempt ${attempt}/${maxRetries}):`, error.message);
                if (error.response) {
                    this.logger.error(`[${this.serviceName}] Status: ${error.response.status}, Data:`, error.response.data);
                    // Do not retry on 4xx client errors, except for 429 (Too Many Requests)
                    if (error.response.status >= 400 && error.response.status < 500 && error.response.status !== 429) {
                        return null; // Or throw a specific error
                    }
                }

                if (attempt === maxRetries) {
                    this.logger.error(`[${this.serviceName}] Max retries reached for ${url}.`);
                    return null; // Or throw error
                }

                const delay = retryDelayBase * Math.pow(2, attempt - 1);
                this.logger.info(`[${this.serviceName}] Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        return null; // Should not be reached if maxRetries > 0
    }

    /**
     * Waits for a condition to be met by repeatedly calling a status check function.
     * @param {Function} checkStatusFunc - An async function that returns true when the condition is met.
     * @param {number} timeoutMs - Maximum time to wait in milliseconds.
     * @param {number} intervalMs - Interval between checks in milliseconds.
     * @returns {Promise<boolean>} - True if the condition was met, false if timed out.
     */
    async waitForReadyStatus(checkStatusFunc, timeoutMs = 60000, intervalMs = 5000) {
        this.logger.info(`[${this.serviceName}] Waiting up to ${timeoutMs / 1000}s for resource to be ready.`);
        const startTime = Date.now();
        while (Date.now() - startTime < timeoutMs) {
            if (await checkStatusFunc()) {
                this.logger.info(`[${this.serviceName}] Resource is ready.`);
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, intervalMs));
        }
        this.logger.info(`[${this.serviceName}] Waiting timed out.`);
        return false;
    }

    /**
     * Downloads a .torrent file from a URL.
     * @param {string} torrentUrl - The URL of the .torrent file.
     * @returns {Promise<Buffer|null>} - The torrent file content as a Buffer or null on failure.
     */
    async downloadTorrentFile(torrentUrl) {
        this.logger.info(`[${this.serviceName}] Downloading torrent file from: ${torrentUrl}`);
        try {
            const response = await this.httpClient({
                method: 'get',
                url: torrentUrl,
                responseType: 'arraybuffer' // Important for binary file data
            });
            return Buffer.from(response.data);
        } catch (error) {
            this.logger.error(`[${this.serviceName}] Failed to download torrent file: ${error.message}`);
            return null;
        }
    }

    /**
     * Selects the best file from a list of files, typically for a series episode.
     * This needs to be adapted from your existing logic or StreamFusion's.
     * @param {Array<object>} files - List of file objects from the debrid service. Each object should have at least 'name' and 'size' (bytes).
     * @param {number} episodeNumber - The desired episode number.
     * @param {string|null} episodeName - The desired episode name (optional, for better matching).
     * @param {object} options - Additional options (e.g., seasonNumber, fileIndex).
     * @returns {object|null} - The best matching file object or null.
     */
    selectBestFile(files, episodeNumber, episodeName = null, options = {}) {
        if (!files || files.length === 0) {
            return null;
        }

        const { seasonNumber, streamType = 'series' } = options; // fileIndex might be handled by specific services

        let candidates = files.filter(file => file && typeof file.name === 'string' && isVideoFile(file.name));
        
        if (streamType === 'movie') {
            return candidates.length > 0 ? candidates.sort((a, b) => b.size - a.size)[0] : null;
        }

        // For series
        let episodeCandidates = [];
        if (seasonNumber && episodeNumber) {
            episodeCandidates = candidates.filter(file =>
                seasonEpisodeInFilename(file.name, seasonNumber, episodeNumber, this.logger) // Pass logger for debugging
            );
        } else if (episodeNumber && episodeName) { // Fallback if seasonNumber is not available but episodeName is
             episodeCandidates = candidates.filter(file => {
                const nameLower = file.name.toLowerCase();
                return nameLower.includes(episodeName.toLowerCase()) && (nameLower.includes(` ${episodeNumber} `) || nameLower.includes(`e${episodeNumber}`) || nameLower.includes(`ep${episodeNumber}`));
            });
        } else if (episodeNumber) { // Basic fallback by episode number only
            episodeCandidates = candidates.filter(file => {
                 const nameLower = file.name.toLowerCase();
                 return nameLower.includes(` ${episodeNumber} `) || nameLower.includes(`e${episodeNumber}`) || nameLower.includes(`ep${episodeNumber}`);
            });
        }


        if (episodeCandidates.length === 0) {
            // If no specific episode match, and it's a single-file torrent (or few files), consider the largest video file.
            // This might happen for OVAs or specials not following strict SxE naming.
            if (candidates.length === 1) return candidates[0];
            // Could add more heuristics here if needed, for now, return null if no direct match.
            this.logger.warn(`[${this.serviceName}] No specific file found for S${seasonNumber}E${episodeNumber}. Found ${candidates.length} video files.`);
            return candidates.length > 0 ? candidates.sort((a, b) => b.size - a.size)[0] : null; // Fallback to largest if no match
        }

        // Sort candidates by size (largest first) or other criteria (e.g., quality tags if available)
        episodeCandidates.sort((a, b) => b.size - a.size);
        return episodeCandidates[0];
    }

    // --- Abstract methods to be implemented by child classes ---

    /**
     * Checks if the API key for the service is valid.
     * @returns {Promise<boolean>}
     */
    async checkApiKey() {
        throw new Error(`[${this.serviceName}] checkApiKey() not implemented.`);
    }

    /**
     * Adds a magnet link to the debrid service and initiates download/caching.
     * This method should ideally return an identifier for the torrent on the service.
     * @param {string} magnetLink - The magnet link.
     * @param {object} queryData - Original query data from Stremio (containing episode, season, etc.)
     * @returns {Promise<string|object|null>} - Torrent ID or relevant info, or null on failure.
     */
    async addMagnetToService(magnetLink, queryData) {
        throw new Error(`[${this.serviceName}] addMagnetToService() not implemented.`);
    }
    
    /**
     * Retrieves the direct streaming link for a previously added torrent.
     * @param {string|object} torrentIdOrInfo - Identifier or info object for the torrent on the service.
     * @param {object} queryData - Original query data from Stremio.
     * @returns {Promise<string|null>} - The direct streamable URL or null.
     */
    async getStreamLinkFromService(torrentIdOrInfo, queryData) {
        throw new Error(`[${this.serviceName}] getStreamLinkFromService() not implemented.`);
    }

    /**
     * (Optional but recommended) Checks if a list of torrent hashes are already cached/available on the service.
     * @param {Array<string>} hashes - Array of torrent infohashes.
     * @returns {Promise<object>} - Object mapping hashes to availability status.
     */
    async checkAvailability(hashes) {
        this.logger.warn(`[${this.serviceName}] checkAvailability() not implemented, assuming all are unavailable by default.`);
        const availability = {};
        hashes.forEach(hash => {
            availability[hash] = false; // Or a more detailed status object
        });
        return availability;
    }
}

module.exports = BaseDebridService;
