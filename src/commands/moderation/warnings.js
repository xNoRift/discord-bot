'use strict';

const { makeModCommand } = require('../../utils/modCommand');
const modWarns = require('../../database/models/modWarns');

module.exports = makeModCommand({
  name: 'warnings',
  description: 'Zeigt die Verwarnungen eines Mitglieds.',
  needs: 'warn',
  async run({ interaction, user }) {
    const rows = modWarns.list(interaction.guildId, user.id);
    if (!rows.length) return `${user.tag} hat keine Verwarnungen.`;
    const lines = rows.map((w, i) => `${i + 1}. <t:${Math.floor(w.created_at / 1000)}:d> – ${w.reason || 'Kein Grund'}`);
    return `**Verwarnungen von ${user.tag}** (${rows.length}):\n${lines.join('\n')}`.slice(0, 1900);
  },
});
