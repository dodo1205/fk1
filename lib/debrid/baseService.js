/**
 * Classe de base pour les services de debridage
 */
class DebridService {
    constructor(apiKey) {
        this.apiKey = apiKey;
    }

    /**
     * Vérifie si l'API key est valide
     * @returns {Promise<boolean>}
     */
    async checkApiKey() {
        throw new Error('La méthode checkApiKey doit être implémentée par les classes enfants');
    }

    /**
     * Ajoute un lien magnet au service de debridage sans attendre la complétion.
     * @param {string} magnetLink - Lien magnet à ajouter
     * @param {string} streamType - Type de contenu ('series', 'movie')
     * @param {string|null} episode - Numéro d'épisode (si series)
     * @param {string|null} episodeName - Nom de l'épisode (si series)
     * @returns {Promise<void>}
     */
    async addMagnetOnly(magnetLink, streamType, episode, episodeName) {
        throw new Error('La méthode addMagnetOnly doit être implémentée par les classes enfants');
    }

    /**
     * Vérifie l'état d'un torrent et récupère les liens si complété.
     * @param {string} magnetLink - Lien magnet à vérifier
     * @param {number|null} fileIndex - Index du fichier spécifique (si connu)
     * @param {string|null} season - Numéro de saison (si series)
     * @param {string|null} episode - Numéro d'épisode (si series)
     * @param {string} streamType - Type de contenu ('series', 'movie')
     * @param {string|null} episodeName - Nom de l'épisode (si series)
     * @returns {Promise<Object|null>} - Objet avec { status: '...', links: [...] } ou null
     */
    async getTorrentStatusAndLinks(magnetLink, fileIndex, season, episode, streamType, episodeName) {
        throw new Error('La méthode getTorrentStatusAndLinks doit être implémentée par les classes enfants');
    }

    /**
     * Sélectionne le meilleur fichier pour un épisode
     * @param {Array} files - Liste des fichiers
     * @param {number} episode - Numéro d'épisode
     * @param {string} episodeName - Nom de l'épisode (optionnel)
     * @param {Object} options - Options supplémentaires
     * @returns {Object|null} - Meilleur fichier correspondant ou null
     */
    selectBestFile(files, episode, episodeName = null, options = {}) {
        const { selectBestFile } = require('../fileUtils');
        // Ajouter le nom du service aux options si non spécifié
        if (!options.service) {
            options.service = this.constructor.name.toLowerCase();
        }
        return selectBestFile(files, episode, episodeName, options);
    }

    /**
     * Dérestreint un lien de téléchargement (si nécessaire par le service).
     * @param {string} link - Lien à dérestreindre
     * @returns {Promise<string|Object>} - Lien dérestreint (string) ou objet (selon service)
     */
    async unrestrictLink(link) {
        // Par défaut, retourne le lien tel quel si le service n'a pas besoin de dérestriction
        console.log(`[${this.constructor.name}] UnrestrictLink: Pas de dérestriction nécessaire par défaut pour ${link}`);
        return link;
    }
}

module.exports = DebridService;
