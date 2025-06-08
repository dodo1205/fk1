const fankaiApi = require('./api/fankaiApi');

function decodeHtmlEntities(html) {
    if (!html) return '';
    return fankaiApi.decodeHtmlEntities(html);
}

async function searchFankai(query = null, id = null) {
    try {
        const rawData = await fankaiApi.search(query, id);

        if (id) {
            // Processing single anime details
            const animeData = rawData;
            if (!animeData || !animeData.name) {
                 throw new Error(`Anime with ID ${id} not found or data is invalid.`);
            }

            const coverImg = cleanImageUrl(animeData.cover);
            const backgroundImg = cleanImageUrl(animeData.background);

            const episodes = (animeData.episodes || []).map(episode => ({
                id: episode.id,
                number: episode.number.toString(),
                name: decodeHtmlEntities(episode.name || ''),
                duration: episode.duration || '',
                image: cleanImageUrl(episode.cover),
                description: decodeHtmlEntities(episode.description || ''),
                episodeRange: episode.episodes || '',
                season_id: episode.season_id || (animeData.seasons && animeData.seasons[0] ? animeData.seasons[0].id : 1),
                multi: episode.multi === 1
            }));

            return {
                id,
                title: decodeHtmlEntities(animeData.name),
                description: decodeHtmlEntities(animeData.description),
                kaieur: decodeHtmlEntities(animeData.kaieur),
                coverImage: coverImg,
                background: backgroundImg,
                episodes,
                seasons: animeData.seasons || [],
                genres: determineGenres(animeData.name, animeData.description),
                status: animeData.status || 'Inconnu',
                torrents: animeData.torrents || null,
                check: animeData.check || 0
            };
        }

        // Processing list of animes
        const animesData = rawData;
        if (!Array.isArray(animesData)) {
            throw new Error("Received invalid data from Fankai API.");
        }

        const animes = animesData.map(anime => ({
            id: anime.id.toString(),
            title: decodeHtmlEntities(anime.name || ''),
            coverImage: cleanImageUrl(anime.cover),
            languages: anime.multi ? 'VOSTFR | VF' : 'VOSTFR',
            description: decodeHtmlEntities(anime.description || ''),
            genres: determineGenres(anime.name, anime.description),
            status: anime.status || 'Inconnu',
            episodes_count: anime.episodes_count || 0,
            check: anime.check || 0
        }));

        console.log(`${animes.length} animes found on Fankai`);
        return animes;

    } catch (error) {
        console.error('Error in searchFankai:', error);
        throw error;
    }
}

/**
 * Détermine les genres probables d'un anime à partir de son titre et de sa description
 * @param {string} title - Titre de l'anime
 * @param {string} description - Description de l'anime (optionnel)
 * @returns {Array} - Liste des genres probables
 */
function determineGenres(title, description = '') {
    const genres = new Set(['Anime']);
    const textToAnalyze = (title + ' ' + description).toLowerCase();

    const genreKeywords = {
        'Action': ['action', 'combat', 'bataille', 'guerre', 'lutte', 'assassin', 'gunfight'],
        'Aventure': ['aventure', 'quête', 'voyage', 'exploration', 'découverte', 'pirates'],
        'Comédie': ['comédie', 'humour', 'drôle', 'comique', 'gag'],
        'Drame': ['drame', 'tragédie', 'émotion', 'triste', 'dramatique'],
        'Fantasy': ['fantasy', 'magie', 'dragon', 'féerique', 'pouvoir', 'sortilège', 'sorcier', 'elfe', 'démon'],
        'Horreur': ['horreur', 'épouvante', 'monstre', 'zombie', 'vampire', 'terreur', 'gore'],
        'Mystère': ['mystère', 'enquête', 'détective', 'thriller', 'suspense'],
        'Psychologique': ['psychologique', 'thriller', 'paranoïa', 'manipulation'],
        'Romance': ['romance', 'amour', 'relation', 'couple', 'sentimental'],
        'Sci-Fi': ['sci-fi', 'science-fiction', 'futur', 'technologie', 'espace', 'robot', 'mecha', 'cyborg'],
        'Slice of Life': ['tranche de vie', 'quotidien', 'école', 'lycée'],
        'Sport': ['sport', 'football', 'basket', 'tennis', 'volley', 'baseball', 'boxe'],
        'Surnaturel': ['surnaturel', 'fantôme', 'esprit', 'démon', 'pouvoir psychique'],
        'Shonen': ['shonen'],
        'Shojo': ['shojo'],
        'Seinen': ['seinen'],
        'Josei': ['josei']
    };

    for (const [genre, keywords] of Object.entries(genreKeywords)) {
        if (keywords.some(keyword => textToAnalyze.includes(keyword))) {
            genres.add(genre);
        }
    }

    const animeGenres = {
        'dragon ball': ['arts martiaux'],
        'naruto': ['ninja'],
        'one piece': ['pirates'],
        'bleach': ['shinigami', 'surnaturel'],
        'death note': ['mystère', 'thriller', 'surnaturel'],
        'attack on titan': ['action', 'drame', 'fantasy', 'horreur', 'post-apocalyptique'],
        'demon slayer': ['surnaturel', 'historique'],
        'my hero academia': ['super-héros'],
        'jujutsu kaisen': ['surnaturel'],
        'food wars': ['cuisine', 'ecchi'],
        'black clover': ['fantasy', 'shonen'],
        'gto': ['slice of life', 'comédie'],
        'slam dunk': ['sport'],
        'hajime no ippo': ['sport', 'boxe'],
        'hunter x hunter': ['aventure', 'shonen'],
        'fullmetal alchemist': ['aventure', 'fantasy', 'steampunk']
    };

    const lowerTitle = title.toLowerCase();
    for (const [animeName, specificGenres] of Object.entries(animeGenres)) {
        if (lowerTitle.includes(animeName)) {
            specificGenres.forEach(g => genres.add(g));
        }
    }

    return [...genres];
}

