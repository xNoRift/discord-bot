'use strict';

const { EmbedBuilder } = require('discord.js');
const config = require('../../config/config');
const { L } = require('./i18n');

/**
 * Einheitliche, moderne Embeds fuer den gesamten Bot.
 */

function base() {
  return new EmbedBuilder().setColor(config.branding.color).setTimestamp();
}

function brand(title, description) {
  const e = base();
  if (title) e.setTitle(title);
  if (description) e.setDescription(description);
  return e;
}

function success(title, description) {
  return brand(title, description).setColor(config.branding.success);
}

function error(title, description) {
  return brand(title ?? L('❌ Fehler', '❌ Error'), description).setColor(config.branding.danger);
}

function warning(title, description) {
  return brand(title, description).setColor(config.branding.warning);
}

function info(title, description) {
  return brand(title, description).setColor(config.branding.info);
}

/** "#5865F2" / "5865F2" -> Zahl für setColor(); ungültig -> fallback. */
function parseHexColor(input, fallback = null) {
  const m = String(input || '').trim().match(/^#?([0-9a-fA-F]{6})$/);
  return m ? parseInt(m[1], 16) : fallback;
}

/** Unicode-Emoji oder Server-Emoji (<:name:id>) – alles andere lehnt Discord bei Buttons ab. */
const validEmoji = (e) => /^(\p{Extended_Pictographic}|<a?:\w+:\d+>)/u.test(String(e || ''));

module.exports = { base, brand, success, error, warning, info, parseHexColor, validEmoji };
