'use strict';

const autoRoleService = require('../services/autoRoleService');
const logger = require('../utils/logger');

module.exports = {
  name: 'guildMemberAdd',
  async execute(member) {
    try {
      await autoRoleService.applyOnJoin(member);
    } catch (err) {
      logger.error('[guildMemberAdd] Auto-Rolle:', err.message);
    }
  },
};
