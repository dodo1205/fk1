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

    // Filtrer les fichiers vidéo
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

    // Si pas de nom d'épisode, on peut quand même essayer de trouver par numéro d'épisode
    if (!episodeName) {
        console.log(`[EPISODE] Aucun nom d'episode fourni pour l'episode ${episode}, recherche par numéro uniquement`);
        // Recherche par numéro d'épisode uniquement
        for (const file of videoFiles) {
            if (matchEpisodeNumber(file.name, episode)) {
                console.log(`[EPISODE] Fichier trouvé par numéro d'épisode: ${file.name}`);
                return file;
            }
        }
        return null;
    }

    // Fonction pour normaliser le texte
    function normalizeText(text) {
        return text.toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "");
    }
    
    // Fonction pour vérifier si le numéro d'épisode correspond
    function matchEpisodeNumber(fileName, episodeNumber) {
        // Convertir en string pour être sûr
        const epNum = String(episodeNumber);
        const epNumPadded = epNum.padStart(2, '0');
        
        const episodePatterns = [
            // Patterns exacts
            new RegExp(`\\b${epNum}\\b`),
            new RegExp(`\\b0*${epNum}\\b`),
            // Patterns avec E ou Episode
            new RegExp(`\\bE0*${epNum}\\b`, 'i'),
            new RegExp(`\\bEP0*${epNum}\\b`, 'i'),
            new RegExp(`\\bEpisode\\s*0*${epNum}\\b`, 'i'),
            // Patterns avec # ou numéro
            new RegExp(`\\b#0*${epNum}\\b`),
            new RegExp(`\\bFilm\\s*0*${epNum}\\b`, 'i'),
            // Patterns avec tirets ou points
            new RegExp(`\\b0*${epNum}[\\s_.-]`, 'i'),
            new RegExp(`[\\s_.-]0*${epNum}\\b`, 'i'),
            // Patterns spécifiques pour les formats courants
            new RegExp(`S\\d+E0*${epNum}\\b`, 'i'),
            new RegExp(`\\[0*${epNum}\\]`, 'i')
        ];
        
        for (const pattern of episodePatterns) {
            if (pattern.test(fileName)) {
                return true;
            }
        }
        
        return false;
    }
    
    // Fonction pour comparer la similarité entre deux textes (exactement comme dans nyaa.js)
    function compareWordSimilarity(text1, text2) {
        const text1Words = text1.split(/\s+/);
        const text2Words = text2.split(/\s+/);
        
        // Filtrer les mots courts et les mots communs
        const commonWords = ['de', 'du', 'des', 'et', 'a', 'à', 'le', 'la', 'les', 'un', 'une'];
        const importantText2Words = text2Words.filter(word =>
            word.length > 2 && !commonWords.includes(word));
        
        // Compter combien de mots importants correspondent
        let matchedWords = 0;
        for (const word2 of importantText2Words) {
            for (const word1 of text1Words) {
                // Correspondance directe ou similarité élevée
                if (word1 === word2 ||
                    (word1.length > 3 && word2.length > 3 &&
                     (word1.includes(word2) || word2.includes(word1)))) {
                    matchedWords++;
                    break;
                }
            }
        }
        
        // Si plus de 70% des mots importants correspondent
        return importantText2Words.length > 0 &&
               matchedWords / importantText2Words.length >= 0.7;
    }
    
    // Normaliser le nom d'épisode recherché
    const normalizedEpisodeName = normalizeText(episodeName);
    
    // Première phase: recherche avec correspondance exacte (comme dans nyaa.js)
    for (const file of videoFiles) {
        // Vérifier d'abord si le numéro d'épisode correspond
        if (matchEpisodeNumber(file.name, episode)) {
            // Méthode exacte originale
            if (file.name.includes(episodeName)) {
                return file;
            }
            
            // Méthode exacte avec normalisation
            const normalizedFileName = normalizeText(file.name);
            
            if (normalizedFileName.includes(normalizedEpisodeName)) {
                console.log(`[MATCH] Correspondance exacte normalisée trouvée pour "${episodeName}"`);
                return file;
            }
        }
    }
    
    // Deuxième phase: correspondance floue (comme dans nyaa.js)
    console.log(`[INFO] Aucune correspondance exacte pour "${episodeName}", essai avec correspondance floue...`);
    
    for (const file of videoFiles) {
        if (matchEpisodeNumber(file.name, episode)) {
            const normalizedFileName = normalizeText(file.name);
            
            // 1. Vérifier les formes singulier/pluriel communes en français
            if ((normalizedEpisodeName.includes(" au ") &&
                 normalizedFileName.includes(normalizedEpisodeName.replace(" au ", " aux "))) ||
                (normalizedEpisodeName.includes(" aux ") &&
                 normalizedFileName.includes(normalizedEpisodeName.replace(" aux ", " au ")))) {
                console.log(`[MATCH] Correspondance singulier/pluriel trouvée pour "${episodeName}"`);
                return file;
            }
            
            // 2. Vérifier sans les articles (le, la, les, l')
            const noArticlesEpisodeName = normalizedEpisodeName
                .replace(/\ble\s|\bla\s|\bles\s|\bl[']/g, "");
            const noArticlesFileName = normalizedFileName
                .replace(/\ble\s|\bla\s|\bles\s|\bl[']/g, "");
                
            if (noArticlesFileName.includes(noArticlesEpisodeName)) {
                console.log(`[MATCH] Correspondance sans articles trouvée pour "${episodeName}"`);
                return file;
            }
            
            // 3. Calcul de similarité pour les cas plus complexes
            if (compareWordSimilarity(normalizedFileName, normalizedEpisodeName)) {
                console.log(`[MATCH] Correspondance par mots-clés trouvée pour "${episodeName}"`);
                return file;
            }
        }
    }
    
    // Si toujours aucun fichier trouvé, essayer une dernière approche avec le numéro d'épisode
    console.log(`[EPISODE] Aucune correspondance trouvée pour l'épisode ${episode} avec nom "${episodeName}"`);
    
    // Dernière tentative: prendre le plus grand fichier qui contient le numéro d'épisode
    const matchingFiles = videoFiles.filter(file => matchEpisodeNumber(file.name, episode));
    if (matchingFiles.length > 0) {
        // Trier par taille et prendre le plus grand
        const largestFile = matchingFiles.sort((a, b) => (b.size || 0) - (a.size || 0))[0];
        console.log(`[EPISODE] Sélection du plus grand fichier correspondant au numéro d'épisode: ${largestFile.name}`);
        return largestFile;
    }
    
    return null;
}

module.exports = {
    findBestEpisodeFile
};