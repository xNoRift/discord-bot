'use strict';

const { makeModCommand } = require('../../utils/modCommand');
const modWarns = require('../../database/models/modWarns');
const { L } = require('../../utils/i18n');

module.exports = makeModCommand({
  name: 'warnings',
  description: 'Zeigt die Verwarnungen eines Mitglieds.',
  needs: 'warn',
  async run({ interaction, user }) {
    const rows = modWarns.list(interaction.guildId, user.id);
    if (!rows.length) return L('{user} hat keine Verwarnungen.', '{user} has no warnings.', { user: user.tag });
    const lines = rows.map((w, i) => `${i + 1}. <t:${Math.floor(w.created_at / 1000)}:d> – ${w.reason || L('Kein Grund', 'No reason')}`);
    return `**${L('Verwarnungen von {user}', 'Warnings of {user}', { user: user.tag })}** (${rows.length}):\n${lines.join('\n')}`.slice(0, 1900);
  },
});
