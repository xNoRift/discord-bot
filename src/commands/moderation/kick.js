'use strict';

const { makeModCommand, withReason } = require('../../utils/modCommand');
const moderationService = require('../../services/moderationService');

module.exports = makeModCommand({
  name: 'kick',
  description: 'Kickt ein Mitglied vom Server.',
  needs: 'kick',
  extra: withReason,
  async run({ interaction, user, reason }) {
    return moderationService.act(interaction.guild, { action: 'kick', userId: user.id, reason, actorTag: interaction.user.tag });
  },
});
