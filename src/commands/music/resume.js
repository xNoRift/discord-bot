'use strict';

const { SlashCommandBuilder } = require('discord.js');
const music = require('../../services/musicService');
const { canControl, ok, err } = require('../../utils/music');
const { L } = require('../../utils/i18n');

module.exports = {
  data: new SlashCommandBuilder().setName('resume').setDescription('Setzt die Wiedergabe fort.'),
  async execute(interaction) {
    const s = music.getSession(interaction.guildId);
    if (!s || !s.current) return err(interaction, L('Es läuft gerade nichts.', 'Nothing is playing right now.'));
    if (!canControl(interaction.member, interaction.settings)) return err(interaction, L('Dir fehlt die DJ-Rolle.', 'You don\'t have the DJ role.'));
    return s.resume() ? ok(interaction, L('▶️ Weiter geht\'s.', '▶️ Resumed.')) : err(interaction, L('Konnte nicht fortsetzen.', 'Could not resume.'));
  },
};
