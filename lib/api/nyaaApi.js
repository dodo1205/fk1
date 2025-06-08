const axios = require('axios');
const Parser = require('rss-parser');
const cheerio = require('cheerio');

const parser = new Parser({
    customFields: {
        item: [
            ['nyaa:seeders', 'seeders'],
            ['nyaa:leechers', 'leechers'],
            ['nyaa:downloads', 'downloads'],
            ['nyaa:infoHash', 'infoHash'],
            ['nyaa:categoryId', 'categoryId'],
            ['nyaa:category', 'category'],
            ['nyaa:size', 'size'],
        ],
    }
});

/**
 * Searches for torrents on Nyaa.si using the RSS feed for a specific user.
 * @param {string} query - The search query.
 * @param {string} user - The user to filter by (e.g., 'Fan-Kai').
 * @returns {Promise<Array>} - A list of found torrents.
 */
async function search(query, user = 'Fan-Kai') {
    try {
        const url = `https://nyaa.si/?page=rss&u=${encodeURIComponent(user)}&q=${encodeURIComponent(query)}`;
        console.log(`Searching Nyaa.si: ${url}`);
        
        const feed = await parser.parseURL(url);
        
        const torrents = feed.items.map(item => ({
            title: item.title,
            torrentId: item.guid.split('/').pop(),
            torrentUrl: item.guid,
            downloadLink: item.link,
            magnetLink: `magnet:?xt=urn:btih:${item.infoHash}&dn=${encodeURIComponent(item.title)}`,
            size: item.size,
            date: item.pubDate,
            seeders: item.seeders,
            leechers: item.leechers,
            downloads: item.downloads
        }));
        
        return torrents;
    } catch (error) {
        console.error(`Error searching Nyaa.si: ${error.message}`);
        return [];
    }
}

/**
 * Gets the file list by scraping a Nyaa.si torrent page.
 * @param {string} pageUrl - The URL of the torrent's page.
 * @returns {Promise<Array>} - A list of files in the torrent.
 */
async function getFileListFromPage(pageUrl) {
    try {
        const response = await axios.get(pageUrl);
        const $ = cheerio.load(response.data);
        const fileList = [];

        // Target the specific file list panel provided by the user
        $('div.torrent-file-list').find('li').each((i, el) => {
            // Ensure we are only targeting file entries, not folders
            if ($(el).find('i.fa-file').length > 0) {
                const fullText = $(el).text().trim();
                // Remove the file size in parentheses at the end to get a clean name
                const name = fullText.replace(/\s*\([^)]+\)$/, '').trim();
                const sizeMatch = fullText.match(/\(([^)]+)\)$/);
                const size = sizeMatch ? sizeMatch[1] : 'N/A';
                
                if (name) {
                    fileList.push({ name, size });
                }
            }
        });

        // If the primary method fails, fallback to the torrent description
        if (fileList.length === 0) {
            console.log(`[INFO] Could not find file list in 'div.torrent-file-list', falling back to 'div.torrent-description' for ${pageUrl}`);
            const description = $('div.torrent-description').text();
            const lines = description.split('\n');
            for (const line of lines) {
                const trimmedLine = line.trim();
                if (trimmedLine && !trimmedLine.endsWith('/')) {
                    fileList.push({ name: trimmedLine, size: 'N/A' });
                }
            }
        }

        return fileList;
    } catch (error) {
        console.error(`Error scraping file list from page: ${error.message}`);
        return [];
    }
}

module.exports = {
    search,
    getFileListFromPage
};
