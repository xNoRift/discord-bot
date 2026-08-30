'use strict';

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
  if (!Number.isFinite(ms) || ms <= 0) return '0 Sekunden';

  const parts = [];
  const days = Math.floor(ms / UNITS.d);
  const hours = Math.floor((ms % UNITS.d) / UNITS.h);
  const minutes = Math.floor((ms % UNITS.h) / UNITS.m);
  const seconds = Math.floor((ms % UNITS.m) / UNITS.s);

  if (days) parts.push(`${days} ${days === 1 ? 'Tag' : 'Tage'}`);
  if (hours) parts.push(`${hours} ${hours === 1 ? 'Stunde' : 'Stunden'}`);
  if (minutes) parts.push(`${minutes} ${minutes === 1 ? 'Minute' : 'Minuten'}`);
  if (seconds && !days && !hours) parts.push(`${seconds} ${seconds === 1 ? 'Sekunde' : 'Sekunden'}`);

  return parts.join(', ') || '0 Sekunden';
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
