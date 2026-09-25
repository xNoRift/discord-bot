'use strict';

/**
 * Preise im Ticket-Formular: jede Option kann einen Preis haben ("14.2M", "500k", "1,5B", "2500"),
 * ein Textfeld kann als Menge markiert sein. Ergebnis: Menge × Summe der gewählten Optionspreise.
 */

const SUFFIX = { '': 1, k: 1e3, m: 1e6, b: 1e9, t: 1e12 };

/** "14.2M" -> 14200000; ungültig -> null */
function parsePrice(text) {
  const m = String(text ?? '').trim().replace(/\s+/g, '').match(/^(\d+(?:[.,]\d+)?)([kmbt]?)$/i);
  if (!m) return null;
  return Number(m[1].replace(',', '.')) * SUFFIX[m[2].toLowerCase()];
}

/** 14200000 -> "14.2M" (bis zu 2 Nachkommastellen) */
function formatPrice(n) {
  if (!Number.isFinite(n)) return '?';
  const abs = Math.abs(n);
  const [div, suf] = abs >= 1e12 ? [1e12, 'T'] : abs >= 1e9 ? [1e9, 'B'] : abs >= 1e6 ? [1e6, 'M'] : abs >= 1e3 ? [1e3, 'k'] : [1, ''];
  return `${String(Math.round((n / div) * 100) / 100)}${suf}`;
}

/** Bereinigt { Option: "14.2M" } – nur gültige Preise und (falls angegeben) vorhandene Optionen. */
function sanitizePrices(map, options) {
  const input = map && typeof map === 'object' && !Array.isArray(map) ? map : {};
  const allowed = Array.isArray(options) ? new Set(options.map(String)) : null;
  const out = {};
  for (const [key, val] of Object.entries(input).slice(0, 25)) {
    const k = String(key).slice(0, 100);
    if (allowed && !allowed.has(k)) continue;
    const v = String(val ?? '').trim().replace(/\s+/g, '').slice(0, 20);
    if (parsePrice(v) !== null) out[k] = v;
  }
  return out;
}

function parsePrices(raw) {
  if (!raw) return {};
  try { return sanitizePrices(typeof raw === 'string' ? JSON.parse(raw) : raw); } catch { return {}; }
}

/** Erste Zahl einer Antwort als Menge ("3", "3x", "3 Stück"); sonst null. */
function parseQuantity(text) {
  const m = String(text ?? '').replace(',', '.').match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/**
 * Preis aus den Formular-Antworten (readModalAnswers) berechnen.
 * @returns {{ total:string, quantity:number, unit:string, detail:string } | null}  null = keine Preise im Formular
 */
function compute(answers) {
  const list = Array.isArray(answers) ? answers : [];
  const prices = list.flatMap((a) => a.prices ?? []).map(parsePrice).filter((n) => n !== null);
  if (!prices.length) return null;
  const unit = prices.reduce((s, n) => s + n, 0);
  const qa = list.find((a) => a.isQuantity);
  const q = qa ? parseQuantity(qa.answer) : null;
  const quantity = q !== null && q > 0 ? q : 1;
  const total = formatPrice(unit * quantity);
  return { total, quantity, unit: formatPrice(unit), detail: `${quantity} × ${formatPrice(unit)}` };
}

module.exports = { parsePrice, formatPrice, sanitizePrices, parsePrices, parseQuantity, compute };
