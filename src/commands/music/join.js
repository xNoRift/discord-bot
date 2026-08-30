'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const music = require('../../services/musicService');
const embeds = require('../../utils/embeds');
const { requireVoice, canControl } = require('../../utils/music');

module.exports = {
  data: new SlashCommandBuilder().setName('join').setDescription('Holt den Bot in deinen Sprachkanal.'),
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
      await music.join(interaction.guild, vc, interaction.channelId);
      await interaction.editReply({ embeds: [embeds.success('🔊 Verbunden', `Ich bin jetzt in **${vc.name}**. Starte etwas mit \`/play\` oder \`/radio\`.`)] });
    } catch (e) {
      await interaction.editReply({ embeds: [embeds.error(undefined, e.message)] });
    }
  },
};
