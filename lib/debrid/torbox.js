const DebridService = require('./baseService');
const torboxApi = require('../api/torboxApi');
// const { getFileExtension, isVideoFile } = require('../utils/fileUtils');

class Torbox extends DebridService {
    constructor(apiKey) {
        super(apiKey);
        this.api = torboxApi;
    }

    /**
     * Vérifie si la clé API est valide.
     * Torbox n'a pas d'endpoint /user. On peut tenter un appel léger.
     * @returns {Promise<boolean>}
     */
    async checkApiKey() {
        try {
            // Tenter de lister les torrents avec une limite de 0 ou 1 pour vérifier la clé.
            await this.api.getMyTorrents(this.apiKey); // getMyTorrents gère déjà les erreurs
            console.log('[Torbox] Clé API semble valide (getMyTorrents a réussi).');
            return true;
        } catch (error) {
            console.error('[Torbox] Échec de la vérification de la clé API Torbox:', error.message);
            return false;
        }
    }

    /**
     * Extrait l'infohash d'un lien magnet.
     * @param {string} magnetLink - Le lien magnet.
     * @returns {string|null} L'infohash ou null.
     */
    getInfoHashFromMagnet(magnetLink) {
        const match = magnetLink.match(/urn:btih:([a-zA-Z0-9]+)/i);
        return match ? match[1].toLowerCase() : null;
    }

    /**
     * Vérifie si un torrent est en cache sur Torbox (Phase 1).
     * @param {string} magnetLink - Le lien magnet.
     * @returns {Promise<Object|null>} { isCached: boolean, files: [], torrentIdIfPresent: string|null } ou null en cas d'erreur.
     */
    async checkCache(magnetLink) {
        const hash = this.getInfoHashFromMagnet(magnetLink);
        if (!hash) {
            console.error('[Torbox] Impossible d\'extraire le hash du magnet pour checkCache.');
            return null;
        }
        try {
            console.log(`[Torbox] Vérification du cache pour le hash: ${hash}`);
            const response = await this.api.checkCached(hash, this.apiKey);
            // La réponse attendue de l'API (selon la doc) pour checkCached:
            // { success: true, data: { cached: true/false, files: [...], torrent_id: "si existe déjà dans mylist" } }
            if (response.success && response.data && typeof response.data.data.cached !== 'undefined') {
                console.log(`[Torbox] Cache check pour hash ${hash}: cached=${response.data.data.cached}`);
                return {
                    isCached: response.data.data.cached || false,
                    files: response.data.data.files || [],
                    torrentIdIfPresent: response.data.data.torrent_id || null
                };
            }
            // Gérer le cas où response.data.data pourrait ne pas exister ou ne pas avoir la propriété cached
            // même si response.success est true (selon la robustesse de l'API)
            console.warn('[Torbox] Réponse inattendue ou structure de données incorrecte de checkCached:', response);
            return { isCached: false, files: [] }; // Par défaut, considérer non cachée en cas de réponse anormale
        } catch (error) {
            console.error(`[Torbox] Erreur lors de la vérification du cache pour hash ${hash}:`, error.message);
            return null;
        }
    }
    
