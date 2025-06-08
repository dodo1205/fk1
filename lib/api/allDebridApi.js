const axios = require('axios');

const BASE_URL = 'https://api.alldebrid.com/v4';
const AGENT = 'FKStream';

async function checkUser(apiKey) {
    const url = `${BASE_URL}/user`;
    const response = await axios.get(url, { params: { agent: AGENT, apikey: apiKey } });
    if (response.data.status !== 'success') {
        throw new Error(response.data.error?.message || 'Failed to check user');
    }
    return response.data.data.user;
}

async function uploadMagnet(magnetLink, apiKey) {
    const url = `${BASE_URL}/magnet/upload`;
    const response = await axios.get(url, { params: { agent: AGENT, apikey: apiKey, magnets: magnetLink } });
    if (response.data.status !== 'success' || !response.data.data.magnets || response.data.data.magnets.length === 0) {
        throw new Error(response.data.error?.message || 'Failed to upload magnet');
    }
    return response.data.data.magnets[0];
}

async function getMagnetStatus(magnetId, apiKey) {
    const url = `${BASE_URL}/magnet/status`;
    const response = await axios.get(url, { params: { agent: AGENT, apikey: apiKey, id: magnetId } });
    if (response.data.status !== 'success') {
        throw new Error(response.data.error?.message || 'Failed to get magnet status');
    }
    return response.data.data.magnets;
}

async function unrestrictLink(link, apiKey) {
    const url = `${BASE_URL}/link/unlock`;
    const response = await axios.get(url, { params: { agent: AGENT, apikey: apiKey, link: link } });
    if (response.data.status !== 'success' || !response.data.data.link) {
        throw new Error(response.data.error?.message || 'Failed to unrestrict link');
    }
    return response.data.data.link;
}

module.exports = {
    checkUser,
    uploadMagnet,
    getMagnetStatus,
    unrestrictLink
};
