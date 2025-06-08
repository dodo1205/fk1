const stringUtils = require('./stringUtils');

/**
 * Utilitaires pour la sélection des épisodes
 */

/**
 * Trouve le meilleur fichier correspondant à un épisode
 * @param {Array} files - Liste des fichiers
 * @param {number} episode - Numéro d'épisode
 * @param {string|null} episodeName - Nom de l'épisode (optionnel)
 * @param {string|null} torrentFilename - Nom du fichier torrent original (optionnel, pour contexte)
 * @returns {Object|null} - Meilleur fichier correspondant ou null
 */
function findBestEpisodeFile(files, episode, episodeName, torrentFilename = null) {
    if (!files || files.length === 0) {
        console.log('[EPISODE] Aucun fichier fourni');
        return null;
    }

    const videoFiles = files.filter(file => {
        if (!file.name) {
            console.log('[EPISODE] Fichier sans nom détecté:', file);
            return false;
        }
        const ext = file.name.split('.').pop().toLowerCase();
        return ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm'].includes(ext);
    });

    if (videoFiles.length === 0) {
        console.log('[EPISODE] Aucun fichier vidéo trouvé');
        return null;
    }

    // Si le nom du torrent est fourni et qu'il n'y a qu'un seul fichier vidéo, c'est forcément le bon.
    if (torrentFilename && videoFiles.length === 1) {
        if (stringUtils.matchEpisodeNumber(torrentFilename, episode)) {
            console.log(`[EPISODE] Un seul fichier vidéo trouvé dans un torrent correspondant, sélection directe: ${videoFiles[0].name}`);
            return videoFiles[0];
        }
    }

    if (!episodeName) {
        console.log(`[EPISODE] Aucun nom d'épisode fourni pour l'épisode ${episode}, recherche par numéro uniquement`);
        const matchingByNumber = videoFiles.filter(file => stringUtils.matchEpisodeNumber(file.name, episode));
        if (matchingByNumber.length === 1) {
            console.log(`[EPISODE] Un seul fichier trouvé par numéro d'épisode: ${matchingByNumber[0].name}`);
            return matchingByNumber[0];
        }
        if (matchingByNumber.length > 1) {
            console.log(`[EPISODE] Plusieurs fichiers correspondent au numéro ${episode}, sélection du plus grand.`);
            return matchingByNumber.sort((a, b) => (b.size || 0) - (a.size || 0))[0];
        }
        return null;
    }

    const normalizedEpisodeName = stringUtils.normalizeText(episodeName);
    
    for (const file of videoFiles) {
        if (stringUtils.matchEpisodeNumber(file.name, episode)) {
            if (file.name.includes(episodeName)) {
                return file;
            }
            
            const normalizedFileName = stringUtils.normalizeText(file.name);
            
            if (normalizedFileName.includes(normalizedEpisodeName)) {
                console.log(`[MATCH] Correspondance exacte normalisée trouvée pour "${episodeName}"`);
                return file;
            }
        }
    }
    
    console.log(`[INFO] Aucune correspondance exacte pour "${episodeName}", essai avec correspondance floue...`);
    
    for (const file of videoFiles) {
        if (stringUtils.matchEpisodeNumber(file.name, episode)) {
            const normalizedFileName = stringUtils.normalizeText(file.name);
            
            if ((normalizedEpisodeName.includes(" au ") &&
                 normalizedFileName.includes(normalizedEpisodeName.replace(" au ", " aux "))) ||
                (normalizedEpisodeName.includes(" aux ") &&
                 normalizedFileName.includes(normalizedEpisodeName.replace(" aux ", " au ")))) {
                console.log(`[MATCH] Correspondance singulier/pluriel trouvée pour "${episodeName}"`);
                return file;
            }
            
            const noArticlesEpisodeName = normalizedEpisodeName
                .replace(/\ble\s|\bla\s|\bles\s|\bl[']/g, "");
            const noArticlesFileName = normalizedFileName
                .replace(/\ble\s|\bla\s|\bles\s|\bl[']/g, "");
                
            if (noArticlesFileName.includes(noArticlesEpisodeName)) {
                console.log(`[MATCH] Correspondance sans articles trouvée pour "${episodeName}"`);
                return file;
            }
            
            if (stringUtils.compareWordSimilarity(normalizedFileName, normalizedEpisodeName)) {
                console.log(`[MATCH] Correspondance par mots-clés trouvée pour "${episodeName}"`);
                return file;
            }
        }
    }
    
    console.log(`[EPISODE] Aucune correspondance trouvée pour l'épisode ${episode} avec nom "${episodeName}"`);
    
    const matchingFiles = videoFiles.filter(file => stringUtils.matchEpisodeNumber(file.name, episode));
    if (matchingFiles.length > 0) {
        const largestFile = matchingFiles.sort((a, b) => (b.size || 0) - (a.size || 0))[0];
        console.log(`[EPISODE] Sélection du plus grand fichier correspondant au numéro d'épisode: ${largestFile.name}`);
        return largestFile;
    }
    
    return null;
}

module.exports = {
    findBestEpisodeFile
};
