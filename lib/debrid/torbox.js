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
            console.error(`[Torbox] Erreur lors de la récupération des infos du torrent ${torrentId}:`, error.message);
            return null;
        }
    }
    
    async unrestrictLink(link) {
        return link;
    }

    async getStreamableLinkForMagnet(magnetLink, fileIndex, season, episodeNumber, streamType, episodeName, options = {}) {
        const { filename: torrentFilename } = options;

        try {
            // Étape 1: Toujours ajouter le magnet pour obtenir un torrentId.
            const torrentId = await this.addMagnet(magnetLink);
            if (!torrentId) {
                throw new Error('Échec de l\'ajout du magnet et de l\'obtention d\'un torrentId.');
            }
            console.log(`[Torbox] Magnet ajouté, ID: ${torrentId}. Récupération des informations du fichier...`);
            
            // Attendre un court instant pour que l'API traite la demande.
            await new Promise(resolve => setTimeout(resolve, 3000));

            // Étape 2: Récupérer les informations du torrent UNE SEULE FOIS.
            const torrentInfo = await this.getTorrentInfo(torrentId);
            if (!torrentInfo || !torrentInfo.files || torrentInfo.files.length === 0) {
                throw new Error(`Impossible de récupérer la liste des fichiers pour le torrent ${torrentId}.`);
            }
            console.log(`[Torbox] Informations du torrent ${torrentId} récupérées avec ${torrentInfo.files.length} fichier(s).`);

            // Étape 3: Sélectionner le meilleur fichier.
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
            console.log(`[Torbox] Meilleur fichier sélectionné: ${bestFile.name} (ID: ${bestFile.id})`);
            
            // Étape 4: Demander le lien de téléchargement.
            const streamLink = await this.api.requestDownloadLink(torrentId, bestFile.id, this.apiKey);
            if (!streamLink) {
                throw new Error(`Échec de la génération du lien de téléchargement pour le fichier ${bestFile.name}.`);
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
