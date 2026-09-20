'use strict';

const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const moduleSettings = require('../database/models/moduleSettings');
const config = require('../../config/config');

/**
 * Voice-Support: Betritt jemand den Warteraum, wird das Support-Team im Benachrichtigungs-Kanal gepingt.
 */

const lastPing = new Map(); // guildId:userId -> timestamp
const COOLDOWN_MS = 60_000;

async function onVoice(oldState, newState) {
  const channelId = newState.channelId;
  if (!channelId || channelId === oldState.channelId || newState.member?.user.bot) return;
  const cfg = moduleSettings.get(newState.guild.id, 'voicesupport');
  if (!cfg.enabled || channelId !== cfg.waitingChannelId) return;

  const key = `${newState.guild.id}:${newState.id}`;
  if (Date.now() - (lastPing.get(key) || 0) < COOLDOWN_MS) return;
  lastPing.set(key, Date.now());

  const notify = newState.guild.channels.cache.get(cfg.notifyChannelId);
  if (!notify || !notify.isTextBased()) return;
  const me = newState.guild.members.me;
  if (me && !notify.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) return;

  const embed = new EmbedBuilder()
    .setColor(config.branding.color)
    .setTitle('🎧 Jemand wartet auf Support')
    .setDescription(`<@${newState.id}> wartet im Sprachkanal <#${channelId}>.`)
    .setTimestamp();
  const role = cfg.roleId && newState.guild.roles.cache.has(cfg.roleId) ? cfg.roleId : null;
  await notify.send({
    content: role ? `<@&${role}>` : undefined,
    embeds: [embed],
    allowedMentions: role ? { roles: [role] } : { parse: [] },
  });
}

module.exports = { onVoice };
