'use strict';

/**
 * Preise im Ticket-Formular: jede Option kann einen beliebigen Preis-Text haben
 * ("14.2M", "500k Coins", "5,99 €", "$20", "2.500 Gold", "Kostenlos", "nach Absprache").
 * Ein Textfeld kann als Menge markiert sein. Enthalten alle gewählten Preise eine Zahl,
 * wird gerechnet (Menge × Summe, Einheit/Währung vom ersten Preis); sonst wird der Text gezeigt.
 */

const MAX_LEN = 60;
const SUFFIX = { '': 1, k: 1e3, tsd: 1e3, m: 1e6, mio: 1e6, b: 1e9, mrd: 1e9, t: 1e12 };
// Zahl (mit Tausender-/Dezimaltrennern) + optionales Kürzel, das nicht Teil eines Worts ist
const NUM_RE = /(\d(?:[\d.,']*\d)?)(?:\s?(mrd|mio|tsd|[kmbt])(?![a-zäöüß]))?/i;

/** "2.500" -> 2500, "1,5" -> 1.5, "1.234,56" -> 1234.56, "1,000,000" -> 1000000 */
function parseNumber(raw, hasSuffix) {
  const s = raw.replace(/'/g, '');
  const dots = (s.match(/\./g) || []).length;
  const commas = (s.match(/,/g) || []).length;
  let norm;
  if (dots && commas) {
    // Das hintere Zeichen ist das Dezimaltrennzeichen
    const dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    norm = s.split(dec === '.' ? ',' : '.').join('').replace(dec, '.');
  } else if (dots + commas > 1) {
    norm = s.replace(/[.,]/g, ''); // mehrfach = Tausendertrenner
  } else if (dots + commas === 1) {
    const [, after] = s.split(/[.,]/);
    // "2.500" ohne Kürzel = Tausender, "14.2M" / "5,99" = Dezimal
    norm = after.length === 3 && !hasSuffix ? s.replace(/[.,]/, '') : s.replace(',', '.');
  } else norm = s;
  const n = Number(norm);
  return Number.isFinite(n) ? n : null;
}

/** "12M Coins" -> { value: 12000000, prefix: '', suffix: ' Coins' }; keine Zahl -> null */
function parsePriceParts(text) {
  const str = String(text ?? '').trim();
  const m = str.match(NUM_RE);
  if (!m) return null;
  const n = parseNumber(m[1], Boolean(m[2]));
  if (n === null) return null;
  return {
    value: n * SUFFIX[(m[2] || '').toLowerCase()],
    prefix: str.slice(0, m.index),
    suffix: str.slice(m.index + m[0].length),
  };
}

/** "14.2M" -> 14200000; keine Zahl -> null */
function parsePrice(text) {
  return parsePriceParts(text)?.value ?? null;
}

/** 14200000 -> "14.2M" (bis zu 2 Nachkommastellen) */
function formatPrice(n) {
  if (!Number.isFinite(n)) return '?';
  const abs = Math.abs(n);
  const [div, suf] = abs >= 1e12 ? [1e12, 'T'] : abs >= 1e9 ? [1e9, 'B'] : abs >= 1e6 ? [1e6, 'M'] : abs >= 1e3 ? [1e3, 'k'] : [1, ''];
  return `${String(Math.round((n / div) * 100) / 100)}${suf}`;
}

/** Bereinigt { Option: "14.2M Coins" } – jeder nicht-leere Text, nur (falls angegeben) vorhandene Optionen. */
function sanitizePrices(map, options) {
  const input = map && typeof map === 'object' && !Array.isArray(map) ? map : {};
  const allowed = Array.isArray(options) ? new Set(options.map(String)) : null;
  const out = {};
  for (const [key, val] of Object.entries(input).slice(0, 25)) {
    const k = String(key).slice(0, 100);
    if (allowed && !allowed.has(k)) continue;
    const v = String(val ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_LEN);
    if (v) out[k] = v;
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
  const texts = list.flatMap((a) => a.prices ?? []).map((p) => String(p).trim()).filter(Boolean);
  if (!texts.length) return null;
  const qa = list.find((a) => a.isQuantity);
  const q = qa ? parseQuantity(qa.answer) : null;
  const quantity = q !== null && q > 0 ? q : 1;
  const parts = texts.map(parsePriceParts);
  if (parts.some((p) => p === null)) {
    // Mindestens ein Preis ohne Zahl ("Kostenlos", "nach Absprache") → Texte so anzeigen
    const unit = texts.join(' + ');
    return { total: unit, quantity, unit, detail: quantity !== 1 ? `${quantity} × ${unit}` : '' };
  }
  const { prefix, suffix } = parts[0];
  const fmt = (n) => `${prefix}${formatPrice(n)}${suffix}`;
  const sum = parts.reduce((s, p) => s + p.value, 0);
  return { total: fmt(sum * quantity), quantity, unit: fmt(sum), detail: `${quantity} × ${fmt(sum)}` };
}

module.exports = { parsePrice, parsePriceParts, formatPrice, sanitizePrices, parsePrices, parseQuantity, compute };
