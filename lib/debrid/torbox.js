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

    async getStreamableLinkForMagnet(magnetLink, fileIndex, season, episodeNumber, streamType, episodeName, options = {}) {
        const { pollingTimeout = 300000, pollingInterval = 5000, filename: torrentFilename } = options;
        let torrentId;

        try {
            const addMagnetResponse = await this.addMagnet(magnetLink);
            if (!addMagnetResponse || !addMagnetResponse.torrent_id) {
                console.error('[Torbox] Échec de l\'ajout du magnet initial.');
                return null;
            }
            torrentId = addMagnetResponse.torrent_id;
            console.log(`[Torbox] Magnet ajouté, ID: ${torrentId}. Attente de la récupération des métadonnées...`);

            await new Promise(resolve => setTimeout(resolve, 3000));

            let torrentInfo = await this.getTorrentInfo(torrentId);
            if (!torrentInfo || !torrentInfo.files || torrentInfo.files.length === 0) {
                console.log(`[Torbox] Pas de fichiers trouvés pour ${torrentId} au premier check, nouvelle tentative dans 7s...`);
                await new Promise(resolve => setTimeout(resolve, 7000));
                torrentInfo = await this.getTorrentInfo(torrentId);
                if (!torrentInfo || !torrentInfo.files || torrentInfo.files.length === 0) {
                    console.error(`[Torbox] Impossible de récupérer la liste des fichiers pour le torrent ${torrentId} après plusieurs tentatives.`);
                    return null;
                }
            }
            console.log(`[Torbox] Infos du torrent ${torrentId} récupérées. ${torrentInfo.files.length} fichier(s) trouvé(s).`);

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

            const startTime = Date.now();
            while (Date.now() - startTime < pollingTimeout) {
                torrentInfo = await this.getTorrentInfo(torrentId);

                if (!torrentInfo) {
                    console.error(`[Torbox] Impossible de récupérer les infos du torrent ${torrentId} pendant le polling.`);
                    return null;
                }

                const status = (torrentInfo.status || 'processing').toLowerCase().trim();
                console.log(`[Torbox] Statut du torrent ${torrentId}: ${status} (Progression: ${torrentInfo.progress || 0}%)`);

                if (status === 'completed' || status === 'download ready' || status === 'cached' || status === 'seeding') {
                    console.log(`[Torbox] Torrent ${torrentId} téléchargé avec succès.`);
                    if (!torrentInfo.files || torrentInfo.files.length === 0) {
                        console.error(`[Torbox] Torrent ${torrentId} marqué comme téléchargé mais aucun fichier trouvé.`);
                        return null;
                    }

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