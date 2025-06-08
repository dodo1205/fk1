const DebridService = require('./baseService');
const allDebridApi = require('../api/allDebridApi');
// const { getFileExtension, isVideoFile } = require('../utils/fileUtils'); // Si nécessaire pour selectBestFile

class AllDebrid extends DebridService {
    constructor(apiKey) {
        super(apiKey);
        this.api = allDebridApi;
    }

    /**
     * Vérifie si la clé API est valide.
     * @returns {Promise<boolean>}
     */
    async checkApiKey() {
        try {
            const user = await this.api.checkUser(this.apiKey);
            if (user && user.isPremium) { // Vérifier si l'utilisateur est premium peut être une bonne indication
                console.log('[AllDebrid] Clé API valide et utilisateur premium.');
                return true;
            }
            console.warn('[AllDebrid] Clé API valide mais utilisateur non premium ou statut inattendu.');
            // Selon la politique, on pourrait retourner false si non premium est requis.
            // Pour l'instant, on considère la clé valide si l'appel réussit.
            return true; 
        } catch (error) {
            console.error('[AllDebrid] Échec de la vérification de la clé API AllDebrid:', error.message);
            return false;
        }
    }
    
    /**
     * Ajoute un lien magnet à AllDebrid.
     * @param {string} magnetLink - Le lien magnet à ajouter.
     * @returns {Promise<Object|null>} L'objet du premier magnet retourné par l'API (contenant id) ou null.
     */
    async addMagnet(magnetLink) {
        try {
            console.log(`[AllDebrid] Ajout du magnet: ${magnetLink.substring(0, 70)}...`);
            // uploadMagnet attend un tableau, mais on envoie un seul magnet ici.
            const response = await this.api.uploadMagnet([magnetLink], this.apiKey);
            // La réponse est un tableau de magnets. On prend le premier.
            if (response && response.length > 0 && response[0].id) {
                console.log(`[AllDebrid] Magnet ajouté avec succès. ID: ${response[0].id}`);
                return response[0]; // Retourne le premier magnet de la réponse {id, name, hash, ready, ...}
            }
            console.error('[AllDebrid] Réponse inattendue de uploadMagnet:', response);
            return null;
        } catch (error) {
            console.error(`[AllDebrid] Erreur lors de l'ajout du magnet:`, error.message);
            return null;
        }
    }

    /**
     * Récupère le statut d'un magnet.
     * @param {number} magnetId - L'ID du magnet sur AllDebrid.
     * @returns {Promise<Object|null>} Les informations de statut du magnet ou null.
     */
    async getMagnetStatus(magnetId) {
        try {
            // console.log(`[AllDebrid] Récupération statut pour magnet ID: ${magnetId}`);
            const statusInfo = await this.api.getMagnetStatus(magnetId, this.apiKey);
            return statusInfo; // { id, filename, size, status, downloaded, uploaded, seeders, links: [] si prêt ... }
        } catch (error) {
            console.error(`[AllDebrid] Erreur lors de la récupération du statut du magnet ${magnetId}:`, error.message);
            return null;
        }
    }

    /**
     * Récupère les fichiers d'un magnet (quand il est prêt).
     * @param {number} magnetId - L'ID du magnet.
     * @returns {Promise<Object|null>} Les détails du magnet incluant la liste des fichiers.
     */
    async getMagnetFiles(magnetId) {
        try {
            console.log(`[AllDebrid] Récupération des fichiers pour magnet ID: ${magnetId}`);
            const filesInfo = await this.api.getMagnetFiles(magnetId, this.apiKey);
            // La structure exacte de filesInfo doit être vérifiée, 
            // elle devrait contenir une liste de fichiers avec leurs noms, tailles, et liens internes.
            return filesInfo; // Devrait être similaire à la réponse de getMagnetStatus mais avec plus de détails sur les fichiers.
        } catch (error) {
            console.error(`[AllDebrid] Erreur lors de la récupération des fichiers du magnet ${magnetId}:`, error.message);
            return null;
        }
    }
    
    /**
     * Dérestreint un lien via AllDebrid.
     * @param {string} link - Le lien à dérestreindre.
     * @returns {Promise<string|null>} Le lien débridé ou null.
     */
    async unrestrictLink(link) {
        try {
            console.log(`[AllDebrid] Dérestriction du lien: ${link}`);
            // L'API unrestrictLink de allDebridApi.js retourne directement le lien débridé (string).
            const unrestrictedLink = await this.api.unrestrictLink(link, this.apiKey);
            console.log(`[AllDebrid] Lien dérestreint avec succès: ${unrestrictedLink}`);
            return unrestrictedLink;
        } catch (error) {
            console.error(`[AllDebrid] Erreur lors de la dérestriction du lien ${link}:`, error.message);
            return null;
        }
    }

