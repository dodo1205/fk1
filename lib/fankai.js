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
            const status = row['avancement'] || row['avancement '];
            const serie = row['série (a)'] || row['séries (b)'] || row['séries (c)'] || row['séries (d)'] || row['séries (e)'] || row['séries (f)'] || row['séries (g)'] || row['séries (h)'] || row['séries (i)'] || row['séries (j)'] || row['séries (k)'] || row['séries (l)'] || row['séries (m)'] || row['séries (n)'] || row['séries (o)'] || row['séries (p)'] || row['séries (r)'] || row['séries (s)'] || row['séries (t)'] || row['séries (v)'] || row['séries (w)'] || row['séries (y)'];
            const affiche = row.affiche;
            const films = row.films;

            if (serie && affiche && films) {
                animes.push({
                    id: serie.split('](')[1].split(')')[0].split('/').pop(),
                    title: serie.split('[')[1].split(']')[0],
                    coverImage: affiche.split('src="')[1].split('"')[0],
                    episodes_count: films,
                    status: status
                });
            }
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
            const film = row.film;
            if (film) {
                anime.episodes.push({
                    id: film.split('](')[1].split(')')[0].split('/').pop(),
                    number: film.split('](')[0].split('[')[1],
                    name: film.split('](')[0].split('[')[1],
                    description: '',
                    season_id: 1
                });
            }
        }
    }

    return anime;
}

module.exports = {
    searchFankai,
    getFullAnimeDetails
};
