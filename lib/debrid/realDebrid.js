const DebridService = require('./baseService');
const RealDebridClient = require('real-debrid-api'); // Utilisation de la dépendance
const { isVideoFile } = require('../utils/fileUtils');
const { getMagnetLink } = require('../utils/magnetHelper'); // Assumons que magnetHelper existe ou sera créé

// Constantes inspirées de Torrentio
const MIN_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const POLL_DELAY_MS = 3000; // Délai entre les vérifications de statut
const MAX_POLL_ATTEMPTS = 20; // Nombre maximum de tentatives de vérification

// Réponses statiques pour communiquer l'état (similaire à Torrentio)
const StaticResponses = {
    DOWNLOADING: 'DOWNLOADING',
    FAILED_ACCESS: 'FAILED_ACCESS',
    FAILED_INFRINGEMENT: 'FAILED_INFRINGEMENT',
    LIMITS_EXCEEDED: 'LIMITS_EXCEEDED',
    FAILED_TOO_BIG: 'FAILED_TOO_BIG',
    FAILED_OPENING: 'FAILED_OPENING',
    FAILED_RAR: 'FAILED_RAR',
    FAILED_DOWNLOAD: 'FAILED_DOWNLOAD',
    TORRENT_NOT_FOUND: 'TORRENT_NOT_FOUND',
    NO_VIDEO_FILES: 'NO_VIDEO_FILES',
    COMPLETED: 'completed'
};

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Fonctions de gestion des statuts RD (de Torrentio)
function statusError(status) {
    return ['error', 'magnet_error', 'virus', 'dead'].includes(status);
}
function statusMagnetError(status) {
    return status === 'magnet_error';
}
function statusOpening(status) {
    return status === 'magnet_conversion';
}
function statusWaitingSelection(status) {
    return status === 'waiting_files_selection';
}
function statusDownloading(status) {
    return ['downloading', 'uploading', 'queued', 'compressing'].includes(status);
}
function statusReady(status) {
    return status === 'downloaded';
}

// Fonctions de gestion des erreurs API RD (de Torrentio)
function isAccessDeniedError(error) {
    return error && [8, 9, 20].includes(error.code); // La lib real-debrid-api propage error.code
}
function isInfringingFileError(error) {
    return error && [35].includes(error.code);
}
// Pourrait être étendu avec isLimitExceededError, isTorrentTooBigError si la lib les gère bien

class RealDebrid extends DebridService {
    constructor(apiKey) {
        super(apiKey);
        this.RD = new RealDebridClient(apiKey); // Initialisation du client RD
        this.StaticResponses = StaticResponses;
    }

