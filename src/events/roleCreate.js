'use strict';

const antiNukeService = require('../services/antiNukeService');
const logger = require('../utils/logger');

module.exports = {
  name: 'roleCreate',
  async execute(role) {
    try {
      await antiNukeService.onRoleCreate(role);
    } catch (err) {
      logger.error('[roleCreate] Anti-Nuke:', err.message);
    }
  },
};
