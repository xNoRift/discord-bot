'use strict';

const { EmbedBuilder } = require('discord.js');
const config = require('../../config/config');

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
  return brand(title ?? '❌ Fehler', description).setColor(config.branding.danger);
}

function warning(title, description) {
  return brand(title, description).setColor(config.branding.warning);
}

function info(title, description) {
  return brand(title, description).setColor(config.branding.info);
}

module.exports = { base, brand, success, error, warning, info };
