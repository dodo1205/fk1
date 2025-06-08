const axios = require('axios');
const FormData = require('form-data'); // Nécessaire pour envoyer des données de formulaire

const BASE_URL = 'https://api.alldebrid.com/v4';
const AGENT = 'FKStream'; // Nom de l'application

// Helper pour construire les paramètres de base pour chaque requête
function getBaseParams(apiKey) {
    return { agent: AGENT, apikey: apiKey };
}

async function checkUser(apiKey) {
    const url = `${BASE_URL}/user`;
    const params = getBaseParams(apiKey);
    const response = await axios.get(url, { params });
    if (response.data.status !== 'success') {
        throw new Error(response.data.error?.message || 'AllDebrid: Failed to check user');
    }
    return response.data.data.user;
}

/**
 * Uploade un ou plusieurs liens magnet.
 * AllDebrid API s'attend à des données de formulaire pour cet endpoint.
 * @param {string|string[]} magnetLinks - Un lien magnet ou un tableau de liens magnet.
 * @param {string} apiKey - Clé API AllDebrid.
 * @returns {Promise<Object>} Réponse de l'API.
 */
async function uploadMagnet(magnetLinks, apiKey) {
    const url = `${BASE_URL}/magnet/upload`;
    const params = getBaseParams(apiKey); // apikey et agent en query params
    
    const form = new FormData();
    const magnets = Array.isArray(magnetLinks) ? magnetLinks : [magnetLinks];
    magnets.forEach(magnet => {
        form.append('magnets[]', magnet); // API attend 'magnets[]' pour chaque magnet
    });

    const response = await axios.post(url, form, { 
        headers: form.getHeaders(), // Important pour FormData avec axios
        params // Ajoute agent et apikey à l'URL
    });

    if (response.data.status !== 'success') {
        const error = response.data.error;
        console.error('AllDebrid uploadMagnet error:', error);
        throw new Error(error?.message || `AllDebrid: Failed to upload magnet(s). Code: ${error?.code}`);
    }
    // Retourne la section 'magnets' des données, qui devrait contenir les infos sur les magnets uploadés
    return response.data.data.magnets; 
}


/**
 * Récupère le statut d'un magnet spécifique par son ID.
 * La documentation curl suggère POST, mais GET avec ID est souvent supporté aussi.
 * On garde GET pour l'instant, à ajuster si l'API l'exige.
 * Si la doc curl est stricte, il faudrait passer à POST avec FormData pour l'ID.
 * @param {number} magnetId - ID du magnet.
 * @param {string} apiKey - Clé API.
 * @returns {Promise<Object>} Statut du magnet.
 */
async function getMagnetStatus(magnetId, apiKey) {
    const url = `${BASE_URL}/magnet/status`;
    // L'API AllDebrid pour /magnet/status avec un ID spécifique
    // semble attendre l'ID comme paramètre de query, même si la doc curl montrait POST.
    // Si cela échoue, il faudra revoir pour utiliser POST avec FormData.
    const params = { ...getBaseParams(apiKey), id: magnetId };
    const response = await axios.get(url, { params });
    if (response.data.status !== 'success') {
        const error = response.data.error;
        throw new Error(error?.message || `AllDebrid: Failed to get magnet status for ID ${magnetId}. Code: ${error?.code}`);
    }
    // La réponse pour un ID spécifique est généralement un objet unique, pas un tableau.
    // S'il retourne un tableau, prendre le premier élément.
    return Array.isArray(response.data.data.magnets) ? response.data.data.magnets[0] : response.data.data.magnets;
}

/**
 * Récupère la liste des fichiers et liens pour un magnet complété.
 * @param {number} magnetId - ID du magnet.
 * @param {string} apiKey - Clé API.
 * @returns {Promise<Object>} Informations sur les fichiers du magnet.
 */
async function getMagnetFiles(magnetId, apiKey) {
    const url = `${BASE_URL}/magnet/files`; // Endpoint manquant, basé sur la doc curl
    const params = getBaseParams(apiKey);   // apikey et agent en query params

    const form = new FormData();
    form.append('id', magnetId); // L'ID du magnet

    // La doc curl utilise POST pour /magnet/files avec l'ID.
    const response = await axios.post(url, form, {
        headers: form.getHeaders(),
        params
    });

    if (response.data.status !== 'success') {
        const error = response.data.error;
        throw new Error(error?.message || `AllDebrid: Failed to get files for magnet ID ${magnetId}. Code: ${error?.code}`);
    }
    return response.data.data.magnets; // Devrait contenir les infos du magnet, y compris les fichiers/liens
}


async function unrestrictLink(link, apiKey) {
    const url = `${BASE_URL}/link/unlock`;
    const params = { ...getBaseParams(apiKey), link: link };
    const response = await axios.get(url, { params });
    if (response.data.status !== 'success' || !response.data.data.link) {
        const error = response.data.error;
        throw new Error(error?.message || `AllDebrid: Failed to unrestrict link. Code: ${error?.code}`);
    }
    return response.data.data.link; // Retourne le lien débridé directement
}

module.exports = {
    checkUser,
    uploadMagnet,
    getMagnetStatus,
    getMagnetFiles, // Ajouté
    unrestrictLink
};
