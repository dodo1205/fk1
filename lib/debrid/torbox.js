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

    async getTorrentInfo(identifier, isHash = false) {
        try {
            return await this.api.getTorrentInfo(identifier, this.apiKey, isHash);
        } catch (error) {
            console.error(`[Torbox] Erreur lors de la récupération des infos du torrent ${identifier}:`, error.message);
            return null;
        }
    }
    
    async unrestrictLink(link) {
        return link;
    }

    async getStreamableLinkForMagnet(magnetLink, fileIndex, season, episodeNumber, streamType, episodeName, options = {}) {
        const { pollingTimeout = 300000, pollingInterval = 5000, isCached = false, filename: torrentFilename } = options;

        const hash = this.getInfoHashFromMagnet(magnetLink);
        if (!hash) {
            throw new Error('Impossible d\'extraire le hash du magnet.');
        }

        try {
            if (isCached) {
                console.log('[Torbox] Le lien est marqué comme EN CACHE. Récupération des infos du torrent via son hash...');
                const torrentInfo = await this.getTorrentInfo(hash, true);
                if (!torrentInfo || !torrentInfo.files || torrentInfo.files.length === 0) {
                    throw new Error('Le torrent est en cache mais getTorrentInfo n\'a retourné aucun fichier.');
                }

                const filesForSelection = torrentInfo.files.map(f => ({
                    id: f.id,
                    name: f.name,
                    path: f.name, 
                    size: f.size,
                    ...f
                }));

                const bestFile = this.selectBestFile(filesForSelection, episodeNumber, episodeName, { fileIndex, streamType, service: 'torbox', torrentFilename });

                if (!bestFile) {
                    throw new Error(`Aucun fichier pertinent trouvé pour l'épisode ${episodeNumber} dans le torrent en cache.`);
                }
                if (!bestFile.id) {
                    throw new Error(`Fichier sélectionné ${bestFile.name} n'a pas d'ID.`);
                }
                
                const streamLink = await this.api.requestDownloadLink(torrentInfo.id, bestFile.id, this.apiKey);
                if (!streamLink) {
                    throw new Error(`Échec de la génération du lien de téléchargement pour le fichier ${bestFile.name}.`);
                }
                
                console.log(`[Torbox] Lien de streaming direct obtenu du cache: ${streamLink}`);
                return { streamUrl: streamLink, filename: bestFile.name };
            }

            console.log('[Torbox] Le lien n\'est pas en cache. Lancement du processus de téléchargement...');
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
                    await new Promise(resolve => setTimeout(resolve, pollingInterval));
                    continue;
                }
                
                const status = (torrentInfo.status || '').toLowerCase();
                console.log(`[Torbox] Statut du torrent ${torrentId}: ${status} (Progression: ${torrentInfo.progress || 0}%)`);

                if (status === 'completed' || status === 'download ready' || status === 'cached') {
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
                        if (!bestFile.id) {
                            throw new Error(`Fichier sélectionné ${bestFile.name} n'a pas d'ID.`);
                        }
                        
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
