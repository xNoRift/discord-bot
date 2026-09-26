'use strict';

const { SlashCommandBuilder } = require('discord.js');
const music = require('../../services/musicService');
const { canControl, ok, err } = require('../../utils/music');
const { L } = require('../../utils/i18n');

module.exports = {
  data: new SlashCommandBuilder().setName('leave').setDescription('Der Bot verlässt den Sprachkanal.'),
  async execute(interaction) {
    const s = music.getSession(interaction.guildId);
    if (!s) return err(interaction, L('Der Bot ist in keinem Sprachkanal.', 'The bot is not in a voice channel.'));
    if (!canControl(interaction.member, interaction.settings)) return err(interaction, L('Dir fehlt die DJ-Rolle.', 'You don\'t have the DJ role.'));
    s.destroy(L('👋 Sprachkanal verlassen.', '👋 Left the voice channel.'));
    return ok(interaction, L('👋 Sprachkanal verlassen.', '👋 Left the voice channel.'));
  },
};
