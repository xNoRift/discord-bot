'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const music = require('../../services/musicService');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder().setName('queue').setDescription('Zeigt die Warteschlange.'),
  async execute(interaction) {
    const s = music.getSession(interaction.guildId);
    if (!s || (!s.current && !s.queue.length)) {
      return interaction.reply({ embeds: [embeds.error(undefined, 'Die Warteschlange ist leer.')], flags: MessageFlags.Ephemeral });
    }
    const lines = s.queue
      .slice(0, 15)
      .map((t, i) => `\`${i + 1}.\` ${t.title}${t.live ? ' _(Live)_' : ` \`${music.fmtDuration(t.duration)}\``}`);
    const more = s.queue.length > 15 ? `\n… und **${s.queue.length - 15}** weitere` : '';
    const e = embeds.brand('🎶 Warteschlange', s.current ? `**Jetzt:** ${s.current.title}\n\n${lines.join('\n') || '_leer_'}${more}` : lines.join('\n') + more);
    return interaction.reply({ embeds: [e] });
  },
};
