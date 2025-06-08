/**
 * Construit un lien magnet à partir d'un infohash.
 * Ajoute des trackers publics courants pour améliorer la découverte de pairs.
 * @param {string} infoHash - L'infohash du torrent.
 * @returns {string} - Le lien magnet complet.
 */
function getMagnetLink(infoHash) {
    if (!infoHash || infoHash.length !== 40 && infoHash.length !== 32) { // Supporte infohash v1 (hex) et v2 (base32)
        console.error('[MagnetHelper] Invalid infoHash provided:', infoHash);
        return null; 
    }

    const trackers = [
        'udp://tracker.coppersurfer.tk:6969/announce',
        'udp://tracker.openbittorrent.com:6969/announce',
        'udp://tracker.opentrackr.org:1337/announce',
        'udp://tracker.leechers-paradise.org:6969/announce',
        'udp://tracker.dler.org:6969/announce',
        'udp://opentracker.i2p.rocks:6969/announce',
        'udp://open.stealth.si:80/announce',
        'udp://tracker.torrent.eu.org:451/announce',
        'udp://exodus.desync.com:6969/announce',
        'udp://tracker.tiny-vps.com:6969/announce',
        'udp://tracker.internetwarriors.net:1337/announce',
        'udp://tracker.moeking.me:6969/announce',
        'udp://tracker.open-internet.nl:6969/announce',
        'udp://tracker.zerobytes.xyz:1337/announce',
        'udp://valakas.rollo.dnsabr.com:2710/announce',
        'http://tracker.gbitt.info:80/announce',
        'http://tracker.ccp.ovh:6969/announce',
        'http://tracker.opentrackr.org:1337/announce',
        'http://open.acgnxtracker.com:80/announce',
        'http://open.tracker.cl:1337/announce',
    ];

    let magnet = `magnet:?xt=urn:btih:${infoHash}`;
    trackers.forEach(tracker => {
        magnet += `&tr=${encodeURIComponent(tracker)}`;
    });

    return magnet;
}

module.exports = {
    getMagnetLink
};
