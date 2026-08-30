'use strict';

const { SlashCommandBuilder } = require('discord.js');
const music = require('../../services/musicService');
const { canControl, ok, err } = require('../../utils/music');

module.exports = {
  data: new SlashCommandBuilder().setName('pause').setDescription('Pausiert die Wiedergabe.'),
  async execute(interaction) {
    const s = music.getSession(interaction.guildId);
    if (!s || !s.current) return err(interaction, 'Es läuft gerade nichts.');
    if (!canControl(interaction.member, interaction.settings)) return err(interaction, 'Dir fehlt die DJ-Rolle.');
    return s.pause() ? ok(interaction, '⏸️ Pausiert.') : err(interaction, 'Konnte nicht pausieren.');
  },
};
