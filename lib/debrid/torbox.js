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
        const pollingTimeout = isCached ? 30000 : 300000; // 30s si cache, 5min sinon
        const pollingInterval = 5000; // 5s
        
        const hash = this.getInfoHashFromMagnet(magnetLink);
        if (!hash) throw new Error('Impossible d\'extraire le hash du magnet.');

        try {
            // Étape 1: Chercher ou ajouter le torrent
            let torrent = (await this.api.getMyTorrents(this.apiKey)).find(t => t.hash.toLowerCase() === hash);
            if (!torrent) {
                console.log('[Torbox] Torrent non trouvé, ajout du magnet...');
                const newTorrentId = await this.addMagnet(magnetLink);
                if (!newTorrentId) throw new Error('Échec de l\'ajout du magnet.');
                // On donne un petit temps à l'API pour l'assimiler
                await new Promise(resolve => setTimeout(resolve, 2000));
                torrent = { id: newTorrentId }; // On continue avec l'ID
            }
            console.log(`[Torbox] Utilisation du torrent ID: ${torrent.id}`);

            // Étape 2: Boucle d'attente unifiée
            const startTime = Date.now();
            let finalTorrentInfo = null;

            while (Date.now() - startTime < pollingTimeout) {
                const currentInfo = (await this.api.getMyTorrents(this.apiKey)).find(t => t.id === torrent.id);

                if (currentInfo) {
                    const { download_state, files, progress } = currentInfo;
                    console.log(`[Torbox] Attente... ID: ${torrent.id}, Statut: ${download_state}, Progression: ${progress}%`);

                    // Condition de succès: le torrent est prêt ET contient des fichiers
                    if (files && files.length > 0 && (download_state === 'completed' || download_state === 'cached')) {
                        finalTorrentInfo = currentInfo;
                        console.log(`[Torbox] Torrent prêt. Statut: ${download_state}`);
                        break;
                    }
                    // Condition d'échec
                    if (download_state === 'error' || download_state === 'stalled') {
                        throw new Error(`Erreur avec le torrent ${torrent.id}. Statut: ${download_state}`);
                    }
                }
                await new Promise(resolve => setTimeout(resolve, pollingInterval));
            }

            if (!finalTorrentInfo) {
                throw new Error(`Timeout dépassé (${pollingTimeout / 1000}s) pour le torrent ${torrent.id}.`);
            }

            // Étape 3: Sélection et récupération du lien
            const filesForSelection = finalTorrentInfo.files.map(f => ({ ...f, path: f.name }));
            const bestFile = this.selectBestFile(filesForSelection, episodeNumber, episodeName, { fileIndex, streamType, service: 'torbox', torrentFilename });
            if (!bestFile || !bestFile.id) {
                throw new Error(`Aucun fichier pertinent trouvé pour l'épisode ${episodeNumber}.`);
            }

            const streamLink = await this.api.requestDownloadLink(finalTorrentInfo.id, bestFile.id, this.apiKey);
            if (!streamLink) {
                throw new Error(`Impossible de générer le lien pour le fichier ${bestFile.name}.`);
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
