'use strict';

const { makeModCommand, withReason } = require('../../utils/modCommand');
const moderationService = require('../../services/moderationService');

module.exports = makeModCommand({
  name: 'mute',
  description: 'Schaltet ein Mitglied stumm (Timeout).',
  needs: 'mute',
  extra: (b) => withReason(b.addIntegerOption((o) => o.setName('minuten').setDescription('Dauer in Minuten').setMinValue(1).setMaxValue(40320))),
  async run({ interaction, user, reason }) {
    return moderationService.act(interaction.guild, {
      action: 'timeout', userId: user.id, reason, minutes: interaction.options.getInteger('minuten') || 10, actorTag: interaction.user.tag,
    });
  },
});
