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
    
    async unrestrictLink(link) {
        return link;
    }

    async getStreamableLinkForMagnet(magnetLink, fileIndex, season, episodeNumber, streamType, episodeName, options = {}) {
        const { pollingTimeout = 300000, pollingInterval = 5000, filename: torrentFilename } = options;
        let torrentId;

        const hash = this.getInfoHashFromMagnet(magnetLink);
        if (!hash) {
            throw new Error('Impossible d\'extraire le hash du magnet.');
        }

        try {
            console.log(`[Torbox] Recherche du torrent avec le hash ${hash} dans la liste de l'utilisateur...`);
            
            // Vérifier d'abord le cache avant de chercher dans la liste
            const cacheResult = await this.checkCache(magnetLink);
            const isCached = cacheResult && cacheResult.isCached;
            console.log(`[Torbox] Statut cache pour hash ${hash}: ${isCached ? 'EN CACHE' : 'PAS EN CACHE'}`);
            
            const myTorrents = await this.api.getMyTorrents(this.apiKey);
            const existingTorrent = myTorrents.find(t => t.hash && t.hash.toLowerCase() === hash);

            if (existingTorrent) {
                torrentId = existingTorrent.id;
                console.log(`[Torbox] Torrent trouvé dans la liste de l'utilisateur. ID: ${torrentId}`);
                
                const currentStatus = (existingTorrent.status || '').toLowerCase();
                console.log(`[Torbox] Statut actuel du torrent existant: ${currentStatus} (Progression: ${existingTorrent.progress || 0}%)`);
                
                if (currentStatus === 'completed' || currentStatus === 'download ready' || currentStatus === 'cached') {
                    console.log(`[Torbox] Torrent déjà complété, traitement direct`);
                    return await this.processCompletedTorrent(existingTorrent, episodeNumber, episodeName, { fileIndex, streamType, torrentFilename });
                }
            } else if (isCached) {
                // Si en cache mais pas dans la liste, l'ajouter
                console.log('[Torbox] Torrent en cache mais non présent dans la liste. Ajout...');
                const addedTorrent = await this.api.createTorrent(magnetLink, this.apiKey);
                if (!addedTorrent || !addedTorrent.torrent_id) {
                    throw new Error('Échec de l\'ajout du torrent en cache.');
                }
                torrentId = addedTorrent.torrent_id;
                console.log(`[Torbox] Torrent en cache ajouté, ID: ${torrentId}`);
                
                // NOUVEAU: Vérifier que le torrent est bien ajouté avant de continuer
                let torrentFound = false;
                for (let attempt = 0; attempt < 5; attempt++) {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    try {
                        const updatedTorrents = await this.api.getMyTorrents(this.apiKey);
                        const foundTorrent = updatedTorrents.find(t => t.id == torrentId);
                        if (foundTorrent) {
                            console.log(`[Torbox] Torrent ${torrentId} confirmé dans la liste après ${(attempt + 1) * 3} secondes`);
                            torrentFound = true;
                            break;
                        }
                    } catch (error) {
                        console.warn(`[Torbox] Tentative ${attempt + 1} de vérification échouée:`, error.message);
                    }
                }
                
                if (!torrentFound) {
                    throw new Error(`Torrent ${torrentId} ajouté mais non trouvé dans la liste après 15 secondes`);
                }
            } else {
                console.log('[Torbox] Torrent non trouvé et pas en cache. Ajout du magnet...');
                const addedTorrent = await this.api.createTorrent(magnetLink, this.apiKey);
                if (!addedTorrent || !addedTorrent.torrent_id) {
                    throw new Error('Échec de l\'ajout du magnet initial.');
                }
                torrentId = addedTorrent.torrent_id;
                console.log(`[Torbox] Magnet ajouté, ID: ${torrentId}. Attente de la complétion...`);
                await new Promise(resolve => setTimeout(resolve, 3000));
            }

            // Boucle de polling pour attendre la complétion
            return await this.waitForCompletion(torrentId, episodeNumber, episodeName, { fileIndex, streamType, torrentFilename }, pollingTimeout, pollingInterval);

        } catch (error) {
            console.error(`[Torbox] Erreur majeure dans getStreamableLinkForMagnet:`, error.message);
            return null;
        }
    }

    async processCompletedTorrent(torrentInfo, episodeNumber, episodeName, options) {
        const { fileIndex, streamType, torrentFilename } = options;
        
        if (torrentInfo.files && torrentInfo.files.length > 0) {
            console.log(`[Torbox] Torrent complété avec ${torrentInfo.files.length} fichier(s).`);
            
            const filesForSelection = torrentInfo.files.map(f => ({ ...f, path: f.name }));
            const bestFile = this.selectBestFile(filesForSelection, episodeNumber, episodeName, { fileIndex, streamType, service: 'torbox', torrentFilename });

            if (!bestFile) {
                throw new Error(`Aucun fichier pertinent trouvé pour l'épisode ${episodeNumber}.`);
            }
            if (!bestFile.id) {
                throw new Error(`Fichier sélectionné ${bestFile.name} n'a pas d'ID.`);
            }
            
            console.log(`[Torbox] Fichier sélectionné: ${bestFile.name} (ID: ${bestFile.id})`);
            
            const streamLink = await this.api.requestDownloadLink(torrentInfo.id, bestFile.id, this.apiKey);
            if (!streamLink) {
                throw new Error(`Échec de la génération du lien de téléchargement pour le fichier ${bestFile.name}.`);
            }
            
            console.log(`[Torbox] Lien de streaming obtenu: ${streamLink}`);
            return { streamUrl: streamLink, filename: bestFile.name };
        }
        
        throw new Error('Aucun fichier trouvé dans le torrent complété');
    }

    async waitForCompletion(torrentId, episodeNumber, episodeName, options, pollingTimeout, pollingInterval) {
        const { fileIndex, streamType, torrentFilename } = options;
        const startTime = Date.now();
        
        while (Date.now() - startTime < pollingTimeout) {
            try {
                const torrentInfo = await this.api.getTorrentInfoById(torrentId, this.apiKey);

                if (torrentInfo) {
                    const status = (torrentInfo.status || '').toLowerCase();
                    console.log(`[Torbox] Statut du torrent ${torrentId}: ${status} (Progression: ${torrentInfo.progress || 0}%)`);

                    if (status === 'completed' || status === 'download ready' || status === 'cached') {
                        return await this.processCompletedTorrent(torrentInfo, episodeNumber, episodeName, { fileIndex, streamType, torrentFilename });
                    } else if (status === 'error' || status === 'stalled') {
                        throw new Error(`Erreur avec le torrent ${torrentId}. Statut: ${status}`);
                    }
                } else {
                    console.log(`[Torbox] Attente... ID: ${torrentId}, informations non disponibles.`);
                }
            } catch (error) {
                console.warn(`[Torbox] Erreur lors de la récupération des infos du torrent ${torrentId}:`, error.message);
            }
            
            await new Promise(resolve => setTimeout(resolve, pollingInterval));
        }

        throw new Error(`Timeout dépassé pour le torrent ${torrentId}.`);
    }
}

module.exports = Torbox;