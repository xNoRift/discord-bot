'use strict';

const { SlashCommandBuilder } = require('discord.js');
const music = require('../../services/musicService');
const { canControl, ok, err } = require('../../utils/music');

module.exports = {
  data: new SlashCommandBuilder().setName('resume').setDescription('Setzt die Wiedergabe fort.'),
  async execute(interaction) {
    const s = music.getSession(interaction.guildId);
    if (!s || !s.current) return err(interaction, 'Es läuft gerade nichts.');
    if (!canControl(interaction.member, interaction.settings)) return err(interaction, 'Dir fehlt die DJ-Rolle.');
    return s.resume() ? ok(interaction, '▶️ Weiter geht\'s.') : err(interaction, 'Konnte nicht fortsetzen.');
  },
};
