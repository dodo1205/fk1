const DebridService = require('./baseService');
const allDebridApi = require('../api/allDebridApi');

class AllDebrid extends DebridService {
    constructor(apiKey) {
        super(apiKey);
        this.api = allDebridApi;
    }

    async checkApiKey() {
        try {
            const user = await this.api.checkUser(this.apiKey);
            if (user && user.isPremium) {
                console.log('[AllDebrid] Clé API valide et utilisateur premium.');
                return true;
            }
            console.warn('[AllDebrid] Clé API valide mais utilisateur non premium ou statut inattendu.');
            return true; 
        } catch (error) {
            console.error('[AllDebrid] Échec de la vérification de la clé API AllDebrid:', error.message);
            return false;
        }
    }
    
    async addMagnet(magnetLink) {
        try {
            console.log(`[AllDebrid] Ajout du magnet: ${magnetLink.substring(0, 70)}...`);
            const response = await this.api.uploadMagnet([magnetLink], this.apiKey);
            if (response && response.length > 0 && response[0].id) {
                console.log(`[AllDebrid] Magnet ajouté avec succès. ID: ${response[0].id}`);
                return response[0];
            }
            console.error('[AllDebrid] Réponse inattendue de uploadMagnet:', response);
            return null;
        } catch (error) {
            console.error(`[AllDebrid] Erreur lors de l'ajout du magnet:`, error.message);
            return null;
        }
    }

    async getMagnetStatus(magnetId) {
        try {
            const statusInfo = await this.api.getMagnetStatus(magnetId, this.apiKey);
            return statusInfo;
        } catch (error) {
            console.error(`[AllDebrid] Erreur lors de la récupération du statut du magnet ${magnetId}:`, error.message);
            return null;
        }
    }
    
    async unrestrictLink(link) {
        try {
            console.log(`[AllDebrid] Dérestriction du lien: ${link}`);
            const unrestrictedLink = await this.api.unrestrictLink(link, this.apiKey);
            console.log(`[AllDebrid] Lien dérestreint avec succès: ${unrestrictedLink}`);
            return unrestrictedLink;
        } catch (error) {
            console.error(`[AllDebrid] Erreur lors de la dérestriction du lien ${link}:`, error.message);
            return null;
        }
    }

    async getStreamableLinkForMagnet(magnetLink, fileIndex, season, episodeNumber, streamType, episodeName, options = {}) {
        const { pollingTimeout = 300000, pollingInterval = 7000, filename: torrentFilename } = options;
        let magnetDetails;

        try {
            const addedMagnet = await this.addMagnet(magnetLink);
            if (!addedMagnet || !addedMagnet.id) {
                console.error('[AllDebrid] Échec de l\'ajout du magnet initial.');
                return null;
            }
            const magnetId = addedMagnet.id;
            console.log(`[AllDebrid] Magnet ajouté, ID: ${magnetId}. Attente de la complétion...`);

            const startTime = Date.now();
            while (Date.now() - startTime < pollingTimeout) {
                magnetDetails = await this.getMagnetStatus(magnetId);

                if (!magnetDetails) {
                    console.error(`[AllDebrid] Impossible de récupérer le statut du magnet ${magnetId} pendant le polling.`);
                    return null; 
                }
                
                console.log(`[AllDebrid] Statut du magnet ${magnetId}: ${magnetDetails.status}, DL: ${magnetDetails.downloaded || 0}bytes`);

                if (magnetDetails.status && (magnetDetails.status.toUpperCase() === 'READY' || magnetDetails.status.toUpperCase() === 'FINISHED') && magnetDetails.links && magnetDetails.links.length > 0) {
                    console.log(`[AllDebrid] Magnet prêt avec ${magnetDetails.links.length} fichier(s)/lien(s).`);
                    
                    const filesForSelection = magnetDetails.links.map(f => ({
                        name: f.filename,
                        path: f.filename,
                        size: f.size,
                        originalLink: f.link,
                        ...f
                    }));

                    const bestFile = this.selectBestFile(filesForSelection, episodeNumber, episodeName, { fileIndex, streamType, service: 'alldebrid', torrentFilename });

                    if (!bestFile) {
                        console.error(`[AllDebrid] Aucun fichier pertinent trouvé pour l'épisode ${episodeNumber} dans le magnet ${magnetId}.`);
                        return null;
                    }
                    console.log(`[AllDebrid] Meilleur fichier sélectionné: ${bestFile.name}`);
                    
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
                } else if (magnetDetails.status && (['error', 'too_many', 'MAGNET_FILE_UPLOAD_FAILED', 'MAGNET_INVALID_URI'].includes(magnetDetails.status.toUpperCase()) || magnetDetails.error)) {
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
