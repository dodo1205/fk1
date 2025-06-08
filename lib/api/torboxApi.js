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
    // La documentation indique GET ou POST. Utilisons GET pour la simplicité.
    const params = { hash: hash , list_files: true }; // list_files: true pour avoir les infos des fichiers si en cache
    const response = await axios.get(url, { params, headers: getHeaders(apiKey) });
    // La structure de la réponse pour checkcached doit être vérifiée.
    // Supposons qu'elle contienne un indicateur de succès et les données du cache.
    if (!response.data || typeof response.data.success === 'undefined') { // Ajuster selon la vraie réponse
        console.warn('[TorboxAPI] Réponse inattendue de checkCached:', response.data);
        throw new Error('Torbox: Réponse inattendue de checkCached');
    }
    return response.data; // Ex: { success: true, data: { cached: true, files: [...] } }
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


async function getTorrentInfo(torrentId, apiKey) {
    // Utilisation de l'endpoint /torrentinfo comme indiqué dans la doc fournie
    const url = `${BASE_URL}${API_PREFIX}/torrentinfo`; 
    const params = { torrent_id: torrentId }; // La doc indique torrent_id
    const response = await axios.get(url, { params, headers: getHeaders(apiKey) });
    // La structure de la réponse de /torrentinfo doit être vérifiée.
    // Supposons qu'elle contienne un indicateur de succès et les données du torrent.
    if (!response.data.success) {
        throw new Error(`Torbox: Failed to get torrent info for ${torrentId}. Message: ${response.data.message}`);
    }
    // response.data.data devrait contenir { id, name, files: [{ name, size, url }], status, progress, etc. }
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

module.exports = {
    checkCached,    // Ajouté
    getMyTorrents,
    createTorrent,
    createTorrentAsync, // Ajouté
    getTorrentInfo, // Modifié pour utiliser /torrentinfo
    // requestDownloadLink // Commenté/Supprimé
};