    /**
     * Processus complet de la Phase 2 pour AllDebrid.
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
        const { pollingTimeout = 300000, pollingInterval = 7000, filename: torrentFilename } = options; // AllDebrid peut être plus lent à lister les fichiers
        let magnetDetails;

        try {
            // Étape 1: Ajouter le magnet
            const addedMagnet = await this.addMagnet(magnetLink);
            if (!addedMagnet || !addedMagnet.id) {
                console.error('[AllDebrid] Échec de l\'ajout du magnet initial.');
                return null;
            }
            const magnetId = addedMagnet.id;
            console.log(`[AllDebrid] Magnet ajouté, ID: ${magnetId}. Attente de la complétion...`);

            // Étape 2: Attendre que le magnet soit prêt (Polling sur le statut)
            const startTime = Date.now();
            while (Date.now() - startTime < pollingTimeout) {
                magnetDetails = await this.getMagnetStatus(magnetId);

                if (!magnetDetails) {
                    console.error(`[AllDebrid] Impossible de récupérer le statut du magnet ${magnetId} pendant le polling.`);
                    return null; 
                }
                
                // Les statuts AllDebrid peuvent être: 'downloading', 'seeding', 'finished', 'error', 'queued', 'too_many'
                // 'READY' ou 'COMPLETED' sont souvent utilisés aussi, ou 'finished'.
                // La doc API dit: "status": "READY" quand c'est bon.
                // "links" est un tableau de fichiers { filename, link, size }
                console.log(`[AllDebrid] Statut du magnet ${magnetId}: ${magnetDetails.status}, DL: ${magnetDetails.downloaded || 0}bytes`);

                // La condition de succès est que le statut soit 'READY' ou 'finished'.
                // Utilisation de toUpperCase() pour éviter les problèmes de casse ('Ready' vs 'READY')
                if (magnetDetails.status && (magnetDetails.status.toUpperCase() === 'READY' || magnetDetails.status.toUpperCase() === 'FINISHED')) {
                    console.log(`[AllDebrid] Magnet ${magnetId} est prêt. Récupération de la liste des fichiers...`);
                    
                    // Étape 3: Appeler getMagnetFiles pour obtenir les liens
                    const filesDetails = await this.getMagnetFiles(magnetId);
                    if (filesDetails && filesDetails.links && filesDetails.links.length > 0) {
                        console.log(`[AllDebrid] Fichiers récupérés pour magnet ${magnetId}. ${filesDetails.links.length} lien(s) trouvé(s).`);
                        
                        // Étape 4: Sélectionner le meilleur fichier
                        const filesForSelection = filesDetails.links.map(f => ({
                            name: f.filename,
                            path: f.filename, // Utiliser filename comme path pour la sélection
                            size: f.size,
                            originalLink: f.link, // Conserver le lien interne AD
                            ...f
                        }));

                        const bestFile = this.selectBestFile(filesForSelection, episodeNumber, episodeName, { fileIndex, streamType, service: 'alldebrid', torrentFilename });

                        if (!bestFile) {
                            console.error(`[AllDebrid] Aucun fichier pertinent trouvé pour l'épisode ${episodeNumber} dans le magnet ${magnetId}.`);
                            return null;
                        }
                        console.log(`[AllDebrid] Meilleur fichier sélectionné: ${bestFile.name}`);
                        
                        // Étape 5: Dérestreindre le lien du meilleur fichier
                        const streamLink = await this.unrestrictLink(bestFile.originalLink);
                        if (!streamLink) {
                            console.error(`[AllDebrid] Échec de la dérestriction du lien pour ${bestFile.name}`);
                            return null;
                        }
                        
                        console.log(`[AllDebrid] Lien de streaming obtenu pour ${bestFile.name}: ${streamLink}`);
                        return {
                            streamUrl: streamLink,
                            filename: bestFile.name
                        };
                    } else {
                        console.warn(`[AllDebrid] Magnet ${magnetId} marqué comme READY mais getMagnetFiles n'a retourné aucun lien. Attente...`);
                    }
                } else if (magnetDetails.status && (['error', 'too_many', 'MAGNET_FILE_UPLOAD_FAILED', 'MAGNET_INVALID_URI'].includes(magnetDetails.status) || magnetDetails.error)) {
                    console.error(`[AllDebrid] Erreur avec le magnet ${magnetId}. Statut/Erreur: ${magnetDetails.status || magnetDetails.error}`);
                    return null;
                }
                
                await new Promise(resolve => setTimeout(resolve, pollingInterval));
            }

            console.warn(`[AllDebrid] Timeout dépassé pour le magnet ${magnetId} après ${pollingTimeout / 1000}s.`);
            return null;

        } catch (error) {
            console.error(`[AllDebrid] Erreur majeure dans getStreamableLinkForMagnet pour ${magnetLink}:`, error.message);
            if (error.stack) console.error(error.stack);
            return null;
        }
    }
}

module.exports = AllDebrid;
