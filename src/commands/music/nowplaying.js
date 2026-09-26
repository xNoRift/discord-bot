'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const music = require('../../services/musicService');
const embeds = require('../../utils/embeds');
const { L } = require('../../utils/i18n');

module.exports = {
  data: new SlashCommandBuilder().setName('np').setDescription('Zeigt den aktuell laufenden Titel.'),
  async execute(interaction) {
    const s = music.getSession(interaction.guildId);
    if (!s || !s.current) {
      return interaction.reply({ embeds: [embeds.error(undefined, L('Es läuft gerade nichts.', 'Nothing is playing right now.'))], flags: MessageFlags.Ephemeral });
    }
    const c = s.current;
    const e = embeds
      .brand(L('🎵 Läuft gerade', '🎵 Now playing'), `**${c.title}**`)
      .addFields(
        { name: L('Dauer', 'Duration'), value: c.live ? 'LIVE' : music.fmtDuration(c.duration), inline: true },
        { name: L('Lautstärke', 'Volume'), value: `${s.state().volume} %`, inline: true },
        { name: L('Wiederholung', 'Loop'), value: s.loop ? L('an', 'on') : L('aus', 'off'), inline: true },
      );
    if (c.thumbnail) e.setThumbnail(c.thumbnail);
    if (c.url && /^https?:/.test(c.url)) e.setURL(c.url);
    if (s.queue.length) e.setFooter({ text: L('{n} Titel in der Warteschlange', '{n} tracks in the queue', { n: s.queue.length }) });
    return interaction.reply({ embeds: [e], flags: MessageFlags.Ephemeral });
  },
};
