const axios = require('axios');
const FormData = require('form-data'); // Gardé car Torbox l'utilise pour la création

const BASE_URL = 'https://api.torbox.app/v1'; // L'URL de base semble correcte

class TorboxClient {
    constructor(apiKey) {
        if (!apiKey) {
            throw new Error('Torbox API key is required');
        }
        this.apiKey = apiKey;
        this.defaultHeaders = {
            'Authorization': `Bearer ${this.apiKey}`, // Utilisation standard de Bearer token
        };
        this.timeout = 15000; // Délai d'attente par défaut
    }

    async _request(method, endpoint, params = {}, data = null, extraHeaders = {}) {
        const url = `${BASE_URL}${endpoint}`;
        let headers = { ...this.defaultHeaders, ...extraHeaders };
        
        const config = {
            method,
            url,
            headers,
            timeout: this.timeout,
        };

        if (method.toLowerCase() === 'get' || method.toLowerCase() === 'delete') {
            config.params = params;
        } else if (data) {
            if (data instanceof FormData) {
                config.data = data;
                // axios se charge des headers Content-Type pour FormData si on ne les spécifie pas,
                // ou on peut utiliser data.getHeaders() si on veut être explicite.
                // Pour Torbox, il semble que `form.getHeaders()` était utilisé, donc on le garde.
                config.headers = { ...headers, ...data.getHeaders() };
            } else {
                // Pour les données JSON ou x-www-form-urlencoded
                config.data = new URLSearchParams(data).toString();
                config.headers['Content-Type'] = 'application/x-www-form-urlencoded';
            }
        }

        try {
            const response = await axios(config);
            // Torbox API enveloppe ses réponses dans un objet avec "success: true/false" et "data" ou "error"
            if (response.data && response.data.success === true) {
                return response.data.data; // Retourner directement le contenu de "data"
            } else if (response.data && response.data.success === false) {
                const errorData = response.data.error || { message: 'Unknown Torbox API error', code: 'UNKNOWN' };
                console.error(`[Torbox Client] API Error for ${method.toUpperCase()} ${endpoint}:`, errorData);
                const apiError = new Error(errorData.message || `Torbox API error code: ${errorData.code}`);
                apiError.code = errorData.code; // Conserver le code d'erreur de Torbox
                apiError.data = errorData;
                throw apiError;
            }
            // Si la structure de la réponse n'est pas comme attendu
            throw new Error('Unexpected response structure from Torbox API');
        } catch (error) {
            if (error.isAxiosError && error.response) { // Erreur de l'API (statut HTTP != 2xx)
                console.error(`[Torbox Client] HTTP Error ${error.response.status} for ${method.toUpperCase()} ${endpoint}:`, error.response.data);
                const apiError = new Error(error.response.data.message || error.response.data.error || `Torbox HTTP error ${error.response.status}`);
                apiError.code = error.response.data.code || error.response.status;
                apiError.status = error.response.status;
                throw apiError;
            } else if (error.isAxiosError && error.request) { // Pas de réponse
                console.error(`[Torbox Client] Network Error for ${method.toUpperCase()} ${endpoint}: No response.`, error.message);
                throw new Error(`Network error with Torbox: ${error.message}`);
            } else if (error.code) { // Erreur déjà formatée par nous (ex: success:false)
                throw error;
            }
            // Autre erreur (configuration, etc.)
            console.error(`[Torbox Client] Request Setup/Unknown Error for ${method.toUpperCase()} ${endpoint}:`, error.message);
            throw new Error(`Error with Torbox request: ${error.message}`);
        }
    }

    // Les méthodes de l'API Torbox
    torrents = {
        // Renommé de getMyTorrents pour la cohérence
        list: async (id = null, page = 1, limit = 100) => { // id est optionnel pour lister un torrent spécifique
            const params = { page, limit };
            if (id) params.id = id; // Pour getTorrentInfo
            // L'endpoint /api/torrents/mylist semble être utilisé pour lister tous et pour un ID spécifique
            return this._request('get', '/api/torrents/mylist', params);
        },
        // Renommé de createTorrent
        addMagnet: async (magnetLink) => {
            const form = new FormData();
            form.append('magnet', magnetLink);
            // La réponse de Torbox pour la création contient { success: true, data: { torrent_id: '...' } }
            const responseData = await this._request('post', '/api/torrents/createtorrent', {}, form);
            return responseData; // Devrait contenir torrent_id
        },
        // Renommé de getTorrentInfo, utilise maintenant torrents.list avec un ID
        info: async (torrentId) => {
            // Torbox utilise le même endpoint 'mylist' pour obtenir les infos d'un torrent spécifique
            // en passant son ID. La réponse est un tableau, donc on prend le premier élément.
            const torrentList = await this.torrents.list(torrentId);
            if (Array.isArray(torrentList) && torrentList.length > 0) {
                return torrentList[0]; // Retourne l'objet torrent
            } else if (Array.isArray(torrentList) && torrentList.length === 0) {
                // Si l'ID est valide mais le torrent n'existe pas/plus, Torbox peut retourner un tableau vide.
                const notFoundError = new Error(`Torrent with ID ${torrentId} not found on Torbox.`);
                notFoundError.code = 'TORRENT_NOT_FOUND'; // Code d'erreur personnalisé
                throw notFoundError;
            }
            // Si la réponse n'est pas un tableau (inattendu)
            throw new Error(`Unexpected response when fetching info for torrent ID ${torrentId}`);
        },
        // Renommé de requestDownloadLink
        getDownloadLink: async (torrentId, fileId) => {
            // Torbox utilise le token API directement dans les paramètres ici, pas dans les headers Bearer.
            // Le _request doit être adapté ou cette méthode doit faire son propre appel axios.
            // Pour l'instant, on va supposer que _request peut gérer cela si on passe null pour apiKey dans les headers.
            // Ou, plus simple, on fait l'appel directement ici.
            const url = `${BASE_URL}/api/torrents/requestdl`;
            const params = { token: this.apiKey, torrent_id: torrentId, file_id: fileId };
            try {
                const response = await axios.get(url, { params, timeout: this.timeout });
                if (response.data && response.data.success === true) {
                    return response.data.data; // Retourne l'URL du lien de téléchargement
                } else if (response.data && response.data.success === false) {
                    const errorData = response.data.error || { message: 'Unknown Torbox API error on requestdl', code: 'UNKNOWN_REQUESTDL' };
                    console.error(`[Torbox Client] API Error for requestdl:`, errorData);
                    const apiError = new Error(errorData.message);
                    apiError.code = errorData.code;
                    throw apiError;
                }
                throw new Error('Unexpected response structure from Torbox requestdl');
            } catch (error) {
                 if (error.isAxiosError && error.response) {
                    console.error(`[Torbox Client] HTTP Error ${error.response.status} for requestdl:`, error.response.data);
                    const apiError = new Error(error.response.data.message || error.response.data.error || `Torbox HTTP error ${error.response.status}`);
                    apiError.code = error.response.data.code || error.response.status;
                    throw apiError;
                } else if (error.code) { // Erreur déjà formatée
                    throw error;
                }
                console.error(`[Torbox Client] Error in requestDownloadLink:`, error.message);
                throw error;
            }
        }
    };

    // Méthode pour vérifier la clé API (similaire à checkUser)
    async checkUser() {
        // Un simple appel à la liste des torrents devrait suffire.
        // Si la clé est invalide, _request lèvera une erreur.
        await this.torrents.list(null, 1, 1); // Demande 1 torrent de la page 1
        return true; // Si aucune erreur n'est levée, la clé est valide
    }
}

module.exports = TorboxClient;
