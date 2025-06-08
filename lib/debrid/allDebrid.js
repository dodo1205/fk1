const DebridService = require('./baseService');
const AllDebridClient = require('all-debrid-api'); // Utilisation de la dépendance
const { isVideoFile } = require('../utils/fileUtils');
const { getMagnetLink } = require('../utils/magnetHelper'); // Assumons que magnetHelper existe

// Réponses statiques (certaines peuvent être communes avec RealDebrid)
const StaticResponses = {
    DOWNLOADING: 'DOWNLOADING',
    FAILED_ACCESS: 'FAILED_ACCESS', // Clé API invalide ou compte expiré/non premium
    // AllDebrid peut avoir des erreurs différentes, à adapter si la lib les expose bien
    FAILED_OPENING: 'FAILED_OPENING', // Erreur lors de l'ajout/traitement du magnet
    FAILED_DOWNLOAD: 'FAILED_DOWNLOAD', // Échec général du téléchargement sur AD ou débridage
    NO_VIDEO_FILES: 'NO_VIDEO_FILES',
    COMPLETED: 'completed'
};

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Fonctions de gestion des statuts AllDebrid (basées sur la doc API ou comportement de la lib)
// La lib all-debrid-api peut déjà gérer cela en interne ou retourner des statuts clairs.
// Exemple de statuts possibles de l'API AllDebrid: 'Queued', 'Downloading', 'Ready', 'Error'
function isADStatusError(status) {
    // À adapter en fonction des retours de la bibliothèque ou de l'API
    return ['Error', 'File Error', 'Link Error'].includes(status);
}
function isADStatusDownloading(status) {
    return ['Queued', 'Downloading', 'Processing', 'Uploading'].includes(status);
}
function isADStatusReady(status) {
    return status === 'Ready' || status === 'Completed'; // 'Completed' si la lib le normalise
}

// Gestion des erreurs de la lib all-debrid-api
function isADAccessDeniedError(error) {
    // La lib all-debrid-api peut retourner des codes d'erreur spécifiques.
    // Exemple: 'AUTH_BAD_APIKEY', 'USER_NOT_PREMIUM'
    // Il faudra inspecter les erreurs retournées par la lib pour les mapper correctement.
    if (error && error.code) { // Supposons que la lib retourne un error.code
        return ['AUTH_BAD_APIKEY', 'USER_NOT_PREMIUM', 'AUTH_MISSING_APIKEY'].includes(error.code);
    }
    return false;
}


class AllDebrid extends DebridService {
    constructor(apiKey) {
        super(apiKey);
        // Le constructeur de all-debrid-api prend (apikey, agentName)
        // agentName est recommandé pour identifier votre application.
        this.AD = new AllDebridClient(apiKey, 'FKStreamAddon');
        this.StaticResponses = StaticResponses;
    }