/**
 * Nettoie une URL d'image pour assurer qu'elle est complète et valide
 * @param {string} imageUrl - URL de l'image à nettoyer
 * @returns {string} - URL de l'image nettoyée
 */
function cleanImageUrl(imageUrl) {
    if (!imageUrl) {
        return 'https://fankai.fr/img/bg-blurred.jpeg'; // Image par défaut
    }
    
    // Si l'URL commence par "/_next/image", extraire l'URL originale
    if (imageUrl.startsWith('/_next/image')) {
        const urlMatch = imageUrl.match(/url=([^&]+)/);
        if (urlMatch && urlMatch[1]) {
            imageUrl = decodeURIComponent(urlMatch[1]);
        }
    }
    
    // Assurer que l'URL est absolue
    if (imageUrl.startsWith('/')) {
        if (imageUrl.startsWith('/images/')) {
            imageUrl = `https://api.fankai.fr${imageUrl}`;
        } else {
            imageUrl = `https://fankai.fr${imageUrl}`;
        }
    }
    
    // Forcer l'utilisation de HTTPS
    if (imageUrl.startsWith('http:')) {
        imageUrl = imageUrl.replace('http:', 'https:');
    }
    return imageUrl;
}

/**
 * Extrait les données utiles d'un anime pour un affichage simplifié
 * @param {Object} anime - Données complètes de l'anime
 * @returns {Object} - Données simplifiées
 */
function simplifyAnimeData(anime) {
    return {
        id: anime.id,
        title: decodeHtmlEntities(anime.title),
        description: decodeHtmlEntities(anime.description),
        kaieur: decodeHtmlEntities(anime.kaieur),
        coverImage: cleanImageUrl(anime.coverImage),
        background: cleanImageUrl(anime.background),
        status: anime.status,
        genres: anime.genres || [],
        episodeCount: anime.episodes?.length || 0,
        seasonCount: anime.seasons?.length || 0,
        languages: anime.languages || (anime.multi ? 'VOSTFR | VF' : 'VOSTFR'),
        check: anime.check || 0
    };
}

/**
 * Récupère les détails complets d'un anime
 * @param {string} animeId - ID de l'anime
 * @returns {Promise<Object>} - Détails complets de l'anime
 */
