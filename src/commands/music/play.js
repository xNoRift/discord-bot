'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const music = require('../../services/musicService');
const embeds = require('../../utils/embeds');
const { requireVoice, canControl } = require('../../utils/music');
const { L } = require('../../utils/i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Spielt einen Song ab (YouTube-Suche/-Link, Spotify-Link, Radio-Sender oder Stream-URL).')
    .addStringOption((o) => o.setName('suche').setDescription('Suchbegriff / Link / Sendername').setRequired(true)),
  async execute(interaction) {
    if (!canControl(interaction.member, interaction.settings)) {
      return interaction.reply({ embeds: [embeds.error(undefined, L('Dir fehlt die DJ-Rolle.', 'You don\'t have the DJ role.'))], flags: MessageFlags.Ephemeral });
    }
    let vc;
    try {
      vc = await requireVoice(interaction);
    } catch (e) {
      return interaction.reply({ embeds: [embeds.error(undefined, e.message)], flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
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
          ? (r.label
              ? L('➕ **{n}** Titel aus **{from}** zur Warteschlange hinzugefügt.', '➕ Added **{n}** tracks from **{from}** to the queue.', { n: r.added, from: r.label })
              : L('➕ **{n}** Titel zur Warteschlange hinzugefügt.', '➕ Added **{n}** tracks to the queue.', { n: r.added }))
          : r.startedNow
            ? L('▶️ Spiele jetzt: **{title}**', '▶️ Now playing: **{title}**', { title: r.first.title })
            : L('➕ Zur Warteschlange: **{title}**', '➕ Added to queue: **{title}**', { title: r.first.title });
      await interaction.editReply({ embeds: [embeds.success('🎵 Musik', msg)] });
    } catch (e) {
      await interaction.editReply({ embeds: [embeds.error(undefined, e.message)] });
    }
  },
};
