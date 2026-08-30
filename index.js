'use strict';

/**
 * Haupt-Entrypoint: startet Discord-Bot UND Web-Dashboard im selben Prozess.
 * Beide teilen sich denselben Discord-Client und dieselbe Datenbank.
 *
 *   npm start
 */

require('dotenv').config();

const logger = require('./src/utils/logger');
const config = require('./config/config');
const { startBot } = require('./src/bot');
const { startDashboard } = require('./dashboard/server');

async function main() {
  const missing = config.validate('all');
  if (missing.length) {
    logger.error('===============================================');
    logger.error(' Konfiguration unvollständig!');
    logger.error(` Fehlende Werte in der .env: ${missing.join(', ')}`);
    logger.error(' Kopiere .env.example zu .env und fülle die Werte aus.');
    logger.error('===============================================');
    process.exit(1);
  }

  await startBot();
  startDashboard();

  logger.success('Alles gestartet. Bot + Dashboard laufen.');
}

main().catch((err) => {
  logger.error('Startfehler:', err);
  process.exit(1);
});

// Sauberes Herunterfahren
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    logger.info(`\n${sig} empfangen – fahre herunter…`);
    process.exit(0);
  });
}
