'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const music = require('../../services/musicService');
const embeds = require('../../utils/embeds');
const { L } = require('../../utils/i18n');

module.exports = {
  data: new SlashCommandBuilder().setName('queue').setDescription('Zeigt die Warteschlange.'),
  async execute(interaction) {
    const s = music.getSession(interaction.guildId);
    if (!s || (!s.current && !s.queue.length)) {
      return interaction.reply({ embeds: [embeds.error(undefined, L('Die Warteschlange ist leer.', 'The queue is empty.'))], flags: MessageFlags.Ephemeral });
    }
    const lines = s.queue
      .slice(0, 15)
      .map((t, i) => `\`${i + 1}.\` ${t.title}${t.live ? ' _(Live)_' : ` \`${music.fmtDuration(t.duration)}\``}`);
    const more = s.queue.length > 15 ? '\n' + L('… und **{n}** weitere', '… and **{n}** more', { n: s.queue.length - 15 }) : '';
    const e = embeds.brand(L('🎶 Warteschlange', '🎶 Queue'), s.current ? `**Jetzt:** ${s.current.title}\n\n${lines.join('\n') || '_leer_'}${more}` : lines.join('\n') + more);
    return interaction.reply({ embeds: [e], flags: MessageFlags.Ephemeral });
  },
};
