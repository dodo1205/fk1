/**
 * Utilitaires pour la sélection et la manipulation de fichiers
 * Ce module centralise toutes les fonctions liées à la manipulation des fichiers
 * pour éviter la duplication de code entre les différents services de debridage
 */

const { findBestEpisodeFile } = require('./episodeUtils');

// Extensions de fichiers vidéo courantes
const VIDEO_EXTENSIONS = ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm'];

// Extensions de fichiers considérés comme "web-ready" (lisibles directement dans un navigateur)
const WEB_READY_EXTENSIONS = ['.mp4', '.webm', '.m3u8'];

/**
 * Vérifie si un fichier est un fichier vidéo
 * @param {string} fileName - Nom du fichier
 * @returns {boolean} - true si c'est un fichier vidéo
 */
function isVideoFile(fileName) {
    if (!fileName) return false;
    const ext = getFileExtension(fileName);
    return VIDEO_EXTENSIONS.includes(ext);
}

/**
 * Extrait l'extension d'un fichier
 * @param {string} fileName - Nom du fichier
 * @returns {string} - Extension du fichier (sans le point)
 */
function getFileExtension(fileName) {
    if (!fileName) return '';
    return fileName.split('.').pop().toLowerCase();
}

/**
 * Vérifie si un fichier est "web-ready" (lisible directement dans un navigateur)
 * @param {string} fileName - Nom du fichier ou URL
 * @returns {boolean} - true si le fichier est web-ready
 */
function isWebReady(fileName) {
    if (!fileName) return false;
    return WEB_READY_EXTENSIONS.some(ext => fileName.toLowerCase().includes(ext));
}

/**
 * Filtre les fichiers vidéo d'une liste de fichiers
 * @param {Array} files - Liste de fichiers
 * @returns {Array} - Liste des fichiers vidéo
 */
function filterVideoFiles(files) {
    if (!files || !Array.isArray(files)) return [];
    return files.filter(file => {
        const fileName = file.name || file.filename || file.path || '';
        return isVideoFile(fileName);
    });
}

/**
 * Trie les fichiers par taille (du plus grand au plus petit)
 * @param {Array} files - Liste de fichiers
 * @returns {Array} - Liste des fichiers triés
 */
function sortFilesBySize(files) {
    if (!files || !Array.isArray(files)) return [];
    return [...files].sort((a, b) => {
        const sizeA = a.size || a.bytes || 0;
        const sizeB = b.size || b.bytes || 0;
        return sizeB - sizeA;
    });
}

/**
 * Récupère le plus grand fichier vidéo d'une liste de fichiers
 * @param {Array} files - Liste de fichiers
 * @returns {Object|null} - Le plus grand fichier vidéo ou null
 */
function getLargestVideoFile(files) {
    const videoFiles = filterVideoFiles(files);
    if (videoFiles.length === 0) return null;
    return sortFilesBySize(videoFiles)[0];
}

/**
 * Sélectionne le meilleur fichier pour un épisode ou un média
 * Fonction unifiée utilisée par tous les services de debridage
 *
 * @param {Array} files - Liste des fichiers à analyser
 * @param {number} episode - Numéro d'épisode
 * @param {string} episodeName - Nom de l'épisode (optionnel)
 * @param {Object} options - Options supplémentaires
 * @param {number} options.fileIndex - Index spécifique du fichier à sélectionner (prioritaire)
 * @param {string} options.service - Nom du service de debridage ('realdebrid', 'alldebrid', 'torbox')
 * @param {string} options.streamType - Type de stream ('series', 'movie', etc.)
 * @returns {Object|null} - Meilleur fichier correspondant ou null si aucun trouvé
 */
function selectBestFile(files, episode, episodeName = null, options = {}) {
    if (!files || files.length === 0) {
        console.log('[FILE] Aucun fichier trouvé');
        return null;
    }

    const { fileIndex, service = 'unknown' } = options;
    console.log(`[${service.toUpperCase()}] Sélection de fichier pour l'épisode ${episode}${episodeName ? ', nom: ' + episodeName : ''}`);

    // Si un index de fichier spécifique est fourni, l'utiliser
    if (fileIndex !== null && fileIndex !== undefined) {
        const fileByIndex = files[fileIndex];
        if (fileByIndex) {
            console.log(`[${service.toUpperCase()}] Utilisation de l'index de fichier spécifié: ${fileIndex}`);
            return fileByIndex;
        }
    }

    // Adapter les fichiers au format attendu par findBestEpisodeFile
    const adaptedFiles = files.map(file => {
        // Déterminer le nom du fichier selon la structure des différents services
        const fileName = file.name || file.filename || file.path || '';
        
        // Déterminer la taille du fichier selon la structure des différents services
        const fileSize = file.size || file.bytes || 0;
        
        // Déterminer l'ID du fichier selon la structure des différents services
        const fileId = file.id || file.fileId || file.file_id || '';
        
        return {
            name: fileName,
            size: fileSize,
            id: fileId,
            // Conserver les propriétés originales pour compatibilité avec les services spécifiques
            ...file
        };
    });

    // Filtrer pour ne garder que les fichiers vidéo avant de chercher l'épisode
    const videoFiles = filterVideoFiles(adaptedFiles);

    if (!videoFiles || videoFiles.length === 0) {
        console.log(`[${service.toUpperCase()}] Aucun fichier vidéo trouvé dans la liste pour l'épisode ${episode}`);
        return null;
    }
    console.log(`[${service.toUpperCase()}] ${videoFiles.length} fichier(s) vidéo trouvé(s) pour analyse.`);

    // Utiliser la fonction commune findBestEpisodeFile sur les fichiers vidéo filtrés
    if (episodeName) {
        console.log(`[${service.toUpperCase()}] Nom de l'épisode fourni: "${episodeName}"`);
        const bestFile = findBestEpisodeFile(videoFiles, episode, episodeName);
        if (bestFile) {
            console.log(`[${service.toUpperCase()}] Fichier vidéo sélectionné pour l'épisode ${episode} (avec nom): ${bestFile.name}`);
            return bestFile;
        }
    } else {
        // Si pas de nom d'épisode, essayer quand même avec findBestEpisodeFile
        const bestFile = findBestEpisodeFile(videoFiles, episode, null);
        if (bestFile) {
            console.log(`[${service.toUpperCase()}] Fichier vidéo sélectionné pour l'épisode ${episode} (par numéro): ${bestFile.name}`);
            return bestFile;
        }
    }

    // Si findBestEpisodeFile n'a rien trouvé parmi les fichiers vidéo,
    // essayer de sélectionner le plus grand fichier vidéo parmi ceux déjà filtrés.
    console.log(`[${service.toUpperCase()}] findBestEpisodeFile n'a pas trouvé de correspondance exacte pour l'épisode ${episode}. Tentative avec le plus grand fichier vidéo.`);
    const largestFile = getLargestVideoFile(videoFiles); // Utiliser videoFiles déjà filtrés
    if (largestFile) {
        console.log(`[${service.toUpperCase()}] Sélection du plus grand fichier vidéo: ${largestFile.name}`);
        return largestFile;
    }
    
    console.log(`[${service.toUpperCase()}] Aucun fichier correspondant trouvé pour l'épisode ${episode}`);
    return null;
}

module.exports = {
    selectBestFile,
    isVideoFile,
    getFileExtension,
    isWebReady,
    filterVideoFiles,
    sortFilesBySize,
    getLargestVideoFile,
    VIDEO_EXTENSIONS,
    WEB_READY_EXTENSIONS
};