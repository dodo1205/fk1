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
            return user && user.isPremium;
        } catch (error) {
            console.error('[AllDebrid] Échec de la vérification de la clé API:', error.message);
            return false;
        }
    }
    
    async addMagnet(magnetLink) {
        try {
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
            return await this.api.getMagnetStatus(magnetId, this.apiKey);
        } catch (error) {
            console.error(`[AllDebrid] Erreur lors de la récupération du statut du magnet ${magnetId}:`, error.message);
            return null;
        }
    }
    
    async unrestrictLink(link) {
        try {
            return await this.api.unrestrictLink(link, this.apiKey);
        } catch (error) {
            console.error(`[AllDebrid] Erreur lors de la dérestriction du lien ${link}:`, error.message);
            return null;
        }
    }

    async getStreamableLinkForMagnet(magnetLink, fileIndex, season, episodeNumber, streamType, episodeName, options = {}) {
        const { pollingTimeout = 300000, pollingInterval = 7000, filename: torrentFilename } = options;

        try {
            const addedMagnet = await this.addMagnet(magnetLink);
            if (!addedMagnet || !addedMagnet.id) {
                throw new Error('Échec de l\'ajout du magnet initial.');
            }
            const magnetId = addedMagnet.id;
            console.log(`[AllDebrid] Magnet ajouté, ID: ${magnetId}. Attente de la complétion...`);

            const startTime = Date.now();
            while (Date.now() - startTime < pollingTimeout) {
                const magnetDetails = await this.getMagnetStatus(magnetId);

                if (!magnetDetails) {
                    console.error(`[AllDebrid] Impossible de récupérer le statut du magnet ${magnetId}. Arrêt du polling.`);
                    return null; 
                }
                
                console.log(`[AllDebrid] Statut du magnet ${magnetId}: ${magnetDetails.status}`);

                const status = (magnetDetails.status || '').toUpperCase();
                if ((status === 'READY' || status === 'FINISHED') && magnetDetails.links && magnetDetails.links.length > 0) {
                    console.log(`[AllDebrid] Magnet prêt avec ${magnetDetails.links.length} fichier(s).`);
                    
                    const filesForSelection = magnetDetails.links.map(f => ({
                        name: f.filename,
                        path: f.filename,
                        size: f.size,
                        originalLink: f.link,
                        ...f
                    }));

                    const bestFile = this.selectBestFile(filesForSelection, episodeNumber, episodeName, { fileIndex, streamType, service: 'alldebrid', torrentFilename });

                    if (!bestFile) {
                        throw new Error(`Aucun fichier pertinent trouvé pour l'épisode ${episodeNumber}.`);
                    }
                    console.log(`[AllDebrid] Meilleur fichier sélectionné: ${bestFile.name}`);
                    
                    const streamLink = await this.unrestrictLink(bestFile.originalLink);
                    if (!streamLink) {
                        throw new Error(`Échec de la dérestriction du lien pour ${bestFile.name}`);
                    }
                    
                    console.log(`[AllDebrid] Lien de streaming obtenu: ${streamLink}`);
                    return { streamUrl: streamLink, filename: bestFile.name };
                }

                if (['ERROR', 'TOO_MANY', 'MAGNET_FILE_UPLOAD_FAILED', 'MAGNET_INVALID_URI'].includes(status) || magnetDetails.error) {
                    throw new Error(`Erreur avec le magnet ${magnetId}. Statut: ${magnetDetails.status || magnetDetails.error}`);
                }
                
                await new Promise(resolve => setTimeout(resolve, pollingInterval));
            }

            throw new Error(`Timeout dépassé pour le magnet ${magnetId}.`);

        } catch (error) {
            console.error(`[AllDebrid] Erreur majeure dans getStreamableLinkForMagnet:`, error.message);
            return null;
        }
    }
}

module.exports = AllDebrid;
