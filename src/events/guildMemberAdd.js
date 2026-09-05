'use strict';

const autoRoleService = require('../services/autoRoleService');
const welcomeService = require('../services/welcomeService');
const antiRaidService = require('../services/antiRaidService');
const antiNukeService = require('../services/antiNukeService');
const logger = require('../utils/logger');

module.exports = {
  name: 'guildMemberAdd',
  async execute(member) {
    if (member.user?.bot) {
      try {
        await antiNukeService.onBotAdd(member);
      } catch (err) {
        logger.error('[guildMemberAdd] Anti-Nuke (Bot-Add):', err.message);
      }
    }

    try {
      const removed = await antiRaidService.handleJoin(member);
      if (removed) return; // Mitglied wurde gekickt/gebannt - keine Auto-Rolle/Willkommensnachricht mehr
    } catch (err) {
      logger.error('[guildMemberAdd] Anti-Raid:', err.message);
    }

    try {
      await autoRoleService.applyOnJoin(member);
    } catch (err) {
      logger.error('[guildMemberAdd] Auto-Rolle:', err.message);
    }

    // Bei aktivem Membership-Screening ist das Mitglied noch "pending" –
    // dann übernimmt guildMemberUpdate die Willkommensnachricht.
    if (member.pending) return;
    try {
      await welcomeService.sendJoin(member);
    } catch (err) {
      logger.error('[guildMemberAdd] Willkommen:', err.message);
    }
  },
};
