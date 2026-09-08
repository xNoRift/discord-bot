'use strict';

const de = require('../locales/de.json');
const en = require('../locales/en.json');

/**
 * Übersetzungs-Schicht für das Dashboard (Server-Render + Client).
 * Sprache pro Besucher:
 *   1. manuell gewählt  -> req.session.lang  ('de' | 'en')
 *   2. sonst Browser-Sprache (Accept-Language beginnt mit "de" -> Deutsch)
 *   3. sonst Englisch
 * Fehlt ein Schlüssel in der Sprache, wird auf Englisch, dann Deutsch,
 * dann den Schlüsselnamen zurückgefallen (nie ein Absturz).
 */

const LOCALES = { de, en };
const SUPPORTED = ['en', 'de'];
const DEFAULT_LANG = 'en';

function lookup(obj, key) {
  return key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function fill(str, vars) {
  return String(str).replace(/\{(\w+)\}/g, (m, v) => (vars && vars[v] != null ? String(vars[v]) : m));
}

function t(lang, key, vars) {
  const l = LOCALES[lang] ? lang : DEFAULT_LANG;
  let str = lookup(LOCALES[l], key);
  if (str == null && l !== 'en') str = lookup(LOCALES.en, key);
  if (str == null && l !== 'de') str = lookup(LOCALES.de, key);
  if (str == null) return key;
  return fill(str, vars);
}

/** Sprache aus dem Request ermitteln. */
function resolveLang(req) {
  const chosen = req.session?.lang;
  if (SUPPORTED.includes(chosen)) return chosen;
  const header = String(req.headers['accept-language'] || '').toLowerCase();
  if (/(^|,)\s*de\b/.test(header) || header.startsWith('de')) return 'de';
  return DEFAULT_LANG;
}

/** Vollständiges Locale-Objekt für die Einbindung ins Client-JS. */
function bundle(lang) {
  return LOCALES[lang] || LOCALES[DEFAULT_LANG];
}

module.exports = { t, resolveLang, bundle, SUPPORTED, DEFAULT_LANG };
