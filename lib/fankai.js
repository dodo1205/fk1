const wiki = require('wikijs').default;

const api = wiki({
    apiUrl: 'https://fan-kai.fandom.com/fr/api.php'
});

async function searchFankai(query = null, id = null) {
    if (id) {
        return getFullAnimeDetails(id);
    }

    const page = await api.page('Guide_des_épisodes');
    const sections = await page.content();
    const content = sections.map(s => s.content).join('\n');

    const animeRegex = /\*\s*\[\[([^\]]+)\]\]\s*([\u{2705}\u{231A}\u{1F6A7}\u{274C}\u{1F4C0}\u{1F44D}\u{1F3AC}\u{23F8}\uFE0F]?)/gu;

    let animes = [];

    for (const match of content.matchAll(animeRegex)) {
        const title = match[1].trim();
        const status = match[2] || '❓'; // défaut si aucun emoji trouvé

        animes.push({
            id: title,
            title: title,
            status: status
        });
    }

    if (query) {
        animes = animes.filter(anime =>
            anime.title.toLowerCase().includes(query.toLowerCase())
        );
    }

    return animes;
}

async function getFullAnimeDetails(animeId) {
    try {
        const page = await api.page(animeId);
        const summary = await page.summary();
        const images = await page.images();
        const sections = await page.content();
        const content = sections.map(s => s.content).join('\n');

        return {
            id: animeId,
            title: page.raw.title,
            description: summary,
            coverImage: images?.[0] || null,
            content: content
        };
    } catch (err) {
        return { error: `Impossible de récupérer les détails pour l'anime : ${animeId}`, details: err.message };
    }
}

module.exports = {
    searchFankai,
    getFullAnimeDetails
};