async function getFullAnimeDetails(animeId) {
    try {
        console.log(`Récupération des détails complets pour l'anime ID ${animeId}`);
        
        // Récupérer les détails de l'anime
        const anime = await searchFankai(null, animeId);
        
        if (!anime) {
            throw new Error(`Anime avec ID ${animeId} non trouvé`);
        }
        
        // Assurer que les saisons sont correctement configurées
        if (!anime.seasons || anime.seasons.length === 0) {
            anime.seasons = [{ id: 1, name: 'Saison 1', number: 1 }];
        }
        
        // Debug info
        console.log(`Anime: ${anime.title}, Saisons: ${anime.seasons.length}, Episodes: ${anime.episodes.length}`);
        console.log(`Saisons: ${JSON.stringify(anime.seasons.map(s => ({ id: s.id, name: s.name, number: s.number })))}`);
        
        // Corriger les saisons des épisodes
        const episodesWithCorrectSeasons = anime.episodes.map(episode => {
            // IMPORTANT: Assigner explicitement une saison à chaque épisode
            if (!episode.season_id || typeof episode.season_id === 'undefined') {
                episode.season_id = anime.seasons[0].id;
                console.log(`Assigné saison ${anime.seasons[0].id} à épisode ${episode.number}`);
            }
            
            // Debug info
            console.log(`Épisode ${episode.number}, saison_id: ${episode.season_id}`);
            
            return {
                ...episode
            };
        });
        
        console.log(`Retour final: ${episodesWithCorrectSeasons.length} épisodes préparés`);
        
        return {
            ...anime,
            episodes: episodesWithCorrectSeasons
        };
    } catch (error) {
        console.error('Erreur lors de la récupération des détails complets:', error);
        throw error;
    }
}

module.exports = {
    searchFankai,
    getFullAnimeDetails,
    simplifyAnimeData,
    cleanImageUrl
};

/**
 * Détermine les genres probables d'un anime à partir de son titre et de sa description
 * @param {string} title - Titre de l'anime
 * @param {string} description - Description de l'anime (optionnel)
 * @returns {Array} - Liste des genres probables
 */
function determineGenres(title, description = '') {
    const genres = ['Anime'];
    
    // Mots-clés associés à des genres spécifiques
    const genreKeywords = {
        'Action': ['combat', 'bataille', 'guerre', 'lutte', 'ninja', 'samouraï', 'shinigami', 'super-pouvoir'],
        'Aventure': ['quête', 'voyage', 'exploration', 'découverte', 'aventure'],
        'Comédie': ['comédie', 'humour', 'rire', 'drôle', 'comique'],
        'Drame': ['drame', 'tragédie', 'émotion', 'larme', 'triste'],
        'Fantasy': ['magie', 'dragon', 'féerique', 'pouvoir', 'sortilège', 'sorcier', 'fantasy'],
        'Horreur': ['horreur', 'épouvante', 'monstre', 'zombie', 'vampire', 'terreur'],
        'Romance': ['amour', 'romance', 'relation', 'couple', 'sentiment'],
        'Sci-Fi': ['futur', 'technologie', 'science', 'espace', 'robot', 'mecha'],
        'Shonen': ['shonen', 'garçon', 'combat', 'amitié', 'puissance'],
        'Shojo': ['shojo', 'fille', 'romance', 'émotion', 'amitié'],
        'Sport': ['sport', 'football', 'basket', 'tennis', 'volley', 'baseball']
    };
    
    // Examine le titre et la description pour des mots-clés associés à des genres
    const textToAnalyze = (title + ' ' + description).toLowerCase();
    
    Object.entries(genreKeywords).forEach(([genre, keywords]) => {
        for (const keyword of keywords) {
            if (textToAnalyze.includes(keyword.toLowerCase())) {
                genres.push(genre);
                break;
            }
        }
    });
    
    // Ajouter quelques genres spécifiques basés sur des titres populaires
    const animeGenres = {
        'Dragon Ball': ['Action', 'Aventure', 'Shonen', 'Arts Martiaux'],
        'Naruto': ['Action', 'Aventure', 'Shonen', 'Ninja'],
        'One Piece': ['Action', 'Aventure', 'Shonen', 'Pirates'],
        'Bleach': ['Action', 'Aventure', 'Shonen', 'Surnaturel'],
        'Death Note': ['Mystère', 'Thriller', 'Surnaturel'],
        'Attack on Titan': ['Action', 'Drame', 'Fantasy', 'Horreur'],
        'Demon Slayer': ['Action', 'Aventure', 'Surnaturel', 'Historique'],
        'My Hero Academia': ['Action', 'Aventure', 'Shonen', 'Super-héros'],
        'Jujutsu Kaisen': ['Action', 'Aventure', 'Surnaturel'],
        'Food Wars': ['Comédie', 'Cuisine', 'Ecchi']
    };
    
    // Vérifier si le titre correspond à un anime populaire
    Object.entries(animeGenres).forEach(([animeName, animeSpecificGenres]) => {
        if (title.toLowerCase().includes(animeName.toLowerCase())) {
            genres.push(...animeSpecificGenres);
        }
    });
    
    // Supprimer les doublons
    return [...new Set(genres)];
}

