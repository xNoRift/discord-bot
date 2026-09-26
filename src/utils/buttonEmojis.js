'use strict';

const { validEmoji } = require('./embeds');

/**
 * Emojis der fest eingebauten Bot-Buttons – pro Server im Dashboard änderbar.
 * Gespeichert in module_settings (Modul "buttonEmojis") als Feld "<gruppe>_<key>".
 * Leer oder ungültig = Standard-Emoji.
 *
 * Buttons, deren Emoji schon am Objekt hängt (Ticket-Kategorien, Bewerbungsarten,
 * Regel-Abschnitte, Giveaway-Ticket-Buttons), stehen hier nicht – die stellt man dort ein.
 */
const BUTTONS = {
  tickets: [
    ['panel', 'Ticket öffnen (Panel ohne eigenes Kategorie-Emoji)', '🎫'],
    ['claim', 'Übernehmen / Freigeben', '📌'],
    ['close', 'Schließen', '🔒'],
    ['reopen', 'Wieder öffnen', '🔓'],
    ['delete', 'Löschen', '🗑️'],
    ['request', 'Anfrage', '📨'],
    ['closeAccept', 'Schließ-Anfrage: Ja', '✅'],
    ['closeDecline', 'Schließ-Anfrage: Nein', '❌'],
  ],
  giveaways: [
    ['join', 'Teilnehmen', '🎉'],
    ['entrants', 'Teilnehmer anzeigen', '👥'],
  ],
  applications: [
    ['start', 'Starten', '▶️'],
    ['accept', 'Annehmen (Team)', '✅'],
    ['reject', 'Ablehnen (Team)', '❌'],
    ['chat', 'Chat (Team)', '💬'],
  ],
  verification: [
    ['verify', 'Verifizieren', '✅'],
  ],
  tempvoice: [
    ['rename', 'Umbenennen', '✏️'],
    ['limit', 'Benutzerlimit', '👥'],
    ['lock', 'Sperren', '🔒'],
    ['unlock', 'Entsperren', '🔓'],
    ['hide', 'Verstecken', '🙈'],
    ['show', 'Zeigen', '👁️'],
    ['region', 'Region', '🌍'],
    ['permit', 'Hinzufügen', '➕'],
    ['reject', 'Entfernen', '➖'],
    ['block', 'Blockieren', '🚫'],
    ['unblock', 'Entblockieren', '♻️'],
    ['disconnect', 'Trennen', '🔌'],
    ['delete', 'Löschen', '🗑️'],
  ],
  music: [
    ['pause', 'Pause', '⏸️'],
    ['resume', 'Weiter', '▶️'],
    ['skip', 'Überspringen', '⏭️'],
    ['loop', 'Wiederholen', '🔁'],
    ['shuffle', 'Mischen', '🔀'],
    ['stop', 'Stopp', '⏹️'],
    ['voldown', 'Leiser', '🔉'],
    ['volup', 'Lauter', '🔊'],
    ['queue', 'Warteschlange', '📜'],
  ],
};

const field = (group, key) => `${group}_${key}`;

/** Schema-Felder für moduleSettings (alle Gruppen). */
function schema() {
  const out = {};
  for (const [group, list] of Object.entries(BUTTONS)) {
    for (const [key] of list) out[field(group, key)] = ['', 'text:80'];
  }
  return out;
}

function defaultOf(group, key) {
  return (BUTTONS[group] || []).find(([k]) => k === key)?.[2] || null;
}

/**
 * Emoji-Resolver für einen Server und eine Gruppe: e('close') -> eigenes oder Standard-Emoji.
 * Einmal pro Nachricht holen, dann für alle Buttons benutzen (nur ein DB-Zugriff).
 */
function forGuild(guildId, group) {
  let cfg = {};
  try {
    cfg = require('../database/models/moduleSettings').get(guildId, 'buttonEmojis');
  } catch {
    cfg = {};
  }
  return (key) => {
    const custom = cfg[field(group, key)];
    return validEmoji(custom) ? custom : defaultOf(group, key);
  };
}

module.exports = { BUTTONS, schema, forGuild, defaultOf };
