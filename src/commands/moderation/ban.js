'use strict';

const { makeModCommand, withReason } = require('../../utils/modCommand');
const moderationService = require('../../services/moderationService');

module.exports = makeModCommand({
  name: 'ban',
  description: 'Bannt ein Mitglied vom Server.',
  needs: 'ban',
  extra: withReason,
  async run({ interaction, user, reason }) {
    return moderationService.act(interaction.guild, { action: 'ban', userId: user.id, reason, actorTag: interaction.user.tag });
  },
});
