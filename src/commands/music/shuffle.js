'use strict';

const { SlashCommandBuilder } = require('discord.js');
const music = require('../../services/musicService');
const { canControl, ok, err } = require('../../utils/music');
const { L } = require('../../utils/i18n');

module.exports = {
  data: new SlashCommandBuilder().setName('shuffle').setDescription('Mischt die Warteschlange.'),
  async execute(interaction) {
    const s = music.getSession(interaction.guildId);
    if (!s || !s.queue.length) return err(interaction, L('Die Warteschlange ist leer.', 'The queue is empty.'));
    if (!canControl(interaction.member, interaction.settings)) return err(interaction, L('Dir fehlt die DJ-Rolle.', 'You don\'t have the DJ role.'));
    s.shuffle();
    return ok(interaction, L('🔀 Warteschlange gemischt (**{n}** Titel).', '🔀 Queue shuffled (**{n}** tracks).', { n: s.queue.length }));
  },
};
