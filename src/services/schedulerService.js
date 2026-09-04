'use strict';

const giveawayService = require('./giveawayService');
const temporaryRoleService = require('./temporaryRoleService');
const ticketService = require('./ticketService');
const backupService = require('./backupService');
const logger = require('../utils/logger');

/**
 * Zentraler Scheduler.
 * - Beim Start: offene Giveaways und temporaere Rollen wiederherstellen.
 * - Danach: alle 60 Sekunden ein Sweep als Sicherheitsnetz (falls ein Timer
 *   verloren ging oder der Prozess laenger geschlafen hat).
 */

let interval = null;

async function start() {
  await temporaryRoleService.restoreAll().catch((err) => logger.error('[scheduler] restore tempRoles:', err));
  await giveawayService.restoreAll().catch((err) => logger.error('[scheduler] restore giveaways:', err));

  if (interval) clearInterval(interval);
  interval = setInterval(() => {
    giveawayService.sweep().catch((err) => logger.error('[scheduler] giveaway sweep:', err.message));
    temporaryRoleService.sweep().catch((err) => logger.error('[scheduler] tempRole sweep:', err.message));
    ticketService.autoCloseSweep().catch((err) => logger.error('[scheduler] ticket autoclose:', err.message));
    backupService.dailySweep().catch((err) => logger.error('[scheduler] backup:', err.message));
  }, 60_000);

  logger.success('[scheduler] gestartet (Sweep alle 60s)');
}

function stop() {
  if (interval) clearInterval(interval);
  interval = null;
}

module.exports = { start, stop };
