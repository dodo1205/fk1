const DebridService = require('./baseService');
const realDebridApi = require('../api/realDebridApi');
const { getFileExtension, isVideoFile } = require('../utils/fileUtils'); // Conservé si selectBestFile en a besoin indirectement

class RealDebrid extends DebridService {
    constructor(apiKey) {
        super(apiKey);
        this.api = realDebridApi; // Pour un accès plus direct aux fonctions de l'API wrapper
    }

    /**
     * Vérifie si la clé API est valide.
     * @returns {Promise<boolean>}
     */
    async checkApiKey() {
        try {
            // L'appel à /user renvoie les infos utilisateur si la clé est valide, sinon une erreur.
            await this.api.checkUser(this.apiKey);
            console.log('[RealDebrid] Clé API valide.');
            return true;
        } catch (error) {
            console.error('[RealDebrid] Échec de la vérification de la clé API Real-Debrid:', error.message);
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
     * Ajoute un lien magnet à Real-Debrid.
     * C'est la première étape de la Phase 2 après le clic utilisateur.
     * @param {string} magnetLink - Le lien magnet à ajouter.
     * @returns {Promise<Object|null>} L'objet de réponse de l'API (contenant id et uri) ou null en cas d'erreur.
     */
    async addMagnet(magnetLink) {
        try {
            console.log(`[RealDebrid] Ajout du magnet: ${magnetLink.substring(0, 70)}...`);
            const response = await this.api.addMagnet(magnetLink, this.apiKey);
            console.log(`[RealDebrid] Magnet ajouté avec succès. ID: ${response.id}`);
            return response; // Contient { id, uri, ... }
        } catch (error) {
            console.error(`[RealDebrid] Erreur lors de l'ajout du magnet:`, error.message);
            // Gérer les erreurs spécifiques de l'API RD si nécessaire
            // Par exemple, si l'erreur est due à un magnet invalide, etc.
            if (error.response && error.response.data && error.response.data.error_code) {
                // error_code 20: Magnet invalide
                // error_code 21: Magnet déjà présent
            }
            return null;
        }
    }

    /**
     * Récupère les informations détaillées d'un torrent.
     * @param {string} torrentId - L'ID du torrent sur Real-Debrid.
     * @returns {Promise<Object|null>} Les informations du torrent ou null en cas d'erreur.
     */
    async getTorrentInfo(torrentId) {
        try {
            // console.log(`[RealDebrid] Récupération des infos pour le torrent ID: ${torrentId}`);
            const torrentInfo = await this.api.getTorrentInfo(torrentId, this.apiKey);
            return torrentInfo;
        } catch (error) {
            console.error(`[RealDebrid] Erreur lors de la récupération des infos du torrent ${torrentId}:`, error.message);
            return null;
        }
    }

    /**
     * Sélectionne les fichiers à télécharger pour un torrent donné.
     * @param {string} torrentId - L'ID du torrent.
     * @param {string} fileIds - Chaîne des IDs de fichiers à sélectionner (ex: "1,2,3" ou "all").
     * @returns {Promise<boolean>} true si succès, false sinon.
     */
    async selectFiles(torrentId, fileIds) {
        try {
            console.log(`[RealDebrid] Sélection des fichiers "${fileIds}" pour le torrent ID: ${torrentId}`);
            await this.api.selectFiles(torrentId, fileIds, this.apiKey);
            console.log(`[RealDebrid] Fichiers sélectionnés avec succès pour le torrent ID: ${torrentId}`);
            return true;
        } catch (error) {
            console.error(`[RealDebrid] Erreur lors de la sélection des fichiers pour ${torrentId}:`, error.message);
            return false;
        }
    }
    
    /**
     * Dérestreint un lien d'hébergeur via Real-Debrid.
     * @param {string} link - Le lien à dérestreindre.
     * @returns {Promise<Object|null>} L'objet de réponse de l'API (contenant le lien débridé) ou null.
     */
    async unrestrictLink(link) {
        try {
            console.log(`[RealDebrid] Dérestriction du lien: ${link}`);
            const response = await this.api.unrestrictLink(link, this.apiKey);
            // La réponse contient typiquement { id, filename, filesize, link (le lien débridé), host, ... }
            // ou { download (le lien débridé), ... } selon les versions/endpoints
            console.log(`[RealDebrid] Lien dérestreint avec succès: ${response.download || response.link}`);
            return response;
        } catch (error) {
            console.error(`[RealDebrid] Erreur lors de la dérestriction du lien ${link}:`, error.message);
            return null;
        }
    }

    /**
     * Processus complet de la Phase 2:
     * Ajoute un magnet (si pas déjà fait), sélectionne le fichier, attend la complétion, et retourne le lien streamable.
     * Cette méthode est appelée APRÈS que l'utilisateur a cliqué sur un lien dans Stremio.
     *
     * @param {string} magnetLink - Le lien magnet du torrent.
     * @param {number|null} fileIndex - Index du fichier spécifique (si connu, peut être null).
     * @param {string|null} season - Numéro de saison (pour séries).
     * @param {number} episodeNumber - Numéro d'épisode (pour séries).
     * @param {string} streamType - Type de contenu ('series', 'movie').
     * @param {string|null} episodeName - Nom de l'épisode (optionnel).
     * @param {Object} options - Options supplémentaires.
     * @param {number} options.pollingTimeout - Timeout total pour le polling en ms (défaut 5 minutes).
     * @param {number} options.pollingInterval - Intervalle entre les checks de statut en ms (défaut 5 secondes).
     * @returns {Promise<Object|null>} Un objet { streamUrl, filename } ou null en cas d'échec.
     */
    async getStreamableLinkForMagnet(magnetLink, fileIndex, season, episodeNumber, streamType, episodeName, options = {}) {
        const { pollingTimeout = 300000, pollingInterval = 5000 } = options;
        let torrentId;

        try {
            // Étape 1: Ajouter le magnet à Real-Debrid
            // (Cette étape est déclenchée par le clic utilisateur)
            const addMagnetResponse = await this.addMagnet(magnetLink);
            if (!addMagnetResponse || !addMagnetResponse.id) {
                console.error('[RealDebrid] Échec de l\'ajout du magnet initial.');
                return null;
            }
            torrentId = addMagnetResponse.id;
            console.log(`[RealDebrid] Magnet ajouté, ID: ${torrentId}. Attente de la récupération des métadonnées...`);

            // Attente courte pour laisser RD traiter le magnet et récupérer les métadonnées/fichiers
            await new Promise(resolve => setTimeout(resolve, 3000)); // Attendre 3 secondes

            // Étape 2: Récupérer les informations du torrent pour lister les fichiers
            let torrentInfo = await this.getTorrentInfo(torrentId);
            if (!torrentInfo || !torrentInfo.files || torrentInfo.files.length === 0) {
                 // Si pas de fichiers après un premier check, attendre un peu plus longtemps
                console.log(`[RealDebrid] Pas de fichiers trouvés pour ${torrentId} au premier check, nouvelle tentative dans 7s...`);
                await new Promise(resolve => setTimeout(resolve, 7000));
                torrentInfo = await this.getTorrentInfo(torrentId);
                if (!torrentInfo || !torrentInfo.files || torrentInfo.files.length === 0) {
                    console.error(`[RealDebrid] Impossible de récupérer la liste des fichiers pour le torrent ${torrentId} après plusieurs tentatives.`);
                    // TODO: Potentiellement supprimer le torrent ici si on ne peut pas continuer ?
                    // await this.api.deleteTorrent(torrentId, this.apiKey); (nécessiterait d'ajouter deleteTorrent à realDebridApi.js)
                    return null;
                }
            }
            console.log(`[RealDebrid] Infos du torrent ${torrentId} récupérées. ${torrentInfo.files.length} fichier(s) trouvé(s).`);

            // Étape 3: Sélectionner le meilleur fichier
            // Les fichiers dans torrentInfo.files ont { id, path, bytes, selected }
            // Il faut adapter cela si selectBestFile attend un format différent (ex: name, size)
            const filesForSelection = torrentInfo.files.map(f => ({
                id: f.id,
                name: f.path, // Utiliser path comme nom
                path: f.path,
                size: f.bytes,
                // Conserver l'objet original au cas où
                ...f 
            }));

            const bestFile = this.selectBestFile(filesForSelection, episodeNumber, episodeName, { fileIndex, streamType, service: 'realdebrid' });
            
            if (!bestFile) {
                console.error(`[RealDebrid] Aucun fichier pertinent trouvé pour l'épisode ${episodeNumber} dans le torrent ${torrentId}.`);
                return null;
            }
            console.log(`[RealDebrid] Meilleur fichier sélectionné: ${bestFile.name} (ID: ${bestFile.id})`);

            // Étape 4: Dire à Real-Debrid de télécharger ce fichier (ou ces fichiers)
            // L'API attend une chaîne d'IDs séparés par des virgules, ou "all".
            // Comme selectBestFile retourne un seul fichier, on envoie son ID.
            const selectionSuccess = await this.selectFiles(torrentId, bestFile.id.toString());
            if (!selectionSuccess) {
                console.error(`[RealDebrid] Échec de la sélection du fichier ${bestFile.id} pour le torrent ${torrentId}.`);
                return null;
            }
            console.log(`[RealDebrid] Sélection du fichier ${bestFile.id} pour ${torrentId} envoyée.`);

            // Étape 5: Attendre que le fichier soit téléchargé par Real-Debrid (Polling)
            const startTime = Date.now();
            while (Date.now() - startTime < pollingTimeout) {
                torrentInfo = await this.getTorrentInfo(torrentId);

                if (!torrentInfo) {
                    console.error(`[RealDebrid] Impossible de récupérer les infos du torrent ${torrentId} pendant le polling.`);
                    return null; // Erreur critique
                }

                // Statuts de Real-Debrid:
                // "magnet_error", "magnet_conversion", "waiting_files_selection",
                // "queued", "downloading", "downloaded", "error", "virus",
                // "compressing", "uploading"
                const status = torrentInfo.status;
                console.log(`[RealDebrid] Statut du torrent ${torrentId}: ${status} (Progression: ${torrentInfo.progress || 0}%)`);

                if (status === 'downloaded') {
                    console.log(`[RealDebrid] Torrent ${torrentId} téléchargé avec succès.`);
                    if (!torrentInfo.links || torrentInfo.links.length === 0) {
                        console.error(`[RealDebrid] Torrent ${torrentId} marqué comme téléchargé mais aucun lien trouvé.`);
                        return null;
                    }
                    // Real-Debrid fournit des liens directs dans torrentInfo.links après 'downloaded'.
                    // Ces liens sont déjà "débridés" pour les serveurs de RD.
                    // Il faut trouver le lien correspondant au fichier que nous avons sélectionné.
                    // Le nom du fichier dans `bestFile.name` (qui est `f.path`) doit correspondre.
                    // Les liens dans `torrentInfo.links` sont des URLs complètes.
                    
                    // On cherche un lien qui FINIT par le nom/path du fichier sélectionné.
                    // Ceci est une heuristique, car RD ne lie pas explicitement un lien à un ID de fichier dans cette structure.
                    const selectedFilePath = bestFile.path; // ou bestFile.name
                    let streamLink = torrentInfo.links.find(link => {
                        try {
                            // Décoder l'URL et le path pour une comparaison plus robuste
                            const decodedLinkPath = decodeURIComponent(new URL(link).pathname.split('/').pop());
                            const decodedSelectedFilePath = decodeURIComponent(selectedFilePath.split('/').pop());
                            return decodedLinkPath === decodedSelectedFilePath;
                        } catch (e) {
                            // Si l'URL est malformée ou le path, comparer directement
                            return link.includes(selectedFilePath.split('/').pop());
                        }
                    });

                    if (!streamLink && torrentInfo.links.length === 1) {
                        // S'il n'y a qu'un seul lien et qu'on n'a pas trouvé de correspondance exacte,
                        // on prend ce lien par défaut, surtout si on a sélectionné un seul fichier.
                        console.log(`[RealDebrid] Correspondance de lien non trouvée, mais un seul lien disponible. Utilisation de: ${torrentInfo.links[0]}`);
                        streamLink = torrentInfo.links[0];
                    } else if (!streamLink) {
                         console.warn(`[RealDebrid] Impossible de trouver un lien correspondant à "${selectedFilePath}" dans les liens disponibles:`, torrentInfo.links);
                         // Fallback: prendre le premier lien si plusieurs et pas de match ? Ou erreur ?
                         // Pour l'instant, considérer comme une erreur si pas de match clair et plusieurs liens.
                         if (torrentInfo.links.length > 0) {
                            console.warn(`[RealDebrid] Utilisation du premier lien par défaut: ${torrentInfo.links[0]}`);
                            streamLink = torrentInfo.links[0]; // Moins idéal
                         } else {
                            console.error(`[RealDebrid] Aucun lien disponible après téléchargement pour ${torrentId}.`);
                            return null;
                         }
                    }
                    
                    console.log(`[RealDebrid] Lien de streaming obtenu pour ${bestFile.name}: ${streamLink}`);
                    return {
                        streamUrl: streamLink,
                        filename: bestFile.name // ou bestFile.path
                    };
                } else if (['error', 'magnet_error', 'virus'].includes(status)) {
                    console.error(`[RealDebrid] Erreur avec le torrent ${torrentId}. Statut: ${status}`);
                    return null;
                }
                // Continuer le polling pour les autres statuts (downloading, queued, etc.)
                await new Promise(resolve => setTimeout(resolve, pollingInterval));
            }

            console.warn(`[RealDebrid] Timeout dépassé pour le torrent ${torrentId} après ${pollingTimeout / 1000}s.`);
            return null;

        } catch (error) {
            console.error(`[RealDebrid] Erreur majeure dans getStreamableLinkForMagnet pour ${magnetLink}:`, error.message);
            if (error.stack) console.error(error.stack);
            return null;
        }
    }
}

module.exports = RealDebrid;
