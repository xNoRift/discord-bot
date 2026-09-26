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
  fn.pick = (deText, enText, vars) => fill(lang === 'en' ? enText : deText, vars);
  return fn;
}

/**
 * Kurzform für Texte direkt im Code – beide Sprachen stehen nebeneinander:
 *   const L = i18n.pick(guild.id);  L('Ticket geschlossen', 'Ticket closed')
 * Platzhalter wie bei t(): L('Hallo {user}', 'Hello {user}', { user })
 * guildId leer (z. B. DM ohne Server) -> Deutsch.
 */
function pick(guildId) {
  const lang = guildId ? langOf(guildId) : 'de';
  const fn = (deText, enText, vars) => fill(lang === 'en' ? enText : deText, vars);
  fn.lang = lang;
  return fn;
}

/* ---------------- Sprach-Kontext ----------------
 * Jede Interaktion, jedes Discord-Event, jede Dashboard-Anfrage und jeder Hintergrund-Job
 * läuft in runFor(guildId, …). Darin liefert L() automatisch die Sprache dieses Servers –
 * auch tief in Services und Helfern, ohne die guildId durchreichen zu müssen.
 */
const { AsyncLocalStorage } = require('node:async_hooks');

const als = new AsyncLocalStorage();

/** Führt fn in der Sprache des Servers aus. */
function runFor(guildId, fn) {
  return als.run({ lang: guildId ? langOf(guildId) : 'de' }, fn);
}

/** Aktuelle Sprache ('de' | 'en') – außerhalb eines Kontexts Deutsch. */
function currentLang() {
  return als.getStore()?.lang || 'de';
}

/** Text in der aktuellen Sprache: L('Deutsch', 'English', { vars }) */
function L(deText, enText, vars) {
  return fill(currentLang() === 'en' ? enText : deText, vars);
}

module.exports = { t, langOf, forGuild, pick, fill, runFor, currentLang, L };
