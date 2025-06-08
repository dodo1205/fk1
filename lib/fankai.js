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
            const status = row['AVANCEMENT'];
            animes.push({
                id: row['Série (A)'].split('](')[1].split(')')[0].split('/').pop(),
                title: row['Série (A)'].split('[')[1].split(']')[0],
                coverImage: row.Affiche.split('src="')[1].split('"')[0],
                episodes_count: row.Films,
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
                id: row.FILM.split('](')[1].split(')')[0].split('/').pop(),
                number: row.FILM.split('](')[0].split('[')[1],
                name: row.FILM.split('](')[0].split('[')[1],
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
