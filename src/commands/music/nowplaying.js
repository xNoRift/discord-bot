'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const music = require('../../services/musicService');
const embeds = require('../../utils/embeds');

module.exports = {
  data: new SlashCommandBuilder().setName('np').setDescription('Zeigt den aktuell laufenden Titel.'),
  async execute(interaction) {
    const s = music.getSession(interaction.guildId);
    if (!s || !s.current) {
      return interaction.reply({ embeds: [embeds.error(undefined, 'Es läuft gerade nichts.')], flags: MessageFlags.Ephemeral });
    }
    const c = s.current;
    const e = embeds
      .brand('🎵 Läuft gerade', `**${c.title}**`)
      .addFields(
        { name: 'Dauer', value: c.live ? 'LIVE' : music.fmtDuration(c.duration), inline: true },
        { name: 'Lautstärke', value: `${s.state().volume} %`, inline: true },
        { name: 'Wiederholung', value: s.loop ? 'an' : 'aus', inline: true },
      );
    if (c.thumbnail) e.setThumbnail(c.thumbnail);
    if (c.url && /^https?:/.test(c.url)) e.setURL(c.url);
    if (s.queue.length) e.setFooter({ text: `${s.queue.length} Titel in der Warteschlange` });
    return interaction.reply({ embeds: [e] });
  },
};
