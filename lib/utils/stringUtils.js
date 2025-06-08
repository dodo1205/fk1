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

/**
 * Checks if a filename contains specific season and episode numbers.
 * @param {string} filename - The name of the file.
 * @param {number} seasonNumber - The season number.
 * @param {number} episodeNumber - The episode number.
 * @param {object} [logger=console] - Optional logger for debugging.
 * @returns {boolean} - True if the filename matches the season and episode, false otherwise.
 */
function seasonEpisodeInFilename(filename, seasonNumber, episodeNumber, logger = console) {
    if (!filename || typeof seasonNumber !== 'number' || typeof episodeNumber !== 'number') {
        // logger.debug(`[seasonEpisodeInFilename] Invalid input: Filename: ${filename}, Season: ${seasonNumber}, Episode: ${episodeNumber}`);
        return false;
    }

    const s = String(seasonNumber).padStart(1, '0'); // Allows S1, S01, etc.
    const e = String(episodeNumber).padStart(2, '0'); // Expects E01, E12, etc.

    // Common patterns:
    // S01E01, s01e01, Season 1 Episode 01, 1x01, 01x01, S01.E01, S01_E01
    // Also handles cases like "Episode 01" if season is 1 (common for single-season shows or OVAs)
    // Or just the episode number if it's a movie/special often labeled as S0 or S1
    const patterns = [
        // Strict SxxExx
        new RegExp(`[Ss]${s.padStart(2, '0')}[Ee]${e}`, 'i'),
        // Flexible SxEyy (e.g. S1E01, S1E10)
        new RegExp(`[Ss]${s}[Ee]${e}`, 'i'),
        // Strict Season X Episode Y
        new RegExp(`Season\\s*${s}\\s*Episode\\s*${e}`, 'i'),
        // Cross pattern like 1x01, 01x01
        new RegExp(`\\b${s}x${e}\\b`, 'i'),
        // Separator patterns like S01.E01, S01_E01, S01-E01
        new RegExp(`[Ss]${s.padStart(2, '0')}[._\\s-]*[Ee]${e}`, 'i'),
        new RegExp(`[Ss]${s}[._\\s-]*[Ee]${e}`, 'i'),
        // Absolute episode number for season 1 (e.g., "Episode 01" for S01E01)
        // or for movies/OVAs often in S0 or S1
        ...(seasonNumber <= 1
            ? [
                  new RegExp(`\\b(?:Episode|Ep|Part|Pt)\\s*${episodeNumber}\\b`, 'i'),
                  new RegExp(`\\b${episodeNumber}\\b(?![\\d.])`) // Episode number standalone, not followed by more digits or a dot (to avoid matching year 1999.2 for ep 2)
              ]
            : []),
        // Pattern like "01-01", "01.01" (often for anime)
        new RegExp(`\\b${s.padStart(2, '0')}[._-]${e}\\b`),
        // Pattern like "101" for S01E01 (if season < 10 and episode < 100)
        // This is more risky, so it's last and more constrained
        ...(seasonNumber < 10 && episodeNumber < 100
            ? [new RegExp(`(?<![\\d])${seasonNumber}${e}(?![\\d])`)] // e.g., matches "101" but not "2101" or "1010"
            : [])
    ];

    for (const pattern of patterns) {
        if (pattern.test(filename)) {
            // logger.debug(`[seasonEpisodeInFilename] Match found for S${seasonNumber}E${episodeNumber} in "${filename}" with pattern: ${pattern}`);
            return true;
        }
    }
    // logger.debug(`[seasonEpisodeInFilename] No match for S${seasonNumber}E${episodeNumber} in "${filename}"`);
    return false;
}


module.exports = {
    normalizeText,
    matchEpisodeNumber,
    seasonEpisodeInFilename,
    compareWordSimilarity,
    encodeBase64UrlSafe,
    decodeBase64UrlSafe
};
