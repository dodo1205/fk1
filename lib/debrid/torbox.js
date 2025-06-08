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
            console.log('[Torbox] Clé API semble valide (getMyTorrents a réussi).');
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
            console.log(`[Torbox] Vérification du cache pour le hash: ${hash}`);
            const response = await this.api.checkCached(hash, this.apiKey);
            if (response.success && response.data) {
                const cacheInfoForHash = response.data[hash];
                const isCached = !!cacheInfoForHash;
                console.log(`[Torbox] Cache check pour hash ${hash}: cached=${isCached}`);
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
            console.log(`[Torbox] Ajout du magnet: ${magnetLink.substring(0, 70)}...`);
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
            const torrentInfo = await this.api.getTorrentInfo(torrentId, this.apiKey);
            return torrentInfo;
        } catch (error) {
            if (error.response && error.response.status === 422) {
                console.warn(`[Torbox] Erreur 422 pour getTorrentInfo sur ${torrentId}. Le torrent est probablement en cours de traitement. On continue le polling.`);
                return { status: 'processing' };
            }
            console.error(`[Torbox] Erreur lors de la récupération des infos du torrent ${torrentId}:`, error.message);
            return null;
        }
    }
    
    async unrestrictLink(link) {
        console.log(`[Torbox] Pas de dérestriction nécessaire pour le lien: ${link}`);
        return link;
    }

    async getStreamableLinkForMagnet(magnetLink, fileIndex, season, episodeNumber, streamType, episodeName, options = {}) {
        const { pollingTimeout = 300000, pollingInterval = 5000, filename: torrentFilename } = options;
        let torrentId;

        try {
            torrentId = await this.addMagnet(magnetLink);
            if (!torrentId) {
                console.error('[Torbox] Échec de l\'ajout du magnet initial.');
                return null;
            }
            console.log(`[Torbox] Magnet ajouté, ID: ${torrentId}. Attente de la complétion...`);
            
            await new Promise(resolve => setTimeout(resolve, 3000));

            const startTime = Date.now();
            while (Date.now() - startTime < pollingTimeout) {
                const torrentInfo = await this.getTorrentInfo(torrentId);

                if (!torrentInfo) {
                    console.error(`[Torbox] Impossible de récupérer les infos du torrent ${torrentId} pendant le polling.`);
                    return null; 
                }
                
                const status = torrentInfo.status || (torrentInfo.progress === 100 ? 'completed' : 'downloading');
                console.log(`[Torbox] Statut du torrent ${torrentId}: ${status} (Progression: ${torrentInfo.progress || 0}%)`);

                if (status === 'completed' || torrentInfo.progress === 100) {
                    if (torrentInfo.files && torrentInfo.files.length > 0) {
                        console.log(`[Torbox] Torrent ${torrentId} complété avec ${torrentInfo.files.length} fichier(s).`);
                        
                        const filesForSelection = torrentInfo.files.map(f => ({
                            name: f.name,
                            path: f.name, 
                            size: f.size,
                            url: f.url,
                            ...f
                        }));

                        const bestFile = this.selectBestFile(filesForSelection, episodeNumber, episodeName, { fileIndex, streamType, service: 'torbox', torrentFilename });

                        if (!bestFile) {
                            console.error(`[Torbox] Aucun fichier pertinent trouvé pour l'épisode ${episodeNumber} dans le torrent ${torrentId}.`);
                            return null;
                        }
                        console.log(`[Torbox] Meilleur fichier sélectionné: ${bestFile.name}`);
                        
                        if (!bestFile.url) {
                            console.error(`[Torbox] Fichier sélectionné ${bestFile.name} n'a pas d'URL de streaming.`);
                            return null;
                        }
                        
                        console.log(`[Torbox] Lien de streaming obtenu pour ${bestFile.name}: ${bestFile.url}`);
                        return {
                            streamUrl: bestFile.url,
                            filename: bestFile.name
                        };
                    } else {
                        console.warn(`[Torbox] Torrent ${torrentId} marqué comme complété mais aucun fichier trouvé. Attente...`);
                    }
                } else if (status === 'error' || status === 'stalled') {
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
