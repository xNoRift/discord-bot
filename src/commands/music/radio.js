'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const music = require('../../services/musicService');
const embeds = require('../../utils/embeds');
const { requireVoice, canControl } = require('../../utils/music');
const { L } = require('../../utils/i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('radio')
    .setDescription('Spielt einen Radio-Sender ab.')
    .addStringOption((o) =>
      o.setName('sender').setDescription('Sender wählen').setRequired(true).setAutocomplete(true),
    ),
  async autocomplete(interaction) {
    const q = interaction.options.getFocused().toLowerCase();
    const list = music.allStations(interaction.guildId);
    const hits = list
      .filter((s) => !q || s.name.toLowerCase().includes(q) || (s.genre || '').toLowerCase().includes(q))
      .slice(0, 25)
      .map((s) => ({ name: `${s.name}${s.genre ? ` · ${s.genre}` : ''}`.slice(0, 100), value: s.name }));
    await interaction.respond(hits);
  },
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
      const r = await music.playStation(
        interaction.guild,
        vc,
        interaction.channelId,
        interaction.options.getString('sender'),
        { id: interaction.user.id, tag: interaction.user.tag },
      );
      await interaction.editReply({
        embeds: [embeds.success('📻 Radio', r.startedNow ? L('Läuft jetzt: **{title}**', 'Now playing: **{title}**', { title: r.first.title }) : L('Zur Warteschlange: **{title}**', 'Added to queue: **{title}**', { title: r.first.title }))],
      });
    } catch (e) {
      await interaction.editReply({ embeds: [embeds.error(undefined, e.message)] });
    }
  },
};
