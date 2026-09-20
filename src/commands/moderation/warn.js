'use strict';

const { makeModCommand, withReason } = require('../../utils/modCommand');
const moderationService = require('../../services/moderationService');

module.exports = makeModCommand({
  name: 'warn',
  description: 'Verwarnt ein Mitglied.',
  needs: 'warn',
  extra: withReason,
  async run({ interaction, user, reason }) {
    const r = await moderationService.warn(interaction.guild, {
      userId: user.id, reason, moderatorId: interaction.user.id, actorTag: interaction.user.tag,
    });
    return `⚠️ ${r.summary}.${r.limitHit ? `\nWarnlimit erreicht → Aktion: ${r.limitHit}.` : ''}`;
  },
});
