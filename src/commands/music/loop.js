'use strict';

const { SlashCommandBuilder } = require('discord.js');
const music = require('../../services/musicService');
const { canControl, ok, err } = require('../../utils/music');

module.exports = {
  data: new SlashCommandBuilder().setName('loop').setDescription('Wiederholung des aktuellen Titels an/aus.'),
  async execute(interaction) {
    const s = music.getSession(interaction.guildId);
    if (!s) return err(interaction, 'Es läuft gerade nichts.');
    if (!canControl(interaction.member, interaction.settings)) return err(interaction, 'Dir fehlt die DJ-Rolle.');
    return ok(interaction, s.toggleLoop() ? '🔁 Wiederholung **an**.' : '➡️ Wiederholung **aus**.');
  },
};
