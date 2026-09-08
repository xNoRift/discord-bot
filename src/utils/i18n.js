'use strict';

const de = require('../locales/de.json');
const en = require('../locales/en.json');
const settingsModel = require('../database/models/settings');

/**
 * Minimale Übersetzungs-Schicht.
 * Die Sprache pro Server steht in guild_settings.bot_language ('de' | 'en').
 * Fehlt ein Schlüssel in der gewählten Sprache, wird auf Deutsch zurückgefallen;
 * fehlt er auch dort, wird der Schlüssel selbst zurückgegeben (nie ein Absturz).
 *
 * Platzhalter im Text: {name} -> vars.name
 */

const LOCALES = { de, en };

function lookup(obj, key) {
  return key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function fill(str, vars) {
  return String(str).replace(/\{(\w+)\}/g, (m, v) => (vars && vars[v] != null ? String(vars[v]) : m));
}

/** Übersetzt einen Schlüssel in die angegebene Sprache. */
function t(lang, key, vars) {
  const l = LOCALES[lang] ? lang : 'de';
  let str = lookup(LOCALES[l], key);
  if (str == null && l !== 'de') str = lookup(LOCALES.de, key);
  if (str == null) return key;
  return fill(str, vars);
}

/** Sprache eines Servers ('de' | 'en'). */
function langOf(guildId) {
  try {
    return settingsModel.get(guildId).bot_language === 'en' ? 'en' : 'de';
  } catch {
    return 'de';
  }
}

/** Gebundene Übersetzungsfunktion für einen Server: tg('tickets.foo', { bar: 1 }). */
function forGuild(guildId) {
  const lang = langOf(guildId);
  const fn = (key, vars) => t(lang, key, vars);
  fn.lang = lang;
  return fn;
}

module.exports = { t, langOf, forGuild };
