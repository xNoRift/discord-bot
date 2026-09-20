'use strict';

const giveawayService = require('./giveawayService');
const temporaryRoleService = require('./temporaryRoleService');
const ticketService = require('./ticketService');
const socialService = require('./socialService');
const maintenanceService = require('./maintenanceService');
const statsChannelService = require('./statsChannelService');
const tagRewardService = require('./tagRewardService');
const applicationFlowService = require('./applicationFlowService');
const logger = require('../utils/logger');

/**
 * Zentraler Scheduler.
 * - Beim Start: offene Giveaways und temporaere Rollen wiederherstellen.
 * - Danach: alle 60 Sekunden ein Sweep als Sicherheitsnetz (falls ein Timer
 *   verloren ging oder der Prozess laenger geschlafen hat).
 */

let interval = null;
let slowInterval = null;

async function start() {
  await temporaryRoleService.restoreAll().catch((err) => logger.error('[scheduler] restore tempRoles:', err));
  await giveawayService.restoreAll().catch((err) => logger.error('[scheduler] restore giveaways:', err));

  if (interval) clearInterval(interval);
  interval = setInterval(() => {
    giveawayService.sweep().catch((err) => logger.error('[scheduler] giveaway sweep:', err.message));
    temporaryRoleService.sweep().catch((err) => logger.error('[scheduler] tempRole sweep:', err.message));
    ticketService.autoCloseSweep().catch((err) => logger.error('[scheduler] ticket autoclose:', err.message));
    socialService.sweep().catch((err) => logger.error('[scheduler] social sweep:', err.message));
    applicationFlowService.sweep().catch((err) => logger.error('[scheduler] application sweep:', err.message));
  }, 60_000);

  // Langsamer Sweep (alle 10 Min.): Statistik-Kanäle, Server-Tag-Belohnung
  if (slowInterval) clearInterval(slowInterval);
  slowInterval = setInterval(() => {
    statsChannelService.sweep().catch((err) => logger.error('[scheduler] stats sweep:', err.message));
    tagRewardService.sweep().catch((err) => logger.error('[scheduler] tag sweep:', err.message));
  }, 10 * 60_000);

  maintenanceService.start();
  logger.success('[scheduler] gestartet (Sweep alle 60s)');
}

function stop() {
  if (interval) clearInterval(interval);
  if (slowInterval) clearInterval(slowInterval);
  interval = null;
  slowInterval = null;
}

module.exports = { start, stop };
