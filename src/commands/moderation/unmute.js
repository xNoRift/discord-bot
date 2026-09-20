'use strict';

const { makeModCommand } = require('../../utils/modCommand');
const moderationService = require('../../services/moderationService');

module.exports = makeModCommand({
  name: 'unmute',
  description: 'Hebt den Timeout eines Mitglieds auf.',
  needs: 'mute',
  async run({ interaction, user }) {
    return moderationService.act(interaction.guild, { action: 'untimeout', userId: user.id, actorTag: interaction.user.tag });
  },
});
