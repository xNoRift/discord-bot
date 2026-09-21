'use strict';

const { MessageFlags } = require('discord.js');
const moduleSettings = require('../../database/models/moduleSettings');
const ruleSections = require('../../database/models/ruleSections');
const rulesService = require('../../services/rulesService');

module.exports = {
  prefix: 'rules:show',
  async execute(interaction) {
    const reply = (payload) => interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    const cfg = moduleSettings.get(interaction.guildId, 'rules');
    if (!cfg.enabled) return reply({ content: 'Die Regeln sind gerade nicht aktiv.' });
    const section = ruleSections.get(Number(interaction.customId.split(':')[2]));
    if (!section || section.guild_id !== interaction.guildId) {
      return reply({ content: 'Diesen Abschnitt gibt es nicht mehr. Bitte ein Teammitglied informieren.' });
    }
    return reply({ embeds: [rulesService.sectionEmbed(cfg, section)] });
  },
};
