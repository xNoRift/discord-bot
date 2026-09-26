'use strict';

const { SlashCommandBuilder } = require('discord.js');
const music = require('../../services/musicService');
const { canControl, ok, err } = require('../../utils/music');
const { L } = require('../../utils/i18n');

module.exports = {
  data: new SlashCommandBuilder().setName('skip').setDescription('Überspringt den aktuellen Titel.'),
  async execute(interaction) {
    const s = music.getSession(interaction.guildId);
    if (!s || !s.current) return err(interaction, L('Es läuft gerade nichts.', 'Nothing is playing right now.'));
    if (!canControl(interaction.member, interaction.settings)) return err(interaction, L('Dir fehlt die DJ-Rolle.', 'You don\'t have the DJ role.'));
    const skipped = s.skip();
    return ok(interaction, L('⏭️ Übersprungen: **{title}**', '⏭️ Skipped: **{title}**', { title: skipped?.title || '—' }));
  },
};
