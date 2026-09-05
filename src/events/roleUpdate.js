'use strict';

const antiNukeService = require('../services/antiNukeService');
const logger = require('../utils/logger');

module.exports = {
  name: 'roleUpdate',
  async execute(oldRole, newRole) {
    try {
      await antiNukeService.onRoleUpdate(oldRole, newRole);
    } catch (err) {
      logger.error('[roleUpdate] Anti-Nuke:', err.message);
    }
  },
};
