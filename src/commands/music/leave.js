'use strict';

const { SlashCommandBuilder } = require('discord.js');
const music = require('../../services/musicService');
const { canControl, ok, err } = require('../../utils/music');

module.exports = {
  data: new SlashCommandBuilder().setName('leave').setDescription('Der Bot verlässt den Sprachkanal.'),
  async execute(interaction) {
    const s = music.getSession(interaction.guildId);
    if (!s) return err(interaction, 'Der Bot ist in keinem Sprachkanal.');
    if (!canControl(interaction.member, interaction.settings)) return err(interaction, 'Dir fehlt die DJ-Rolle.');
    s.destroy();
    return ok(interaction, '👋 Sprachkanal verlassen.');
  },
};
