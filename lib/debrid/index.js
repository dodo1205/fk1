const RealDebrid = require('./realDebrid');
const AllDebrid = require('./allDebrid');
const Torbox = require('./torbox');
const { isWebReady } = require('../utils/fileUtils'); // Assuming this utility is still relevant

const logger = console; // Basic logger

/**
 * Creates an instance of the appropriate debrid service.
 * @param {string} serviceName - Name of the service ('realdebrid', 'alldebrid', 'torbox').
 * @param {string} apiKey - API key for the service.
 * @returns {DebridService} - Instance of the debrid service.
 * @throws {Error} if the service is not supported.
 */
function createDebridService(serviceName, apiKey) {
    const normalizedService = serviceName.toLowerCase().replace(/-/g, '');
    switch (normalizedService) {
        case 'realdebrid':
            return new RealDebrid(apiKey);
        case 'alldebrid':
            return new AllDebrid(apiKey);
        case 'torbox':
            return new Torbox(apiKey);
        default:
            throw new Error(`Unsupported debrid service: ${serviceName}`);
    }
}

/**
 * Initiates the process of adding a torrent to the debrid service WITHOUT waiting for completion.
 * @param {string} magnetLink - Magnet link to add.
 * @param {object} config - Debrid service configuration { service, apiKey }.
 * @param {string|null} streamType - Type of content ('series', 'movie').
 * @param {number|null} episodeNumber - Episode number (if series).
 * @param {string|null} episodeName - Episode name (if series).
 * @returns {Promise<object|null>} - The response from the service's addMagnet method (e.g., torrent ID info) or null on failure.
 */
async function initiateDebridDownload(magnetLink, config, streamType, episodeNumber, episodeName) {
    logger.log(`[DEBRID INIT] Initiating download for: ${magnetLink.substring(0, 50)}..., Type: ${streamType}, Ep: ${episodeNumber}, Name: ${episodeName}`);
    try {
        if (!config || !config.service || config.service === 'none' || !config.apiKey) {
            throw new Error('Invalid debrid configuration for initiateDebridDownload');
        }

        const service = createDebridService(config.service, config.apiKey);

        // Optional: Check API key validity first, though addMagnet should handle errors.
        // const isValid = await service.checkApiKey();
        // if (!isValid) {
        //     throw new Error('Invalid API key for initiateDebridDownload');
        // }

        const options = { streamType, episodeNumber, episodeName };
        const result = await service.addMagnet(magnetLink, options);

        if (result) {
            logger.log(`[DEBRID INIT] Torrent addition initiated successfully with ${config.service}. Result:`, JSON.stringify(result));
        } else {
            logger.warn(`[DEBRID INIT] Torrent addition to ${config.service} might have failed or returned no specific result.`);
        }
        return result; // Return what the service's addMagnet returned

    } catch (error) {
        logger.error(`[DEBRID INIT] Error during download initiation: ${error.message}`);
        // Do not re-throw to avoid blocking other operations if this is fire-and-forget
        return null;
    }
}

/**
 * Checks the status of a torrent on the debrid service and retrieves the streamable link if ready.
 * @param {string} magnetLink - Magnet link to check/debride.
 * @param {object} config - Debrid service configuration { service, apiKey, downloadOption (e.g. 'cached') }.
 * @param {string|null} streamType - Type of content ('series', 'movie').
 * @param {number|null} episodeNumber - Episode number (if series).
 * @param {string|null} episodeName - Episode name (if series).
 * @param {string|null} season - Season number (if series).
 * @param {number|null} fileIndex - Specific file index/ID to prioritize.
 * @returns {Promise<object|null>} - Object with { streamUrl, filename, webReady } or null.
 */
async function debridTorrent(magnetLink, config, streamType, episodeNumber, episodeName, season, fileIndex) {
    logger.log(`[DEBRID GET] Verifying/Retrieving link for: ${magnetLink.substring(0, 50)}..., Type: ${streamType}, Ep: ${episodeNumber}, Name: ${episodeName}`);
    try {
        if (!config || !config.service || config.service === 'none' || !config.apiKey) {
            logger.warn('[DEBRID GET] Invalid debrid configuration.');
            return null;
        }

        const service = createDebridService(config.service, config.apiKey);

        const apiKeyValid = await service.checkApiKey();
        if (!apiKeyValid) {
            logger.warn(`[DEBRID GET] Invalid API key for ${config.service}.`);
            return null;
        }

        // Options for getStreamLink
        const options = {
            streamType: streamType || (new URLSearchParams(magnetLink.split('?')[1] || '').get('type')) || 'series',
            episodeNumber,
            episodeName,
            season: season || (new URLSearchParams(magnetLink.split('?')[1] || '').get('season')) || null,
            fileIndex: fileIndex !== undefined ? fileIndex : (new URLSearchParams(magnetLink.split('?')[1] || '').get('fileIndex')) || null
        };
        
        // If downloadOption is 'cached', we might want to use getAvailabilityBulk first.
        // However, getStreamLink in each service should ideally handle cache checks internally.
        // For now, we directly call getStreamLink.
        // The 'cached' option logic might need to be re-evaluated or handled within getStreamLink implementations.

        const streamUrl = await service.getStreamLink(magnetLink, options);

        if (!streamUrl) {
            logger.log(`[DEBRID GET] Could not get streamable link from ${config.service}.`);
            return null;
        }

        logger.log(`[DEBRID GET] Final stream URL obtained: ${streamUrl}`);
        
        // Filename might not be easily available if getStreamLink only returns a URL.
        // This part might need adjustment if filename is crucial and not part of streamUrl.
        // For now, we'll try to derive it or leave it null.
        let filename = null;
        try {
            const urlParts = new URL(streamUrl);
            filename = urlParts.pathname.split('/').pop() || 'streamed_file';
            if (filename.includes('?')) filename = filename.split('?')[0]; // Clean query params
        } catch (e) {
            logger.warn(`[DEBRID GET] Could not parse filename from stream URL: ${streamUrl}`);
        }


        const webReady = isWebReady(streamUrl); // Assuming isWebReady is still a valid check
        logger.log(`[DEBRID GET] Stream URL: ${streamUrl}, Filename: ${filename}, WebReady: ${webReady}`);

        return {
            streamUrl: streamUrl, // Should be HTTPS already if services handle it
            filename: filename,
            // allLinks: null, // This was in your old structure, might be hard to get with new getStreamLink
            webReady: webReady
        };

    } catch (error) {
        logger.error(`[DEBRID GET] Error retrieving debrided link: ${error.message}`, error.stack);
        return null;
    }
}

module.exports = {
    createDebridService,
    RealDebrid, // Exporting the classes themselves can be useful
    AllDebrid,
    Torbox,
    debridTorrent,
    initiateDebridDownload
};
