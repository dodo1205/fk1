const axios = require('axios');
const FormData = require('form-data');

const BASE_URL = 'https://api.torbox.app'; 
const API_PREFIX = '/v1/api/torrents';

function getHeaders(apiKey) {
    return { 'Authorization': `Bearer ${apiKey}` };
}

async function checkCached(hash, apiKey) {
    const url = `${BASE_URL}${API_PREFIX}/checkcached`;
    const headers = { 
        ...getHeaders(apiKey),
        'Content-Type': 'application/json' 
    };
    const postData = { hashes: [hash] };
    const response = await axios.post(url, postData, { headers });
    
    if (!response.data || typeof response.data.success === 'undefined') {
        console.warn('[TorboxAPI] Réponse inattendue de checkCached:', response.data);
        throw new Error('Torbox: Réponse inattendue de checkCached');
    }
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
    return response.data.data;
}

async function getTorrentInfoByHash(hash, apiKey) {
    const url = `${BASE_URL}${API_PREFIX}/torrentinfo`; 
    const params = { hash: hash };
    const response = await axios.get(url, { params, headers: getHeaders(apiKey) });
    if (!response.data.success) {
        throw new Error(`Torbox: Failed to get torrent info for hash ${hash}. Message: ${response.data.message}`);
    }
    return response.data.data; 
}

// FONCTION CORRIGÉE - Plus fiable
async function getTorrentInfoById(torrentId, apiKey) {
    try {
        // Méthode 1: Essayer l'endpoint spécifique pour un torrent
        const url = `${BASE_URL}${API_PREFIX}/torrentinfo`;
        const params = { torrent_id: torrentId };
        const response = await axios.get(url, { params, headers: getHeaders(apiKey) });
        
        if (response.data.success && response.data.data) {
            return response.data.data;
        }
    } catch (error) {
        console.warn(`[TorboxAPI] Méthode 1 échouée pour torrent ${torrentId}:`, error.message);
    }

    try {
        // Méthode 2: Récupérer toute la liste et filtrer
        console.log(`[TorboxAPI] Tentative méthode 2 pour torrent ${torrentId}...`);
        const allTorrents = await getMyTorrents(apiKey);
        const torrent = allTorrents.find(t => t.id == torrentId);
        
        if (torrent) {
            console.log(`[TorboxAPI] Torrent ${torrentId} trouvé dans la liste complète`);
            return torrent;
        }
        
        throw new Error(`Torrent ${torrentId} non trouvé dans la liste utilisateur`);
    } catch (error) {
        console.error(`[TorboxAPI] Toutes les méthodes ont échoué pour torrent ${torrentId}:`, error.message);
        throw new Error(`Torbox: Failed to get torrent info for id ${torrentId}: ${error.message}`);
    }
}

async function requestDownloadLink(torrentId, fileId, apiKey) {
    const url = `${BASE_URL}${API_PREFIX}/requestdl`;
    const params = { token: apiKey, torrent_id: torrentId, file_id: fileId };
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
    getTorrentInfoByHash,
    getTorrentInfoById,
    requestDownloadLink
};