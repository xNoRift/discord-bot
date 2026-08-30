'use strict';

const { SlashCommandBuilder } = require('discord.js');
const music = require('../../services/musicService');
const { canControl, ok, err } = require('../../utils/music');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Setzt die Lautstärke (0–150 %).')
    .addIntegerOption((o) => o.setName('prozent').setDescription('0–150').setMinValue(0).setMaxValue(150).setRequired(true)),
  async execute(interaction) {
    const s = music.getSession(interaction.guildId);
    if (!s) return err(interaction, 'Es läuft gerade nichts.');
    if (!canControl(interaction.member, interaction.settings)) return err(interaction, 'Dir fehlt die DJ-Rolle.');
    const v = s.setVolume(interaction.options.getInteger('prozent') / 100);
    return ok(interaction, `🔊 Lautstärke: **${Math.round(v * 100)} %**`);
  },
};
