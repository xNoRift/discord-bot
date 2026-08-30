'use strict';

const fs = require('node:fs');
const path = require('node:path');
const logger = require('../utils/logger');

/**
 * Rekursiv alle .js-Dateien in einem Ordner sammeln.
 */
function collectFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function loadCommands(client) {
  const dir = path.join(__dirname, '..', 'commands');
  let count = 0;
  for (const file of collectFiles(dir)) {
    const mod = require(file);
    if (!mod?.data?.name || typeof mod.execute !== 'function') {
      logger.warn(`[loader] Command übersprungen (ungültig): ${path.relative(dir, file)}`);
      continue;
    }
    client.commands.set(mod.data.name, mod);
    count++;
  }
  logger.info(`[loader] ${count} Slash-Command(s) geladen`);
}

function loadComponents(client) {
  const groups = [
    ['buttons', client.buttons],
    ['selects', client.selectMenus],
    ['modals', client.modals],
  ];
  for (const [folder, collection] of groups) {
    const dir = path.join(__dirname, '..', 'components', folder);
    let count = 0;
    for (const file of collectFiles(dir)) {
      const mod = require(file);
      if (!mod?.prefix || typeof mod.execute !== 'function') {
        logger.warn(`[loader] Component übersprungen: ${path.basename(file)}`);
        continue;
      }
      collection.set(mod.prefix, mod);
      count++;
    }
    logger.info(`[loader] ${count} ${folder} geladen`);
  }
}

function loadEvents(client) {
  const dir = path.join(__dirname, '..', 'events');
  let count = 0;
  for (const file of collectFiles(dir)) {
    const mod = require(file);
    if (!mod?.name || typeof mod.execute !== 'function') {
      logger.warn(`[loader] Event übersprungen: ${path.basename(file)}`);
      continue;
    }
    const handler = (...args) => mod.execute(...args, client);
    if (mod.once) client.once(mod.name, handler);
    else client.on(mod.name, handler);
    count++;
  }
  logger.info(`[loader] ${count} Event(s) geladen`);
}

/**
 * Findet den passenden Component-Handler anhand des customId-Prefix.
 * Beispiel: customId "giveaway:enter:42" -> Handler mit prefix "giveaway:enter".
 */
function matchComponent(collection, customId) {
  if (collection.has(customId)) return collection.get(customId);
  let best = null;
  for (const [prefix, mod] of collection) {
    if (customId === prefix || customId.startsWith(prefix + ':')) {
      if (!best || prefix.length > best.prefix.length) best = mod;
    }
  }
  return best;
}

module.exports = { loadCommands, loadComponents, loadEvents, matchComponent, collectFiles };
