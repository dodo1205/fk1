const RealDebrid = require('./realDebrid');
const AllDebrid = require('./allDebrid');
const Torbox = require('./torbox');
const { isWebReady } = require('../utils/fileUtils');

// Exposer les StaticResponses des services pour que l'addon principal puisse les utiliser
// On prend celles de RealDebrid comme référence, elles devraient être similaires pour les autres.
// Idéalement, StaticResponses pourrait être un module partagé.
const DebridStaticResponses = RealDebrid.prototype.StaticResponses || AllDebrid.prototype.StaticResponses || Torbox.prototype.StaticResponses || {};


function createDebridService(service, apiKey) {
    const normalizedService = service.toLowerCase().replace(/-/g, '');
    switch (normalizedService) {
        case 'realdebrid':
            return new RealDebrid(apiKey);
        case 'alldebrid':
            return new AllDebrid(apiKey);
        case 'torbox':
            return new Torbox(apiKey);
        default:
            throw new Error(`Service de debridage non pris en charge: ${service}`);
    }
}

async function initiateDebridDownload(magnetLink, config, episodeNumber, episodeName) {
    console.log(`[DEBRID INIT] Initiation du téléchargement pour: ${magnetLink.substring(0, 50)}..., Ep: ${episodeNumber}, Name: ${episodeName}`);
    try {
        if (!config || !config.service || config.service === 'none' || !config.apiKey) {
            throw new Error('Configuration de debridage invalide pour initiateDebridDownload');
        }
        const serviceInstance = createDebridService(config.service, config.apiKey);
        const isValid = await serviceInstance.checkApiKey();
        if (!isValid) {
            // On pourrait vouloir propager une erreur spécifique ici
            console.error(`[DEBRID INIT] Clé API invalide pour ${config.service}`);
            return { error: 'Invalid API Key', status: DebridStaticResponses.FAILED_ACCESS };
        }

        const urlParams = new URLSearchParams(magnetLink.split('?')[1] || '');
        const streamType = urlParams.get('type') || 'series';

        const torrentId = await serviceInstance.addMagnetOnly(magnetLink, streamType, episodeNumber, episodeName);
        if (torrentId) {
            console.log(`[DEBRID INIT] Ajout du torrent à ${config.service} initié avec succès. ID: ${torrentId}`);
            return { success: true, torrentId };
        } else {
            console.error(`[DEBRID INIT] Échec de l'ajout du torrent à ${config.service}.`);
            return { error: 'Failed to add torrent', status: DebridStaticResponses.FAILED_OPENING };
        }

    } catch (error) {
        console.error(`[DEBRID INIT] Erreur lors de l'initiation du téléchargement: ${error.message}`);
        // Renvoyer une structure d'erreur cohérente
        return { error: error.message, status: DebridStaticResponses.FAILED_OPENING };
    }
}

async function debridTorrent(magnetLink, config, episodeNumber, episodeName) {
    console.log(`[DEBRID GET] Vérification/Récupération lien pour: ${magnetLink.substring(0, 50)}..., Ep: ${episodeNumber}, Name: ${episodeName}`);
    try {
        if (!config || !config.service || config.service === 'none' || !config.apiKey) {
            console.warn('[DEBRID GET] Configuration de debridage invalide');
            return { status: 'INVALID_CONFIG', error: 'Configuration de debridage invalide' };
        }

        const serviceInstance = createDebridService(config.service, config.apiKey);

        const isValid = await serviceInstance.checkApiKey();
        if (!isValid) {
            console.warn(`[DEBRID GET] Clé API invalide pour ${config.service}`);
            // Utiliser les StaticResponses du service s'ils sont disponibles et mappés
            return { status: serviceInstance.StaticResponses?.FAILED_ACCESS || 'INVALID_API_KEY', error: 'Clé API invalide' };
        }

        const urlParams = new URLSearchParams(magnetLink.split('?')[1] || '');
        const streamType = urlParams.get('type') || 'series';
        const fileIndex = urlParams.get('fileIndex') ? parseInt(urlParams.get('fileIndex')) : null;
        const season = urlParams.get('season') || null;

        console.log(`[DEBRID GET] Infos utilisées: type=${streamType}, fileIndex=${fileIndex}, season=${season}, episode=${episodeNumber}${episodeName ? ', nom=' + episodeName : ''}`);

        const result = await serviceInstance.getTorrentStatusAndLinks(magnetLink, fileIndex, season, episodeNumber, streamType, episodeName);

        // Les services retournent maintenant un objet avec un champ 'status' et potentiellement 'links', 'error', 'torrentInfo'
        // Si le statut est COMPLETED, alors result.links devrait être présent.
        if (result && result.status === DebridStaticResponses.COMPLETED) {
            if (!result.links || result.links.length === 0 || !result.links[0].url) {
                console.error(`[DEBRID GET] Statut COMPLETED mais pas de lien valide. Résultat:`, result);
                return { status: DebridStaticResponses.FAILED_DOWNLOAD, error: 'Completed but no valid link found', details: result };
            }

            const finalUrl = result.links[0].url;
            console.log(`[DEBRID GET] URL finale obtenue de ${config.service}: ${finalUrl}`);

            if (!finalUrl.startsWith('http')) {
                console.error(`[DEBRID GET] URL de stream invalide (non http(s)): ${finalUrl}`);
                return { status: DebridStaticResponses.FAILED_DOWNLOAD, error: 'Invalid stream URL format', details: result };
            }
            
            // La dérestriction est maintenant gérée dans chaque service.
            // Forcer HTTPS si besoin (certains services peuvent retourner http)
            let secureUrl = finalUrl;
            if (finalUrl.startsWith('http:')) {
                secureUrl = finalUrl.replace('http:', 'https:');
                console.log(`[DEBRID GET] URL convertie en HTTPS: ${secureUrl}`);
            }

            const webReady = isWebReady(secureUrl);
            console.log(`[DEBRID GET] Stream considéré comme ${webReady ? 'web-ready' : 'non web-ready'}`);

            return {
                status: DebridStaticResponses.COMPLETED, // Confirmer le statut de succès
                streamUrl: secureUrl,
                filename: result.links[0].filename,
                // allLinks: result.links, // Si les services retournent plusieurs liens, on peut les propager
                webReady: webReady,
                torrentInfo: result.torrentInfo // Propager les infos du torrent si disponibles
            };
        } else {
            // Gérer les autres statuts (DOWNLOADING, FAILED_ACCESS, etc.)
            console.log(`[DEBRID GET] Torrent non prêt ou erreur. Statut: ${result?.status}, Erreur: ${result?.error}`);
            // Retourner directement l'objet résultat du service, qui contient le statut et l'erreur.
            return result || { status: 'UNKNOWN_ERROR', error: 'Résultat inattendu du service de débridage' };
        }

    } catch (error) {
        console.error(`[DEBRID GET] Erreur majeure lors de la récupération du lien débridé: ${error.message}`);
        // Renvoyer une structure d'erreur cohérente
        return { status: 'EXCEPTION', error: error.message, stack: error.stack };
    }
}

module.exports = {
    createDebridService,
    RealDebrid, // Exporter les classes pour référence si besoin
    AllDebrid,
    Torbox,
    DebridStaticResponses, // Exporter les statuts pour l'addon principal
    debridTorrent,
    initiateDebridDownload
};
