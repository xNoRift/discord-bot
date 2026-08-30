'use strict';

/**
 * Fest eingebaute Radio-Sender (direkte Stream-URLs – wartungsarm).
 * Überwiegend SomaFM (erlauben direktes Streaming für den privaten Gebrauch).
 * Nutzer können im Dashboard eigene Sender/URLs ergänzen (music_stations).
 */
module.exports = [
  { key: 'lofi', name: 'Lofi Hip Hop', url: 'https://usa9.fastcast4u.com/proxy/jamz?mp=/1', genre: 'Chill' },
  { key: 'chillhop', name: 'Chillhop', url: 'https://stream.zeno.fm/0r0xa792kwzuv', genre: 'Chill' },
  { key: 'edm', name: 'EDM / Dance', url: 'https://stream.zeno.fm/f3wvbbqmdg8uv', genre: 'Electronic' },
  { key: 'groovesalad', name: 'Groove Salad', url: 'https://ice1.somafm.com/groovesalad-128-mp3', genre: 'Chill' },
  { key: 'fluid', name: 'Fluid (Future Beats)', url: 'https://ice1.somafm.com/fluid-128-mp3', genre: 'Chill' },
  { key: 'beatblender', name: 'Beat Blender', url: 'https://ice1.somafm.com/beatblender-128-mp3', genre: 'Electronic' },
  { key: 'poptron', name: 'PopTron', url: 'https://ice1.somafm.com/poptron-128-mp3', genre: 'Pop' },
  { key: 'indiepop', name: 'Indie Pop Rocks', url: 'https://ice1.somafm.com/indiepop-128-mp3', genre: 'Indie' },
  { key: 'u80s', name: 'Underground 80s', url: 'https://ice1.somafm.com/u80s-128-mp3', genre: '80s' },
  { key: '7soul', name: 'Seven Inch Soul', url: 'https://ice1.somafm.com/7soul-128-mp3', genre: 'Soul' },
  { key: 'secretagent', name: 'Secret Agent (Lounge)', url: 'https://ice1.somafm.com/secretagent-128-mp3', genre: 'Lounge' },
  { key: 'lush', name: 'Lush (Vocals)', url: 'https://ice1.somafm.com/lush-128-mp3', genre: 'Chill' },
  { key: 'dronezone', name: 'Drone Zone (Ambient)', url: 'https://ice1.somafm.com/dronezone-128-mp3', genre: 'Ambient' },
  { key: 'metal', name: 'Metal Detector', url: 'https://ice1.somafm.com/metal-128-mp3', genre: 'Metal' },
  { key: 'defcon', name: 'DEF CON Radio', url: 'https://ice1.somafm.com/defcon-128-mp3', genre: 'Electronic' },
];
