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
const { serveHTTP } = require('stremio-addon-sdk');
const http = require('http');
const { networkInterfaces } = require('os');
const crypto = require('crypto');

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

// --- Encoding/Decoding Functions ---
function encodeBase64UrlSafe(str) {
    return Buffer.from(str).toString('base64')
        .replace(/\+/g, '-') // Convert '+' to '-'
        .replace(/\//g, '_') // Convert '/' to '_'
        .replace(/=+$/, ''); // Remove ending '='
}

function decodeBase64UrlSafe(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    // Pad with '=' characters if necessary
    while (str.length % 4) {
        str += '=';
    }
    return Buffer.from(str, 'base64').toString('utf-8');
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
// --- End Encoding/Decoding ---


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
        
        // Add baseUrl to config before creating interface
        config.baseUrl = `https://${req.get('host')}/c/${uniqueId}`; 
        
        const addonInterface = createAddonInterface(config);
        
        if (addonInterface && addonInterface.manifest) {
            const fullUrlManifest = { ...addonInterface.manifest };
            // Ensure absolute URLs are correctly set (using baseUrl from config now)
            fullUrlManifest.resources = [
                { name: "catalog", types: ["fankai"], idPrefixes: ["fankai:"], endpoint: `${config.baseUrl}/catalog/{type}/{id}.json` },
                { name: "meta", types: ["fankai"], idPrefixes: ["fankai:"], endpoint: `${config.baseUrl}/meta/{type}/{id}.json` },
                { name: "stream", types: ["fankai"], idPrefixes: ["fankai:"], endpoint: `${config.baseUrl}/stream/{type}/{id}.json` }
                // Playback endpoint is not part of standard manifest resources
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
        // Add baseUrl to config before creating interface
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
        // Add baseUrl to config before creating interface
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
        // Add baseUrl to config before creating interface
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

    console.log(`[PLAYBACK] Decoded Action: ${action}, Magnet: ${magnetLink ? magnetLink.substring(0, 50) + '...' : 'N/A'}, Episode: ${episodeNumber}, EpisodeName: ${episodeName}`);

    try {
        const { initiateDebridDownload, debridTorrent } = require('./lib/debrid/index');
        const introVideoUrl = 'https://cdn4.videas.fr/1503a1ff14ee4357869d8d8ab2634ea4/no-cache-mp4-source.mp4';

        if (action === 'download') {
            console.log(`[PLAYBACK - DOWNLOAD] Initiating download for: ${magnetLink.substring(0, 50)}...`);
            if (config.service === 'none' || !config.apiKey) {
                 console.error('[PLAYBACK - DOWNLOAD] Debrid service not configured');
                 return res.redirect(302, introVideoUrl);
            }
            // Pass episodeNumber and episodeName to initiateDebridDownload
            initiateDebridDownload(magnetLink, config, episodeNumber, episodeName)
                .then(() => console.log(`[PLAYBACK - DOWNLOAD] Background download initiated for ${magnetLink.substring(0, 50)}...`))
                .catch(err => console.error(`[PLAYBACK - DOWNLOAD] Background download initiation failed: ${err.message}`));
            console.log(`[PLAYBACK - DOWNLOAD] Redirecting to intro video: ${introVideoUrl}`);
            return res.redirect(302, introVideoUrl);

        } else if (action === 'play') {
            console.log(`[PLAYBACK - PLAY] Resolving stream link for: ${magnetLink.substring(0, 50)}...`);
            if (config.service === 'none' || !config.apiKey) {
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

    const { action, episode: episodeNumber, episodeName } = queryData; // Also decode episode info for HEAD if needed

    // Basic headers indicating potential video content
    const headers = {
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    };

    try {
        if (action === 'download' || action === 'play') {
             if (config.service === 'none' || !config.apiKey) {
                 if (action === 'play') {
                    console.error('[PLAYBACK HEAD - PLAY] Debrid not configured');
                    return res.status(400).end();
                 }
                 console.warn('[PLAYBACK HEAD - DOWNLOAD] Debrid not configured, but responding OK for HEAD');
             }
            console.log(`[PLAYBACK HEAD - ${action.toUpperCase()}] Responding 200 OK for Ep: ${episodeNumber} Name: ${episodeName}`);
            return res.status(200).set(headers).end();

        } else {
            console.error(`[PLAYBACK HEAD] Invalid action: ${action}`);
            return res.status(400).end();
        }
    } catch (error) {
        console.error(`[PLAYBACK HEAD] Error processing request: ${error.message}`);
        return res.status(500).end();
    }
});
                 console.error('[PLAYBACK - PLAY] Debrid service not configured for playback');
                 return res.status(400).send('Debrid service not configured for playback');
            }
            // Pass episodeNumber and episodeName to debridTorrent
            const debridResult = await debridTorrent(magnetLink, config, episodeNumber, episodeName);
            if (debridResult && debridResult.streamUrl) {
                console.log(`[PLAYBACK - PLAY] Redirecting to resolved stream: ${debridResult.streamUrl}`);
                return res.redirect(302, debridResult.streamUrl);
            } else {
                console.log(`[PLAYBACK - PLAY] Stream not ready or found. Initiating download and redirecting to intro video.`);
                 // Pass episodeNumber and episodeName to initiateDebridDownload
                 initiateDebridDownload(magnetLink, config, episodeNumber, episodeName)
                    .then(() => console.log(`[PLAYBACK - PLAY] Background download initiated (stream not ready) for ${magnetLink.substring(0, 50)}...`))
                    .catch(err => console.error(`[PLAYBACK - PLAY] Background download initiation failed (stream not ready): ${err.message}`));
                return res.redirect(302, introVideoUrl);
            }
        } else {
            console.error(`[PLAYBACK] Invalid action: ${action}`);
            return res.status(400).send('Invalid action parameter');
        }
    } catch (error) {
        console.error(`[PLAYBACK] Error processing request: ${error.message}`);
        return res.status(500).send('Internal server error');
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