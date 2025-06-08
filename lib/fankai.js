const wiki = require('wikijs').default;

const api = wiki({
    apiUrl: 'https://fan-kai.fandom.com/fr/api.php'
});

async function searchFankai(query = null, id = null) {
    if (id) {
        return getFullAnimeDetails(id);
    }

    try {
        const page = await api.page('Guide_des_épisodes');
        const data = await page.raw();
        const pageId = Object.keys(data.query.pages)[0];
        const content = data.query.pages[pageId].revisions[0]['*'];
        let animes = [];

        if (content && typeof content === 'string') {
            const regex = /\*\[\[(.*?)]]\s*(.*)/g;
            let match;
            while ((match = regex.exec(content)) !== null) {
                animes.push({
                    id: match[1],
                    title: match[1],
                    coverImage: '', // Will be fetched in getFullAnimeDetails
                    episodes_count: 0, // Will be fetched in getFullAnimeDetails
                    status: match[2].trim()
                });
            }
        }

        if (query) {
            animes = animes.filter(anime => anime.title.toLowerCase().includes(query.toLowerCase()));
        }

        return animes;
    } catch (error) {
        console.error('Erreur lors de la récupération du catalogue Fankai:', error);
        return [];
    }
}

async function getFullAnimeDetails(animeId) {
    try {
        const page = await api.page(animeId);
        const summary = await page.summary();
        const images = await page.images();
        const data = await page.raw();
        const pageId = Object.keys(data.query.pages)[0];
        const content = data.query.pages[pageId].revisions[0]['*'];

        const anime = {
            id: animeId,
            title: page.title,
            description: summary,
            coverImage: images.length > 0 ? images[0] : '',
            episodes: [],
            seasons: []
        };

        if (content && typeof content === 'string') {
            const regex = /\|{{Resume\|(.*?)\|.*?\|(\d+)\|.*?}}/g;
            let match;
            while ((match = regex.exec(content)) !== null) {
                anime.episodes.push({
                    id: `${animeId}:${match[2]}`,
                    number: match[2],
                    name: match[1],
                    description: '',
                    season_id: 1
                });
            }
        }

        return anime;
    } catch (error) {
        console.error(`Erreur lors de la récupération des détails pour l'anime ${animeId}:`, error);
        return null;
    }
}

module.exports = {
    searchFankai,
    getFullAnimeDetails
};
