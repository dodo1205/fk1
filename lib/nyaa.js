const nyaaApi = require('./api/nyaaApi');
const { searchFankai } = require('./fankai');
const stringUtils = require('./utils/stringUtils');

/**
 * Recherche des torrents sur Nyaa.si pour un anime spécifique
 * @param {string} animeName - Nom de l'anime à rechercher
 * @param {string} episodeName - Nom de l'épisode à rechercher
 * @param {number} episodeNumber - Numéro de l'épisode à rechercher
 * @returns {Promise<Array>} - Liste des torrents trouvés
 */
async function searchTorrents(animeName, episodeName, episodeNumber) {
    console.log(`[RECHERCHE] Analysant Nyaa.si pour "${animeName}"`);

    if (!episodeName) {
        console.log(`[ATTENTION] Aucun nom d'episode fourni pour l'episode ${episodeNumber}`);
        return [];
    }

    const torrents = await nyaaApi.search(animeName);

    if (torrents.length > 0) {
        const plural = torrents.length > 1 ? 's' : '';
        console.log(`[RECHERCHE] ${torrents.length} torrent${plural} trouve${plural} pour "${animeName}"`);
        
        const relevantTorrents = await findRelevantTorrents(torrents, episodeNumber, episodeName);
        
        if (relevantTorrents.length > 0) {
            const plural = relevantTorrents.length > 1 ? 's' : '';
            console.log(`[FILTRAGE] ${relevantTorrents.length} torrent${plural} trouve${plural} pour l'episode ${episodeNumber} "${episodeName}"`);
            return relevantTorrents;
        }
    }
    
    console.log(`[RESULTAT] Aucun torrent trouve pour "${animeName}" episode ${episodeNumber} "${episodeName}"`);
    return [];
}

/**
 * Trouve les torrents pertinents pour un épisode spécifique
 * @param {Array} torrents - Liste des torrents à analyser
 * @param {number} episodeNumber - Numéro de l'épisode recherché
 * @param {string} episodeName - Nom de l'épisode recherché
 * @returns {Promise<Array>} - Liste des torrents pertinents
 */
async function findRelevantTorrents(torrents, episodeNumber, episodeName) {
    if (!episodeName) {
        console.log(`[ATTENTION] Nom d'episode manquant pour l'episode ${episodeNumber}`);
        return [];
    }
    
    const relevantTorrents = [];
    
    for (const torrent of torrents) {
        const fileList = await nyaaApi.getFileListFromPage(torrent.torrentUrl);
        
        if (hasEpisodeInFileList(fileList, episodeNumber, episodeName)) {
            torrent.fileList = fileList;
            torrent.episodeInfo = findEpisodeInfo(fileList, episodeNumber, episodeName);
            torrent.isPack = fileList.length > 1;
            relevantTorrents.push(torrent);
        }
    }
    
    relevantTorrents.sort((a, b) => (parseInt(b.seeders) || 0) - (parseInt(a.seeders) || 0));
    
    return relevantTorrents;
}

/**
 * Vérifie si un épisode spécifique est présent dans la liste des fichiers
 * @param {Array} fileList - Liste des fichiers
 * @param {number} episodeNumber - Numéro de l'épisode
 * @param {string} episodeName - Nom de l'épisode
 * @returns {boolean} - True si l'épisode est présent
 */
