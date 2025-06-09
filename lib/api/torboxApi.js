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

async function getMyTorrents(apiKey, bypassCache = false) {
    const url = `${BASE_URL}${API_PREFIX}/mylist`;
    const params = bypassCache ? { bypass_cache: 'true' } : {};
    const response = await axios.get(url, { 
        headers: getHeaders(apiKey),
        params 
    });
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
    // Utiliser la méthode exacte de stream-fusion
    const url = `${BASE_URL}${API_PREFIX}/mylist?bypass_cache=true&id=${torrentId}`;
    const response = await axios.get(url, { headers: getHeaders(apiKey) });
    
    if (!response.data.success) {
        throw new Error(`Torbox: Failed to get torrent info for ID ${torrentId}. Message: ${response.data.message}`);
    }
    
    if (response.data.data && response.data.data.length > 0) {
        return response.data.data[0];
    }
    
    // Si pas trouvé avec bypass_cache, essayer la liste normale
    const allTorrents = await getMyTorrents(apiKey);
    const torrent = allTorrents.find(t => t.id == torrentId);
    if (torrent) {
        return torrent;
    }
    
    throw new Error(`Torrent ${torrentId} not found`);
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

async function findExistingTorrent(infoHash, apiKey) {
    const torrents = await getMyTorrents(apiKey);
    if (torrents && Array.isArray(torrents)) {
        return torrents.find(torrent => 
            torrent.hash && torrent.hash.toLowerCase() === infoHash.toLowerCase()
        );
    }
    return null;
}

module.exports = {
    checkCached,
    getMyTorrents,
    createTorrent,
    getTorrentInfoByHash,
    getTorrentInfoById,
    requestDownloadLink,
    findExistingTorrent
};