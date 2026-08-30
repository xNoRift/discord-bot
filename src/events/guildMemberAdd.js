'use strict';

const autoRoleService = require('../services/autoRoleService');
const welcomeService = require('../services/welcomeService');
const logger = require('../utils/logger');

module.exports = {
  name: 'guildMemberAdd',
  async execute(member) {
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
