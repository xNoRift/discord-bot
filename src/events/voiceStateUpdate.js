'use strict';

const tempVoiceService = require('../services/tempVoiceService');
const logger = require('../utils/logger');

module.exports = {
  name: 'voiceStateUpdate',
  async execute(oldState, newState) {
    try {
      await tempVoiceService.onVoiceUpdate(oldState, newState);
    } catch (err) {
      logger.error('[voiceStateUpdate] Temp-Voice:', err.message);
    }
  },
};
