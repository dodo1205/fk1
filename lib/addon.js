const { addonBuilder } = require('stremio-addon-sdk');
const { searchFankai, getFullAnimeDetails, simplifyAnimeData, cleanImageUrl } = require('./fankai');
const { searchTorrents, getTorrentDetails } = require('./nyaa');
const { debridTorrent } = require('./debrid/index');
// Debrid functions are called by the backend in index.js now
const { isWebReady } = require('./fileUtils'); 

// Configuration state within this module instance
let debridConfig = {
    service: 'none',
    apiKey: '',
    downloadOption: 'all',
    baseUrl: '' // Placeholder for the base URL passed from index.js
};

// Manifest definition
const manifest = {
    id: 'org.fankai.fkstream',
    version: '1.1.0',
    name: 'FKStream',
    description: 'Addon pour regarder les animes Kai de Fankai directement depuis Stremio',
    logo: 'https://i.imgur.com/HOR15Iu.png', 
    background: '', 
    catalogs: [
        { id: 'fankai-tout', name: 'Tout', type: 'fankai', extra: [ { name: 'search', isRequired: false } ] },
        { id: 'fankai-terminees', name: 'Terminées', type: 'fankai', extra: [ { name: 'search', isRequired: false } ] },
        { id: 'fankai-encours', name: 'En cours', type: 'fankai', extra: [ { name: 'search', isRequired: false } ] },
        { id: 'fankai-ajour', name: 'À jour', type: 'fankai', extra: [ { name: 'search', isRequired: false } ] },
        { id: 'fankai-genre-action', name: 'Action', type: 'fankai', extra: [ { name: 'search', isRequired: false } ] },
        { id: 'fankai-genre-aventure', name: 'Aventure', type: 'fankai', extra: [ { name: 'search', isRequired: false } ] },
        { id: 'fankai-genre-comedie', name: 'Comédie', type: 'fankai', extra: [ { name: 'search', isRequired: false } ] },
        { id: 'fankai-genre-drame', name: 'Drame', type: 'fankai', extra: [ { name: 'search', isRequired: false } ] },
        { id: 'fankai-genre-fantasy', name: 'Fantasy', type: 'fankai', extra: [ { name: 'search', isRequired: false } ] },
        { id: 'fankai-genre-horreur', name: 'Horreur', type: 'fankai', extra: [ { name: 'search', isRequired: false } ] },
        { id: 'fankai-genre-romance', name: 'Romance', type: 'fankai', extra: [ { name: 'search', isRequired: false } ] },
        { id: 'fankai-genre-sci-fi', name: 'Sci-Fi', type: 'fankai', extra: [ { name: 'search', isRequired: false } ] },
        { id: 'fankai-genre-shonen', name: 'Shonen', type: 'fankai', extra: [ { name: 'search', isRequired: false } ] },
        { id: 'fankai-genre-shojo', name: 'Shojo', type: 'fankai', extra: [ { name: 'search', isRequired: false } ] },
        { id: 'fankai-genre-sport', name: 'Sport', type: 'fankai', extra: [ { name: 'search', isRequired: false } ] }
    ],
    resources: ['catalog', 'stream', 'meta'], 
    types: ['series', 'movie', 'fankai'],
    idPrefixes: ['fankai:'],
    behaviorHints: {
        adult: false,
        configurable: true,
        configurationRequired: false
    }
};

const builder = new addonBuilder(manifest);

// Function called by index.js to update the config for this instance
function updateDebridConfig(config) {
    debridConfig = { ...debridConfig, ...config }; 
    console.log('Configuration des debrideurs mise à jour dans addon.js:', debridConfig);
}

// --- Helper Functions ---
function cleanImageForStremio(imageUrl) {
    if (!imageUrl) return 'https://i.imgur.com/HOR15Iu.png';
    const cleanedUrl = cleanImageUrl(imageUrl);
    if (cleanedUrl === 'https://fankai.fr/img/bg-blurred.jpeg') {
        return 'https://i.imgur.com/HOR15Iu.png';
    }
    return cleanedUrl;
}

function isAnimeMovie(anime) {
    return (
        (anime.title && (anime.title.toLowerCase().includes('film') || anime.title.toLowerCase().includes('movie'))) ||
        (anime.episodes && anime.episodes.length === 1) ||
        (anime.status === 'Finis' && anime.episodes && anime.episodes.length < 3)
    );
}

function calculateTorrentHealth(seeders, leechers) {
    seeders = parseInt(seeders) || 0;
    leechers = parseInt(leechers) || 0;
    if (seeders === 0) return 'dead';
    if (seeders < 5) return 'poor';
    if (seeders < 10) return 'average';
    if (seeders < 30) return 'good';
    return 'excellent';
}

