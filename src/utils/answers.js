'use strict';

const { L } = require('./i18n');

/**
 * Einheitliche Darstellung von Formular-Angaben in Discord-Embeds
 * (Ticket-Eröffnung, Bewerbung fürs Team, Bewerber-Chat):
 *
 *   **Frage**
 *   > Antwort
 *
 * Alles steht in der Embed-Beschreibung (bis 4096 Zeichen) – übersichtlicher als Felder.
 */

/**
 * @param {{question?:string, answer?:string}[]} answers
 * @param {{ noAnswer?: string, question?: string, priced?: {total:string, detail:string}|null }} [o]
 * @returns {string[]}  ein Block pro Frage (+ Preis)
 */
function blocks(answers, o = {}) {
  const quote = (text) => String(text).slice(0, 1000).split('\n').map((l) => `> ${l}`).join('\n');
  const out = (answers || []).slice(0, 25).map((a) => {
    const q = String(a.question || o.question || L('Frage', 'Question')).slice(0, 200);
    const ans = a.answer && String(a.answer).trim() ? String(a.answer).trim() : o.noAnswer || L('*(keine Angabe)*', '*(no answer)*');
    return `**${q}**\n${quote(ans)}`;
  });
  if (o.priced) out.push(`💰 **${L('Preis', 'Price')}:** __**${o.priced.total}**__ · ${o.priced.detail}`);
  return out;
}

/**
 * Blöcke auf Embed-Beschreibungen verteilen.
 * @param {string[]} list
 * @param {number} firstLimit  Platz im ersten Embed (dort steht meist noch Text davor)
 * @returns {string[]}  [erster Teil, ...Fortsetzungen] – leer, wenn es keine Angaben gibt
 */
function split(list, firstLimit = 4000) {
  const parts = [];
  let cur = '';
  let limit = Math.max(500, Math.min(4000, firstLimit));
  for (const b of list) {
    const next = cur ? `${cur}\n\n${b}` : b;
    if (next.length > limit && cur) {
      parts.push(cur);
      cur = b;
      limit = 4000;
    } else {
      cur = next;
    }
  }
  if (cur) parts.push(cur);
  return parts;
}

module.exports = { blocks, split };
