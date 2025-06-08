const DebridService = require('./baseService');
const TorboxClient = require('../api/torboxApi'); // Utilisation du client API mis à jour
const { isVideoFile } = require('../utils/fileUtils');
const { getMagnetLink } = require('../utils/magnetHelper');

// Réponses statiques
const StaticResponses = {
    DOWNLOADING: 'DOWNLOADING',
    FAILED_ACCESS: 'FAILED_ACCESS', // Clé API invalide
    FAILED_OPENING: 'FAILED_OPENING', // Erreur lors de l'ajout du magnet
    FAILED_DOWNLOAD: 'FAILED_DOWNLOAD', // Échec du téléchargement sur Torbox ou de la génération du lien
    NO_VIDEO_FILES: 'NO_VIDEO_FILES',
    TORRENT_NOT_FOUND: 'TORRENT_NOT_FOUND',
    COMPLETED: 'completed'
};

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Fonctions de gestion des statuts Torbox
// L'API Torbox retourne des statuts comme: 'downloading', 'finished', 'error', 'paused', 'queued'
// 'finished' signifie que le téléchargement sur leurs serveurs est terminé.
function isTorboxStatusError(status) {
    return status === 'error';
}
function isTorboxStatusDownloading(status) {
    return ['downloading', 'queued', 'paused'].includes(status); // 'paused' est aussi un état d'attente
}
function isTorboxStatusReady(status) {
    return status === 'finished';
}

// Gestion des erreurs spécifiques de TorboxClient
function isTorboxAccessDeniedError(error) {
    // TorboxClient lèvera une erreur avec error.code si la clé est invalide (souvent un HTTP 401 ou 403)
    // ou un code d'erreur spécifique de l'API Torbox si leur wrapper le propage.
    return error && (error.status === 401 || error.status === 403 || error.code === 'INVALID_API_KEY'); // À adapter
}
function isTorboxNotFoundError(error) {
    return error && error.code === 'TORRENT_NOT_FOUND';
}


class Torbox extends DebridService {
    constructor(apiKey) {
        super(apiKey);
        this.TB = new TorboxClient(apiKey);
        this.StaticResponses = StaticResponses;
    }

    async checkApiKey() {
        try {
            await this.TB.checkUser(); // Utilise la méthode checkUser du client
            return true;
        } catch (error) {
            console.error('[FK Torbox] API key check failed:', error.message);
            return false;
        }
    }

