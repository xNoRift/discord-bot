'use strict';

const { MessageFlags } = require('discord.js');
const embeds = require('./embeds');
const { isManager } = require('./permissions');
const { L } = require('./i18n');

/**
 * Gemeinsame Helfer für die Musik-Slash-Commands.
 */

/** Das Mitglied muss in einem Sprachkanal sein (und der Bot darf dort rein). */
async function requireVoice(interaction) {
  const member = interaction.member;
  const vc = member?.voice?.channel;
  if (!vc) {
    throw new Error(L('Du musst zuerst einem Sprachkanal beitreten.', 'You need to join a voice channel first.'));
  }
  const me = interaction.guild.members.me;
  const perms = vc.permissionsFor(me);
  if (!perms?.has('Connect') || !perms?.has('Speak')) {
    throw new Error(L('Der Bot darf diesem Sprachkanal nicht beitreten oder dort nicht sprechen.', 'The bot is not allowed to join or speak in this voice channel.'));
  }
  const botVc = me.voice?.channel;
  if (botVc && botVc.id !== vc.id) {
    throw new Error(L('Der Bot spielt gerade in **{channel}**.', 'The bot is currently playing in **{channel}**.', { channel: botVc.name }));
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

/** Bestätigungen sind nur für den Befehlsnutzer sichtbar (temporär) – dauerhaft sichtbar ist nur das Steuerungspanel. */
function ok(interaction, text) {
  const p = { embeds: [embeds.success(undefined, text)], flags: MessageFlags.Ephemeral };
  return interaction.deferred || interaction.replied ? interaction.editReply(p) : interaction.reply(p);
}
function err(interaction, text) {
  const p = { embeds: [embeds.error(undefined, text)], flags: MessageFlags.Ephemeral };
  return interaction.deferred || interaction.replied ? interaction.editReply(p) : interaction.reply(p);
}

module.exports = { requireVoice, canControl, ok, err };
