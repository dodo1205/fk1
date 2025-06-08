const fetch = require('node-fetch');

async function getRawPageContent(title) {
    const url = `https://fan-kai.fandom.com/fr/api.php?action=query&format=json&prop=revisions&titles=${encodeURIComponent(title)}&rvprop=content&rvslots=main&formatversion=2`;
    const res = await fetch(url);
    const json = await res.json();
    return json.query.pages[0].revisions[0].slots.main.content;
}

async function searchFankai(query = null, id = null) {
    if (id) {
        return getFullAnimeDetails(id);
    }

    try {
        const content = await getRawPageContent('Guide_des_épisodes');
        let animes = [];
        const regex = /\*\s*\[\[([^\]]+)\]\]\s*([^\n]*)/g;
        let match;

        while ((match = regex.exec(content)) !== null) {
            animes.push({
                id: match[1].trim(),
                title: match[1].trim(),
                coverImage: '',
                episodes_count: 0,
                status: match[2].trim()
            });
        }

        if (query) {
            animes = animes.filter(anime =>
                anime.title.toLowerCase().includes(query.toLowerCase())
            );
        }

        return animes;
    } catch (error) {
        console.error('Erreur lors de la récupération du catalogue Fankai:', error);
        return [];
    }
}

async function getFullAnimeDetails(animeId) {
    try {
        const content = await getRawPageContent(animeId);
        const summaryMatch = content.match(/Synopsis\s*=\s*(.*)/);
        const summary = summaryMatch ? summaryMatch[1] : '';
        const imageMatch = content.match(/image\s*=\s*(.*)/);
        const image = imageMatch ? imageMatch[1] : '';

        const anime = {
            id: animeId,
            title: animeId.replace(/_/g, ' '),
            description: summary,
            coverImage: image,
            episodes: [],
            seasons: []
        };

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
