'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const music = require('../../services/musicService');
const embeds = require('../../utils/embeds');
const { requireVoice, canControl } = require('../../utils/music');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Spielt einen Song ab (YouTube-Suche, YouTube-Link, Radio-Sender oder Stream-URL).')
    .addStringOption((o) => o.setName('suche').setDescription('Suchbegriff / Link / Sendername').setRequired(true)),
  async execute(interaction) {
    if (!canControl(interaction.member, interaction.settings)) {
      return interaction.reply({ embeds: [embeds.error(undefined, 'Dir fehlt die DJ-Rolle.')], flags: MessageFlags.Ephemeral });
    }
    let vc;
    try {
      vc = await requireVoice(interaction);
    } catch (e) {
      return interaction.reply({ embeds: [embeds.error(undefined, e.message)], flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply();
    try {
      const query = interaction.options.getString('suche');
      const r = await music.play(
        interaction.guild,
        vc,
        interaction.channelId,
        query,
        { id: interaction.user.id, tag: interaction.user.tag },
      );
      const msg =
        r.added > 1
          ? `➕ **${r.added}** Titel zur Warteschlange hinzugefügt.`
          : r.startedNow
            ? `▶️ Spiele jetzt: **${r.first.title}**`
            : `➕ Zur Warteschlange: **${r.first.title}**`;
      await interaction.editReply({ embeds: [embeds.success('🎵 Musik', msg)] });
    } catch (e) {
      await interaction.editReply({ embeds: [embeds.error(undefined, e.message)] });
    }
  },
};
