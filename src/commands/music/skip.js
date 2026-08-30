'use strict';

const { SlashCommandBuilder } = require('discord.js');
const music = require('../../services/musicService');
const { canControl, ok, err } = require('../../utils/music');

module.exports = {
  data: new SlashCommandBuilder().setName('skip').setDescription('Überspringt den aktuellen Titel.'),
  async execute(interaction) {
    const s = music.getSession(interaction.guildId);
    if (!s || !s.current) return err(interaction, 'Es läuft gerade nichts.');
    if (!canControl(interaction.member, interaction.settings)) return err(interaction, 'Dir fehlt die DJ-Rolle.');
    const skipped = s.skip();
    return ok(interaction, `⏭️ Übersprungen: **${skipped?.title || '—'}**`);
  },
};
