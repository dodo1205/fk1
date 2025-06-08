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

    async getTorrentInfo(torrentId, retries = 3) {
        try {
            return await this.api.getTorrentInfo(torrentId, this.apiKey);
        } catch (error) {
            if (error.response && error.response.status === 422 && retries > 0) {
                console.warn(`[Torbox] Erreur 422 pour getTorrentInfo sur ${torrentId}. Nouvelle tentative dans 2s... (${retries} restantes)`);
                await new Promise(resolve => setTimeout(resolve, 2000));
                return this.getTorrentInfo(torrentId, retries - 1);
            }
            if (error.response && error.response.status === 422) {
                console.warn(`[Torbox] Erreur 422 persistante pour getTorrentInfo sur ${torrentId}. On continue le polling.`);
                return { status: 'processing' };
            }
            console.error(`[Torbox] Erreur lors de la récupération des infos du torrent ${torrentId}:`, error.message);
            return null;
        }
    }
    
    async unrestrictLink(link) {
        return link;
    }

    async getStreamableLinkForMagnet(magnetLink, fileIndex, season, episodeNumber, streamType, episodeName, options = {}) {
        const { pollingTimeout = 300000, pollingInterval = 5000, filename: torrentFilename } = options;

        try {
            const torrentId = await this.addMagnet(magnetLink);
            if (!torrentId) {
                throw new Error('Échec de l\'ajout du magnet initial.');
            }
            console.log(`[Torbox] Magnet ajouté, ID: ${torrentId}. Attente de la complétion...`);
            
            await new Promise(resolve => setTimeout(resolve, 3000));

            const startTime = Date.now();
            while (Date.now() - startTime < pollingTimeout) {
                const torrentInfo = await this.getTorrentInfo(torrentId);

                if (!torrentInfo) {
                    throw new Error(`Impossible de récupérer les infos du torrent ${torrentId}.`);
                }
                
                const status = torrentInfo.status || (torrentInfo.progress === 100 ? 'completed' : 'downloading');
                console.log(`[Torbox] Statut du torrent ${torrentId}: ${status} (Progression: ${torrentInfo.progress || 0}%)`);

                if (status === 'completed' || torrentInfo.progress === 100) {
                    if (torrentInfo.files && torrentInfo.files.length > 0) {
                        console.log(`[Torbox] Torrent ${torrentId} complété avec ${torrentInfo.files.length} fichier(s).`);
                        
                        const filesForSelection = torrentInfo.files.map(f => ({
                            id: f.id,
                            name: f.name,
                            path: f.name, 
                            size: f.size,
                            ...f
                        }));

                        const bestFile = this.selectBestFile(filesForSelection, episodeNumber, episodeName, { fileIndex, streamType, service: 'torbox', torrentFilename });

                        if (!bestFile) {
                            throw new Error(`Aucun fichier pertinent trouvé pour l'épisode ${episodeNumber}.`);
                        }
                        console.log(`[Torbox] Meilleur fichier sélectionné: ${bestFile.name}`);
                        
                        const streamLink = await this.api.requestDownloadLink(torrentId, bestFile.id, this.apiKey);
                        if (!streamLink) {
                            throw new Error(`Fichier sélectionné ${bestFile.name} n'a pas d'URL de streaming.`);
                        }
                        
                        console.log(`[Torbox] Lien de streaming obtenu: ${streamLink}`);
                        return { streamUrl: streamLink, filename: bestFile.name };
                    }
                    console.warn(`[Torbox] Torrent ${torrentId} marqué comme complété mais aucun fichier trouvé. Attente...`);
                } else if (status === 'error' || status === 'stalled') {
                    throw new Error(`Erreur avec le torrent ${torrentId}. Statut: ${status}`);
                }
                
                await new Promise(resolve => setTimeout(resolve, pollingInterval));
            }

            throw new Error(`Timeout dépassé pour le torrent ${torrentId}.`);

        } catch (error) {
            console.error(`[Torbox] Erreur majeure dans getStreamableLinkForMagnet:`, error.message);
            return null;
        }
    }
}

module.exports = Torbox;
