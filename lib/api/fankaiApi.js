const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Decode HTML entities in a string
 * @param {string} html - The string with HTML entities to decode
 * @returns {string} - The decoded string
 */
function decodeHtmlEntities(html) {
    if (!html) return '';
    return html.replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
               .replace(/&#x([0-9a-f]+);/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)))
               .replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"').replace(/&#39;/g, "'");
}

/**
 * Fallback method using DOM if JSON extraction fails
 * @param {string} htmlContent - HTML content of the page
 * @returns {Array} - List of found animes
 */
function fallbackSearchDOM(htmlContent) {
    console.log('Using DOM fallback method');
    const $ = cheerio.load(htmlContent);
    const animes = [];
    $('.MuiImageListItem-root').each((i, el) => {
        const title = $(el).find('div[class*="MuiBox-root"][class*="css-xq89s0"]').text().trim();
        let img = $(el).find('img').attr('src') || '';
        if (img && img.startsWith('/_next/image')) {
            const match = img.match(/url=([^&]+)/);
            if (match && match[1]) {
                img = decodeURIComponent(match[1]);
            }
        }
        const languages = $(el).find('div[class*="MuiBox-root"][class*="css-1v6vunl"], div[id="mobile"]').text().trim() || 'VOSTFR';
        let animeId = '';
        const clickable = $(el).find('a');
        const href = clickable.attr('href') || '';
        const matchHref = href.match(/\/productions\/(\d+)/);
        if (matchHref && matchHref[1]) {
            animeId = matchHref[1];
        }

        if (title && animeId) {
            animes.push({
                id: animeId,
                name: title,
                cover: img,
                multi: languages.includes('VF'),
            });
        }
    });
    console.log(`${animes.length} animes found via DOM fallback`);
    return animes;
}

/**
 * Searches for animes on Fankai
 * @param {string} query - Search term (optional)
 * @param {string} id - ID of the anime to search for (optional)
 * @returns {Promise<Array|Object>} - List of found animes or details of a specific anime
 */
async function search(query = null, id = null) {
    try {
        const baseUrl = 'https://fankai.fr/productions';
        let url = id ? `${baseUrl}/${id}` : (query ? `${baseUrl}?search=${encodeURIComponent(query)}` : baseUrl);
        
        console.log(`Fetching data from: ${url}`);
        const response = await axios.get(url);
        const jsonMatch = response.data.match(/<script\s+id="__NEXT_DATA__"\s+type="application\/json"[^>]*>([\s\S]*?)<\/script>/);

        if (!jsonMatch || !jsonMatch[1]) {
            console.warn("Could not extract JSON data, attempting DOM fallback.");
            return id ? {} : fallbackSearchDOM(response.data);
        }

        const nextData = JSON.parse(jsonMatch[1]);
        const pageData = nextData.props.pageProps.data;

        if (!pageData) {
            console.warn("JSON data not found in the expected structure, attempting DOM fallback.");
            return id ? {} : fallbackSearchDOM(response.data);
        }
        
        // If fetching details for a single anime, return the data directly
        if (id) {
            return pageData;
        }

        // If searching for a list, ensure it's an array and return
        if (Array.isArray(pageData)) {
            return pageData;
        }

        console.warn("JSON data is not an array, attempting DOM fallback.");
        return fallbackSearchDOM(response.data);

    } catch (error) {
        console.error('Error searching Fankai:', error);
        throw error;
    }
}

module.exports = {
    search,
    decodeHtmlEntities
};
