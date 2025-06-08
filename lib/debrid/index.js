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
 * @returns {Promise<void>}
 */
async function initiateDebridDownload(magnetLink, config, episodeNumber, episodeName) {
    console.log(`[DEBRID INIT] Initiation du téléchargement pour: ${magnetLink.substring(0, 50)}..., Ep: ${episodeNumber}, Name: ${episodeName}`);
    try {
        if (!config || !config.service || config.service === 'none' || !config.apiKey) {
            throw new Error('Configuration de debridage invalide pour initiateDebridDownload');
        }

        const service = createDebridService(config.service, config.apiKey);

        // Vérifier si l'API key est valide (optionnel ici, mais bonne pratique)
        const isValid = await service.checkApiKey();
        if (!isValid) {
            throw new Error('Clé API invalide pour initiateDebridDownload');
        }

        // Utiliser les paramètres episodeNumber et episodeName directement
        // Le streamType peut encore être extrait du magnet si nécessaire, ou passé en paramètre aussi à l'avenir
        const urlParams = new URLSearchParams(magnetLink.split('?')[1] || '');
        const streamType = urlParams.get('type') || 'series'; // Conserver pour l'instant

        // Logique modifiée pour la Phase 1
        const normalizedServiceName = config.service.toLowerCase().replace(/-/g, '');
        if (normalizedServiceName === 'realdebrid' || normalizedServiceName === 'alldebrid') {
            // Pour RealDebrid et AllDebrid, avec la "fausse" vérification de cache,
            // nous ne contactons pas le service ici. L'addon considérera le lien comme "en cache".
            console.log(`[DEBRID INIT] Phase 1 pour ${config.service} (fausse vérification cache) pour Ep: ${episodeNumber}. Aucun appel API effectué.`);
        } else if (normalizedServiceName === 'torbox') {
            // Pour Torbox, nous effectuerons une vraie vérification de cache.
            const cacheInfo = await service.checkCache(magnetLink);
            if (cacheInfo) {
                console.log(`[DEBRID INIT] Phase 1 pour Torbox. Cache Info pour Ep: ${episodeNumber}: Cached=${cacheInfo.isCached}, Files=${cacheInfo.files?.length || 0}`);
                // L'addon utilisera cette information (isCached) pour afficher la bonne icône.
                // Si isCached est true et cacheInfo.files est peuplé, l'addon pourrait même
                // directement préparer un lien streamable sans passer par la Phase 2 complète (addMagnet, polling).
                // Cela serait une optimisation future pour Torbox si checkCache retourne suffisamment d'infos.
                // Pour l'instant, on se contente de vérifier et logger.
            } else {
                console.warn(`[DEBRID INIT] Phase 1 pour Torbox: checkCache a échoué pour Ep: ${episodeNumber}.`);
            }
        } else {
            // Comportement par défaut pour d'autres services non explicitement gérés par la nouvelle logique
            console.warn(`[DEBRID INIT] Service ${config.service} non géré par la logique de Phase 1 spécifique. Tentative d'appel générique si existant.`);
            if (typeof service.initiateDownload === 'function') { // Nom de méthode plus générique
                 await service.initiateDownload(magnetLink, streamType, episodeNumber, episodeName);
                 console.log(`[DEBRID INIT] Appel initiateDownload pour ${config.service} (Ep: ${episodeNumber}) effectué.`);
            } else {
                console.log(`[DEBRID INIT] Pas d'action spécifique en Phase 1 pour ${config.service} (Ep: ${episodeNumber}).`);
            }
        }

    } catch (error) {
        // Log l'erreur mais ne pas la propager pour ne pas bloquer la redirection
        console.error(`[DEBRID INIT] Erreur lors de l'initiation (Phase 1): ${error.message}`);
    }
}


/**
 * Vérifie l'état d'un torrent sur le service de debridage et récupère le lien de streaming si prêt.
 * Utilisé par le stream handler pour les liens "Lire via [Service]".
 * @param {string} magnetLink - Lien magnet à vérifier/débrider
 * @param {Object} config - Configuration du service de debridage
 * @param {number|null} episodeNumber - Numéro de l'épisode
 * @param {string|null} episodeName - Nom de l'épisode
 * @returns {Promise<Object|null>} - Résultat du debridage (avec streamUrl) ou null si non prêt/erreur.
 */
async function debridTorrent(magnetLink, config, episodeNumber, episodeName) {
    console.log(`[DEBRID GET] Vérification/Récupération lien pour: ${magnetLink.substring(0, 50)}..., Ep: ${episodeNumber}, Name: ${episodeName}`);
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
            streamResult = await service.getStreamableLinkForMagnet(magnetLink, fileIndex, season, episodeNumber, streamType, episodeName);
            // streamResult est attendu comme { streamUrl, filename } ou null
        } else if (normalizedServiceName === 'torbox') {
            // Utiliser la nouvelle méthode getStreamableLinkForMagnet pour Torbox
            streamResult = await service.getStreamableLinkForMagnet(magnetLink, fileIndex, season, episodeNumber, streamType, episodeName);
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
    initiateDebridDownload // Exporter la nouvelle fonction
};
