'use strict';

const { MessageFlags } = require('discord.js');
const embeds = require('./embeds');
const { isManager } = require('./permissions');

/**
 * Gemeinsame Helfer für die Musik-Slash-Commands.
 */

/** Das Mitglied muss in einem Sprachkanal sein (und der Bot darf dort rein). */
async function requireVoice(interaction) {
  const member = interaction.member;
  const vc = member?.voice?.channel;
  if (!vc) {
    throw new Error('Du musst zuerst einem Sprachkanal beitreten.');
  }
  const me = interaction.guild.members.me;
  const perms = vc.permissionsFor(me);
  if (!perms?.has('Connect') || !perms?.has('Speak')) {
    throw new Error('Der Bot darf diesem Sprachkanal nicht beitreten oder dort nicht sprechen.');
  }
  const botVc = me.voice?.channel;
  if (botVc && botVc.id !== vc.id) {
    throw new Error(`Der Bot spielt gerade in **${botVc.name}**.`);
  }
  return vc;
}

/** Darf dieses Mitglied die Musik steuern? (DJ-Rolle oder Manager – oder gar keine Rolle gesetzt) */
function canControl(member, settings) {
  if (isManager(member)) return true;
  const djRole = settings?.music_dj_role_id;
  if (!djRole) return true; // keine DJ-Rolle konfiguriert -> alle dürfen
  return member.roles.cache.has(djRole);
}

function ok(interaction, text) {
  return interaction.reply({ embeds: [embeds.success(undefined, text)] });
}
function err(interaction, text) {
  const p = { embeds: [embeds.error(undefined, text)], flags: MessageFlags.Ephemeral };
  return interaction.deferred || interaction.replied ? interaction.editReply(p) : interaction.reply(p);
}

module.exports = { requireVoice, canControl, ok, err };