/**
 * Nettoie une URL d'image pour assurer qu'elle est complète et valide
 * @param {string} imageUrl - URL de l'image à nettoyer
 * @returns {string} - URL de l'image nettoyée
 */
function cleanImageUrl(imageUrl) {
    if (!imageUrl) {
        return 'https://fankai.fr/img/bg-blurred.jpeg'; // Image par défaut
    }
    
    // Si l'URL commence par "/_next/image", extraire l'URL originale
    if (imageUrl.startsWith('/_next/image')) {
        const urlMatch = imageUrl.match(/url=([^&]+)/);
        if (urlMatch && urlMatch[1]) {
            imageUrl = decodeURIComponent(urlMatch[1]);
        }
    }
    
    // Assurer que l'URL est absolue
    if (imageUrl.startsWith('/')) {
        if (imageUrl.startsWith('/images/')) {
            imageUrl = `https://api.fankai.fr${imageUrl}`;
        } else {
            imageUrl = `https://fankai.fr${imageUrl}`;
        }
    }
    
    // Forcer l'utilisation de HTTPS
    if (imageUrl.startsWith('http:')) {
        imageUrl = imageUrl.replace('http:', 'https:');
    }
    return imageUrl;
}

/**
 * Extrait les données utiles d'un anime pour un affichage simplifié
 * @param {Object} anime - Données complètes de l'anime
 * @returns {Object} - Données simplifiées
 */
function simplifyAnimeData(anime) {
    return {
        id: anime.id,
        title: decodeHtmlEntities(anime.title),
        description: decodeHtmlEntities(anime.description),
        kaieur: decodeHtmlEntities(anime.kaieur),
        coverImage: cleanImageUrl(anime.coverImage),
        background: cleanImageUrl(anime.background),
        status: anime.status,
        genres: anime.genres || [],
        episodeCount: anime.episodes?.length || 0,
        seasonCount: anime.seasons?.length || 0,
        languages: anime.languages || (anime.multi ? 'VOSTFR | VF' : 'VOSTFR'),
        check: anime.check || 0
    };
}

/**
 * Récupère les détails complets d'un anime
 * @param {string} animeId - ID de l'anime
 * @returns {Promise<Object>} - Détails complets de l'anime
 */
async function getFullAnimeDetails(animeId) {
    try {
        console.log(`Récupération des détails complets pour l'anime ID ${animeId}`);
        
        // Récupérer les détails de l'anime
        const anime = await searchFankai(null, animeId);
        
        if (!anime) {
            throw new Error(`Anime avec ID ${animeId} non trouvé`);
        }
        
        // Assurer que les saisons sont correctement configurées
        if (!anime.seasons || anime.seasons.length === 0) {
            anime.seasons = [{ id: 1, name: 'Saison 1', number: 1 }];
        }
        
        // Debug info
        console.log(`Anime: ${anime.title}, Saisons: ${anime.seasons.length}, Episodes: ${anime.episodes.length}`);
        console.log(`Saisons: ${JSON.stringify(anime.seasons.map(s => ({ id: s.id, name: s.name, number: s.number })))}`);
        
        // Corriger les saisons des épisodes
        const episodesWithCorrectSeasons = anime.episodes.map(episode => {
            // IMPORTANT: Assigner explicitement une saison à chaque épisode
            if (!episode.season_id || typeof episode.season_id === 'undefined') {
                episode.season_id = anime.seasons[0].id;
                console.log(`Assigné saison ${anime.seasons[0].id} à épisode ${episode.number}`);
            }
            
            // Debug info
            console.log(`Épisode ${episode.number}, saison_id: ${episode.season_id}`);
            
            return {
                ...episode
            };
        });
        
        console.log(`Retour final: ${episodesWithCorrectSeasons.length} épisodes préparés`);
        
        return {
            ...anime,
            episodes: episodesWithCorrectSeasons
        };
    } catch (error) {
        console.error('Erreur lors de la récupération des détails complets:', error);
        throw error;
    }
}

module.exports = {
    searchFankai,
    getFullAnimeDetails,
    simplifyAnimeData,
    cleanImageUrl
};