// Base64 encoding function (URL safe)
function encodeBase64UrlSafe(str) {
    return Buffer.from(str).toString('base64')
        .replace(/\+/g, '-') 
        .replace(/\//g, '_') 
        .replace(/=+$/, ''); 
}

// Helper to get language emoji (simplified)
function getLanguageEmoji(lang) {
    if (!lang) return '🌐';
    const lowerLang = lang.toLowerCase();
    if (lowerLang.includes('fr') || lowerLang.includes('vf')) return '🇫🇷';
    if (lowerLang.includes('en') || lowerLang.includes('vo')) return '🇬🇧';
    if (lowerLang.includes('jp')) return '🇯🇵';
    // Add more mappings as needed
    return '🌐'; // Default globe
}

// --- Addon Handlers ---

builder.defineCatalogHandler(async ({ type, id, extra }) => {
    console.log('Catalog request:', type, id, extra);
    if (!id.startsWith('fankai')) return { metas: [] };
    try {
        const query = extra.search || '';
        const animes = await searchFankai(query);
        console.log(`Récupéré ${animes.length} animes depuis Fankai`);
        console.log(`Requête catalogue: type=${type}, id=${id}, extra=${JSON.stringify(extra)}`);
        const visibleAnimes = animes.filter(anime => anime.check !== 1);
        console.log(`Après filtrage des animes cachés: ${visibleAnimes.length} animes visibles`);
        let filteredAnimes = visibleAnimes;
        // Gestion des catalogues, avec un fallback si l'ID n'est pas reconnu
        if (id === 'fankai-tout') {
            filteredAnimes = visibleAnimes;
        } else if (id === 'fankai-terminees') {
            filteredAnimes = visibleAnimes.filter(anime => anime.status === 'Finis');
        } else if (id === 'fankai-encours') {
            filteredAnimes = visibleAnimes.filter(anime => anime.status === 'En cours');
        } else if (id === 'fankai-ajour') {
            filteredAnimes = visibleAnimes.filter(anime => anime.status === 'À jour');
        } else if (id.startsWith('fankai-genre-')) {
            const genre = id.replace('fankai-genre-', '').replace('-', ' ').split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
            filteredAnimes = visibleAnimes.filter(anime => anime.genres && anime.genres.some(g => g.toLowerCase() === genre.toLowerCase()));
            console.log(`Filtrage par genre ${genre}: ${filteredAnimes.length} animes correspondants`);
        } else {
            console.log(`Catalogue inconnu ${id}, utilisation du catalogue par défaut 'fankai-tout'`);
            filteredAnimes = visibleAnimes; // Fallback vers 'Tout' pour les catalogues inconnus comme 'top'
        }
        const metas = filteredAnimes.map(anime => {
            const animeId = anime.id || Math.random().toString(36).substring(7);
            const posterUrl = cleanImageForStremio(anime.coverImage);
            const backgroundUrl = cleanImageForStremio(anime.background);
            const genres = Array.isArray(anime.genres) && anime.genres.length > 0 ? anime.genres : ['Anime', 'Action', 'Aventure'];
            return {
                id: `fankai:${animeId}`, type: 'fankai', name: anime.title || 'Anime sans titre',
                poster: posterUrl, posterShape: 'poster', background: backgroundUrl,
                description: anime.description || 'Anime Kai sans fillers, plus fidèle au manga original.',
                releaseInfo: anime.status || 'Fan-Kai', genres: genres.slice(0, 5),
                director: anime.kaieur ? [`Kaieur: ${anime.kaieur}`] : [],
                year: new Date().getFullYear(), runtime: anime.episodes_count ? `${anime.episodes_count} épisodes` : '30 min',
                language: anime.languages || 'VOSTFR'
            };
        });
        return { metas };
    } catch (error) {
        console.error('Erreur lors de la récupération du catalogue:', error);
        return { metas: [] };
    }
});

builder.defineMetaHandler(async ({ type, id }) => {
    console.log('Meta request:', type, id);
    if (!id.startsWith('fankai:')) return { meta: null };
    try {
        const animeId = id.split(':')[1];
        const anime = await getFullAnimeDetails(animeId);
        if (!anime || anime.check === 1) {
            console.log(`Anime ${anime?.title} (ID: ${animeId}) non trouvé ou caché, retourne null`);
            return { meta: null };
        }
        console.log(`Détails de l'anime récupérés pour ${anime.title}`);
        const isMovie = isAnimeMovie(anime);
        const videos = [];
        const seasonsMap = new Map();
        // Season/Episode mapping logic... (omitted for brevity, assumed correct)
        if (anime.episodes && anime.episodes.length > 0) {
             anime.episodes.forEach(episode => {
                let episodeNumber = parseInt(episode.number) || 1;
                let season_id_key = String(episode.season_id);
                let seasonInfo = seasonsMap.get(season_id_key);
                // Fallback logic for season...
                if (!seasonInfo) seasonInfo = { id: 1, name: 'Saison 1', number: 1 };
                if (isMovie) { seasonInfo = { id: 0, name: 'Film', number: 0 }; episodeNumber = 1; }
                
                const thumbnailUrl = cleanImageForStremio(episode.image || anime.coverImage);
                videos.push({
                    id: `fankai:${anime.id}:${episode.number}`, title: episode.name || `Épisode ${episode.number}`,
                    released: new Date().toISOString(), season: seasonInfo.number, episode: isMovie ? 1 : episodeNumber,
                    overview: episode.description || `Épisode ${episode.number} de ${anime.title} en version Kai sans fillers.`,
                    thumbnail: thumbnailUrl, duration: episode.duration || '30 min', available: true
                });
            });
        }
        // Fallback for no videos...
        if (videos.length === 0) { /* ... add fallback video ... */ }
        
        const meta = {
            id: `fankai:${anime.id}`, type: 'fankai', name: anime.title || 'Anime sans titre',
            poster: cleanImageForStremio(anime.coverImage), posterShape: 'poster',
            background: cleanImageForStremio(anime.background) || manifest.background,
            description: anime.description || 'Anime Kai sans fillers, plus fidèle au manga original.',
            releaseInfo: anime.status || 'Fan-Kai', genres: Array.isArray(anime.genres) ? anime.genres : ['Anime', 'Action', 'Aventure'],
            videos: videos, language: 'fr', country: 'FR', director: anime.kaieur ? [`Kaieur: ${anime.kaieur}`] : [],
            runtime: anime.episodes && anime.episodes[0]?.duration || '30 min', year: new Date().getFullYear(),
            behaviorHints: { hasScheduledVideos: false }
        };
        return { meta };
    } catch (error) {
        console.error('Erreur lors de la récupération des métadonnées:', error);
        return { meta: null };
    }
});

// Endpoint pour récupérer les streams - Ajuste name/description
builder.defineStreamHandler(async ({ type, id }) => {
    console.log('Stream request:', type, id);

    if (!id.startsWith('fankai:')) return { streams: [] };
    
    if (!debridConfig.baseUrl) {
        console.error("Erreur critique: baseUrl n'est pas défini dans la configuration de l'addon.");
        return { streams: [] }; 
    }
    
    try {
        const parts = id.split(':');
        if (parts.length < 3) {
            console.error('Format d\'ID invalide pour la récupération de stream:', id);
            return { streams: [] };
        }
        
        const animeId = parts[1];
        const episodeNumber = parts[2];
        
        console.log(`[INFO] Recherche episode ${episodeNumber} pour anime ID ${animeId}`);
        
        const details = await getTorrentDetails(animeId, episodeNumber);
        
        if (!details || !details.torrents || details.torrents.length === 0) {
            console.log(`[RESULTAT] Aucun torrent trouve pour l'episode ${episodeNumber}`);
            return { streams: [] };
        }
        
        const streams = [];
        const torrentsToProcess = details.torrents.slice(0, 3); // Limit to first 3 torrents to avoid performance issues
        
        for (let i = 0; i < torrentsToProcess.length; i++) {
            const torrent = torrentsToProcess[i];
            const magnetLink = torrent.magnetLink || torrent.magnetUrl;
            if (!magnetLink) {
                console.warn(`[ATTENTION] Torrent sans lien magnet: ${torrent.title}`);
                continue;
            }
            
            const quality = torrent.quality || 'N/A';
            const language = torrent.language || 'N/A';
            const seeders = torrent.seeders || 0;
            const leechers = torrent.leechers || 0;
            // Use the raw size string from Nyaa.si directly
            const sizeText = torrent.size || '0.00 GiB';
            const indexer = torrent.indexer || 'N/A'; // Assuming getTorrentDetails provides this
            const rawTitle = torrent.title || 'N/A';
            
            const healthInfo = `[${seeders}S/${leechers}L]`;
            const torrentHealth = calculateTorrentHealth(seeders, leechers);
            const infoHashMatch = magnetLink.match(/urn:btih:([a-zA-Z0-9]+)/i);
            const infoHash = infoHashMatch ? infoHashMatch[1].toLowerCase() : null;
            const bingeGroup = `fankai-${infoHash || torrentHealth}`; 
            const filename = rawTitle; 

            // --- Build Description String ---
            let description = `${rawTitle}\n`;
            description += `${getLanguageEmoji(language)}\n`; // Language emoji
            description += `🔍 Nyaa 💾 ${sizeText} 👥 ${seeders}`; // Torrent info, always show Nyaa for indexer

            console.log(`[STREAM #${i+1}] Ajout de ${rawTitle} (${seeders} seeders)`);

            // --- Stream Options Logic ---
            if (debridConfig.service === 'none' || !debridConfig.apiKey) {
                // If no debrid service is selected, show only the Magnet (Nyaa) option
                streams.push({
                    name: `FKStream\n[Magnet]`, // Simple name for magnet
                    description: description, // Use detailed description
                    url: magnetLink, 
                    behaviorHints: { 
                        notWebReady: true,
                        bingeGroup: bingeGroup,
                        filename: filename
                    }
                });
            } else {
                // Debrid service is selected, check cache status
                const numericEpisodeNumber = parseInt(episodeNumber); // Ensure it's a number
                const episodeName = details.episodeName || null; // Get episode name from details

                // Check if torrent is cached
                console.log(`[CACHE CHECK] Vérification du cache pour torrent ${i+1}`);
                const cacheConfig = { ...debridConfig, downloadOption: 'cached' };
                const cacheResult = await debridTorrent(magnetLink, cacheConfig, numericEpisodeNumber, episodeName);
                const isCached = cacheResult && cacheResult.status === 'completed';

                console.log(`[CACHE CHECK] Torrent ${i+1} ${isCached ? 'est en cache' : 'n\'est pas en cache'}`);

                const baseQuery = {
                    magnet: magnetLink,
                    episode: numericEpisodeNumber,
                    episodeName: episodeName
                };
                const serviceNameFormatted = debridConfig.service.charAt(0).toUpperCase() + debridConfig.service.slice(1); // e.g., Realdebrid -> RealDeBrid

                if (isCached) {
                    // Show only Instant option if cached
                    const playQuery = { ...baseQuery, action: 'play' };
                    const playQueryB64 = encodeBase64UrlSafe(JSON.stringify(playQuery));
                    const playUrl = `${debridConfig.baseUrl}/playback/${playQueryB64}`;
                    streams.push({
                        name: `⚡ Instant\n${serviceNameFormatted}`,
                        description: description,
                        url: playUrl,
                        behaviorHints: {
                            bingeGroup: bingeGroup,
                            filename: filename
                        }
                    });
                } else {
                    // Show only Download option if not cached
                    const downloadQuery = { ...baseQuery, action: 'download' };
                    const downloadQueryB64 = encodeBase64UrlSafe(JSON.stringify(downloadQuery));
                    const downloadUrl = `${debridConfig.baseUrl}/playback/${downloadQueryB64}`;
                    streams.push({
                        name: `⬇️ Télécharger\n${serviceNameFormatted}`,
                        description: description,
                        url: downloadUrl,
                        behaviorHints: {
                            bingeGroup: bingeGroup,
                            filename: filename
                        }
                    });
                }
            }
        }

        // Trier les streams (Maintenir le tri)
        streams.sort((a, b) => {
            const getScore = (streamName) => { // Sort based on name now
                if (streamName.includes('⬇️')) return 3; 
                if (streamName.includes('⚡')) return 2; 
                if (streamName.includes('[Magnet]')) return 1;
                return 0;
            };
            const scoreA = getScore(a.name);
            const scoreB = getScore(b.name);
            if (scoreA !== scoreB) return scoreB - scoreA; 
            
            // Fallback sort by seeders using description if scores are equal
            const seedersA = parseInt(a.description.match(/👥 (\d+)/)?.[1] || '0');
            const seedersB = parseInt(b.description.match(/👥 (\d+)/)?.[1] || '0');
            return seedersB - seedersA;
        });

        const plural = streams.length > 1 ? 's' : '';
        console.log(`[TERMINE] ${streams.length} stream${plural} disponible${plural} pour l'episode ${episodeNumber}`);

        return { streams };
    } catch (error) {
        console.error(`[ERREUR] Recuperation des streams: ${error.message}`);
        return { streams: [] };
    }
});

module.exports = {
    createAddonInterface: function(config) {
        if (config) {
            updateDebridConfig(config); 
        }
        return builder.getInterface();
    },
    updateDebridConfig 
};