function hasEpisodeInFileList(fileList, episodeNumber, episodeName) {
    if (!episodeName) {
        return false;
    }

    const normalizedEpisodeName = stringUtils.normalizeText(episodeName);

    for (const file of fileList) {
        if (stringUtils.matchEpisodeNumber(file.name, episodeNumber)) {
            if (file.name.includes(episodeName)) {
                return true;
            }
            const normalizedFileName = stringUtils.normalizeText(file.name);
            if (normalizedFileName.includes(normalizedEpisodeName)) {
                console.log(`[MATCH] Correspondance exacte normalisée trouvée pour "${episodeName}"`);
                return true;
            }
        }
    }

    console.log(`[INFO] Aucune correspondance exacte pour "${episodeName}", essai avec correspondance floue...`);
    for (const file of fileList) {
        if (stringUtils.matchEpisodeNumber(file.name, episodeNumber)) {
            const normalizedFileName = stringUtils.normalizeText(file.name);
            if ((normalizedEpisodeName.includes(" au ") && normalizedFileName.includes(normalizedEpisodeName.replace(" au ", " aux "))) ||
                (normalizedEpisodeName.includes(" aux ") && normalizedFileName.includes(normalizedEpisodeName.replace(" aux ", " au ")))) {
                console.log(`[MATCH] Correspondance singulier/pluriel trouvée pour "${episodeName}"`);
                return true;
            }
            const noArticlesEpisodeName = normalizedEpisodeName.replace(/\ble\s|\bla\s|\bles\s|\bl[']/g, "");
            const noArticlesFileName = normalizedFileName.replace(/\ble\s|\bla\s|\bles\s|\bl[']/g, "");
            if (noArticlesFileName.includes(noArticlesEpisodeName)) {
                console.log(`[MATCH] Correspondance sans articles trouvée pour "${episodeName}"`);
                return true;
            }
            if (stringUtils.compareWordSimilarity(normalizedFileName, normalizedEpisodeName)) {
                console.log(`[MATCH] Correspondance par mots-clés trouvée pour "${episodeName}"`);
                return true;
            }
        }
    }

    return false;
}

/**
 * Trouve les informations sur un épisode spécifique dans la liste des fichiers
 * @param {Array} fileList - Liste des fichiers
 * @param {number} episodeNumber - Numéro de l'épisode
 * @param {string} episodeName - Nom de l'épisode
 * @returns {Object|null} - Informations sur l'épisode ou null si non trouvé
 */
function findEpisodeInfo(fileList, episodeNumber, episodeName) {
    if (!episodeName) {
        return null;
    }
    
    for (const file of fileList) {
        if (stringUtils.matchEpisodeNumber(file.name, episodeNumber)) {
            if (file.name.includes(episodeName)) {
                const nameMatch = file.name.match(/\s-\s(.*?)\s-\s/);
                const extractedEpisodeName = nameMatch ? nameMatch[1] : null;
                
                return {
                    fileName: file.name,
                    episodeName: extractedEpisodeName || episodeName,
                    size: file.size,
                    parent: file.parent
                };
            }
        }
    }
    
    return null;
}

/**
 * Récupère les détails d'un torrent pour un anime et un épisode spécifiques
 * @param {string} animeId - ID de l'anime
 * @param {number} episodeNumber - Numéro de l'épisode
 * @returns {Promise<Object>} - Détails du torrent
 */
async function getTorrentDetails(animeId, episodeNumber) {
    try {
        let animeName = `Anime ${animeId}`;
        let episodeName = null;
        
        try {
            const animeDetails = await searchFankai(null, animeId);
            if (animeDetails && animeDetails.title) {
                animeName = animeDetails.title;
                console.log(`[INFO] Nom de l'anime: "${animeName}"`);
                
                if (animeDetails.episodes && animeDetails.episodes.length > 0) {
                    const episode = animeDetails.episodes.find(ep => ep.number.toString() === episodeNumber.toString());
                    if (episode && episode.name) {
                        episodeName = episode.name;
                        console.log(`[INFO] Nom de l'episode: "${episodeName}"`);
                    } else {
                        console.warn(`[ATTENTION] Nom d'épisode ${episodeNumber} non trouvé dans les données Fankai`);
                        return { torrents: [] };
                    }
                } else {
                    console.warn(`[ATTENTION] Aucun épisode trouvé pour l'anime ${animeName}`);
                    return { torrents: [] };
                }
            }
        } catch (error) {
            console.warn(`[ERREUR] Impossible de recuperer le nom de l'anime: ${error.message}`);
            return { torrents: [] };
        }
        
        if (!episodeName) {
            console.warn(`[ATTENTION] Impossible de trouver le nom de l'épisode ${episodeNumber}`);
            return { torrents: [], episodeName: null };
        }
        
        const torrents = await searchTorrents(animeName, episodeName, episodeNumber);
        
        if (torrents.length === 0) {
            return { torrents: [], episodeName: episodeName };
        }
        
        return {
            torrents: torrents,
            episodeName: episodeName
        };
    } catch (error) {
        console.error(`[ERREUR] Recuperation des details du torrent: ${error.message}`);
        return { torrents: [] };
    }
}

module.exports = {
    searchTorrents,
    getTorrentDetails,
    hasEpisodeInFileList,
    findEpisodeInfo
};
