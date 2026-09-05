'use strict';

const antiNukeService = require('../services/antiNukeService');
const logger = require('../utils/logger');

module.exports = {
  name: 'guildBanAdd',
  async execute(ban) {
    try {
      await antiNukeService.onBanAdd(ban);
    } catch (err) {
      logger.error('[guildBanAdd] Anti-Nuke:', err.message);
    }
  },
};
