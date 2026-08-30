'use strict';

const tempVoiceService = require('../services/tempVoiceService');
const musicService = require('../services/musicService');
const logger = require('../utils/logger');

module.exports = {
  name: 'voiceStateUpdate',
  async execute(oldState, newState) {
    try {
      await tempVoiceService.onVoiceUpdate(oldState, newState);
    } catch (err) {
      logger.error('[voiceStateUpdate] Temp-Voice:', err.message);
    }

    // Musik: wenn der Bot mit niemandem mehr im Sprachkanal ist -> verlassen.
    try {
      const guild = newState.guild || oldState.guild;
      const session = musicService.getSession(guild.id);
      if (session && session.voiceChannelId) {
        const vc = guild.channels.cache.get(session.voiceChannelId);
        const humans = vc ? vc.members.filter((m) => !m.user.bot).size : 0;
        if (humans === 0) {
          setTimeout(() => {
            const s = musicService.getSession(guild.id);
            const c = s && guild.channels.cache.get(s.voiceChannelId);
            if (s && (!c || c.members.filter((m) => !m.user.bot).size === 0)) {
              s._announce?.('👋 Niemand mehr im Sprachkanal – ich verlasse ihn.');
              s.destroy();
            }
          }, 20000);
        }
      }
    } catch (err) {
      logger.warn('[voiceStateUpdate] Musik:', err.message);
    }
  },
};
