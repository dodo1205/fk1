const stringUtils = require('./stringUtils');

/**
 * Utilitaires pour la sélection des épisodes
 */

/**
 * Trouve le meilleur fichier correspondant à un épisode
 * @param {Array} files - Liste des fichiers
 * @param {number} episode - Numéro d'épisode
 * @param {string} episodeName - Nom de l'épisode (obligatoire)
 * @returns {Object|null} - Meilleur fichier correspondant ou null
 */
function findBestEpisodeFile(files, episode, episodeName) {
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

    if (!episodeName) {
        console.log(`[EPISODE] Aucun nom d'episode fourni pour l'episode ${episode}, recherche par numéro uniquement`);
        for (const file of videoFiles) {
            if (stringUtils.matchEpisodeNumber(file.name, episode)) {
                console.log(`[EPISODE] Fichier trouvé par numéro d'épisode: ${file.name}`);
                return file;
            }
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
