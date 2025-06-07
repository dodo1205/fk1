
const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Module pour la recherche et l'analyse des torrents sur Nyaa.si
 */

/**
 * Recherche des torrents sur Nyaa.si pour un anime spécifique
 * @param {string} animeName - Nom de l'anime à rechercher
 * @param {string} episodeName - Nom de l'épisode à rechercher
 * @param {number} episodeNumber - Numéro de l'épisode à rechercher
 * @returns {Promise<Array>} - Liste des torrents trouvés
 */
async function searchTorrents(animeName, episodeName, episodeNumber) {
    console.log(`[RECHERCHE] Analysant Nyaa.si pour "${animeName}"`);
    
    // Vérifier que le nom de l'épisode est disponible
    if (!episodeName) {
        console.log(`[ATTENTION] Aucun nom d'episode fourni pour l'episode ${episodeNumber}`);
        return [];
    }
    
    // Recherche directe avec le nom de l'anime uniquement
    const torrents = await searchNyaaByUser(animeName);
    
    if (torrents.length > 0) {
        const plural = torrents.length > 1 ? 's' : '';
        console.log(`[RECHERCHE] ${torrents.length} torrent${plural} trouve${plural} pour "${animeName}"`);
        
        // Filtrer les torrents pour trouver ceux qui contiennent potentiellement l'épisode recherché
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
 * Recherche sur Nyaa.si avec l'utilisateur Fan-Kai
 * @param {string} query - Requête de recherche
 * @returns {Promise<Array>} - Liste des torrents trouvés
 */
async function searchNyaaByUser(query) {
    try {
        // Utiliser la nouvelle URL de recherche par utilisateur
        const url = `https://nyaa.si/user/Fan-Kai?f=0&c=0_0&q=${encodeURIComponent(query)}`;
        console.log(`Recherche sur Nyaa.si: ${url}`);
        
        const response = await axios.get(url);
        const $ = cheerio.load(response.data);
        
        const torrents = [];
        
        // Parcourir les résultats de la recherche
        $('table.torrent-list tbody tr').each((index, element) => {
            const title = $(element).find('td:nth-child(2) a:not(.comments)').text().trim();
            const torrentViewLink = $(element).find('td:nth-child(2) a:not(.comments)').attr('href');
            const downloadLink = $(element).find('td:nth-child(3) a:first-child').attr('href');
            const magnetLink = $(element).find('td:nth-child(3) a:last-child').attr('href');
            const size = $(element).find('td:nth-child(4)').text().trim();
            const date = $(element).find('td:nth-child(5)').text().trim();
            const seeders = $(element).find('td:nth-child(6)').text().trim();
            const leechers = $(element).find('td:nth-child(7)').text().trim();
            const downloads = $(element).find('td:nth-child(8)').text().trim();
            
            // Extraire l'ID du torrent depuis le lien de la page du torrent (pas du lien de téléchargement)
            const torrentId = torrentViewLink ? torrentViewLink.split('/').pop() : null;
            
            // Construire l'URL complète de la page du torrent
            const torrentUrl = torrentViewLink ? `https://nyaa.si${torrentViewLink}` : null;
            
            // Construire l'URL complète du fichier torrent
            const fullDownloadLink = downloadLink ? `https://nyaa.si${downloadLink}` : null;
            
            torrents.push({
                title,
                torrentId,
                torrentUrl,
                downloadLink: fullDownloadLink,
                magnetLink,
                size,
                date,
                seeders,
                leechers,
                downloads
            });
        });
        
        return torrents;
    } catch (error) {
        console.error(`Erreur lors de la recherche sur Nyaa.si: ${error.message}`);
        return [];
    }
}

/**
 * Trouve les torrents pertinents pour un épisode spécifique
 * @param {Array} torrents - Liste des torrents à analyser
 * @param {number} episodeNumber - Numéro de l'épisode recherché
 * @param {string} episodeName - Nom de l'épisode recherché
 * @returns {Promise<Array>} - Liste des torrents pertinents
 */
async function findRelevantTorrents(torrents, episodeNumber, episodeName) {
    // Vérifier que le nom d'épisode est fourni
    if (!episodeName) {
        console.log(`[ATTENTION] Nom d'episode manquant pour l'episode ${episodeNumber}`);
        return [];
    }
    
    const relevantTorrents = [];
    
    for (const torrent of torrents) {
        // Pour tous les torrents, récupérer la liste des fichiers
        const fileList = await getFileList(torrent.torrentUrl);
        
        // Vérifier si l'épisode recherché est dans la liste des fichiers (numéro ET nom)
        if (hasEpisodeInFileList(fileList, episodeNumber, episodeName)) {
            // Ajouter les informations sur l'épisode trouvé
            torrent.fileList = fileList;
            torrent.episodeInfo = findEpisodeInfo(fileList, episodeNumber, episodeName);
            
            // Déterminer si c'est un pack ou un épisode individuel (pour information)
            torrent.isPack = fileList.length > 1;
            
            relevantTorrents.push(torrent);
        }
    }
    
    // Trier les torrents par nombre de seeders
    relevantTorrents.sort((a, b) => {
        const seedersA = parseInt(a.seeders) || 0;
        const seedersB = parseInt(b.seeders) || 0;
        return seedersB - seedersA;
    });
    
    return relevantTorrents;
}

/**
 * Récupère la liste des fichiers d'un torrent
 * @param {string} torrentUrl - URL de la page du torrent
 * @returns {Promise<Array>} - Liste des fichiers
 */
async function getFileList(torrentUrl) {
    try {
        const response = await axios.get(torrentUrl);
        const $ = cheerio.load(response.data);
        
        const fileList = [];
        
        // Parcourir la liste des fichiers
        $('.torrent-file-list li').each((index, element) => {
            const isFolder = $(element).find('a.folder').length > 0;
            const name = $(element).find('a.folder, i.fa-file').parent().text().trim();
            const size = $(element).find('.file-size').text().trim();
            
            fileList.push({
                name,
                isFolder,
                size: size.replace(/[()]/g, '').trim()
            });
            
            // Si c'est un dossier, récupérer les fichiers à l'intérieur
            if (isFolder) {
                $(element).find('ul li').each((subIndex, subElement) => {
                    const subName = $(subElement).text().trim();
                    const subSize = $(subElement).find('.file-size').text().trim();
                    
                    fileList.push({
                        name: subName,
                        isFolder: false,
                        size: subSize.replace(/[()]/g, '').trim(),
                        parent: name
                    });
                });
            }
        });
        
        return fileList;
    } catch (error) {
        console.error(`Erreur lors de la récupération de la liste des fichiers: ${error.message}`);
        return [];
    }
}

/**
 * Normalise un texte pour la comparaison
 * @param {string} text - Texte à normaliser
 * @returns {string} - Texte normalisé
 */
function normalizeText(text) {
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
    const episodePatterns = [
        new RegExp(`\\b${episodeNumber}\\b`),
        new RegExp(`\\b0*${episodeNumber}\\b`),
        new RegExp(`\\bFilm\\s*${episodeNumber}\\b`, 'i'),
        new RegExp(`\\bEpisode\\s*${episodeNumber}\\b`, 'i')
    ];
    
    for (const pattern of episodePatterns) {
        if (pattern.test(fileName)) {
            return true;
        }
    }
    
    return false;
}

/**
 * Vérifie si un épisode spécifique est présent dans la liste des fichiers
 * @param {Array} fileList - Liste des fichiers
 * @param {number} episodeNumber - Numéro de l'épisode
 * @param {string} episodeName - Nom de l'épisode
 * @returns {boolean} - True si l'épisode est présent
 */
function hasEpisodeInFileList(fileList, episodeNumber, episodeName) {
    // Si pas de nom d'épisode, retourner false immédiatement
    if (!episodeName) {
        return false;
    }
    
    // Normaliser le nom d'épisode recherché
    const normalizedEpisodeName = normalizeText(episodeName);
    
    // Première phase: recherche avec correspondance exacte
    for (const file of fileList) {
        // Vérifier d'abord si le numéro d'épisode correspond
        if (matchEpisodeNumber(file.name, episodeNumber)) {
            // Méthode exacte originale
            if (file.name.includes(episodeName)) {
                return true;
            }
            
            // Méthode exacte avec normalisation
            const normalizedFileName = normalizeText(file.name);
            
            if (normalizedFileName.includes(normalizedEpisodeName)) {
                console.log(`[MATCH] Correspondance exacte normalisée trouvée pour "${episodeName}"`);
                return true;
            }
        }
    }
    
    // Deuxième phase: correspondance floue
    console.log(`[INFO] Aucune correspondance exacte pour "${episodeName}", essai avec correspondance floue...`);
    
    for (const file of fileList) {
        if (matchEpisodeNumber(file.name, episodeNumber)) {
            const normalizedFileName = normalizeText(file.name);
            
            // 1. Vérifier les formes singulier/pluriel communes en français
            if ((normalizedEpisodeName.includes(" au ") && 
                 normalizedFileName.includes(normalizedEpisodeName.replace(" au ", " aux "))) ||
                (normalizedEpisodeName.includes(" aux ") && 
                 normalizedFileName.includes(normalizedEpisodeName.replace(" aux ", " au ")))) {
                console.log(`[MATCH] Correspondance singulier/pluriel trouvée pour "${episodeName}"`);
                return true;
            }
            
            // 2. Vérifier sans les articles (le, la, les, l')
            const noArticlesEpisodeName = normalizedEpisodeName
                .replace(/\ble\s|\bla\s|\bles\s|\bl[']/g, "");
            const noArticlesFileName = normalizedFileName
                .replace(/\ble\s|\bla\s|\bles\s|\bl[']/g, "");
                
            if (noArticlesFileName.includes(noArticlesEpisodeName)) {
                console.log(`[MATCH] Correspondance sans articles trouvée pour "${episodeName}"`);
                return true;
            }
            
            // 3. Calcul de similarité pour les cas plus complexes
            if (compareWordSimilarity(normalizedFileName, normalizedEpisodeName)) {
                console.log(`[MATCH] Correspondance par mots-clés trouvée pour "${episodeName}"`);
                return true;
            }
        }
    }
    
    // Aucune correspondance trouvée, même avec la méthode floue
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

/**
 * Trouve les informations sur un épisode spécifique dans la liste des fichiers
 * @param {Array} fileList - Liste des fichiers
 * @param {number} episodeNumber - Numéro de l'épisode
 * @param {string} episodeName - Nom de l'épisode
 * @returns {Object|null} - Informations sur l'épisode ou null si non trouvé
 */
function findEpisodeInfo(fileList, episodeNumber, episodeName) {
    // Si pas de nom d'épisode, retourner null immédiatement
    if (!episodeName) {
        return null;
    }
    
    for (const file of fileList) {
        // Vérifier d'abord si le numéro d'épisode correspond
        if (matchEpisodeNumber(file.name, episodeNumber)) {
            // Vérifier si le nom correspond
            if (file.name.includes(episodeName)) {
                // Extraire le nom de l'épisode si disponible (pour info seulement)
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
 * Vérifie si un titre correspond à un épisode spécifique
 * @param {string} title - Titre à vérifier
 * @param {number} episodeNumber - Numéro de l'épisode
 * @param {string} episodeName - Nom de l'épisode
 * @returns {boolean} - True si le titre correspond à l'épisode
 */
function isEpisodeMatch(title, episodeNumber, episodeName) {
    // Si pas de nom d'épisode, retourner false immédiatement
    if (!episodeName) {
        return false;
    }
    
    // Vérifier d'abord si le numéro d'épisode correspond
    if (!matchEpisodeNumber(title, episodeNumber)) {
        return false;
    }
    
    // Vérifier ensuite si le nom correspond
    const normalizedEpisodeName = normalizeText(episodeName);
    const normalizedTitle = normalizeText(title);
    
    return normalizedTitle.includes(normalizedEpisodeName);
}

const { searchFankai } = require('./fankai');

/**
 * Récupère les détails d'un torrent pour un anime et un épisode spécifiques
 * @param {string} animeId - ID de l'anime
 * @param {number} episodeNumber - Numéro de l'épisode
 * @returns {Promise<Object>} - Détails du torrent
 */
async function getTorrentDetails(animeId, episodeNumber) {
    try {
        // Récupérer les détails de l'anime pour obtenir son nom
        let animeName = `Anime ${animeId}`;
        let episodeName = null;
        
        try {
            const animeDetails = await searchFankai(null, animeId);
            if (animeDetails && animeDetails.title) {
                animeName = animeDetails.title;
                console.log(`[INFO] Nom de l'anime: "${animeName}"`);
                
                // Chercher l'épisode spécifique pour obtenir son nom
                if (animeDetails.episodes && animeDetails.episodes.length > 0) {
                    const episode = animeDetails.episodes.find(ep => ep.number.toString() === episodeNumber.toString());
                    if (episode && episode.name) {
                        episodeName = episode.name;
                        console.log(`[INFO] Nom de l'episode: "${episodeName}"`);
                    } else {
                        console.warn(`[ATTENTION] Nom d'épisode ${episodeNumber} non trouvé dans les données Fankai`);
                        return { torrents: [] }; // Arrêter si pas de nom d'épisode
                    }
                } else {
                    console.warn(`[ATTENTION] Aucun épisode trouvé pour l'anime ${animeName}`);
                    return { torrents: [] }; // Arrêter si pas d'épisodes
                }
            }
        } catch (error) {
            console.warn(`[ERREUR] Impossible de recuperer le nom de l'anime: ${error.message}`);
            return { torrents: [] }; // Arrêter en cas d'erreur
        }
        
        // Si aucun nom d'épisode n'a été trouvé, impossible de continuer
        if (!episodeName) {
            console.warn(`[ATTENTION] Impossible de trouver le nom de l'épisode ${episodeNumber}`);
            return { torrents: [], episodeName: null };
        }
        
        // Rechercher les torrents pour cet anime et cet épisode
        const torrents = await searchTorrents(animeName, episodeName, episodeNumber);
        
        if (torrents.length === 0) {
            // Ne rien afficher ici, déjà géré par searchTorrents
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
    searchNyaaByUser,
    getFileList,
    getTorrentDetails,
    isEpisodeMatch,
    hasEpisodeInFileList,
    findEpisodeInfo
};
