const axios = require('axios');
const FormData = require('form-data');

const BASE_URL = 'https://api.torbox.app/v1';

function getHeaders(apiKey) {
    return { 'Authorization': `Bearer ${apiKey}` };
}

async function getMyTorrents(apiKey) {
    const url = `${BASE_URL}/api/torrents/mylist`;
    try {
        const response = await axios.get(url, { headers: getHeaders(apiKey) });
        if (!response.data.success) {
            throw new Error(response.data.error || 'Failed to get torrent list from Torbox');
        }
        return response.data.data || [];
    } catch (error) {
        console.error('[TorboxAPI] Error fetching torrent list:', error.message);
        throw error;
    }
}

async function createTorrent(magnetLink, apiKey) {
    const url = `${BASE_URL}/api/torrents/createtorrent`;
    const form = new FormData();
    form.append('magnet', magnetLink);
    
    const headers = { ...getHeaders(apiKey), ...form.getHeaders() };
    try {
        const response = await axios.post(url, form, { headers });

        if (!response.data.success || !response.data.data || !response.data.data.torrent_id) {
            throw new Error(response.data.error || 'Failed to create torrent on Torbox');
        }
        return response.data.data.torrent_id;
    } catch (error) {
        console.error('[TorboxAPI] Error creating torrent:', error.message);
        throw error;
    }
}

async function getTorrentInfo(torrentId, apiKey) {
    // This endpoint might return an array, but the service layer expects a single object.
    // If Torbox's /api/torrents/torrentinfo is more suitable, consider switching.
    // For now, assuming /mylist?id= correctly provides the specific torrent object needed.
    const url = `${BASE_URL}/api/torrents/mylist`;
    const params = { id: torrentId, bypass_cache: true };
    try {
        const response = await axios.get(url, { params, headers: getHeaders(apiKey) });
        if (!response.data.success || !response.data.data) {
            // If data is an empty array for a specific ID, it might mean not found or error
            throw new Error(response.data.error || 'Failed to get torrent info from Torbox or torrent not found');
        }
        // Assuming response.data.data is the torrent object when 'id' is specified.
        // If it's an array, further filtering might be needed: response.data.data.find(t => t.id === torrentId)
        return response.data.data; 
    } catch (error) {
        console.error(`[TorboxAPI] Error fetching torrent info for ID ${torrentId}:`, error.message);
        throw error;
    }
}

async function requestDownloadLink(torrentId, fileId, apiKey) {
    const url = `${BASE_URL}/api/torrents/requestdl`;
    // Removed redundant 'token' from params as Authorization header is used.
    const params = { torrent_id: torrentId, file_id: fileId }; 
    try {
        const response = await axios.get(url, { params, headers: getHeaders(apiKey) });

        if (!response.data.success || !response.data.data || typeof response.data.data !== 'string') {
            throw new Error(response.data.error || 'Failed to generate download link or link is invalid from Torbox');
        }
        
        const downloadLink = response.data.data;
        if (!downloadLink.startsWith('http://') && !downloadLink.startsWith('https://')) {
            throw new Error('Download link from Torbox is not a valid URL');
        }

        // Optional: Verify if the link is a direct video stream
        try {
            const headResponse = await axios.head(downloadLink, { timeout: 5000 }); // 5s timeout
            const contentType = headResponse.headers['content-type'];
            if (!contentType || (!contentType.startsWith('video/') && contentType !== 'application/octet-stream')) {
                console.warn(`[TorboxAPI] Link for torrent ${torrentId}, file ${fileId} might not be a direct video stream. Content-Type: ${contentType}`);
                // Depending on strictness, you might throw an error here or just warn.
                // For now, we'll allow it but log a warning.
            }
        } catch (headError) {
            console.warn(`[TorboxAPI] Failed to verify content type of download link for torrent ${torrentId}, file ${fileId} with HEAD request: ${headError.message}. Proceeding with the link.`);
            // Proceeding as the link might still be valid even if HEAD request fails (e.g., server doesn't support HEAD well)
        }

        return downloadLink;
    } catch (error) {
        console.error(`[TorboxAPI] Error requesting download link for torrent ${torrentId}, file ${fileId}:`, error.message);
        throw error;
    }
}

module.exports = {
    getMyTorrents,
    createTorrent,
    getTorrentInfo,
    requestDownloadLink
};
