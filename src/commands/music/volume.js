'use strict';

const { SlashCommandBuilder } = require('discord.js');
const music = require('../../services/musicService');
const { canControl, ok, err } = require('../../utils/music');
const { L } = require('../../utils/i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription('Setzt die Lautstärke (0–150 %).')
    .addIntegerOption((o) => o.setName('prozent').setDescription('0–150').setMinValue(0).setMaxValue(150).setRequired(true)),
  async execute(interaction) {
    const s = music.getSession(interaction.guildId);
    if (!s) return err(interaction, L('Es läuft gerade nichts.', 'Nothing is playing right now.'));
    if (!canControl(interaction.member, interaction.settings)) return err(interaction, L('Dir fehlt die DJ-Rolle.', 'You don\'t have the DJ role.'));
    const v = s.setVolume(interaction.options.getInteger('prozent') / 100);
    return ok(interaction, L('🔊 Lautstärke: **{v} %**', '🔊 Volume: **{v} %**', { v: Math.round(v * 100) }));
  },
};
