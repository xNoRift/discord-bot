'use strict';

const antiNukeService = require('../services/antiNukeService');
const logger = require('../utils/logger');

module.exports = {
  name: 'roleDelete',
  async execute(role) {
    try {
      await antiNukeService.onRoleDelete(role);
    } catch (err) {
      logger.error('[roleDelete] Anti-Nuke:', err.message);
    }
  },
};
