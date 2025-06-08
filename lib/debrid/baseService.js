const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const { selectBestFile } = require('../utils/fileUtils');

// Default retry and rate limiting settings (can be overridden by subclasses if needed)
const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_INITIAL_BACKOFF_MS = 1000; // 1 second
const DEFAULT_GLOBAL_RATE_LIMIT = { limit: 250, periodMs: 60000 }; // 250 requests per 60 seconds
const DEFAULT_TORRENT_RATE_LIMIT = { limit: 1, periodMs: 1000 }; // 1 torrent-related request per 1 second

class DebridService {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.logger = console; // Basic logger, can be replaced with a more sophisticated one

        this.globalRequestTimestamps = [];
        this.torrentRequestTimestamps = [];

        this.maxRetries = DEFAULT_MAX_RETRIES;
        this.initialBackoffMs = DEFAULT_INITIAL_BACKOFF_MS;
        this.globalRateLimit = { ...DEFAULT_GLOBAL_RATE_LIMIT };
        this.torrentRateLimit = { ...DEFAULT_TORRENT_RATE_LIMIT };
    }

    /**
     * Delays execution for a specified number of milliseconds.
     * @param {number} ms - The number of milliseconds to wait.
     * @returns {Promise<void>}
     */
    _wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Manages rate limiting for API requests.
     * @param {Array<number>} timestampsQueue - The queue of timestamps for requests.
     * @param {object} limitConfig - Configuration { limit, periodMs }.
     * @returns {Promise<void>}
     */
    async _applyRateLimit(timestampsQueue, limitConfig) {
        const now = Date.now();

        // Remove old timestamps
        while (timestampsQueue.length > 0 && timestampsQueue[0] <= now - limitConfig.periodMs) {
            timestampsQueue.shift();
        }

        if (timestampsQueue.length >= limitConfig.limit) {
            const timeToWait = timestampsQueue[0] - (now - limitConfig.periodMs);
            if (timeToWait > 0) {
                this.logger.debug(`[${this.constructor.name}] Rate limit reached. Waiting for ${timeToWait}ms.`);
                await this._wait(timeToWait);
            }
            // After waiting, re-check and remove old timestamps again, as time has passed
            const newNow = Date.now();
            while (timestampsQueue.length > 0 && timestampsQueue[0] <= newNow - limitConfig.periodMs) {
                timestampsQueue.shift();
            }
        }
        timestampsQueue.push(Date.now());
    }

    /**
     * Centralized HTTP request method with retries, backoff, and rate limiting.
     * @param {string} url - The URL to request.
     * @param {object} options - Fetch options (method, headers, body, etc.).
     * @param {boolean} isTorrentApiCall - Whether this is a torrent-specific API call for stricter rate limiting.
     * @returns {Promise<object|null>} - The parsed JSON response, or null if an error occurs after retries.
     */
    async request(url, options = {}, isTorrentApiCall = false) {
        await this._applyRateLimit(this.globalRequestTimestamps, this.globalRateLimit);
        if (isTorrentApiCall) {
            await this._applyRateLimit(this.torrentRequestTimestamps, this.torrentRateLimit);
        }

        for (let attempt = 0; attempt < this.maxRetries; attempt++) {
            try {
                const response = await fetch(url, options);

                if (!response.ok) {
                    // Handle HTTP errors
                    if (response.status === 429 || response.status >= 500) { // Rate limit or server error
                        this.logger.warn(`[${this.constructor.name}] Request to ${url} failed with status ${response.status}. Attempt ${attempt + 1}/${this.maxRetries}.`);
                        if (attempt < this.maxRetries - 1) {
                            const backoffTime = this.initialBackoffMs * Math.pow(2, attempt);
                            await this._wait(backoffTime);
                            continue; // Retry
                        } else {
                            this.logger.error(`[${this.constructor.name}] Max retries reached for ${url}. Status: ${response.status}`);
                            return null; // Max retries reached
                        }
                    } else if (response.status >= 400 && response.status < 500) { // Client error (not 429)
                        this.logger.error(`[${this.constructor.name}] Client error for ${url}: ${response.status}. Response: ${await response.text()}`);
                        return null; // Do not retry client errors other than 429
                    }
                }

                // Try to parse JSON, handle potential errors
                const textContent = await response.text();
                if (!textContent) { // Handle empty response body
                    if (response.ok) return {}; // Or specific success indicator if appropriate
                    this.logger.warn(`[${this.constructor.name}] Empty response from ${url} with status ${response.status}.`);
                    // Potentially retry for empty responses on 5xx errors if not caught above
                    if (response.status >= 500 && attempt < this.maxRetries - 1) {
                         const backoffTime = this.initialBackoffMs * Math.pow(2, attempt);
                         await this._wait(backoffTime);
                         continue;
                    }
                    return null;
                }
                try {
                    return JSON.parse(textContent);
                } catch (e) {
                    this.logger.error(`[${this.constructor.name}] Failed to parse JSON response from ${url}: ${e.message}. Content: ${textContent.substring(0, 200)}...`);
                    if (attempt < this.maxRetries - 1) {
                        const backoffTime = this.initialBackoffMs * Math.pow(2, attempt);
                        await this._wait(backoffTime);
                        continue; // Retry on JSON parse error
                    }
                    return null; // Max retries reached for JSON parsing
                }

            } catch (error) { // Network errors or other fetch-related issues
                this.logger.warn(`[${this.constructor.name}] Request to ${url} failed: ${error.message}. Attempt ${attempt + 1}/${this.maxRetries}.`);
                if (attempt < this.maxRetries - 1) {
                    const backoffTime = this.initialBackoffMs * Math.pow(2, attempt);
                    await this._wait(backoffTime);
                } else {
                    this.logger.error(`[${this.constructor.name}] Max retries reached for ${url} due to network/fetch error: ${error.message}`);
                    return null; // Max retries reached
                }
            }
        }
        return null; // Should be unreachable if loop logic is correct
    }

    /**
     * Checks if the API key is valid.
     * To be implemented by subclasses.
     * @returns {Promise<boolean>}
     */
    async checkApiKey() {
        throw new Error('Method "checkApiKey" must be implemented by subclasses.');
    }

    /**
     * Adds a magnet link to the debrid service.
     * To be implemented by subclasses.
     * @param {string} magnetLink - The magnet link.
     * @param {object} options - Additional options (e.g., streamType, episodeNumber).
     * @returns {Promise<object|null>} - Service-specific response or null on failure.
     */
    async addMagnet(magnetLink, options = {}) {
        throw new Error('Method "addMagnet" must be implemented by subclasses.');
    }

    /**
     * Gets a streamable link for the given magnet.
     * This is the main method to be called to get a debrided link.
     * It will handle checking status, selecting files, and unrestricting.
     * To be implemented by subclasses.
     * @param {string} magnetLink - The magnet link.
     * @param {object} options - Additional options (e.g., streamType, fileIndex, season, episode).
     * @returns {Promise<string|null>} - The streamable URL or null on failure/not ready.
     */
    async getStreamLink(magnetLink, options = {}) {
        throw new Error('Method "getStreamLink" must be implemented by subclasses.');
    }

    /**
     * Checks the availability of multiple torrent hashes/magnets in the debrid service cache.
     * To be implemented by subclasses.
     * @param {Array<string>} hashesOrMagnets - An array of info hashes or magnet links.
     * @param {object} options - Additional options.
     * @returns {Promise<object|null>} - An object mapping hashes to availability status, or null.
     */
    async getAvailabilityBulk(hashesOrMagnets, options = {}) {
        throw new Error('Method "getAvailabilityBulk" must be implemented by subclasses.');
    }

    /**
     * Selects the best file from a list of files based on criteria.
     * (This method is preserved from your original baseService and uses fileUtils)
     * @param {Array} files - List of files from the torrent.
     * @param {number|null} episode - Episode number (for series).
     * @param {string|null} episodeName - Episode name (for series).
     * @param {object} options - Additional options (e.g., fileIndex, streamType).
     * @returns {object|null} - The best matching file object or null.
     */
    selectBestFile(files, episode, episodeName = null, options = {}) {
        // Add the service name to options if not specified, for fileUtils
        if (!options.service) {
            options.service = this.constructor.name.toLowerCase().replace('service', '');
        }
        return selectBestFile(files, episode, episodeName, options);
    }

    /**
     * Unrestricts a given download link.
     * May be used internally by getStreamLink or directly if needed.
     * To be implemented by subclasses if their links require a separate unrestriction step.
     * @param {string} link - The link to unrestrict.
     * @param {object} options - Additional options.
     * @returns {Promise<string|object|null>} - The unrestricted link (string) or service-specific object, or null.
     */
    async unrestrictLink(link, options = {}) {
        // Default implementation: if a service doesn't need explicit unrestriction after getting links
        // from its torrent info, it might not need to override this.
        // However, most services with a separate unrestrict step will override this.
        this.logger.debug(`[${this.constructor.name}] UnrestrictLink called for ${link}. Default behavior: returning link as is.`);
        return link;
    }
}

module.exports = DebridService;
