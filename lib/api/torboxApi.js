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

async function getTorrentInfoById(torrentId, apiKey) {
    try {
        // D'abord essayer via la liste (plus fiable)
        const allTorrents = await getMyTorrents(apiKey);
        const torrent = allTorrents.find(t => t.id == torrentId);
        if (torrent) {
            return torrent;
        }
        
        // Fallback: endpoint direct
        const url = `${BASE_URL}${API_PREFIX}/torrentinfo`;
        const params = { torrent_id: torrentId };
        const response = await axios.get(url, { params, headers: getHeaders(apiKey) });
        if (!response.data.success) {
            throw new Error(`Torbox: Failed to get torrent info for ID ${torrentId}. Message: ${response.data.message}`);
        }
        return response.data.data;
    } catch (error) {
        throw new Error(`Torbox: Error getting torrent ${torrentId}: ${error.message}`);
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