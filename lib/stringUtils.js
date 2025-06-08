/**
 * Normalise un texte pour la comparaison
 * @param {string} text - Texte à normaliser
 * @returns {string} - Texte normalisé
 */
function normalizeText(text) {
    if (!text) return '';
    return text.toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Vérifie si le numéro d'épisode correspond dans un nom de fichier
 * @param {string} fileName - Nom du fichier
 * @param {number} episodeNumber - Numéro de l'épisode
 * @returns {boolean} - True si le numéro correspond
 */
function matchEpisodeNumber(fileName, episodeNumber) {
    const epNum = String(episodeNumber);
    const episodePatterns = [
        new RegExp(`\\b${epNum}\\b`),
        new RegExp(`\\b0*${epNum}\\b`),
        new RegExp(`\\bE0*${epNum}\\b`, 'i'),
        new RegExp(`\\bEP0*${epNum}\\b`, 'i'),
        new RegExp(`\\bEpisode\\s*0*${epNum}\\b`, 'i'),
        new RegExp(`\\b#0*${epNum}\\b`),
        new RegExp(`\\bFilm\\s*0*${epNum}\\b`, 'i'),
        new RegExp(`\\b0*${epNum}[\\s_.-]`, 'i'),
        new RegExp(`[\\s_.-]0*${epNum}\\b`, 'i'),
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

/**
 * Compare la similarité entre deux textes en se basant sur les mots importants
 * @param {string} text1 - Premier texte
 * @param {string} text2 - Deuxième texte
 * @returns {boolean} - True si les textes sont similaires
 */
function compareWordSimilarity(text1, text2) {
    const text1Words = text1.split(/\s+/);
    const text2Words = text2.split(/\s+/);
    
    const commonWords = ['de', 'du', 'des', 'et', 'a', 'à', 'le', 'la', 'les', 'un', 'une'];
    const importantText2Words = text2Words.filter(word =>
        word.length > 2 && !commonWords.includes(word));
    
    if (importantText2Words.length === 0) {
        return false;
    }

    let matchedWords = 0;
    for (const word2 of importantText2Words) {
        for (const word1 of text1Words) {
            if (word1 === word2 || (word1.length > 3 && word2.length > 3 && (word1.includes(word2) || word2.includes(word1)))) {
                matchedWords++;
                break;
            }
        }
    }
    
    return (matchedWords / importantText2Words.length) >= 0.7;
}

function encodeBase64UrlSafe(str) {
    return Buffer.from(str).toString('base64')
        .replace(/\+/g, '-') 
        .replace(/\//g, '_') 
        .replace(/=+$/, ''); 
}

function decodeBase64UrlSafe(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) {
        str += '=';
    }
    return Buffer.from(str, 'base64').toString('utf-8');
}

module.exports = {
    normalizeText,
    matchEpisodeNumber,
    compareWordSimilarity,
    encodeBase64UrlSafe,
    decodeBase64UrlSafe
};
