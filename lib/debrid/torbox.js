const DebridService = require('./baseService');
const torboxApi = require('../api/torboxApi');

class Torbox extends DebridService {
    constructor(apiKey) {
        super(apiKey);
        this.api = torboxApi;
    }

    async checkApiKey() {
        try {
            await this.api.getMyTorrents(this.apiKey);
            return true;
        } catch (error) {
            console.error('[Torbox] Échec de la vérification de la clé API Torbox:', error.message);
            return false;
        }
    }

    getInfoHashFromMagnet(magnetLink) {
        const match = magnetLink.match(/urn:btih:([a-zA-Z0-9]+)/i);
        return match ? match[1].toLowerCase() : null;
    }

    async checkCache(magnetLink) {
        const hash = this.getInfoHashFromMagnet(magnetLink);
        if (!hash) {
            console.error('[Torbox] Impossible d\'extraire le hash du magnet pour checkCache.');
            return null;
        }
        try {
            const response = await this.api.checkCached(hash, this.apiKey);
            if (response.success && response.data) {
                const cacheInfoForHash = response.data[hash];
                const isCached = !!cacheInfoForHash;
                return {
                    isCached: isCached,
                    files: isCached ? (cacheInfoForHash.files || []) : [],
                    torrentIdIfPresent: null 
                };
            }
            console.warn('[Torbox] Réponse inattendue ou échec de checkCached:', response);
            return { isCached: false, files: [] };
        } catch (error) {
            console.error(`[Torbox] Erreur lors de la vérification du cache pour hash ${hash}:`, error.message);
            return null;
        }
    }
    
    async addMagnet(magnetLink, name = null) {
        try {
            const responseData = await this.api.createTorrent(magnetLink, this.apiKey, name);
            if (responseData && responseData.torrent_id) {
                console.log(`[Torbox] Magnet ajouté avec succès. ID: ${responseData.torrent_id}`);
                return responseData.torrent_id;
            }
            console.error('[Torbox] Réponse inattendue de createTorrent:', responseData);
            return null;
        } catch (error) {
            console.error(`[Torbox] Erreur lors de l'ajout du magnet:`, error.message);
            return null;
        }
    }

    async getTorrentInfo(torrentId) {
        try {
            return await this.api.getTorrentInfo(torrentId, this.apiKey);
        } catch (error) {
            if (error.response && error.response.status === 422) {
                // Erreur attendue si le torrent n'est pas encore prêt. Le polling continue.
                console.log(`[Torbox] Torrent ${torrentId} pas encore prêt (422), le polling continue.`);
                return { status: 'processing', progress: 0 };
            }
            // Pour toute autre erreur, on arrête le processus.
            console.error(`[Torbox] Erreur critique lors de la récupération des infos du torrent ${torrentId}:`, error.message);
            return null;
        }
    }
    
    async unrestrictLink(link) {
        return link;
    }

    async getStreamableLinkForMagnet(magnetLink, fileIndex, season, episodeNumber, streamType, episodeName, options = {}) {
        const { filename: torrentFilename, isCached } = options;

        // Définition des timeouts en fonction du statut du cache
        const pollingTimeout = isCached ? 30000 : 300000; // 30 secondes si en cache, 5 minutes sinon
        const pollingInterval = 5000; // On vérifie toutes les 5 secondes
        
        const hash = this.getInfoHashFromMagnet(magnetLink);
        if (!hash) {
            throw new Error('Impossible d\'extraire le hash du magnet.');
        }

        try {
            // Étape 1: Obtenir ou ajouter le torrent à la liste de l'utilisateur
            console.log(`[Torbox] Recherche du torrent avec le hash ${hash} dans la liste de l'utilisateur...`);
            let myTorrents = await this.api.getMyTorrents(this.apiKey);
            let torrent = myTorrents.find(t => t.hash.toLowerCase() === hash);
            let torrentId;

            if (torrent) {
                torrentId = torrent.id;
                console.log(`[Torbox] Torrent trouvé dans la liste de l'utilisateur. ID: ${torrentId}`);
            } else {
                console.log('[Torbox] Torrent non trouvé dans la liste. Ajout du magnet...');
                torrentId = await this.addMagnet(magnetLink);
                if (!torrentId) {
                    throw new Error('Échec de l\'ajout du magnet initial.');
                }
            }

            // Étape 2: Attendre que le torrent soit prêt en utilisant une boucle de polling robuste
            let finalTorrentInfo = null;
            const startTime = Date.now();
            console.log(`[Torbox] Attente de la complétion pour ID: ${torrentId}. (Timeout: ${pollingTimeout / 1000}s)`);

            while (Date.now() - startTime < pollingTimeout) {
                myTorrents = await this.api.getMyTorrents(this.apiKey);
                torrent = myTorrents.find(t => t.id === torrentId);

                if (torrent && torrent.files && torrent.files.length > 0 && (torrent.download_state === 'completed' || torrent.progress === 100)) {
                    finalTorrentInfo = torrent;
                    console.log(`[Torbox] Torrent ${torrentId} prêt.`);
                    break;
                }
                if (torrent && (torrent.download_state === 'error' || torrent.download_state === 'stalled')) {
                     throw new Error(`Erreur avec le torrent ${torrentId}. Statut: ${torrent.download_state}`);
                }
                console.log(`[Torbox] Attente... Statut: ${torrent ? torrent.download_state : 'inconnu'} (Progression: ${torrent ? torrent.progress : 0}%)`);
                await new Promise(resolve => setTimeout(resolve, pollingInterval));
            }

            if (!finalTorrentInfo) {
                 throw new Error(`Timeout dépassé (${pollingTimeout / 1000}s) pour le torrent ${torrentId}.`);
            }

            // Étape 3: Sélectionner le fichier et récupérer le lien
            console.log(`[Torbox] Torrent ${torrentId} prêt avec ${finalTorrentInfo.files.length} fichier(s).`);
            const filesForSelection = finalTorrentInfo.files.map(f => ({
                id: f.id, name: f.name, path: f.name, size: f.size, ...f
            }));

            const bestFile = this.selectBestFile(filesForSelection, episodeNumber, episodeName, { fileIndex, streamType, service: 'torbox', torrentFilename });

            if (!bestFile || !bestFile.id) {
                throw new Error(`Aucun fichier pertinent trouvé pour l'épisode ${episodeNumber}.`);
            }

            const streamLink = await this.api.requestDownloadLink(torrentId, bestFile.id, this.apiKey);
            if (!streamLink) {
                throw new Error(`Fichier sélectionné ${bestFile.name} n'a pas d'URL de streaming.`);
            }

            console.log(`[Torbox] Lien de streaming obtenu: ${streamLink}`);
            return { streamUrl: streamLink, filename: bestFile.name };

        } catch (error) {
            console.error(`[Torbox] Erreur majeure dans getStreamableLinkForMagnet:`, error.message);
            return null;
        }
    }
}

module.exports = Torbox;