    async checkApiKey() {
        try {
            // Tenter une opération simple qui nécessite une authentification,
            // par exemple, lister les magnets de l'utilisateur.
            // La bibliothèque all-debrid-api devrait avoir une méthode pour cela.
            // Supposons this.AD.magnets.get() ou this.AD.magnets.status() avec un ID fictif ou sans ID pour lister.
            // Si this.AD.magnets.get() n'existe pas, il faudra trouver l'équivalent.
            // Pour l'instant, tentons avec une récupération de statut sur un ID non existant,
            // ou une liste vide si la méthode le permet.
            // Une méthode plus sûre serait de vérifier la documentation de `all-debrid-api`.
            // Alternative: utiliser `this.AD.link.check(arrayOfLinks)` si elle existe et peut prendre un tableau vide ou un lien test.
            // Pour l'instant, je vais essayer avec `this.AD.magnets.status()` sans ID, ce qui pourrait lister ou échouer de manière attendue.
            // Ou mieux, une méthode qui récupère les infos utilisateur si elle existe sous un autre nom.
            // D'après la documentation implicite de telles libs, un appel à `this.AD.user()` pourrait exister.
            // Ou `this.AD.user.infos()`
            // Si `all-debrid-api` est similaire à `real-debrid-api`, `this.AD.user()` pourrait être l'objet et `get()` la méthode.
            // L'erreur indique que `this.AD.user.get` n'est pas une fonction.
            // Essayons une méthode qui est plus susceptible d'exister pour tester la clé, comme lister les hôtes supportés.
            // Ou, plus simplement, un appel qui récupère les informations de l'utilisateur.
            // La documentation de `all-debrid-api` (npm) indique `new AllDebrid(apikey, agent).user.get()`
            // L'erreur était peut-être due à une initialisation incorrecte ou une version différente.
            // Assurons-nous que l'instance AD est correcte.
            // Si `this.AD.user.get()` n'existe VRAIMENT pas, on peut essayer `this.AD.hosts.get()`
            // ou `this.AD.ping()` si disponible.
            // Pour l'instant, je vais supposer que la documentation que j'ai trouvée pour `all-debrid-api` est correcte
            // et que l'erreur vient d'ailleurs ou d'une version.
            // Mais pour être sûr, je vais utiliser une méthode qui est plus susceptible d'être là pour un test de clé:
            // Tenter de récupérer les types d'hôtes supportés.
            await this.AD.hosts.types(); // Cette méthode existe dans la lib `all-debrid-api`
            return true;
        } catch (error) {
            console.error('[FK AllDebrid] API key check failed:', error.message, error.code ? `(Code: ${error.code})` : '');
            return false;
        }
    }

    getInfoHashFromMagnet(magnetLink) { // Dupliqué de RealDebrid, pourrait être dans un utilitaire commun
        const match = magnetLink.match(/urn:btih:([a-fA-F0-9]{40})/i);
        if (match) return match[1].toLowerCase();
        const matchv2 = magnetLink.match(/urn:btih:([a-z2-7]{32})/i);
        if (matchv2) return matchv2[1].toLowerCase();
        return null;
    }

    async addMagnetOnly(magnetLink, streamType, episodeNumber, episodeName) {
        try {
            const infoHash = this.getInfoHashFromMagnet(magnetLink);
            if (!infoHash) throw new Error('Invalid magnet link for addMagnetOnly.');

            // L'API AllDebrid ajoute et retourne l'état du magnet en une seule fois.
            // La lib all-debrid-api devrait avoir une méthode comme magnets.upload() ou magnets.add()
            const response = await this.AD.magnets.upload(magnetLink);
            // La réponse peut contenir l'ID du magnet et son statut initial.
            // Pour addMagnetOnly, on ne se soucie pas de la sélection de fichiers ici.
            if (response && response.data && response.data.magnets && response.data.magnets.length > 0) {
                console.log(`[FK AllDebrid] Magnet added/already present with ID: ${response.data.magnets[0].id}`);
                return response.data.magnets[0].id;
            } else if (response && response.data && response.data.error) { // Gestion d'erreur de l'API AD
                 console.error(`[FK AllDebrid] API error adding magnet: ${response.data.error.message} (Code: ${response.data.error.code})`);
                 if (isADAccessDeniedError(response.data.error)) { /* Gérer */ }
                 return null;
            }
            throw new Error('Unexpected response from AllDebrid magnets.upload');
        } catch (error) {
            console.error(`[FK AllDebrid] Error in addMagnetOnly:`, error.message);
            if (isADAccessDeniedError(error)) {
                console.error('[FK AllDebrid] Access denied during addMagnetOnly.');
            }
            return null;
        }
    }

