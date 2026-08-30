'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const music = require('../../services/musicService');
const embeds = require('../../utils/embeds');
const { requireVoice, canControl } = require('../../utils/music');

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
      const r = await music.playStation(
        interaction.guild,
        vc,
        interaction.channelId,
        interaction.options.getString('sender'),
        { id: interaction.user.id, tag: interaction.user.tag },
      );
      await interaction.editReply({
        embeds: [embeds.success('📻 Radio', r.startedNow ? `Läuft jetzt: **${r.first.title}**` : `Zur Warteschlange: **${r.first.title}**`)],
      });
    } catch (e) {
      await interaction.editReply({ embeds: [embeds.error(undefined, e.message)] });
    }
  },
};
