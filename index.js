/**
 * Point d'entrée principal de l'addon FKStream
 * 
 * Ce fichier gère un serveur Express qui permet de configurer et d'utiliser
 * l'addon FKStream pour Stremio avec différentes configurations de debridage.
 */

// Modules requis
const express = require('express');
const path = require('path');
const cors = require('cors');
const { networkInterfaces } = require('os');
const crypto = require('crypto');
const { encodeBase64UrlSafe, decodeBase64UrlSafe } = require('./lib/utils/stringUtils');

// Création de l'application Express
const app = express();

// Configuration middleware
app.use(express.json());
app.use(cors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    preflightContinue: false,
    optionsSuccessStatus: 204
}));

// Servir les fichiers statiques du dossier public
app.use(express.static(path.join(__dirname, 'public')));

// Stockage des configurations actives
const activeConfigs = {};

// Fonction pour générer un ID unique
function generateUniqueId() {
    return crypto.randomBytes(4).toString('hex');
}

function encodeConfig(config) {
    return encodeBase64UrlSafe(JSON.stringify(config));
}

function decodeConfig(encodedConfig) {
    try {
        const decodedString = decodeBase64UrlSafe(encodedConfig);
        return JSON.parse(decodedString);
    } catch (error) {
        console.error('Erreur lors du décodage de la configuration:', error);
        return null;
    }
}

// Function to decode the query parameter from the URL path
function decodeQuery(encodedQuery) {
     try {
        const decodedString = decodeBase64UrlSafe(encodedQuery);
        return JSON.parse(decodedString);
    } catch (error) {
        console.error('Erreur lors du décodage de la query:', error);
        return null;
    }
}

// Importation du module addon
const { createAddonInterface } = require('./lib/addon');

// Routes principales
// -----------------------------------------------------------

// Page d'accueil - redirection vers l'interface de configuration
app.get('/', (req, res) => {
    res.redirect('/configure');
});

// Route spécifique pour la page de configuration
app.get('/configure', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'configure.html'));
});

// Route pour le manifest par défaut - redirection vers la page de configuration
app.get('/manifest.json', (req, res) => {
    res.redirect('/configure');
});

