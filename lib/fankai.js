const wiki = require('wikijs').default;

const api = wiki({
    apiUrl: 'https://fan-kai.fandom.com/fr/api.php'
});

async function searchFankai(query = null, id = null) {
    if (id) {
        return getFullAnimeDetails(id);
    }

    const page = await api.page('Guide_des_épisodes');
    const tables = await page.tables();
    let animes = [];

    for (const table of tables) {
        for (const row of table) {
            const status = row['avancement'];
            animes.push({
                id: row['série (a)'].split('](')[1].split(')')[0].split('/').pop(),
                title: row['série (a)'].split('[')[1].split(']')[0],
                coverImage: row.affiche.split('src="')[1].split('"')[0],
                episodes_count: row.films,
                status: status
            });
        }
    }

    if (query) {
        animes = animes.filter(anime => anime.title.toLowerCase().includes(query.toLowerCase()));
    }

    return animes;
}

async function getFullAnimeDetails(animeId) {
    const page = await api.page(animeId);
    const summary = await page.summary();
    const images = await page.images();
    const tables = await page.tables();

    const anime = {
        id: animeId,
        title: page.title,
        description: summary,
        coverImage: images[0],
        episodes: [],
        seasons: []
    };

    for (const table of tables) {
        for (const row of table) {
            anime.episodes.push({
                id: row.film.split('](')[1].split(')')[0].split('/').pop(),
                number: row.film.split('](')[0].split('[')[1],
                name: row.film.split('](')[0].split('[')[1],
                description: '',
                season_id: 1
            });
        }
    }

    return anime;
}

module.exports = {
    searchFankai,
    getFullAnimeDetails
};
