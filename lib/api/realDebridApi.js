const axios = require('axios');

const BASE_URL = 'https://api.real-debrid.com/rest/1.0';

function getHeaders(apiKey) {
    return { 'Authorization': `Bearer ${apiKey}` };
}

async function checkUser(apiKey) {
    const url = `${BASE_URL}/user`;
    const response = await axios.get(url, { headers: getHeaders(apiKey) });
    return response.data;
}

async function addMagnet(magnetLink, apiKey) {
    const url = `${BASE_URL}/torrents/addMagnet`;
    const headers = { ...getHeaders(apiKey), 'Content-Type': 'application/x-www-form-urlencoded' };
    const response = await axios.post(url, `magnet=${encodeURIComponent(magnetLink)}`, { headers });
    return response.data;
}

async function getTorrents(apiKey) {
    const url = `${BASE_URL}/torrents`;
    const response = await axios.get(url, { headers: getHeaders(apiKey) });
    return response.data;
}

async function getTorrentInfo(torrentId, apiKey) {
    const url = `${BASE_URL}/torrents/info/${torrentId}`;
    const response = await axios.get(url, { headers: getHeaders(apiKey) });
    return response.data;
}

async function selectFiles(torrentId, fileIds, apiKey) {
    const url = `${BASE_URL}/torrents/selectFiles/${torrentId}`;
    const headers = { ...getHeaders(apiKey), 'Content-Type': 'application/x-www-form-urlencoded' };
    await axios.post(url, `files=${fileIds}`, { headers });
}

async function unrestrictLink(link, apiKey) {
    const url = `${BASE_URL}/unrestrict/link`;
    const headers = { ...getHeaders(apiKey), 'Content-Type': 'application/x-www-form-urlencoded' };
    const response = await axios.post(url, `link=${encodeURIComponent(link)}`, { headers });
    return response.data;
}

module.exports = {
    checkUser,
    addMagnet,
    getTorrents,
    getTorrentInfo,
    selectFiles,
    unrestrictLink
};
