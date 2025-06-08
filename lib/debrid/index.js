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

        // Appeler une méthode spécifique pour AJOUTER SEULEMENT le torrent
        // NOTE: Cette méthode `addMagnetOnly` doit être implémentée dans chaque service.
        // Elle ne doit PAS attendre la complétion du téléchargement.
        await service.addMagnetOnly(magnetLink, streamType, episodeNumber, episodeName);

        console.log(`[DEBRID INIT] Ajout du torrent à ${config.service} initié avec succès pour Ep: ${episodeNumber}.`);

    } catch (error) {
        // Log l'erreur mais ne pas la propager pour ne pas bloquer la redirection
        console.error(`[DEBRID INIT] Erreur lors de l'initiation du téléchargement: ${error.message}`);
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

        // Appeler une méthode spécifique pour VÉRIFIER L'ÉTAT et OBTENIR LES LIENS
        // NOTE: Cette méthode `getTorrentStatusAndLinks` doit être implémentée.
        // Elle doit retourner l'état ('downloading', 'completed', 'error', etc.) et les liens si 'completed'.
        const result = await service.getTorrentStatusAndLinks(magnetLink, fileIndex, season, episodeNumber, streamType, episodeName);

        if (config.downloadOption === 'cached') {
            return result;
        }

        if (!result || result.status !== 'completed' || !result.links || result.links.length === 0) {
            console.log(`[DEBRID GET] Torrent non prêt ou liens non trouvés (Status: ${result?.status})`);
            return null; // Retourner null si non complété ou pas de liens
        }

        // Prendre le premier lien (généralement le fichier principal)
        const initialUrl = result.links[0].url;
        console.log(`[DEBRID GET] URL initiale obtenue: ${initialUrl}`);

        if (!initialUrl || !initialUrl.startsWith('http')) {
            console.error(`[DEBRID GET] URL de stream invalide: ${initialUrl}`);
            return null;
        }

        // Traitement spécifique selon le service pour dérestreindre
        let finalUrl = initialUrl;
        if (config.service === 'alldebrid') {
            try {
                finalUrl = await service.unrestrictLink(initialUrl);
                console.log(`[DEBRID GET] AllDebrid URL dérestreinte: ${finalUrl}`);
            } catch (error) {
                console.error(`[DEBRID GET] Erreur dérestriction AllDebrid: ${error.message}`);
                return null; // Échec de la dérestriction
            }
        } else if (config.service === 'realdebrid') {
            try {
                const unrestricted = await service.unrestrictLink(initialUrl);
                if (unrestricted && unrestricted.download) {
                    finalUrl = unrestricted.download;
                    console.log(`[DEBRID GET] RealDebrid URL dérestreinte: ${finalUrl}`);
                } else {
                    console.error(`[DEBRID GET] Réponse inattendue de RealDebrid unrestrict:`, unrestricted);
                    return null; // Échec de la dérestriction
                }
            } catch (error) {
                console.error(`[DEBRID GET] Erreur dérestriction RealDebrid: ${error.message}`);
                return null; // Échec de la dérestriction
            }
        }
        // Torbox fournit déjà des liens directs

        // Forcer HTTPS
        let secureUrl = finalUrl;
        if (finalUrl.startsWith('http:')) {
            secureUrl = finalUrl.replace('http:', 'https:');
            console.log(`[DEBRID GET] URL convertie en HTTPS: ${secureUrl}`);
        }

        const webReady = isWebReady(secureUrl);
        console.log(`[DEBRID GET] Stream considéré comme ${webReady ? 'web-ready' : 'non web-ready'}`);

        return {
            streamUrl: secureUrl,
            filename: result.links[0].filename,
            allLinks: result.links,
            webReady: webReady
        };

    } catch (error) {
        console.error(`[DEBRID GET] Erreur lors de la récupération du lien débridé: ${error.message}`);
        return null; // Retourner null en cas d'erreur générale
    }
}

async function checkTorrentsCached(hashes, config) {
    if (!config || !config.service || config.service === 'none' || !config.apiKey) {
        return {};
    }

    try {
        const service = createDebridService(config.service, config.apiKey);
        return await service.checkCached(hashes);
    } catch (error) {
        console.error(`[DEBRID CACHE CHECK] Error: ${error.message}`);
        return {};
    }
}

module.exports = {
    createDebridService,
    RealDebrid,
    AllDebrid,
    Torbox,
    debridTorrent,
    initiateDebridDownload,
    checkTorrentsCached
};
