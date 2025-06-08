const RealDebrid = require('./realDebrid');
const AllDebrid = require('./allDebrid');
const Torbox = require('./torbox');
const { isWebReady } = require('../utils/fileUtils');

/**
 * Crée une instance du service de debridage approprié
 * @param {string} service - Nom du service ('realdebrid', 'alldebrid', 'torbox')
 * @param {string} apiKey - Clé API pour le service
 * @returns {DebridService} - Instance du service de debridage
 */
function createDebridService(service, apiKey) {
    // Normaliser le nom du service (supprimer les tirets et mettre en minuscules)
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

/**
 * Lance le processus d'ajout d'un torrent au service de debridage SANS attendre la fin.
 * Utilisé par le gestionnaire de ressources /download.
 * @param {string} magnetLink - Lien magnet à ajouter
 * @param {Object} config - Configuration du service de debridage
 * @param {number|null} episodeNumber - Numéro de l'épisode
 * @param {string|null} episodeName - Nom de l'épisode
 * @returns {Promise<Object|null>} Un objet avec le statut du cache, ex: { isCached: boolean, files: [] }
 */
async function checkCache(magnetLink, config) {
    console.log(`[CACHE CHECK] Vérification pour: ${magnetLink.substring(0, 50)}...`);
    try {
        if (!config || !config.service || config.service === 'none' || !config.apiKey) {
            throw new Error('Configuration de debridage invalide pour checkCache');
        }

        const service = createDebridService(config.service, config.apiKey);
        const normalizedServiceName = config.service.toLowerCase().replace(/-/g, '');

        if (normalizedServiceName === 'realdebrid' || normalizedServiceName === 'alldebrid') {
            // Pour RealDebrid et AllDebrid, on applique la "fausse" vérification de cache.
            // On retourne systématiquement que le lien est en cache.
            console.log(`[CACHE CHECK] Fausse vérification pour ${config.service}: retourne 'isCached: true' par défaut.`);
            return { isCached: true, files: [] }; // On retourne true pour afficher l'icône "éclair".
        } 
        
        if (normalizedServiceName === 'torbox') {
            // Pour Torbox, on effectue une vraie vérification de cache.
            const cacheInfo = await service.checkCache(magnetLink);
            if (cacheInfo) {
                console.log(`[CACHE CHECK] Résultat pour Torbox: Cached=${cacheInfo.isCached}`);
                return cacheInfo; // Retourne { isCached, files, torrentIdIfPresent }
            }
            console.warn(`[CACHE CHECK] Torbox: checkCache a retourné une réponse nulle.`);
            return { isCached: false, files: [] }; // Fallback en cas d'erreur
        }

        console.warn(`[CACHE CHECK] Service non géré: ${config.service}`);
        return null;

    } catch (error) {
        console.error(`[CACHE CHECK] Erreur lors de la vérification du cache: ${error.message}`);
        return null;
    }
}


/**
 * Vérifie l'état d'un torrent sur le service de debridage et récupère le lien de streaming si prêt.
 * Utilisé par le stream handler pour les liens "Lire via [Service]".
 * @param {string} magnetLink - Lien magnet à vérifier/débrider
 * @param {Object} config - Configuration du service de debridage
 * @param {number|null} episodeNumber - Numéro de l'épisode
 * @param {string|null} episodeName - Nom de l'épisode
 * @param {Object} options - Options supplémentaires, ex: { isCached: true, filename: "..." }
 * @returns {Promise<Object|null>} - Résultat du debridage (avec streamUrl) ou null si non prêt/erreur.
 */
async function debridTorrent(magnetLink, config, episodeNumber, episodeName, options = {}) {
    console.log(`[DEBRID GET] Vérification/Récupération lien pour: ${magnetLink.substring(0, 50)}..., Ep: ${episodeNumber}, Name: ${episodeName}, Filename: ${options.filename}`);
    try {
        if (!config || !config.service || config.service === 'none' || !config.apiKey) {
            console.warn('[DEBRID GET] Configuration de debridage invalide');
            return null; // Retourner null si config invalide
        }

        const service = createDebridService(config.service, config.apiKey);

        // Vérifier si l'API key est valide
        const isValid = await service.checkApiKey();
        if (!isValid) {
            console.warn('[DEBRID GET] Clé API invalide');
            return null; // Retourner null si API key invalide
        }

        // Extraire les informations supplémentaires de la requête (fileIndex, season, streamType)
        // episodeNumber et episodeName sont maintenant passés en paramètres
        const urlParams = new URLSearchParams(magnetLink.split('?')[1] || '');
        const streamType = urlParams.get('type') || 'series';
        const fileIndex = urlParams.get('fileIndex') ? parseInt(urlParams.get('fileIndex')) : null;
        const season = urlParams.get('season') || null; // Conserver pour l'instant

        console.log(`[DEBRID GET] Infos utilisées: type=${streamType}, fileIndex=${fileIndex}, season=${season}, episode=${episodeNumber}${episodeName ? ', nom=' + episodeName : ''}`);

        let streamResult = null;
        const normalizedServiceName = config.service.toLowerCase().replace(/-/g, '');
        
        if (normalizedServiceName === 'realdebrid' || normalizedServiceName === 'alldebrid') {
            // Utiliser la nouvelle méthode getStreamableLinkForMagnet pour RealDebrid et AllDebrid
            // Les options de polling peuvent être passées ici si nécessaire
            streamResult = await service.getStreamableLinkForMagnet(magnetLink, fileIndex, season, episodeNumber, streamType, episodeName, options);
            // streamResult est attendu comme { streamUrl, filename } ou null
        } else if (normalizedServiceName === 'torbox') {
            // Utiliser la nouvelle méthode getStreamableLinkForMagnet pour Torbox
            streamResult = await service.getStreamableLinkForMagnet(magnetLink, fileIndex, season, episodeNumber, streamType, episodeName, options);
        } else {
            console.warn(`[DEBRID GET] Service non géré par la logique de Phase 2: ${config.service}`);
            return null;
        }

        if (!streamResult || !streamResult.streamUrl) {
            console.log(`[DEBRID GET] Lien de streaming non obtenu pour ${config.service}.`);
            return null;
        }

        let secureUrl = streamResult.streamUrl;
        if (secureUrl.startsWith('http:')) {
            secureUrl = secureUrl.replace('http:', 'https:');
            console.log(`[DEBRID GET] URL convertie en HTTPS: ${secureUrl}`);
        }

        const webReady = isWebReady(secureUrl);
        console.log(`[DEBRID GET] Stream pour ${config.service} considéré comme ${webReady ? 'web-ready' : 'non web-ready'}`);

        return {
            streamUrl: secureUrl,
            filename: streamResult.filename,
            // Conserver allLinks si disponible pour la rétrocompatibilité ou usages futurs
            allLinks: streamResult.allLinks || [{ url: secureUrl, filename: streamResult.filename }],
            webReady: webReady
        };

    } catch (error) {
        console.error(`[DEBRID GET] Erreur lors de la récupération du lien débridé pour ${config.service}: ${error.message}`);
        if (error.stack) console.error(error.stack);
        return null; // Retourner null en cas d'erreur générale
    }
}

module.exports = {
    createDebridService,
    RealDebrid,
    AllDebrid,
    Torbox,
    debridTorrent,
    checkCache // Remplace initiateDebridDownload
};
