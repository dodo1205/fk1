// This file will be rewritten with the new debrid handling logic
// inspired by StreamFusion.

const BaseDebridService = require('./baseDebridService'); // Will be the base for all new services
const NewAllDebrid = require('./newAllDebrid');
// const NewRealDebrid = require('./newRealDebrid'); // Placeholder for when we create it
// const NewTorbox = require('./newTorbox'); // Placeholder
// ... import other new debrid services here

const SERVICE_MAPPING = {
    'alldebrid': NewAllDebrid,
    // 'realdebrid': NewRealDebrid,
    // 'torbox': NewTorbox,
    // ... map other service names to their classes
};

/**
 * Creates an instance of the appropriate debrid service.
 * @param {object} config - User's debrid configuration for the specific service (should include apiKey).
 * @param {string} serviceName - The name of the debrid service (e.g., 'alldebrid', 'realdebrid').
 * @returns {BaseDebridService|null} - An instance of the debrid service or null if not supported.
 */
function createNewDebridService(config, serviceName) {
    const normalizedServiceName = serviceName.toLowerCase().replace(/-/g, '');
    const ServiceClass = SERVICE_MAPPING[normalizedServiceName];

    if (ServiceClass) {
        return new ServiceClass(config);
    } else {
        console.error(`[DebridFactory] Unsupported debrid service: ${serviceName}`);
        return null;
    }
}

/**
 * Main function to handle debriding a torrent and getting a stream link.
 * This will be called by the playback endpoint in index.js.
 * @param {object} queryData - Decoded query from Stremio (contains magnet, episode, season, service, etc.).
 * @param {object} userConfig - The user's specific configuration for the selected debrid service.
 * @returns {Promise<string|null>} - The direct streamable URL or null.
 */
async function resolveStream(queryData, userConfig) {
    const { magnet: magnetLink, service: serviceName, episode, season, type, episodeName } = queryData;

    if (!serviceName || serviceName === 'none') {
        console.warn('[ResolveStream] No debrid service specified or service is "none".');
        return null; // Or handle magnet link directly if that's a desired fallback
    }

    const debridServiceInstance = createNewDebridService(userConfig, serviceName);

    if (!debridServiceInstance) {
        return null; // Service not supported or error in creation
    }

    try {
        // 1. Add magnet to the service (this might also check cache or just add)
        // This method should return an identifier or info object needed for the next step.
        const torrentIdOrInfo = await debridServiceInstance.addMagnetToService(magnetLink, queryData);
        if (!torrentIdOrInfo) {
            console.error(`[ResolveStream] Failed to add magnet to ${serviceName}.`);
            return null;
        }

        // 2. Get the stream link from the service using the identifier
        // This method in the specific service class will handle waiting, file selection, and unrestricting.
        const streamUrl = await debridServiceInstance.getStreamLinkFromService(torrentIdOrInfo, queryData);

        if (streamUrl) {
            console.info(`[ResolveStream] Successfully resolved stream URL from ${serviceName}: ${streamUrl}`);
            return streamUrl;
        } else {
            console.warn(`[ResolveStream] Could not get stream URL from ${serviceName} for magnet.`);
            // This might be where we return a "caching in progress" video URL
            // For now, returning null will trigger that in the current index.js logic.
            return null;
        }

    } catch (error) {
        console.error(`[ResolveStream] Error during debrid process with ${serviceName}:`, error.message);
        return null;
    }
}

/**
 * (Optional) Function to check availability of multiple torrents.
 * @param {Array<string>} hashes - Array of torrent infohashes.
 * @param {object} userConfig - User's debrid configuration.
 * @param {string} serviceName - Name of the debrid service.
 * @returns {Promise<object|null>}
 */
async function checkTorrentsAvailability(hashes, userConfig, serviceName) {
    if (!serviceName || serviceName === 'none') {
        return null;
    }
    const debridServiceInstance = createNewDebridService(userConfig, serviceName);
    if (!debridServiceInstance) {
        return null;
    }
    return debridServiceInstance.checkAvailability(hashes);
}


module.exports = {
    createNewDebridService,
    resolveStream,
    checkTorrentsAvailability,
    // Export new service classes as we create them if needed directly elsewhere
    NewAllDebrid,
    // NewRealDebrid, 
    // NewTorbox,
};
