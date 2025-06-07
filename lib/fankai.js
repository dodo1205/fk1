const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Decode HTML entities in a string
 * @param {string} html - The string with HTML entities to decode
 * @returns {string} - The decoded string
 */
function decodeHtmlEntities(html) {
    if (!html) return '';
    
    // Remplacer les entités HTML courantes
    return html
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/&#x2F;/g, '/')
        .replace(/&#x60;/g, '`')
        .replace(/&#x3D;/g, '=')
        .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
        .replace(/&#x([0-9a-f]+);/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Recherche des animes sur Fankai
 * @param {string} query - Terme de recherche (optionnel)
 * @param {string} id - ID de l'anime à rechercher (optionnel)
 * @returns {Promise<Array|Object>} - Liste des animes trouvés ou détails d'un anime spécifique
 */
async function searchFankai(query = null, id = null) {
    try {
        // URL de base pour la recherche sur Fankai
        const baseUrl = 'https://fankai.fr/productions';
        
        // Si un ID est fourni, récupérer les détails de cet anime spécifique
        if (id) {
            const animeUrl = `${baseUrl}/${id}`;
            console.log(`Récupération des détails de l'anime depuis: ${animeUrl}`);
            
            const response = await axios.get(animeUrl);
            
            // Extraction du JSON depuis la balise script
            const jsonMatch = response.data.match(/<script\s+id="__NEXT_DATA__"\s+type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
            
            if (!jsonMatch || !jsonMatch[1]) {
                throw new Error("Impossible d'extraire les données JSON de la page");
            }
            
            // Parser le JSON
            const nextData = JSON.parse(jsonMatch[1]);
            
            // Les données de l'anime se trouvent généralement dans props.pageProps.data
            let animeData;
            try {
                animeData = nextData.props.pageProps.data;
            } catch (error) {
                throw new Error("Structure JSON inattendue: " + error.message);
            }
            
            if (!animeData) {
                throw new Error("Données de l'anime non trouvées dans le JSON");
            }
            
            // Extraire les données structurées de l'anime
            const title = animeData.name || '';
            
            // Extraire la description depuis le HTML si disponible
            let description = animeData.description || '';
            
            // Chercher la description dans le HTML (classe css-jugfk2)
            const descriptionMatch = response.data.match(/<p[^>]*class="[^"]*css-jugfk2[^"]*"[^>]*>([\s\S]*?)<\/p>/);
            if (descriptionMatch && descriptionMatch[1]) {
                description = decodeHtmlEntities(descriptionMatch[1].trim());
            }
            
            const kaieur = animeData.kaieur || '';
            
            // Obtenir l'URL correcte de l'image de couverture
            let coverImg = animeData.cover || '';
            if (coverImg && !coverImg.startsWith('http')) {
                coverImg = `https://api.fankai.fr${coverImg}`;
            }
            
            // Obtenir l'URL correcte de l'image de fond
            let backgroundImg = animeData.background || '';
            if (backgroundImg && !backgroundImg.startsWith('http')) {
                backgroundImg = `https://api.fankai.fr${backgroundImg}`;
            }
            
            // Chercher l'image de fond dans le HTML si non trouvée
            if (!backgroundImg) {
                const bgMatch = response.data.match(/background-image:\s*url\("([^"]+)"\)/);
                if (bgMatch && bgMatch[1]) {
                    backgroundImg = bgMatch[1];
                    if (backgroundImg.startsWith('/')) {
                        backgroundImg = `https://api.fankai.fr${backgroundImg}`;
                    }
                }
            }
            
            // Extraire les saisons
            let seasons = animeData.seasons ? animeData.seasons.map(season => ({
                id: season.id,
                name: season.name,
                number: season.number
            })) : [];
            
            // Si aucune saison n'est trouvée dans les données JSON, chercher dans le HTML
            if (seasons.length === 0) {
                const seasonsMatch = response.data.match(/<div class="MuiBox-root css-1ofyzhl">([\s\S]*?)<\/div>/);
                if (seasonsMatch && seasonsMatch[1]) {
                    const $ = cheerio.load(seasonsMatch[1]);
                    const seasonButtons = $('button');
                    
                    if (seasonButtons.length > 0) {
                        seasons = [];
                        seasonButtons.each((i, el) => {
                            seasons.push({
                                id: i + 1,
                                name: $(el).text().trim(),
                                number: i + 1
                            });
                        });
                    }
                }
            }
            
            // Extraire les épisodes
            let episodes = animeData.episodes ? animeData.episodes.map(episode => {
                // Traitement de l'image de l'épisode
                let episodeImg = episode.cover || '';
                if (episodeImg && !episodeImg.startsWith('http')) {
                    episodeImg = `https://api.fankai.fr${episodeImg}`;
                }
                
                return {
                    id: episode.id,
                    number: episode.number.toString(),
                    name: decodeHtmlEntities(episode.name || ''),
                    duration: episode.duration || '',
                    image: episodeImg,
                    description: decodeHtmlEntities(episode.description || ''),
                    episodeRange: episode.episodes || '',
                    season_id: episode.season_id || seasons[0]?.id,
                    multi: episode.multi === 1
                };
            }) : [];
            
            // Si aucun épisode n'est trouvé dans les données JSON, chercher dans le HTML
            if (episodes.length === 0) {
                const episodesMatch = response.data.match(/<div class="MuiBox-root css-j565mi">([\s\S]*?)<\/div>/g);
                if (episodesMatch) {
                    episodes = [];
                    episodesMatch.forEach((episodeHtml, index) => {
                        const $ = cheerio.load(episodeHtml);
                        
                        // Extraire le titre de l'épisode
                        const title = $('p.MuiTypography-root.MuiTypography-body1.css-167yfzz').first().text().trim();
                        
                        // Extraire la durée
                        const duration = $('p.MuiTypography-root.MuiTypography-body1.css-167yfzz').eq(1).text().trim();
                        
                        // Extraire la plage d'épisodes
                        const episodeRange = $('div.MuiBox-root.css-8s549p').text().trim().replace(/Episodes\s+/i, '');
                        
                        // Extraire la description
                        const description = $('p.MuiTypography-root.MuiTypography-body1.css-sd8pf2').text().trim();
                        
                        // Extraire l'image
                        let image = $('img').attr('src') || '';
                        if (image && image.startsWith('/_next/image')) {
                            const match = image.match(/url=([^&]+)/);
                            if (match && match[1]) {
                                image = decodeURIComponent(match[1]);
                                if (!image.startsWith('http')) {
                                    image = `https://api.fankai.fr${image}`;
                                }
                            }
                        }
                        
                        // Déterminer le numéro d'épisode à partir du titre
                        const episodeNumberMatch = title.match(/Film\s+(\d+)/i);
                        const episodeNumber = episodeNumberMatch ? episodeNumberMatch[1] : (index + 1).toString();
                        
                        // Déterminer la saison (par défaut la première)
                        const season_id = seasons.length > 0 ? seasons[0].id : 1;
                        
                        episodes.push({
                            id: index + 1,
                            number: episodeNumber,
                            name: decodeHtmlEntities(title.replace(/Film\s+\d+\s+-\s+/i, '')),
                            duration: duration,
                            image: image,
                            description: decodeHtmlEntities(description),
                            episodeRange: episodeRange,
                            season_id: season_id,
                            multi: title.toLowerCase().includes('vostfr') && title.toLowerCase().includes('vf')
                        });
                    });
                }
            }
            
            console.log(`Anime trouvé: ${title} avec ${episodes.length} épisodes et ${seasons.length} saisons`);
            
            return {
                id,
                title: decodeHtmlEntities(title),
                description: decodeHtmlEntities(description),
                kaieur: decodeHtmlEntities(kaieur),
                coverImage: coverImg,
                background: backgroundImg,
                episodes,
                seasons,
                genres: determineGenres(title, description),
                status: animeData.status || 'Inconnu',
                torrents: animeData.torrents || null,
                check: animeData.check || 0
            };
        }
        
        // Sinon, effectuer une recherche avec le terme fourni ou récupérer tous les animes
        let url = baseUrl;
        if (query) {
            url = `${baseUrl}?search=${encodeURIComponent(query)}`;
        }
        
        console.log(`Récupération de la liste des animes depuis: ${url}`);
        const response = await axios.get(url);
        
        // Extraction du JSON depuis la balise script
        const jsonMatch = response.data.match(/<script\s+id="__NEXT_DATA__"\s+type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
        
        if (!jsonMatch || !jsonMatch[1]) {
            throw new Error("Impossible d'extraire les données JSON de la page");
        }
        
        // Parser le JSON
        const nextData = JSON.parse(jsonMatch[1]);
        
        // Les données de liste d'animes se trouvent généralement dans props.pageProps.data
        let animesData;
        try {
            animesData = nextData.props.pageProps.data;
        } catch (error) {
            // Fallback sur la méthode DOM si on ne trouve pas le JSON
            console.warn("Structure JSON inattendue, utilisation du fallback DOM");
            return fallbackSearchDOM(response.data, query);
        }
        
        if (!Array.isArray(animesData)) {
            // Fallback sur la méthode DOM si la structure du JSON est inattendue
            console.warn("Structure JSON inattendue (pas un tableau), utilisation du fallback DOM");
            return fallbackSearchDOM(response.data, query);
        }
        
        const animes = animesData.map(anime => {
            // Traitement de l'image de couverture
            let coverImg = anime.cover || '';
            if (coverImg && !coverImg.startsWith('http')) {
                coverImg = `https://api.fankai.fr${coverImg}`;
            }
            
            return {
                id: anime.id.toString(),
                title: decodeHtmlEntities(anime.name || ''),
                coverImage: coverImg,
                languages: anime.multi ? 'VOSTFR | VF' : 'VOSTFR',
                description: decodeHtmlEntities(anime.description || ''),
                genres: determineGenres(anime.name, anime.description),
                status: anime.status || 'Inconnu',
                episodes_count: anime.episodes_count || 0,
                check: anime.check || 0
            };
        });
        
        console.log(`${animes.length} animes trouvés sur Fankai`);
        return animes;
    } catch (error) {
        console.error('Erreur lors de la recherche sur Fankai:', error);
        throw error;
    }
}

/**
 * Méthode de fallback utilisant le DOM si l'extraction JSON échoue
 * @param {string} htmlContent - Contenu HTML de la page
 * @param {string} query - Terme de recherche
 * @returns {Array} - Liste des animes trouvés
 */
function fallbackSearchDOM(htmlContent, query) {
    console.log('Utilisation de la méthode fallback DOM');
    const $ = cheerio.load(htmlContent);
    
    const animes = [];
    $('.MuiImageListItem-root').each((i, el) => {
        // Extraire le titre
        const title = $(el).find('div[class*="MuiBox-root"][class*="css-xq89s0"]').text().trim() ||
                     $(el).find('div[class*="MuiBox-root"] > div').first().text().trim();
        
        // Extraire l'image
        let img = $(el).find('img').attr('src') || '';
        
        // Corriger l'URL de l'image
        if (img && img.startsWith('/_next/image')) {
            const match = img.match(/url=([^&]+)/);
            if (match && match[1]) {
                img = decodeURIComponent(match[1]);
                if (!img.startsWith('http')) {
                    img = `https://api.fankai.fr${img}`;
                }
            }
        }
        
        // Extraire les langues disponibles
        const languages = $(el).find('div[class*="MuiBox-root"][class*="css-1v6vunl"], div[id="mobile"]').text().trim() || 'VOSTFR';
        
        // Extraire l'ID
        let animeId = '';
        
        // Chercher l'ID dans l'attribut data-id ou onclick
        const dataId = $(el).attr('data-id');
        if (dataId) {
            animeId = dataId;
        } else {
            // Chercher dans des attributs onclick ou href
            const clickable = $(el).find('*[onclick], a');
            clickable.each((j, elem) => {
                const onclick = $(elem).attr('onclick') || '';
                const href = $(elem).attr('href') || '';
                
                // Extraire l'ID d'une URL comme /productions/123
                const matchOnclick = onclick.match(/\/productions\/(\d+)/);
                const matchHref = href.match(/\/productions\/(\d+)/);
                
                if (matchOnclick && matchOnclick[1]) {
                    animeId = matchOnclick[1];
                } else if (matchHref && matchHref[1]) {
                    animeId = matchHref[1];
                }
            });
        }
        
        // Si toujours pas d'ID, utiliser l'index
        if (!animeId) {
            animeId = (i + 1).toString();
        }
        
        animes.push({
            id: animeId,
            title: decodeHtmlEntities(title),
            coverImage: img,
            languages,
            genres: determineGenres(title),
            status: 'Inconnu',
            episodes_count: 0, // Par défaut, on ne connaît pas le nombre d'épisodes
            check: 0 // Par défaut, les animes récupérés via DOM fallback sont considérés comme visibles
        });
    });
    
    console.log(`${animes.length} animes trouvés via le DOM fallback`);
    return animes;
}

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