    async checkApiKey() {
        try {
            await this.RD.user.get();
            return true;
        } catch (error) {
            console.error('[FK RealDebrid] API key check failed:', error.message);
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

    async addMagnetOnly(magnetLink, streamType, episodeNumber, episodeName) { // streamType, etc. pour la sélection
        try {
            const infoHash = this.getInfoHashFromMagnet(magnetLink);
            if (!infoHash) throw new Error('Invalid magnet link for addMagnetOnly.');

            const addedMagnet = await this.RD.torrents.addMagnet(magnetLink);
            const torrentId = addedMagnet.id;

            if (torrentId && episodeNumber) {
                console.log(`[FK RealDebrid] Non-blocking file selection for torrent ${torrentId}, ep ${episodeNumber}`);
                this._selectFilesLogic(torrentId, episodeNumber, episodeName, streamType, null, true)
                    .catch(err => console.warn(`[FK RealDebrid] Non-blocking file selection failed: ${err.message}`));
            }
            return torrentId;
        } catch (error) {
            console.error(`[FK RealDebrid] Error in addMagnetOnly:`, error.message, error.code);
            if (isAccessDeniedError(error)) {
                console.error('[FK RealDebrid] Access denied during addMagnetOnly.');
            }
            return null;
        }
    }

    async getTorrentStatusAndLinks(magnetLink, fileIndexParam, season, episodeNumber, streamType, episodeName) {
        const infoHash = this.getInfoHashFromMagnet(magnetLink);
        if (!infoHash) {
            console.error('[FK RealDebrid] Invalid magnet link:', magnetLink);
            return { error: 'Invalid magnet link', status: StaticResponses.FAILED_OPENING };
        }
        console.log(`[FK RealDebrid] Resolving ${infoHash} Ep:${episodeNumber} Name:${episodeName} FileIdxParam:${fileIndexParam}`);

        try {
            let torrentId = await this._findExistingTorrentId(infoHash, fileIndexParam, episodeNumber, episodeName, streamType);
            let torrentInfo;

            if (torrentId) {
                console.log(`[FK RealDebrid] Found existing torrent ID: ${torrentId} for hash ${infoHash}`);
                torrentInfo = await this.RD.torrents.info(torrentId);
            } else {
                console.log(`[FK RealDebrid] No suitable existing torrent. Adding new for hash ${infoHash}.`);
                const magnet = await getMagnetLink(infoHash); // Assurez-vous que cette fonction existe et fonctionne
                if (!magnet) throw new Error(`Could not generate magnet link for ${infoHash}`);
                const addedMagnet = await this.RD.torrents.addMagnet(magnet);
                torrentId = addedMagnet.id;
                console.log(`[FK RealDebrid] Added new torrent ID: ${torrentId}. Selecting files.`);
                // La sélection est cruciale ici avant la première vérification de statut
                await this._selectFilesLogic(torrentId, episodeNumber, episodeName, streamType, fileIndexParam);
                await delay(POLL_DELAY_MS); // Donner du temps à RD
                torrentInfo = await this.RD.torrents.info(torrentId);
            }

            for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
                if (!torrentInfo || !torrentInfo.status) {
                    throw new Error(`Invalid torrent info for ID ${torrentId}`);
                }
                console.log(`[FK RealDebrid] Torrent ${torrentId} status: ${torrentInfo.status} (Attempt ${attempt + 1})`);

                if (statusReady(torrentInfo.status)) {
                    return this._handleReadyTorrent(torrentInfo, episodeNumber, episodeName, streamType, fileIndexParam);
                } else if (statusDownloading(torrentInfo.status) || statusOpening(torrentInfo.status)) {
                    if (attempt < MAX_POLL_ATTEMPTS - 1) {
                        console.log(`[FK RealDebrid] Torrent ${torrentId} is ${torrentInfo.status}. Waiting...`);
                        await delay(POLL_DELAY_MS * (attempt / 5 + 1)); // Augmenter le délai progressivement
                        torrentInfo = await this.RD.torrents.info(torrentId);
                    } else {
                        break; // Sortir pour retourner DOWNLOADING après max tentatives
                    }
                } else if (statusWaitingSelection(torrentInfo.status)) {
                    console.log(`[FK RealDebrid] Torrent ${torrentId} waiting for file selection. Re-selecting.`);
                    await this._selectFilesLogic(torrentId, episodeNumber, episodeName, streamType, fileIndexParam);
                    await delay(POLL_DELAY_MS);
                    torrentInfo = await this.RD.torrents.info(torrentId);
                } else if (statusMagnetError(torrentInfo.status)) {
                    console.error(`[FK RealDebrid] Magnet error for torrent ${torrentId}.`);
                    return { status: StaticResponses.FAILED_OPENING, torrentInfo, error: 'Magnet error' };
                } else if (statusError(torrentInfo.status)) {
                    console.error(`[FK RealDebrid] Error status for torrent ${torrentId}: ${torrentInfo.status}. Trying to delete and re-add.`);
                    try {
                        await this.RD.torrents.delete(torrentId);
                        // Relancer le processus en forçant la création
                        return this.getTorrentStatusAndLinks(magnetLink, fileIndexParam, season, episodeNumber, streamType, episodeName); // Attention: récursion
                    } catch (delError) {
                        console.error(`[FK RealDebrid] Failed to delete torrent ${torrentId} after error:`, delError);
                        return { status: StaticResponses.FAILED_DOWNLOAD, torrentInfo, error: `Torrent error status: ${torrentInfo.status}` };
                    }
                } else {
                    console.warn(`[FK RealDebrid] Unknown status for ${torrentId}: ${torrentInfo.status}. Treating as downloading.`);
                    if (attempt < MAX_POLL_ATTEMPTS - 1) {
                        await delay(POLL_DELAY_MS);
                        torrentInfo = await this.RD.torrents.info(torrentId);
                    } else {
                        break;
                    }
                }
            }
            console.log(`[FK RealDebrid] Torrent ${torrentId} did not become ready. Final status: ${torrentInfo?.status}`);
            return { status: StaticResponses.DOWNLOADING, torrentInfo, error: 'Torrent not ready after max attempts' };

        } catch (error) {
            console.error(`[FK RealDebrid] Error in getTorrentStatusAndLinks for ${infoHash}:`, error.message, error.code);
            if (isAccessDeniedError(error)) return { status: StaticResponses.FAILED_ACCESS, error: 'Access denied' };
            if (isInfringingFileError(error)) return { status: StaticResponses.FAILED_INFRINGEMENT, error: 'Infringing file' };
            return { error: error.message, status: StaticResponses.FAILED_DOWNLOAD };
        }
    }

    async _findExistingTorrentId(infoHash, fileIndexParam, episodeNumber, episodeName, streamType) {
        try {
            const torrents = await this.RD.torrents.get(0, 100); // Récupérer une page de torrents récents
            const matchingTorrents = torrents.filter(t => t.hash && t.hash.toLowerCase() === infoHash);

            if (matchingTorrents.length === 0) return null;

            // Si plusieurs torrents avec le même hash, essayer de trouver celui avec le bon fichier déjà sélectionné
            for (const torrent of matchingTorrents.sort((a,b) => new Date(b.added) - new Date(a.added))) {
                const info = await this.RD.torrents.info(torrent.id);
                if (info && info.files && info.files.length > 0) {
                    const selectedFile = this.selectBestFile(info.files, episodeNumber, episodeName, { fileIndex: fileIndexParam, streamType });
                    if (selectedFile) {
                        const rdFile = info.files.find(f => f.id === selectedFile.id);
                        // Vérifier si le fichier est sélectionné (selected=1) et si le torrent est prêt ou en dl
                        if (rdFile && rdFile.selected === 1 && (statusReady(info.status) || statusDownloading(info.status) || statusOpening(info.status))) {
                            console.log(`[FK RealDebrid] Found suitable existing torrent ${info.id} with file ${selectedFile.path} selected.`);
                            return info.id;
                        }
                    }
                }
            }
            // Si aucun n'a le fichier parfait, prendre le plus récent non erroné
            const nonErrorTorrents = matchingTorrents.filter(t => !statusError(t.status));
            if (nonErrorTorrents.length > 0) {
                 console.log(`[FK RealDebrid] No perfect match, taking most recent non-error torrent ${nonErrorTorrents[0].id}`);
                return nonErrorTorrents[0].id;
            }
            return null; // Tous les torrents correspondants sont en erreur
        } catch (error) {
            console.warn(`[FK RealDebrid] Error finding existing torrent for ${infoHash}:`, error.message);
            return null;
        }
    }
    
    async _selectFilesLogic(torrentId, episodeNumber, episodeName, streamType, fileIndexParam, nonBlocking = false) {
        const select = async () => {
            try {
                const torrentInfo = await this.RD.torrents.info(torrentId);
                if (!torrentInfo || !torrentInfo.files || torrentInfo.files.length === 0) {
                    console.warn(`[FK RealDebrid] No files in torrent ${torrentId} for selection.`);
                    return;
                }

                let filesToSelectIds = [];
                // Priorité à fileIndexParam si fourni et valide
                if (fileIndexParam !== null && fileIndexParam !== undefined) {
                    // fileIndexParam est 0-indexed, l'API RD attend des IDs de fichiers.
                    // On suppose que selectBestFile peut aussi prendre fileIndexParam et retourner le fichier RD correspondant.
                    const preSelectedFile = this.selectBestFile(torrentInfo.files, episodeNumber, episodeName, { fileIndex: fileIndexParam, streamType });
                    if (preSelectedFile && preSelectedFile.id) {
                         const rdFile = torrentInfo.files.find(f => f.id === preSelectedFile.id);
                         if (rdFile && isVideoFile(rdFile.path) && rdFile.bytes > MIN_SIZE_BYTES) {
                            filesToSelectIds.push(rdFile.id.toString());
                            console.log(`[FK RealDebrid] Selecting by fileIndexParam, file ID: ${rdFile.id}`);
                         }
                    }
                }

                if (filesToSelectIds.length === 0) { // Si fileIndexParam n'a pas abouti ou n'était pas fourni
                    const bestFile = this.selectBestFile(torrentInfo.files, episodeNumber, episodeName, { streamType });
                    if (bestFile && bestFile.id) {
                        const rdFile = torrentInfo.files.find(f => f.id === bestFile.id);
                         if (rdFile && isVideoFile(rdFile.path) && rdFile.bytes > MIN_SIZE_BYTES) {
                            filesToSelectIds.push(rdFile.id.toString());
                            console.log(`[FK RealDebrid] Selecting by bestFile logic, file ID: ${rdFile.id}`);
                        } else if (rdFile) {
                             console.log(`[FK RealDebrid] Best file ${rdFile.path} not suitable (video/size).`);
                        }
                    }
                }

                if (filesToSelectIds.length === 0) { // Fallback: sélectionner tous les fichiers vidéo valides
                    console.log(`[FK RealDebrid] No specific file selected, selecting all valid video files in torrent ${torrentId}.`);
                    filesToSelectIds = torrentInfo.files
                        .filter(f => isVideoFile(f.path) && f.bytes > MIN_SIZE_BYTES)
                        .map(f => f.id.toString());
                }

                if (filesToSelectIds.length > 0) {
                    await this.RD.torrents.selectFiles(torrentId, filesToSelectIds.join(','));
                    console.log(`[FK RealDebrid] Files selected for torrent ${torrentId}: ${filesToSelectIds.join(',')}`);
                } else {
                    console.warn(`[FK RealDebrid] No files to select for torrent ${torrentId}.`);
                    // Cela pourrait être un problème, le torrent pourrait rester en 'waiting_files_selection'
                }
            } catch (error) {
                console.error(`[FK RealDebrid] Error during file selection for torrent ${torrentId}:`, error.message, error.code);
                if (isAccessDeniedError(error)) { /* Gérer si besoin */ }
                // Ne pas propager l'erreur si non bloquant pour ne pas casser addMagnetOnly
                if (!nonBlocking) throw error;
            }
        };

        if (nonBlocking) {
            select().catch(err => console.warn(`[FK RealDebrid] Non-blocking selectFilesLogic error: ${err.message}`));
            return Promise.resolve();
        } else {
            return select();
        }
    }

    async _handleReadyTorrent(torrentInfo, episodeNumber, episodeName, streamType, fileIndexParam) {
        const selectedFile = this.selectBestFile(torrentInfo.files, episodeNumber, episodeName, { fileIndex: fileIndexParam, streamType });

        if (!selectedFile || !selectedFile.id) {
            console.warn(`[FK RealDebrid] Torrent ${torrentInfo.id} ready, but no suitable file found for Ep:${episodeNumber}.`);
            return { status: StaticResponses.NO_VIDEO_FILES, torrentInfo };
        }

        const rdFile = torrentInfo.files.find(f => f.id === selectedFile.id);
        if (!rdFile || rdFile.selected === 0) {
            console.log(`[FK RealDebrid] Torrent ${torrentInfo.id} ready, but file ${selectedFile.path} (ID ${selectedFile.id}) not selected/downloaded. Re-initiating selection.`);
            // Tenter de sélectionner et indiquer à l'utilisateur de réessayer plus tard
            await this._selectFilesLogic(torrentInfo.id, episodeNumber, episodeName, streamType, fileIndexParam);
            return { status: StaticResponses.DOWNLOADING, torrentInfo, error: 'File was not selected, re-initiated' };
        }
        
        // Trouver le lien correspondant au fichier sélectionné
        // L'API RD retourne les liens dans le même ordre que les fichiers DANS la propriété `files` du torrentInfo,
        // MAIS seulement pour les fichiers qui ont été sélectionnés ET téléchargés.
        // Il faut donc trouver l'index du fichier sélectionné PARMI les fichiers téléchargés.
        const downloadedFiles = torrentInfo.files.filter(f => f.selected === 1);
        const linkIndex = downloadedFiles.findIndex(f => f.id === selectedFile.id);

        if (linkIndex === -1 || !torrentInfo.links[linkIndex]) {
            console.error(`[FK RealDebrid] Torrent ${torrentInfo.id} ready, file ${selectedFile.path} selected, but no corresponding link in torrentInfo.links. Links:`, torrentInfo.links);
             // Cela peut arriver si le fichier est marqué comme "selected" mais que RD n'a pas encore généré le lien, ou une désynchronisation.
            return { status: StaticResponses.FAILED_DOWNLOAD, torrentInfo, error: 'Link not found for selected file after ready status' };
        }
        const targetLink = torrentInfo.links[linkIndex];

        try {
            const unrestricted = await this.RD.unrestrict.link(targetLink);
            if (unrestricted && unrestricted.download) {
                console.log(`[FK RealDebrid] Unrestricted link for ${selectedFile.path}: ${unrestricted.download}`);
                return {
                    status: StaticResponses.COMPLETED,
                    links: [{ url: unrestricted.download, filename: selectedFile.path.split('/').pop() }],
                    torrentInfo
                };
            } else {
                console.error('[FK RealDebrid] Failed to unrestrict link or invalid response:', unrestricted);
                return { status: StaticResponses.FAILED_DOWNLOAD, torrentInfo, error: 'Unrestriction failed' };
            }
        } catch (error) {
            console.error(`[FK RealDebrid] Error unrestricting link ${targetLink}:`, error.message, error.code);
            if (isAccessDeniedError(error)) return { status: StaticResponses.FAILED_ACCESS, torrentInfo, error: 'Access denied during unrestrict' };
            // Gérer d'autres erreurs spécifiques de débridage si la lib les propage bien
            return { status: StaticResponses.FAILED_DOWNLOAD, torrentInfo, error: `Unrestriction API error: ${error.message}` };
        }
    }

    // La méthode unrestrictLink de baseService peut être utilisée si elle retourne juste le lien,
    // mais ici, la dérestriction est gérée dans getTorrentStatusAndLinks.
    // Si une dérestriction séparée est nécessaire (improbable avec ce flux), elle pourrait être ajoutée.
}

module.exports = RealDebrid;