// Route pour encoder une configuration
app.post('/api/encode', (req, res) => {
    try {
        const config = req.body;
        if (!config || typeof config !== 'object') {
            return res.status(400).json({ success: false, error: 'Configuration invalide' });
        }
        const safeConfig = {
            service: ['none', 'realdebrid', 'alldebrid', 'torbox'].includes(config.service) ? config.service : 'none',
            apiKey: config.apiKey || '',
            downloadOption: ['all', 'cached', 'download'].includes(config.downloadOption) ? config.downloadOption : 'all',
            prepareNextEpisode: config.prepareNextEpisode === true || config.prepareNextEpisode === 'true'
        };
        const uniqueId = generateUniqueId();
        activeConfigs[uniqueId] = safeConfig;
        console.log(`Nouvelle configuration créée avec ID ${uniqueId}:`, safeConfig);
        const encoded = encodeConfig(safeConfig); // Keep this for potential direct use, though ID is preferred
        res.json({ success: true, uniqueId: uniqueId, encoded: encoded });
    } catch (error) {
        console.error('Erreur lors de l\'encodage de la configuration:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Route pour le manifest personnalisé par ID unique
app.get('/c/:uniqueId/manifest.json', (req, res) => {
    try {
        const uniqueId = req.params.uniqueId;
        console.log('Demande de manifest pour ID:', uniqueId);
        const config = activeConfigs[uniqueId];
        if (!config) {
            console.error('Configuration non trouvée pour ID:', uniqueId);
            return res.status(404).json({ error: 'Configuration non trouvée' });
        }
        console.log('Utilisation de la configuration:', config);
        
        config.baseUrl = `https://${req.get('host')}/c/${uniqueId}`; 
        
        const addonInterface = createAddonInterface(config);
        
        if (addonInterface && addonInterface.manifest) {
            const fullUrlManifest = { ...addonInterface.manifest };
            fullUrlManifest.resources = [
                { name: "catalog", types: ["fankai"], idPrefixes: ["fankai:"], endpoint: `${config.baseUrl}/catalog/{type}/{id}.json` },
                { name: "meta", types: ["fankai"], idPrefixes: ["fankai:"], endpoint: `${config.baseUrl}/meta/{type}/{id}.json` },
                { name: "stream", types: ["fankai"], idPrefixes: ["fankai:"], endpoint: `${config.baseUrl}/stream/{type}/{id}.json` }
            ];
            console.log('Manifest envoyé avec URLs absolues');
            res.setHeader('Content-Type', 'application/json');
            return res.send(JSON.stringify(fullUrlManifest));
        } else {
            console.error('Interface d\'addon ou manifest non généré');
            return res.status(500).json({ error: 'Erreur de génération du manifest' });
        }
    } catch (error) {
        console.error('Erreur lors du traitement du manifest:', error);
        res.status(500).json({ error: 'Erreur de génération du manifest: ' + error.message });
    }
});

// Route pour le manifest personnalisé par configuration encodée (pour compatibilité)
app.get('/:encodedConfig/manifest.json', (req, res) => {
    try {
        const encodedConfig = req.params.encodedConfig;
        console.log('Demande de manifest avec configuration encodée:', encodedConfig);
        const config = decodeConfig(encodedConfig);
        if (!config) {
            console.error('Impossible de décoder la configuration:', encodedConfig);
            return res.status(400).json({ error: 'Configuration invalide' });
        }
        console.log('Configuration décodée:', config);
        const uniqueId = generateUniqueId();
        activeConfigs[uniqueId] = config;
        return res.redirect(`/c/${uniqueId}/manifest.json`);
    } catch (error) {
        console.error('Erreur lors du traitement du manifest encodé:', error);
        res.status(500).json({ error: 'Erreur de génération du manifest: ' + error.message });
    }
});

// Routes pour les ressources (catalog, meta, stream) avec ID unique
app.get('/c/:uniqueId/catalog/:type/:id.json', (req, res) => {
    try {
        const uniqueId = req.params.uniqueId;
        console.log(`Demande de catalog pour ID: ${uniqueId}, type: ${req.params.type}, id: ${req.params.id}`);
        const config = activeConfigs[uniqueId];
        if (!config) {
            console.error('Configuration non trouvée pour ID catalog:', uniqueId);
            return res.status(404).json({ error: 'Configuration non trouvée' });
        }
        config.baseUrl = `https://${req.get('host')}/c/${uniqueId}`; 
        const addonInterface = createAddonInterface(config);
        if (!addonInterface.get) {
            console.error('Interface d\'addon invalide: méthode get manquante');
            return res.status(500).json({ error: 'Interface d\'addon invalide' });
        }
        addonInterface.get('catalog', req.params.type, req.params.id, req.query).then(result => {
            res.setHeader('Content-Type', 'application/json');
            res.send(JSON.stringify(result));
        }).catch(error => {
            console.error('Erreur catalog:', error);
            res.status(500).json({ error: error.message });
        });
    } catch (error) {
        console.error('Erreur route catalog:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/c/:uniqueId/meta/:type/:id.json', (req, res) => {
    try {
        const uniqueId = req.params.uniqueId;
        console.log(`Demande de meta pour ID: ${uniqueId}, type: ${req.params.type}, id: ${req.params.id}`);
        const config = activeConfigs[uniqueId];
        if (!config) {
            console.error('Configuration non trouvée pour ID meta:', uniqueId);
            return res.status(404).json({ error: 'Configuration non trouvée' });
        }
        config.baseUrl = `https://${req.get('host')}/c/${uniqueId}`; 
        const addonInterface = createAddonInterface(config);
        if (!addonInterface.get) {
            console.error('Interface d\'addon invalide: méthode get manquante');
            return res.status(500).json({ error: 'Interface d\'addon invalide' });
        }
        addonInterface.get('meta', req.params.type, req.params.id).then(result => {
            res.setHeader('Content-Type', 'application/json');
            res.send(JSON.stringify(result));
        }).catch(error => {
            console.error('Erreur meta:', error);
            res.status(500).json({ error: error.message });
        });
    } catch (error) {
        console.error('Erreur route meta:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/c/:uniqueId/stream/:type/:id.json', (req, res) => {
    try {
        const uniqueId = req.params.uniqueId;
        const streamType = req.params.type;
        const streamId = req.params.id;
        console.log(`Demande de stream pour ID: ${uniqueId}, type: ${streamType}, id: ${streamId}`);
        const config = activeConfigs[uniqueId];
        if (!config) {
            console.error('Configuration non trouvée pour ID stream:', uniqueId);
            return res.status(404).json({ error: 'Configuration non trouvée' });
        }
        config.baseUrl = `https://${req.get('host')}/c/${uniqueId}`; 
        const addonInterface = createAddonInterface(config);
        if (!addonInterface.get) {
            console.error('Interface d\'addon invalide: méthode get manquante');
            return res.status(500).json({ error: 'Interface d\'addon invalide' });
        }
        addonInterface.get('stream', streamType, streamId).then(result => {
            res.setHeader('Content-Type', 'application/json');
            res.send(JSON.stringify(result));
        }).catch(error => {
            console.error('Erreur stream:', error);
            res.status(500).json({ error: error.message });
        });
    } catch (error) {
        console.error('Erreur route stream:', error);
        res.status(500).json({ error: error.message });
    }
});

// Route pour gérer la lecture/téléchargement via le backend - MODIFIED ROUTE
app.get('/c/:uniqueId/playback/:queryb64', async (req, res) => {
    const { uniqueId, queryb64 } = req.params;

    console.log(`[PLAYBACK] Request for ID: ${uniqueId}, QueryB64: ${queryb64}`);

    const config = activeConfigs[uniqueId];
    if (!config) {
        console.error('[PLAYBACK] Configuration not found for ID:', uniqueId);
        return res.status(404).send('Configuration not found');
    }

    const queryData = decodeQuery(queryb64);
    if (!queryData || !queryData.action || !queryData.magnet) {
        console.error('[PLAYBACK] Invalid or missing query data from queryb64:', queryData);
        return res.status(400).send('Invalid or missing action/magnet in query');
    }

    const { action, magnet: magnetLink, episode: episodeNumber, episodeName } = queryData;

    console.log(`[PLAYBACK] Decoded Query Data:`, queryData);
    // The 'action' property in queryData might be deprecated with the new resolveStream logic.
    // We primarily need queryData.service, queryData.magnet, and episode/season info.

    try {
        // Import the new resolveStream function from the updated lib/debrid/index.js
        const { resolveStream } = require('./lib/debrid/index');
        const introVideoUrl = 'https://cdn4.videas.fr/1503a1ff14ee4357869d8d8ab2634ea4/no-cache-mp4-source.mp4'; // Placeholder for "caching in progress"

        // The userConfig for the service is the 'config' object we retrieved for the uniqueId.
        // It should contain { service: 'alldebrid', apiKey: '...', ... }
        // queryData should also contain a 'service' field indicating which debrid to use for this specific stream.
        // This 'service' in queryData is determined by addon.js when creating the stream link.
        
        const serviceNameToUse = queryData.service; // e.g., 'alldebrid', 'realdebrid'
        if (!serviceNameToUse || serviceNameToUse === 'none') {
            console.error('[PLAYBACK] Debrid service not specified in queryData or is "none".');
            return res.status(400).send('Debrid service not specified in query.');
        }
        
        // Pass the entire user's config for that uniqueId, which includes the apiKey for the selected service.
        // resolveStream will internally pick the correct apiKey based on serviceNameToUse if userConfig has multiple.
        // For now, userConfig (which is 'config' here) is specific to one service chosen at /api/encode.
        const userDebridConfig = {
            service: config.service, // This is the service selected at /configure time
            apiKey: config.apiKey,
            // Potentially add other global settings from 'config' if services need them
        };

        // Ensure queryData.service (the service chosen for *this specific stream*) is used to pick the debrid handler.
        // The userDebridConfig.apiKey should be the one for queryData.service.
        // This assumes that the 'config' object (userDebridConfig) is already specific to the 'queryData.service'.
        // This is true because 'config' is set when the user creates their unique addon link.
        // If queryData.service could differ from config.service, we'd need a more complex config structure.
        // For now, we assume config.service IS the serviceNameToUse.

        console.log(`[PLAYBACK] Attempting to resolve stream via ${serviceNameToUse} for magnet: ${queryData.magnet ? queryData.magnet.substring(0, 50) + '...' : 'N/A'}`);
        
        const streamUrl = await resolveStream(queryData, userDebridConfig);

        if (streamUrl) {
            console.log(`[PLAYBACK] Redirecting to resolved stream: ${streamUrl}`);
            return res.redirect(302, streamUrl);
        } else {
            // This means the stream is not ready (being cached) or an error occurred.
            console.log(`[PLAYBACK] Stream not ready or error for ${serviceNameToUse}. Redirecting to intro video: ${introVideoUrl}`);
            return res.redirect(302, introVideoUrl);
        }

    } catch (error) {
        console.error(`[PLAYBACK] Error processing request: ${error.message}`, error.stack);
        return res.status(500).send('Internal server error');
    }
});

// HEAD handler for playback URL - Check status without redirecting
app.head('/c/:uniqueId/playback/:queryb64', async (req, res) => {
    const { uniqueId, queryb64 } = req.params;

    console.log(`[PLAYBACK HEAD] Request for ID: ${uniqueId}, QueryB64: ${queryb64}`);

    const config = activeConfigs[uniqueId];
    if (!config) {
        console.error('[PLAYBACK HEAD] Configuration not found for ID:', uniqueId);
        return res.status(404).end();
    }

    const queryData = decodeQuery(queryb64);
    if (!queryData || !queryData.action || !queryData.magnet) {
        console.error('[PLAYBACK HEAD] Invalid or missing query data from queryb64:', queryData);
        return res.status(400).end();
    }

    // 'action' might be deprecated here as well, primarily need magnet and service info.
    // const { action, episode: episodeNumber, episodeName } = queryData; 

    const headers = {
        'Content-Type': 'video/mp4', // Standard content type for video streams
        'Accept-Ranges': 'bytes',    // Indicate support for range requests
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    };

    try {
        // Basic validation: if the config and query are okay, respond with 200.
        // A more advanced HEAD handler could try to get the actual status from debrid
        // or check a Redis cache (like StreamFusion does) to return 202 if caching.
        // For now, a simple 200 OK is a safe default for HEAD if parameters are valid.
        // Stremio uses HEAD to check if the URL is valid and get Content-Length if available.
        // If debrid service is not configured, it's an issue for actual playback, but HEAD might still be "valid".
        
        const serviceNameToUse = queryData.service;
        if (!serviceNameToUse || serviceNameToUse === 'none') {
            if (queryData.magnet && queryData.magnet.startsWith('magnet:')) {
                // If it's a direct magnet link and no debrid, Stremio might handle it.
                // Or, if this endpoint is *only* for debrided links, this is an error.
                // Assuming for now that if it reaches here with 'none', it's an issue for playback,
                // but the URL itself can be considered "valid" for a HEAD request.
                console.warn(`[PLAYBACK HEAD] Debrid service is 'none' for magnet: ${queryData.magnet.substring(0,50)}...`);
            } else {
                console.error('[PLAYBACK HEAD] Debrid service not specified in queryData or is "none".');
                // For non-magnet links, if no service, it's likely an error.
                // However, for HEAD, we might still return 200 if the path is structurally valid.
                // Let's be stricter: if no service for a non-magnet, it's bad.
                // But queryData.magnet should always be present based on previous check.
            }
        }
        
        // For now, always respond 200 OK if basic checks pass.
        // Later, we can integrate with checkTorrentsAvailability or a Redis cache status.
        console.log(`[PLAYBACK HEAD] Responding 200 OK for query:`, queryData);
        return res.status(200).set(headers).end();

    } catch (error) {
        console.error(`[PLAYBACK HEAD] Error processing request: ${error.message}`);
        return res.status(500).end();
    }
});

// Démarrer le serveur
// -----------------------------------------------------------
const PORT = process.env.PORT || 7000;

app.listen(PORT, () => {
    console.log(`---------------------------------------------`);
    console.log(`Addon FKStream démarré sur http://localhost:${PORT}`);
    console.log(`Interface de configuration: http://localhost:${PORT}/configure`);
    console.log(`---------------------------------------------`);
    const nets = networkInterfaces();
    let localIp = '';
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                localIp = net.address;
                break;
            }
        }
        if (localIp) break;
    }
    if (localIp) {
        console.log(`Sur votre réseau: http://${localIp}:${PORT}/configure`);
    }
    console.log(`---------------------------------------------`);
});
