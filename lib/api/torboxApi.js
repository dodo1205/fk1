const axios = require('axios');
const FormData = require('form-data');

// La documentation indique https://api.torbox.app et les endpoints /v1/api/...
// Donc BASE_URL devrait être juste https://api.torbox.app
const BASE_URL = 'https://api.torbox.app'; 
const API_PREFIX = '/v1/api/torrents';

function getHeaders(apiKey) {
    return { 'Authorization': `Bearer ${apiKey}` };
}

/**
 * Vérifie si un torrent est en cache.
 * @param {string} hash - Hash du torrent.
 * @param {string} apiKey - Clé API Torbox.
 * @returns {Promise<Object>} Réponse de l'API.
 */
async function checkCached(hash, apiKey) {
    const url = `${BASE_URL}${API_PREFIX}/checkcached`;
    // Votre test curl montre que l'API attend un POST avec un corps JSON.
    const headers = { 
        ...getHeaders(apiKey),
        'Content-Type': 'application/json' 
    };
    const postData = {
        hashes: [hash] // L'API attend un tableau de hashes
    };
    const response = await axios.post(url, postData, { headers });
    
    if (!response.data || typeof response.data.success === 'undefined') {
        console.warn('[TorboxAPI] Réponse inattendue de checkCached:', response.data);
        throw new Error('Torbox: Réponse inattendue de checkCached');
    }
    // La réponse est { success: true, data: { "hash1": {...}, "hash2": {...} } }
    return response.data;
}

async function getMyTorrents(apiKey) {
    const url = `${BASE_URL}${API_PREFIX}/mylist`;
    const response = await axios.get(url, { headers: getHeaders(apiKey) });
    if (!response.data.success) {
        throw new Error('Torbox: Failed to get torrent list');
    }
    return response.data.data || [];
}

async function createTorrent(magnetLink, apiKey, name = null) {
    const url = `${BASE_URL}${API_PREFIX}/createtorrent`;
    const form = new FormData();
    form.append('magnet', magnetLink);
    if (name) {
        form.append('name', name);
    }
    
    const headers = { ...getHeaders(apiKey), ...form.getHeaders() };
    const response = await axios.post(url, form, { headers });

    if (!response.data.success || !response.data.data || !response.data.data.torrent_id) {
        const errorMsg = response.data.message || 'Torbox: Failed to create torrent';
        console.error(`[TorboxAPI] createTorrent error: ${errorMsg}`, response.data);
        throw new Error(errorMsg);
    }
    return response.data.data; // Retourne { torrent_id, ... }
}

async function createTorrentAsync(magnetLink, apiKey, name = null) {
    const url = `${BASE_URL}${API_PREFIX}/asynccreatetorrent`;
    const form = new FormData();
    form.append('magnet', magnetLink);
    if (name) {
        form.append('name', name);
    }

    const headers = { ...getHeaders(apiKey), ...form.getHeaders() };
    const response = await axios.post(url, form, { headers });

    if (!response.data.success || !response.data.data || !response.data.data.torrent_id) {
        const errorMsg = response.data.message || 'Torbox: Failed to create torrent asynchronously';
        console.error(`[TorboxAPI] createTorrentAsync error: ${errorMsg}`, response.data);
        throw new Error(errorMsg);
    }
    return response.data.data; // Retourne { torrent_id, ... }
}


async function getTorrentInfo(hash, apiKey) {
    const url = `${BASE_URL}${API_PREFIX}/torrentinfo`; 
    const params = { hash: hash };
    const response = await axios.get(url, { params, headers: getHeaders(apiKey) });
    if (!response.data.success) {
        throw new Error(`Torbox: Failed to get torrent info for ${hash}. Message: ${response.data.message}`);
    }
    return response.data.data; 
}

// requestDownloadLink n'est pas dans la doc fournie, on le commente/supprime pour l'instant.
// Si les liens sont directement dans torrentinfo, cette fonction n'est pas nécessaire.
/*
async function requestDownloadLink(torrentId, fileId, apiKey) {
    const url = `${BASE_URL}/api/torrents/requestdl`;
    const params = { token: apiKey, torrent_id: torrentId, file_id: fileId };
    const response = await axios.get(url, { params, headers: getHeaders(apiKey) });
    if (!response.data.success) {
        throw new Error('Failed to generate download link from Torbox');
    }
    return response.data.data;
}
*/

async function requestDownloadLink(torrentId, fileId, apiKey) {
    const url = `${BASE_URL}${API_PREFIX}/requestdl`;
    const params = { torrent_id: torrentId, file_id: fileId };
    const response = await axios.get(url, { params, headers: getHeaders(apiKey) });
    if (!response.data.success || !response.data.data) {
        throw new Error('Failed to generate download link from Torbox');
    }
    return response.data.data;
}

module.exports = {
    checkCached,
    getMyTorrents,
    createTorrent,
    createTorrentAsync,
    getTorrentInfo,
    requestDownloadLink
};