    getInfoHashFromMagnet(magnetLink) {
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

            // Vérifier si le torrent existe déjà pour éviter les doublons si possible
            const existingTorrent = await this._findExistingTorrentByHash(infoHash);
            if (existingTorrent && existingTorrent.id) {
                console.log(`[FK Torbox] Magnet ${infoHash} already exists with ID: ${existingTorrent.id}`);
                return existingTorrent.id;
            }
            
            const response = await this.TB.torrents.addMagnet(magnetLink);
            // La réponse de addMagnet devrait contenir torrent_id
            if (response && response.torrent_id) {
                console.log(`[FK Torbox] Magnet added with ID: ${response.torrent_id}`);
                return response.torrent_id;
            }
            throw new Error('Unexpected response from Torbox addMagnet');
        } catch (error) {
            console.error(`[FK Torbox] Error in addMagnetOnly:`, error.message, error.code);
            if (isTorboxAccessDeniedError(error)) {
                console.error('[FK Torbox] Access denied during addMagnetOnly.');
            }
            return null;
        }
    }

    async getTorrentStatusAndLinks(magnetLink, fileIndexParam, season, episodeNumber, streamType, episodeName) {
        const infoHash = this.getInfoHashFromMagnet(magnetLink);
        if (!infoHash) {
            console.error('[FK Torbox] Invalid magnet link:', magnetLink);
            return { error: 'Invalid magnet link', status: StaticResponses.FAILED_OPENING };
        }
        console.log(`[FK Torbox] Resolving ${infoHash} Ep:${episodeNumber} Name:${episodeName} FileIdxParam:${fileIndexParam}`);

        try {
            let torrentOnTorbox = await this._findExistingTorrentByHash(infoHash);
            let torrentId;

            if (torrentOnTorbox && torrentOnTorbox.id) {
                torrentId = torrentOnTorbox.id;
                console.log(`[FK Torbox] Found existing torrent ID: ${torrentId} for hash ${infoHash}`);
            } else {
                console.log(`[FK Torbox] No existing torrent for hash ${infoHash}. Adding new one.`);
                const magnet = await getMagnetLink(infoHash);
                if (!magnet) throw new Error(`Could not generate magnet link for ${infoHash}`);
                const addResponse = await this.TB.torrents.addMagnet(magnet);
                if (!addResponse || !addResponse.torrent_id) {
                     throw new Error('Failed to add magnet to Torbox or missing torrent_id in response.');
                }
                torrentId = addResponse.torrent_id;
                console.log(`[FK Torbox] Added new torrent ID: ${torrentId}. Fetching info.`);
                await delay(2000); // Petit délai pour que Torbox traite
                torrentOnTorbox = await this.TB.torrents.info(torrentId);
            }
            
            if (!torrentOnTorbox || !torrentOnTorbox.id) { // Vérification après ajout ou recherche
                console.error(`[FK Torbox] Could not find or add torrent ${infoHash} on Torbox.`);
                return { status: StaticResponses.TORRENT_NOT_FOUND, error: 'Torrent could not be added or found on Torbox' };
            }

            // Boucle de vérification de statut
            for (let attempt = 0; attempt < 15; attempt++) { // Torbox est généralement rapide
                // Mettre à jour les informations du torrent à chaque tentative
                try {
                    torrentOnTorbox = await this.TB.torrents.info(torrentId);
                } catch (infoError) {
                    if (isTorboxNotFoundError(infoError)) { // Si le torrent disparaît après avoir été ajouté
                        console.error(`[FK Torbox] Torrent ${torrentId} disappeared from Torbox.`);
                        return { status: StaticResponses.TORRENT_NOT_FOUND, error: `Torrent ${torrentId} not found after initial add/find.` };
                    }
                    throw infoError; // Propager d'autres erreurs d'info
                }

                if (!torrentOnTorbox || !torrentOnTorbox.status) {
                    throw new Error(`Invalid torrent info for ID ${torrentId} from Torbox.`);
                }
                console.log(`[FK Torbox] Torrent ${torrentId} status: ${torrentOnTorbox.status} (Attempt ${attempt + 1})`);

                if (isTorboxStatusReady(torrentOnTorbox.status)) {
                    if (!torrentOnTorbox.files || torrentOnTorbox.files.length === 0) {
                        console.warn(`[FK Torbox] Torrent ${torrentId} is Ready, but no files listed.`);
                        return { status: StaticResponses.NO_VIDEO_FILES, torrentInfo: torrentOnTorbox };
                    }

                    // Adapter la structure des fichiers Torbox pour selectBestFile
                    // Torbox files: { id, name, size, dl_link (parfois présent, mais préférer requestdl) }
                    const tbFiles = torrentOnTorbox.files.map(file => ({
                        id: file.id, // ID du fichier Torbox
                        path: file.name,
                        name: file.name,
                        size: parseInt(file.size, 10), // Assurer que size est un nombre
                        isVideo: isVideoFile(file.name)
                    }));

                    const bestFile = this.selectBestFile(tbFiles, episodeNumber, episodeName, { fileIndex: fileIndexParam, streamType });
                    if (!bestFile || !bestFile.id) {
                        console.warn(`[FK Torbox] Torrent ${torrentId} ready, but no suitable file found for Ep:${episodeNumber}.`);
                        return { status: StaticResponses.NO_VIDEO_FILES, torrentInfo: torrentOnTorbox };
                    }

                    // Demander le lien de téléchargement pour le fichier sélectionné
                    try {
                        const downloadUrl = await this.TB.torrents.getDownloadLink(torrentId, bestFile.id);
                        if (downloadUrl) { // Torbox retourne directement l'URL
                            console.log(`[FK Torbox] Download link for ${bestFile.name}: ${downloadUrl}`);
                            return {
                                status: StaticResponses.COMPLETED,
                                links: [{ url: downloadUrl, filename: bestFile.name }],
                                torrentInfo: torrentOnTorbox
                            };
                        } else {
                            console.error(`[FK Torbox] Failed to get download link for file ${bestFile.id} in torrent ${torrentId}.`);
                            return { status: StaticResponses.FAILED_DOWNLOAD, torrentInfo: torrentOnTorbox, error: 'Failed to retrieve download link' };
                        }
                    } catch (linkError) {
                        console.error(`[FK Torbox] Error requesting download link for file ${bestFile.id}:`, linkError.message, linkError.code);
                        return { status: StaticResponses.FAILED_DOWNLOAD, torrentInfo: torrentOnTorbox, error: `Download link request error: ${linkError.message}` };
                    }

                } else if (isTorboxStatusDownloading(torrentOnTorbox.status)) {
                     if (attempt < 14) {
                        console.log(`[FK Torbox] Torrent ${torrentId} is ${torrentOnTorbox.status}. Waiting...`);
                        await delay(2500 * (attempt / 4 + 1)); // Délai progressif
                    } else {
                        break; 
                    }
                } else if (isTorboxStatusError(torrentOnTorbox.status)) {
                    console.error(`[FK Torbox] Error status for torrent ${torrentId}: ${torrentOnTorbox.status}`);
                    return { status: StaticResponses.FAILED_OPENING, torrentInfo: torrentOnTorbox, error: `Torrent error status: ${torrentOnTorbox.status}` };
                } else {
                    console.warn(`[FK Torbox] Unknown status for ${torrentId}: ${torrentOnTorbox.status}. Treating as downloading.`);
                     if (attempt < 14) {
                        await delay(2500);
                    } else {
                        break;
                    }
                }
            }
            // Si on sort de la boucle
            console.log(`[FK Torbox] Torrent ${torrentId} did not become ready. Final status: ${torrentOnTorbox?.status}`);
            return { status: StaticResponses.DOWNLOADING, torrentInfo: torrentOnTorbox, error: 'Torrent not ready after max attempts' };

        } catch (error) {
            console.error(`[FK Torbox] Error in getTorrentStatusAndLinks for ${infoHash}:`, error.message, error.code);
            if (isTorboxAccessDeniedError(error)) return { status: StaticResponses.FAILED_ACCESS, error: 'Access denied' };
            if (isTorboxNotFoundError(error)) return { status: StaticResponses.TORRENT_NOT_FOUND, error: error.message };
            return { error: error.message, status: StaticResponses.FAILED_DOWNLOAD };
        }
    }
    
    async _findExistingTorrentByHash(infoHash) {
        try {
            const torrents = await this.TB.torrents.list(); // Liste tous les torrents
            if (Array.isArray(torrents)) {
                // L'API Torbox ne semble pas retourner l'infohash directement dans la liste /mylist.
                // On ne peut donc pas directement faire correspondre par infohash ici sans plus d'infos.
                // Si Torbox a un endpoint pour chercher par infohash, ce serait mieux.
                // Pour l'instant, cette fonction ne sera pas très utile sans infohash dans la liste.
                // Alternative: si on stocke l'ID Torbox après un ajout, on peut le réutiliser.
                // Mais pour une première recherche, c'est difficile.
                // On va supposer pour l'instant que l'on ajoute toujours, sauf si on a un ID Torbox stocké ailleurs.
                // Ou alors, on compare par nom, mais c'est peu fiable.
                // console.warn("[FK Torbox] _findExistingTorrentByHash cannot reliably find by hash with current Torbox API list structure.");
                return null; // Retourner null pour forcer l'ajout pour l'instant
            }
            return null;
        } catch (error) {
            console.warn(`[FK Torbox] Error listing torrents to find existing for ${infoHash}:`, error.message);
            return null;
        }
    }

    // Pas de méthode unrestrictLink séparée car Torbox génère le lien direct via getDownloadLink.
}

module.exports = Torbox;