    /**
     * Ajoute un lien magnet à Torbox.
     * @param {string} magnetLink - Le lien magnet à ajouter.
     * @param {string|null} name - Nom optionnel pour le torrent.
     * @returns {Promise<string|null>} L'ID du torrent créé ou null.
     */
    async addMagnet(magnetLink, name = null) {
        try {
            console.log(`[Torbox] Ajout du magnet: ${magnetLink.substring(0, 70)}...`);
            // Utiliser createTorrent (synchrone selon la doc pour l'ID immédiat)
            const responseData = await this.api.createTorrent(magnetLink, this.apiKey, name);
            // createTorrent dans torboxApi.js retourne response.data.data
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

    /**
     * Récupère les informations détaillées d'un torrent.
     * @param {string} torrentId - L'ID du torrent sur Torbox.
     * @returns {Promise<Object|null>} Les informations du torrent ou null.
     */
    async getTorrentInfo(torrentId) {
        try {
            // console.log(`[Torbox] Récupération des infos pour le torrent ID: ${torrentId}`);
            const torrentInfo = await this.api.getTorrentInfo(torrentId, this.apiKey);
            // La réponse attendue de /torrentinfo est { success: true, data: { id, name, files: [...], status, progress, ... } }
            return torrentInfo; // On retourne directement la section data si success est géré dans l'API
        } catch (error) {
            console.error(`[Torbox] Erreur lors de la récupération des infos du torrent ${torrentId}:`, error.message);
            return null;
        }
    }
    
    /**
     * Torbox fournit des liens directs, donc pas de dérestriction nécessaire.
     * @param {string} link - Le lien (sera retourné tel quel).
     * @returns {Promise<string>} Le lien inchangé.
     */
    async unrestrictLink(link) {
        console.log(`[Torbox] Pas de dérestriction nécessaire pour le lien: ${link}`);
        return link; // Retourne le lien tel quel
    }

    /**
     * Processus complet de la Phase 2 pour Torbox.
     * @param {string} magnetLink - Le lien magnet.
     * @param {number|null} fileIndex - Index du fichier (optionnel).
     * @param {string|null} season - Numéro de saison.
     * @param {number} episodeNumber - Numéro d'épisode.
     * @param {string} streamType - Type de stream.
     * @param {string|null} episodeName - Nom de l'épisode.
     * @param {Object} options - Options de polling.
     * @returns {Promise<Object|null>} { streamUrl, filename } ou null.
     */
    async getStreamableLinkForMagnet(magnetLink, fileIndex, season, episodeNumber, streamType, episodeName, options = {}) {
        const { pollingTimeout = 300000, pollingInterval = 5000 } = options;
        let torrentId;

        try {
            // Étape 0 (Optionnelle mais bonne pratique pour Torbox): Vérifier si le torrent est déjà dans la liste de l'utilisateur via checkCache
            // Si checkCache retourne un torrentIdIfPresent, on peut l'utiliser directement.
            const cacheInfoForPhase2 = await this.checkCache(magnetLink);
            if (cacheInfoForPhase2 && cacheInfoForPhase2.torrentIdIfPresent) {
                torrentId = cacheInfoForPhase2.torrentIdIfPresent;
                console.log(`[Torbox] Torrent déjà présent dans la liste de l'utilisateur (via checkCache). ID: ${torrentId}`);
            } else {
                // Étape 1: Ajouter le magnet à Torbox si non trouvé
                torrentId = await this.addMagnet(magnetLink);
                if (!torrentId) {
                    console.error('[Torbox] Échec de l\'ajout du magnet initial.');
                    return null;
                }
                console.log(`[Torbox] Magnet ajouté, ID: ${torrentId}. Attente de la complétion...`);
            }

            // Étape 2: Attendre que le magnet soit prêt (Polling sur le statut)
            const startTime = Date.now();
            while (Date.now() - startTime < pollingTimeout) {
                const torrentInfo = await this.getTorrentInfo(torrentId);

                if (!torrentInfo) {
                    console.error(`[Torbox] Impossible de récupérer les infos du torrent ${torrentId} pendant le polling.`);
                    return null; 
                }
                
                // Les statuts Torbox (à confirmer depuis la réponse réelle de /torrentinfo):
                // Ex: "downloading", "completed", "error", "paused"
                // Le champ "progress" (0-100) est aussi un bon indicateur.
                // Les fichiers sont dans torrentInfo.files [{ name, size, url (lien direct) }]
                const status = torrentInfo.status || (torrentInfo.progress === 100 ? 'completed' : 'downloading');
                console.log(`[Torbox] Statut du torrent ${torrentId}: ${status} (Progression: ${torrentInfo.progress || 0}%)`);

                if (status === 'completed' || torrentInfo.progress === 100) {
                    if (torrentInfo.files && torrentInfo.files.length > 0) {
                        console.log(`[Torbox] Torrent ${torrentId} complété avec ${torrentInfo.files.length} fichier(s).`);
                        
                        // Étape 3: Sélectionner le meilleur fichier
                        // Structure d'un fichier Torbox: { name, size, url (lien direct) }
                        const filesForSelection = torrentInfo.files.map(f => ({
                            name: f.name,
                            path: f.name, 
                            size: f.size,
                            url: f.url, // Lien direct
                            ...f
                        }));

                        const bestFile = this.selectBestFile(filesForSelection, episodeNumber, episodeName, { fileIndex, streamType, service: 'torbox' });

                        if (!bestFile) {
                            console.error(`[Torbox] Aucun fichier pertinent trouvé pour l'épisode ${episodeNumber} dans le torrent ${torrentId}.`);
                            return null;
                        }
                        console.log(`[Torbox] Meilleur fichier sélectionné: ${bestFile.name}`);
                        
                        // Étape 4: Torbox fournit des liens directs, pas besoin de dérestriction.
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
                } else if (status === 'error' || status === 'stalled') { // Ajouter d'autres statuts d'erreur si connus
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
