# FKStream - Addon Stremio pour Fankai

FKStream est un addon Stremio qui vous permet de regarder les animes Kai de Fankai directement depuis l'application Stremio. Il offre également des fonctionnalités de debridage pour une lecture en streaming sans client torrent.

## Qu'est-ce que Fankai ?

Fankai est un groupe de fans qui crée des versions "Kai" d'animes populaires. Ces versions Kai sont des montages qui éliminent les fillers, améliorent le rythme et restent plus fidèles au manga original. Ils proposent souvent des versions en VOSTFR et VF.

## Fonctionnalités

- Catalogue complet des animes Kai de Fankai (séries et films)
- Recherche d'animes
- Accès aux liens torrent pour chaque film/épisode
- Support des versions VOSTFR et VF (selon disponibilité)
- Intégration avec des services de debridage (Real-Debrid, AllDebrid)
- Tri des torrents par nombre de seeders
- Interface de configuration pour les services de debridage

## Installation

### Méthode 1 : Installation directe via l'URL

1. Ouvrez Stremio
2. Cliquez sur l'icône d'addons (puzzle) dans le menu
3. Cliquez sur "Community Addons"
4. Collez l'URL suivante dans la barre d'adresse en haut :
   ```
   http://localhost:7000/manifest.json
   ```
   (Remplacez localhost:7000 par l'URL de votre serveur si vous l'hébergez ailleurs)
5. Cliquez sur "Install"
6. Profitez de vos animes Kai !

### Méthode 2 : Installation manuelle

1. Clonez ce dépôt :
   ```
   git clone https://github.com/votre-username/fkstream.git
   ```
2. Installez les dépendances :
   ```
   cd fkstream
   npm install
   ```
3. Démarrez le serveur :
   ```
   npm start
   ```
4. Ouvrez Stremio et suivez les étapes 2 à 6 de la méthode 1

### Configuration des services de debridage

FKStream prend en charge les services de debridage suivants :
- Real-Debrid
- AllDebrid

Pour configurer un service de debridage :
1. Accédez à l'interface de configuration à l'adresse `http://localhost:7000/configure`
2. Sélectionnez votre service de debridage préféré
3. Entrez votre clé API
4. Choisissez votre option de téléchargement préférée :
   - Tous les liens (torrents directs + liens débridés)
   - Liens débridés uniquement
   - Torrents directs uniquement
5. Cliquez sur "Enregistrer"

## Utilisation

1. Ouvrez Stremio
2. Accédez à l'onglet "Discover"
3. Sélectionnez "Fankai - Séries" ou "Fankai - Films" dans le menu déroulant des addons
4. Parcourez le catalogue ou utilisez la recherche pour trouver votre anime préféré
5. Cliquez sur un anime pour voir les films/épisodes disponibles
6. Sélectionnez un film/épisode et choisissez un lien pour commencer la lecture :
   - Liens avec "(RealDebrid)" ou "(AllDebrid)" : streaming direct sans client torrent
   - Liens avec "(10S/5L)" : torrents directs (10 seeders, 5 leechers)

## Remarques importantes

- Cet addon ne stocke ni n'héberge aucun contenu. Il fournit simplement des liens vers des torrents publiquement disponibles.
- L'utilisation de cet addon est à vos propres risques. Assurez-vous de respecter les lois sur le droit d'auteur dans votre pays.
- Pour une meilleure expérience avec les torrents directs, il est recommandé d'utiliser un client torrent compatible avec Stremio.
- Pour le streaming direct sans client torrent, un abonnement à un service de debridage (Real-Debrid, AllDebrid) est nécessaire.

## Dépendances

- stremio-addon-sdk
- axios
- cheerio
- express
- cors

## Développement

Pour contribuer au développement de cet addon :

1. Forkez ce dépôt
2. Créez une branche pour votre fonctionnalité (`git checkout -b feature/amazing-feature`)
3. Committez vos changements (`git commit -m 'Add some amazing feature'`)
4. Poussez vers la branche (`git push origin feature/amazing-feature`)
5. Ouvrez une Pull Request

### Structure du projet

- `index.js` : Point d'entrée principal de l'application
- `lib/addon.js` : Définition de l'addon Stremio (handlers pour catalog, meta, stream)
- `lib/fankai.js` : Fonctions pour récupérer les données depuis Fankai et Nyaa.si
- `lib/debrid.js` : Services de debridage (Real-Debrid, AllDebrid)
- `public/configure.html` : Interface de configuration pour les services de debridage
- `utils/` : Utilitaires divers (parsing de configuration, encodage de chaînes)

## Licence

Ce projet est sous licence MIT - voir le fichier [LICENSE](LICENSE) pour plus de détails.

## Remerciements

- L'équipe Fankai pour leur travail incroyable sur les versions Kai
- La communauté Stremio pour le SDK et le support
