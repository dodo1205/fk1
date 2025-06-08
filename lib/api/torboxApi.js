const axios = require('axios');
const FormData = require('form-data');

const BASE_URL = 'https://api.torbox.app/v1';

function getHeaders(apiKey) {
    return { 'Authorization': `Bearer ${apiKey}` };
}

async function getMyTorrents(apiKey) {
    const url = `${BASE_URL}/api/torrents/mylist`;
    const response = await axios.get(url, { headers: getHeaders(apiKey) });
    if (!response.data.success) {
        throw new Error('Failed to get torrent list from Torbox');
    }
    return response.data.data || [];
}

async function createTorrent(magnetLink, apiKey) {
    const url = `${BASE_URL}/api/torrents/createtorrent`;
    const form = new FormData();
    form.append('magnet', magnetLink);
    
    const headers = { ...getHeaders(apiKey), ...form.getHeaders() };
    const response = await axios.post(url, form, { headers });

    if (!response.data.success || !response.data.data.torrent_id) {
        throw new Error('Failed to create torrent on Torbox');
    }
    return response.data.data.torrent_id;
}

async function getTorrentInfo(torrentId, apiKey) {
    const url = `${BASE_URL}/api/torrents/torrentinfo`;
    const params = { id: torrentId, bypass_cache: true };
    const response = await axios.get(url, { params, headers: getHeaders(apiKey) });
    if (!response.data.success) {
        throw new Error('Failed to get torrent info from Torbox');
    }
    return response.data.data;
}

async function requestDownloadLink(torrentId, fileId, apiKey) {
    const url = `${BASE_URL}/api/torrents/requestdl`;
    const params = { token: apiKey, torrent_id: torrentId, file_id: fileId };
    const response = await axios.get(url, { params, headers: getHeaders(apiKey) });
    if (!response.data.success) {
        throw new Error('Failed to generate download link from Torbox');
    }
    return response.data.data;
}

async function checkCached(infoHashes, apiKey) {
    const url = `${BASE_URL}/api/torrents/checkcached`;
    const response = await axios.post(url, { hashes: infoHashes }, { headers: getHeaders(apiKey) });
    if (!response.data.success) {
        throw new Error('Failed to check cached torrents on Torbox');
    }
    return response.data.data;
}

module.exports = {
    getMyTorrents,
    createTorrent,
    getTorrentInfo,
    requestDownloadLink,
    checkCached
};
