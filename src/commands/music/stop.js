'use strict';

const { SlashCommandBuilder } = require('discord.js');
const music = require('../../services/musicService');
const { canControl, ok, err } = require('../../utils/music');
const { L } = require('../../utils/i18n');

module.exports = {
  data: new SlashCommandBuilder().setName('stop').setDescription('Stoppt die Musik und leert die Warteschlange.'),
  async execute(interaction) {
    const s = music.getSession(interaction.guildId);
    if (!s) return err(interaction, L('Es läuft gerade nichts.', 'Nothing is playing right now.'));
    if (!canControl(interaction.member, interaction.settings)) return err(interaction, L('Dir fehlt die DJ-Rolle.', 'You don\'t have the DJ role.'));
    s.destroy(L('⏹️ Gestoppt und Sprachkanal verlassen.', '⏹️ Stopped and left the voice channel.'));
    return ok(interaction, L('⏹️ Gestoppt und Sprachkanal verlassen.', '⏹️ Stopped and left the voice channel.'));
  },
};
