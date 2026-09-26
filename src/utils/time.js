'use strict';

const { L } = require('./i18n');

/**
 * Hilfsfunktionen zum Parsen und Formatieren von Zeitangaben.
 */

const UNITS = {
  s: 1000,
  sec: 1000,
  m: 60 * 1000,
  min: 60 * 1000,
  h: 60 * 60 * 1000,
  hr: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
};

/**
 * Wandelt Strings wie "24h", "1d 12h", "30m", "90" (Minuten) in Millisekunden um.
 * Gibt null zurueck, wenn nichts erkannt wurde.
 * @param {string|number} input
 * @returns {number|null}
 */
function parseDuration(input) {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number' && Number.isFinite(input)) {
    return input > 0 ? Math.floor(input) : null;
  }

  const str = String(input).trim().toLowerCase();
  if (str === '') return null;

  // Reine Zahl -> Minuten
  if (/^\d+$/.test(str)) {
    const minutes = Number.parseInt(str, 10);
    return minutes > 0 ? minutes * UNITS.m : null;
  }

  const regex = /(\d+(?:\.\d+)?)\s*(w|d|h(?:r)?|m(?:in)?|s(?:ec)?)/g;
  let match;
  let total = 0;
  let found = false;
  while ((match = regex.exec(str)) !== null) {
    const value = Number.parseFloat(match[1]);
    const unit = match[2];
    const factor = UNITS[unit] ?? UNITS[unit[0]];
    if (factor) {
      total += value * factor;
      found = true;
    }
  }

  return found && total > 0 ? Math.floor(total) : null;
}

/**
 * Formatiert Millisekunden als lesbaren deutschen Text, z.B. "1 Tag, 3 Stunden".
 * @param {number} ms
 * @returns {string}
 */
function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return L('0 Sekunden', '0 seconds');

  const parts = [];
  const days = Math.floor(ms / UNITS.d);
  const hours = Math.floor((ms % UNITS.d) / UNITS.h);
  const minutes = Math.floor((ms % UNITS.h) / UNITS.m);
  const seconds = Math.floor((ms % UNITS.m) / UNITS.s);

  const unit = (n, de1, deN, en1, enN) => `${n} ${n === 1 ? L(de1, en1) : L(deN, enN)}`;
  if (days) parts.push(unit(days, 'Tag', 'Tage', 'day', 'days'));
  if (hours) parts.push(unit(hours, 'Stunde', 'Stunden', 'hour', 'hours'));
  if (minutes) parts.push(unit(minutes, 'Minute', 'Minuten', 'minute', 'minutes'));
  if (seconds && !days && !hours) parts.push(unit(seconds, 'Sekunde', 'Sekunden', 'second', 'seconds'));

  return parts.join(', ') || L('0 Sekunden', '0 seconds');
}

/**
 * Discord-Timestamp-Markup, z.B. <t:1700000000:R>
 * @param {number} msTimestamp  Zeit in ms (Date.now()-Format)
 * @param {string} style  't' | 'T' | 'd' | 'D' | 'f' | 'F' | 'R'
 */
function discordTimestamp(msTimestamp, style = 'f') {
  return `<t:${Math.floor(msTimestamp / 1000)}:${style}>`;
}

module.exports = { parseDuration, formatDuration, discordTimestamp, UNITS };
