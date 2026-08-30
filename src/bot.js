'use strict';

/**
 * Bot-Entrypoint.
 * Kann eigenständig gestartet werden (`npm run bot`) ODER von index.js
 * zusammen mit dem Dashboard (`npm start`).
 */

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const config = require('../config/config');
const logger = require('./utils/logger');
const client = require('./core/client');
const { loadCommands, loadComponents, loadEvents } = require('./handlers/loaders');

let started = false;

async function startBot() {
  if (started) return client;
  started = true;

  const missing = config.validate('bot');
  if (missing.length) {
    logger.error(`[bot] Fehlende .env-Variablen: ${missing.join(', ')}`);
    throw new Error('Bot-Konfiguration unvollständig. Siehe .env.example');
  }

  // DB initialisieren (Seiteneffekt: Schema anlegen)
  require('./database/db');

  loadEvents(client);
  loadCommands(client);
  loadComponents(client);

  process.on('unhandledRejection', (reason) => logger.error('[unhandledRejection]', reason));
  process.on('uncaughtException', (err) => logger.error('[uncaughtException]', err));

  try {
    await client.login(config.discord.token);
  } catch (err) {
    if (/disallowed intents|Used disallowed intents/i.test(err.message || '')) {
      logger.error('===============================================================');
      logger.error(' LOGIN FEHLGESCHLAGEN – privilegierter Intent nicht aktiviert.');
      logger.error(' Aktiviere im Discord Developer Portal:');
      logger.error('   Deine App -> Bot -> "Privileged Gateway Intents"');
      logger.error('   -> "SERVER MEMBERS INTENT"   (Auto-Rolle, Willkommen, Verlassen)');
      logger.error('   -> "MESSAGE CONTENT INTENT"  (Zähl-Spiel / Spiele)');
      logger.error('   beide einschalten -> Save');
      logger.error('===============================================================');
    }
    throw err;
  }
  return client;
}

// Direktstart?
if (require.main === module) {
  startBot().catch((err) => {
    logger.error('[bot] Start fehlgeschlagen:', err);
    process.exit(1);
  });
}

module.exports = { startBot, client };
