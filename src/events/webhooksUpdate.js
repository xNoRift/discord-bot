'use strict';

const antiNukeService = require('../services/antiNukeService');
const logger = require('../utils/logger');

module.exports = {
  name: 'webhooksUpdate',
  async execute(channel) {
    try {
      await antiNukeService.onWebhookChannelUpdate(channel);
    } catch (err) {
      logger.error('[webhooksUpdate] Anti-Nuke:', err.message);
    }
  },
};
