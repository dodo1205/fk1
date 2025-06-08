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
        const content = await page.rawContent();
        let animes = [];

        if (content && typeof content === 'string') {
            const lines = content.split('\n');
            for (const line of lines) {
                if (line.startsWith('*[[')) {
                    const parts = line.split(']]');
                    const title = parts[0].replace('*[[', '');
                    const status = parts[1].trim();

                    animes.push({
                        id: title,
                        title: title,
                        coverImage: '', // Will be fetched in getFullAnimeDetails
                        episodes_count: 0, // Will be fetched in getFullAnimeDetails
                        status: status
                    });
                }
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
        const content = await page.rawContent();

        const anime = {
            id: animeId,
            title: page.title,
            description: summary,
            coverImage: images.length > 0 ? images[0] : '',
            episodes: [],
            seasons: []
        };

        if (content && typeof content === 'string') {
            const lines = content.split('\n');
            for (const line of lines) {
                if (line.startsWith('|{{Resume|')) {
                    const parts = line.split('|');
                    const film = parts[1].replace('{{Resume|', '').trim();
                    const number = parts[3].trim();
                    const name = film;

                    anime.episodes.push({
                        id: `${animeId}:${number}`,
                        number: number,
                        name: name,
                        description: '',
                        season_id: 1
                    });
                }
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
