'use strict';

const { SlashCommandBuilder } = require('discord.js');
const music = require('../../services/musicService');
const { canControl, ok, err } = require('../../utils/music');

module.exports = {
  data: new SlashCommandBuilder().setName('shuffle').setDescription('Mischt die Warteschlange.'),
  async execute(interaction) {
    const s = music.getSession(interaction.guildId);
    if (!s || !s.queue.length) return err(interaction, 'Die Warteschlange ist leer.');
    if (!canControl(interaction.member, interaction.settings)) return err(interaction, 'Dir fehlt die DJ-Rolle.');
    s.shuffle();
    return ok(interaction, `🔀 Warteschlange gemischt (**${s.queue.length}** Titel).`);
  },
};
