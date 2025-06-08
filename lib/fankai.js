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

function cleanImageUrl(imageUrl) {
    if (!imageUrl) {
        return 'https://fankai.fr/img/bg-blurred.jpeg'; // Image par défaut
    }
    
    if (imageUrl.startsWith('/_next/image')) {
        const urlMatch = imageUrl.match(/url=([^&]+)/);
        if (urlMatch && urlMatch[1]) {
            imageUrl = decodeURIComponent(urlMatch[1]);
        }
    }
    
    if (imageUrl.startsWith('/')) {
        if (imageUrl.startsWith('/images/')) {
            imageUrl = `https://api.fankai.fr${imageUrl}`;
        } else {
            imageUrl = `https://fankai.fr${imageUrl}`;
        }
    }
    
    if (imageUrl.startsWith('http:')) {
        imageUrl = imageUrl.replace('http:', 'https:');
    }
    return imageUrl;
}

function simplifyAnimeData(anime) {
    return {
        id: anime.id,
        title: decodeHtmlEntities(anime.title),
        description: decodeHtmlEntities(anime.description),
        kaieur: decodeHtmlEntities(anime.kaieur),
        coverImage: cleanImageUrl(anime.coverImage),
        background: cleanImageUrl(anime.background),
        status: anime.status,
        episodeCount: anime.episodes?.length || 0,
        seasonCount: anime.seasons?.length || 0,
        languages: anime.languages || (anime.multi ? 'VOSTFR | VF' : 'VOSTFR'),
        check: anime.check || 0
    };
}

async function getFullAnimeDetails(animeId) {
    try {
        console.log(`Récupération des détails complets pour l'anime ID ${animeId}`);
        
        const anime = await searchFankai(null, animeId);
        
        if (!anime) {
            throw new Error(`Anime avec ID ${animeId} non trouvé`);
        }
        
        if (!anime.seasons || anime.seasons.length === 0) {
            anime.seasons = [{ id: 1, name: 'Saison 1', number: 1 }];
        }
        
        console.log(`Anime: ${anime.title}, Saisons: ${anime.seasons.length}, Episodes: ${anime.episodes.length}`);
        console.log(`Saisons: ${JSON.stringify(anime.seasons.map(s => ({ id: s.id, name: s.name, number: s.number })))}`);
        
        const episodesWithCorrectSeasons = anime.episodes.map(episode => {
            if (!episode.season_id || typeof episode.season_id === 'undefined') {
                episode.season_id = anime.seasons[0].id;
                console.log(`Assigné saison ${anime.seasons[0].id} à épisode ${episode.number}`);
            }
            
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
