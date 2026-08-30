'use strict';

const autoRoleService = require('../services/autoRoleService');
const welcomeService = require('../services/welcomeService');
const logger = require('../utils/logger');

/**
 * Falls der Server "Regeln zustimmen" (Membership Screening) nutzt, ist ein
 * frisch beigetretenes Mitglied erst "pending". Sobald es zustimmt, feuert
 * guildMemberUpdate mit pending: true -> false. Dann Auto-Rolle nachholen.
 */
module.exports = {
  name: 'guildMemberUpdate',
  async execute(oldMember, newMember) {
    try {
      if (oldMember.pending && !newMember.pending) {
        await autoRoleService.applyOnJoin(newMember);
        await welcomeService.sendJoin(newMember);
      }
    } catch (err) {
      logger.error('[guildMemberUpdate] Beitritt:', err.message);
    }
  },
};
