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

    async addMagnet(magnetLink) {
        try {
            console.log(`[Torbox] Ajout du magnet: ${magnetLink.substring(0, 70)}...`);
            const response = await this.api.createTorrent(magnetLink, this.apiKey);
            console.log(`[Torbox] Magnet ajouté avec succès. ID: ${response.torrent_id}`);
            return response;
        } catch (error) {
            console.error(`[Torbox] Erreur lors de l'ajout du magnet:`, error.message);
            return null;
        }
    }

    async getTorrentInfo(torrentId) {
        try {
            const torrentInfo = await this.api.getTorrentInfoById(torrentId, this.apiKey);
            return torrentInfo;
        } catch (error) {
            console.error(`[Torbox] Erreur lors de la récupération des infos du torrent ${torrentId}:`, error.message);
            return null;
        }
    }

    async unrestrictLink(link) {
        return link;
    }

    async processCompletedTorrent(torrentInfo, episodeNumber, episodeName, options) {
        const { fileIndex, streamType, torrentFilename } = options;
        
        if (torrentInfo.files && torrentInfo.files.length > 0) {
            console.log(`[Torbox] Torrent complété avec ${torrentInfo.files.length} fichier(s).`);
            
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

    async getStreamableLinkForMagnet(magnetLink, fileIndex, season, episodeNumber, streamType, episodeName, options = {}) {
        const { pollingTimeout = 300000, pollingInterval = 5000, filename: torrentFilename } = options;
        let torrentId;

        try {
            // Vérifier d'abord si le torrent existe déjà (comme stream-fusion)
            const infoHash = this.getInfoHashFromMagnet(magnetLink);
            if (infoHash) {
                console.log(`[Torbox] Recherche d'un torrent existant avec le hash: ${infoHash}`);
                const existingTorrent = await this.api.findExistingTorrent(infoHash, this.apiKey);
                if (existingTorrent) {
                    console.log(`[Torbox] Torrent existant trouvé avec l'ID: ${existingTorrent.id}`);
                    torrentId = existingTorrent.id;
                } else {
                    console.log(`[Torbox] Aucun torrent existant trouvé, ajout du magnet...`);
                    const addMagnetResponse = await this.addMagnet(magnetLink);
                    if (!addMagnetResponse || !addMagnetResponse.torrent_id) {
                        console.error('[Torbox] Échec de l\'ajout du magnet initial.');
                        return null;
                    }
                    torrentId = addMagnetResponse.torrent_id;
                    console.log(`[Torbox] Magnet ajouté, ID: ${torrentId}. Attente de la récupération des métadonnées...`);
                }
            } else {
                // Fallback à l'ancienne méthode si on ne peut pas extraire le hash
                const addMagnetResponse = await this.addMagnet(magnetLink);
                if (!addMagnetResponse || !addMagnetResponse.torrent_id) {
                    console.error('[Torbox] Échec de l\'ajout du magnet initial.');
                    return null;
                }
                torrentId = addMagnetResponse.torrent_id;
                console.log(`[Torbox] Magnet ajouté, ID: ${torrentId}. Attente de la récupération des métadonnées...`);
            }

            // Attendre que les fichiers soient disponibles (méthode stream-fusion)
            console.log(`[Torbox] Attente des fichiers du torrent ${torrentId}...`);
            const startWaitTime = Date.now();
            const metadataTimeout = 60000; // 1 minute timeout pour les métadonnées
            let torrentInfo = null;
            
            while (Date.now() - startWaitTime < metadataTimeout) {
                try {
                    torrentInfo = await this.getTorrentInfo(torrentId);
                    if (torrentInfo && torrentInfo.files && torrentInfo.files.length > 0) {
                        console.log(`[Torbox] Fichiers disponibles pour ${torrentId}. ${torrentInfo.files.length} fichier(s) trouvé(s).`);
                        break;
                    }
                } catch (error) {
                    // Ignorer l'erreur et continuer à attendre
                    console.log(`[Torbox] Torrent ${torrentId} pas encore prêt, attente 10s...`);
                }
                await new Promise(resolve => setTimeout(resolve, 10000)); // Attendre 10s comme stream-fusion
            }
            
            if (!torrentInfo || !torrentInfo.files || torrentInfo.files.length === 0) {
                console.error(`[Torbox] Impossible de récupérer la liste des fichiers pour le torrent ${torrentId} après ${metadataTimeout/1000}s.`);
                return null;
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
                console.error(`[Torbox] Aucun fichier pertinent trouvé pour l'épisode ${episodeNumber} dans le torrent ${torrentId}.`);
                return null;
            }
            console.log(`[Torbox] Meilleur fichier sélectionné: ${bestFile.name} (ID: ${bestFile.id})`);

            // Attendre que le torrent soit prêt pour le téléchargement (comme stream-fusion)
            console.log(`[Torbox] Attente du téléchargement du torrent ${torrentId}...`);
            const startTime = Date.now();
            while (Date.now() - startTime < pollingTimeout) {
                torrentInfo = await this.getTorrentInfo(torrentId);

                if (!torrentInfo) {
                    console.error(`[Torbox] Impossible de récupérer les infos du torrent ${torrentId} pendant le polling.`);
                    return null;
                }

                const status = (torrentInfo.status || 'processing').toLowerCase().trim();
                console.log(`[Torbox] Statut du torrent ${torrentId}: ${status} (Progression: ${torrentInfo.progress || 0}%)`);

                // Vérifier si le torrent est prêt - condition simplifiée comme stream-fusion
                const isReady = torrentInfo.files && torrentInfo.files.length > 0 && 
                              ['completed', 'download ready', 'cached', 'seeding'].includes(status);
                
                if (isReady) {
                    console.log(`[Torbox] Torrent ${torrentId} téléchargé avec succès.`);
                    
                    const streamLink = await this.api.requestDownloadLink(torrentId, bestFile.id, this.apiKey);
                    if (!streamLink) {
                        console.error(`[Torbox] Échec de la génération du lien de téléchargement pour le fichier ${bestFile.name}.`);
                        return null;
                    }

                    console.log(`[Torbox] Lien de streaming final obtenu pour ${bestFile.name}: ${streamLink}`);
                    
                    return {
                        streamUrl: streamLink,
                        filename: bestFile.name
                    };
                } else if (['error', 'failed'].includes(status)) {
                    console.error(`[Torbox] Erreur avec le torrent ${torrentId}. Statut: ${status}`);
                    return null;
                }
                
                await new Promise(resolve => setTimeout(resolve, pollingInterval));
            }

            console.warn(`[Torbox] Timeout dépassé pour le torrent ${torrentId} après ${pollingTimeout / 1000}s.`);
            return null;

        } catch (error) {
            console.error(`[Torbox] Erreur majeure dans getStreamableLinkForMagnet pour ${magnetLink}:`, error.message);
            if (error.stack) console.error(error.stack);
            return null;
        }
    }
}

module.exports = Torbox;