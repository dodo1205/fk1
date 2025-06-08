const wiki = require('wikijs').default;

const api = wiki({
    apiUrl: 'https://fan-kai.fandom.com/fr/api.php'
});

async function searchFankai(query = null, id = null) {
    if (id) {
        return getFullAnimeDetails(id);
    }

    const page = await api.page('Guide_des_épisodes');
    const content = await page.content();
    const animes = [];

    if (content) {
        const tables = content.split('{| class="wikitable"');
        for (let i = 1; i < tables.length; i++) {
            const table = tables[i];
            const rows = table.split('|-');
            for (let j = 1; j < rows.length; j++) {
                const row = rows[j];
                const cells = row.split('|');
                if (cells.length > 5) {
                    const affiche = cells[1];
                    const serie = cells[2];
                    const films = cells[3];
                    const status = cells[5];

                    if (serie && affiche && films) {
                        animes.push({
                            id: serie.split('[[')[1].split(']]')[0],
                            title: serie.split('[[')[1].split(']]')[0],
                            coverImage: affiche.split('src="')[1].split('"')[0],
                            episodes_count: films,
                            status: status.trim()
                        });
                    }
                }
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
    const content = await page.content();

    const anime = {
        id: animeId,
        title: page.title,
        description: summary,
        coverImage: images[0],
        episodes: [],
        seasons: []
    };

    if (content) {
        const tables = content.split('{| class="wikitable"');
        if (tables.length > 1) {
            const table = tables[1];
            const rows = table.split('|-');
            for (let j = 1; j < rows.length; j++) {
                const row = rows[j];
                const cells = row.split('|');
                if (cells.length > 3) {
                    const film = cells[1];
                    if (film) {
                        anime.episodes.push({
                            id: film.split('[[')[1].split(']]')[0],
                            number: film.split('[[')[1].split(']]')[0],
                            name: film.split('[[')[1].split(']]')[0],
                            description: '',
                            season_id: 1
                        });
                    }
                }
            }
        }
    }

    return anime;
}

module.exports = {
    searchFankai,
    getFullAnimeDetails
};
