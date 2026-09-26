'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const music = require('../../services/musicService');
const embeds = require('../../utils/embeds');
const { requireVoice, canControl } = require('../../utils/music');
const { L } = require('../../utils/i18n');

module.exports = {
  data: new SlashCommandBuilder().setName('join').setDescription('Holt den Bot in deinen Sprachkanal.'),
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
      await music.join(interaction.guild, vc, interaction.channelId);
      await interaction.editReply({ embeds: [embeds.success(L('🔊 Verbunden', '🔊 Connected'), L('Ich bin jetzt in **{channel}**. Starte etwas mit `/play` oder `/radio`.', 'I\'m now in **{channel}**. Start something with `/play` or `/radio`.', { channel: vc.name }))] });
    } catch (e) {
      await interaction.editReply({ embeds: [embeds.error(undefined, e.message)] });
    }
  },
};