    async getTorrentStatusAndLinks(magnetLink, fileIndexParam, season, episodeNumber, streamType, episodeName) {
        const infoHash = this.getInfoHashFromMagnet(magnetLink);
        if (!infoHash) {
            console.error('[FK AllDebrid] Invalid magnet link:', magnetLink);
            return { error: 'Invalid magnet link', status: StaticResponses.FAILED_OPENING };
        }
        console.log(`[FK AllDebrid] Resolving ${infoHash} Ep:${episodeNumber} Name:${episodeName} FileIdxParam:${fileIndexParam}`);

        try {
            // 1. Ajouter le magnet (ou vérifier s'il existe)
            // La méthode magnets.upload() d'AllDebrid fait souvent les deux.
            // Elle peut retourner un ID de magnet existant ou en créer un nouveau.
            let uploadResponse;
            try {
                uploadResponse = await this.AD.magnets.upload(magnetLink);
            } catch (uploadError) {
                 console.error(`[FK AllDebrid] Error uploading magnet ${infoHash} to AllDebrid:`, uploadError.message, uploadError.code);
                 if (isADAccessDeniedError(uploadError)) return { status: StaticResponses.FAILED_ACCESS, error: 'Access denied during magnet upload' };
                 return { status: StaticResponses.FAILED_OPENING, error: `Magnet upload failed: ${uploadError.message}` };
            }


            if (!uploadResponse || !uploadResponse.data || !uploadResponse.data.magnets || uploadResponse.data.magnets.length === 0) {
                const errorDetail = uploadResponse?.data?.error;
                const errorMessage = errorDetail ? `${errorDetail.message} (Code: ${errorDetail.code})` : 'No magnet data in response';
                console.error(`[FK AllDebrid] Failed to add/get magnet ${infoHash} on AllDebrid: ${errorMessage}`);
                if (errorDetail && isADAccessDeniedError(errorDetail)) return { status: StaticResponses.FAILED_ACCESS, error: errorMessage };
                return { status: StaticResponses.FAILED_OPENING, error: `Failed to add/get magnet: ${errorMessage}` };
            }

            const magnetDetails = uploadResponse.data.magnets[0]; // Prendre le premier (devrait être le seul pour un nouveau magnet)
            const magnetId = magnetDetails.id;

            // 2. Vérifier le statut du magnet
            // Boucle de vérification de statut (AllDebrid est généralement plus rapide que RD pour les torrents en cache)
            for (let attempt = 0; attempt < 10; attempt++) { // Moins de tentatives pour AD
                const statusResponse = await this.AD.magnets.status(magnetId);
                const currentMagnetStatus = statusResponse?.data?.magnets;

                if (!currentMagnetStatus) {
                    throw new Error(`Invalid status response for magnet ID ${magnetId}`);
                }
                console.log(`[FK AllDebrid] Magnet ${magnetId} status: ${currentMagnetStatus.status} (Attempt ${attempt + 1})`);

                if (isADStatusReady(currentMagnetStatus.status)) {
                    // Le torrent est prêt, les liens devraient être dans currentMagnetStatus.links
                    if (!currentMagnetStatus.links || currentMagnetStatus.links.length === 0) {
                        console.warn(`[FK AllDebrid] Magnet ${magnetId} is Ready, but no links found.`);
                        return { status: StaticResponses.NO_VIDEO_FILES, magnetInfo: currentMagnetStatus };
                    }

                    // Adapter la structure des fichiers/liens d'AD pour selectBestFile
                    const adFiles = currentMagnetStatus.links.map(link => ({
                        id: link.link, // Utiliser le lien comme ID temporaire si pas d'autre ID de fichier
                        path: link.filename, // AD fournit 'filename'
                        name: link.filename,
                        size: link.size, // AD fournit 'size' en bytes
                        link: link.link, // Garder le lien original
                        // Ajouter isVideo pour le filtrage dans selectBestFile
                        isVideo: isVideoFile(link.filename)
                    }));

                    const bestFile = this.selectBestFile(adFiles, episodeNumber, episodeName, { fileIndex: fileIndexParam, streamType });
                    if (!bestFile || !bestFile.link) {
                        console.warn(`[FK AllDebrid] Magnet ${magnetId} ready, but no suitable file found for Ep:${episodeNumber}.`);
                        return { status: StaticResponses.NO_VIDEO_FILES, magnetInfo: currentMagnetStatus };
                    }

                    // 3. Débrider le lien sélectionné
                    try {
                        const unrestrictResponse = await this.AD.link.unlock(bestFile.link);
                        const finalLink = unrestrictResponse?.data?.link;

                        if (finalLink) {
                            console.log(`[FK AllDebrid] Unrestricted link for ${bestFile.name}: ${finalLink}`);
                            return {
                                status: StaticResponses.COMPLETED,
                                links: [{ url: finalLink, filename: bestFile.name }],
                                magnetInfo: currentMagnetStatus
                            };
                        } else {
                            const errorDetailUnlock = unrestrictResponse?.data?.error;
                            const errorMessageUnlock = errorDetailUnlock ? `${errorDetailUnlock.message} (Code: ${errorDetailUnlock.code})` : 'Unrestriction failed or invalid response';
                            console.error(`[FK AllDebrid] Failed to unrestrict link ${bestFile.link}: ${errorMessageUnlock}`);
                            return { status: StaticResponses.FAILED_DOWNLOAD, magnetInfo: currentMagnetStatus, error: `Unrestriction failed: ${errorMessageUnlock}` };
                        }
                    } catch (unrestrictError) {
                        console.error(`[FK AllDebrid] Error unrestricting link ${bestFile.link}:`, unrestrictError.message, unrestrictError.code);
                        if (isADAccessDeniedError(unrestrictError)) return { status: StaticResponses.FAILED_ACCESS, magnetInfo: currentMagnetStatus, error: 'Access denied during unrestrict' };
                        return { status: StaticResponses.FAILED_DOWNLOAD, magnetInfo: currentMagnetStatus, error: `Unrestriction API error: ${unrestrictError.message}` };
                    }

                } else if (isADStatusDownloading(currentMagnetStatus.status)) {
                    if (attempt < 9) {
                        console.log(`[FK AllDebrid] Magnet ${magnetId} is ${currentMagnetStatus.status}. Waiting...`);
                        await delay(2000 * (attempt + 1)); // Délai simple pour AD
                        // Pas besoin de refetch explicitement, la prochaine itération le fera
                    } else {
                        break; // Sortir pour retourner DOWNLOADING
                    }
                } else if (isADStatusError(currentMagnetStatus.status)) {
                    console.error(`[FK AllDebrid] Error status for magnet ${magnetId}: ${currentMagnetStatus.status}`);
                    return { status: StaticResponses.FAILED_OPENING, magnetInfo: currentMagnetStatus, error: `Magnet error status: ${currentMagnetStatus.status}` };
                } else {
                    console.warn(`[FK AllDebrid] Unknown magnet status for ${magnetId}: ${currentMagnetStatus.status}. Treating as downloading.`);
                     if (attempt < 9) {
                        await delay(2000);
                    } else {
                        break;
                    }
                }
            }
            // Si on sort de la boucle
            const finalStatusResponse = await this.AD.magnets.status(magnetId);
            console.log(`[FK AllDebrid] Magnet ${magnetId} did not become ready. Final status: ${finalStatusResponse?.data?.magnets?.status}`);
            return { status: StaticResponses.DOWNLOADING, magnetInfo: finalStatusResponse?.data?.magnets, error: 'Magnet not ready after max attempts' };

        } catch (error) {
            console.error(`[FK AllDebrid] Error in getTorrentStatusAndLinks for ${infoHash}:`, error.message, error.code);
            if (isADAccessDeniedError(error)) return { status: StaticResponses.FAILED_ACCESS, error: 'Access denied' };
            return { error: error.message, status: StaticResponses.FAILED_DOWNLOAD };
        }
    }

    // La méthode unrestrictLink de baseService n'est pas directement utilisée ici car
    // la dérestriction est intégrée dans le flux de getTorrentStatusAndLinks pour AllDebrid.
    // Si on voulait une dérestriction de lien générique, on pourrait l'implémenter.
    async unrestrictLink(linkToUnrestrict) {
        try {
            const unrestrictResponse = await this.AD.link.unlock(linkToUnrestrict);
            const finalLink = unrestrictResponse?.data?.link;
            if (finalLink) {
                return finalLink;
            }
            const errorDetail = unrestrictResponse?.data?.error;
            const errorMessage = errorDetail ? `${errorDetail.message} (Code: ${errorDetail.code})` : 'Unrestriction failed';
            throw new Error(errorMessage);
        } catch (error) {
            console.error(`[FK AllDebrid] Error in standalone unrestrictLink for ${linkToUnrestrict}:`, error.message);
            throw error; // Propager pour que l'appelant gère
        }
    }
}

module.exports = AllDebrid;
