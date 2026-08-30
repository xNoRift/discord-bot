'use strict';

const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const settingsModel = require('../database/models/settings');
const config = require('../../config/config');
const logger = require('../utils/logger');

/**
 * Willkommens-/Abschieds-System: postet beim Beitritt/Verlassen eine Nachricht
 * in einen konfigurierten Kanal und schickt optional eine Willkommens-DM.
 * Die automatische Rollenvergabe beim Beitritt läuft über den autoRoleService.
 */

function parseHexColor(input, fallback) {
  const m = String(input || '').trim().match(/^#?([0-9a-fA-F]{6})$/);
  return m ? parseInt(m[1], 16) : fallback;
}

/**
 * Ersetzt Platzhalter in einer Vorlage.
 * {user}/{mention} {username} {user.tag} {server} {membercount}
 */
function render(template, member, guild) {
  const count = guild.memberCount ?? guild.members?.cache?.size ?? 0;
  return String(template || '')
    .replaceAll('{user}', `<@${member.id}>`)
    .replaceAll('{mention}', `<@${member.id}>`)
    .replaceAll('{user.tag}', member.user.tag)
    .replaceAll('{username}', member.user.username)
    .replaceAll('{server}', guild.name)
    .replaceAll('{guild}', guild.name)
    .replaceAll('{membercount}', String(count))
    .replaceAll('{memberCount}', String(count))
    .replaceAll('{count}', String(count))
    .slice(0, 4000);
}

function canPost(channel, me) {
  if (!channel || !channel.isTextBased?.() || !me) return false;
  const p = channel.permissionsFor(me);
  return Boolean(p?.has(PermissionFlagsBits.ViewChannel) && p?.has(PermissionFlagsBits.SendMessages));
}

async function post(guild, channelId, { asEmbed, color, text, member, ping }) {
  const channel = guild.channels.cache.get(String(channelId || ''));
  const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  if (!canPost(channel, me)) {
    logger.warn(`[welcome] Kanal ${channelId} in ${guild.id} nicht beschreibbar.`);
    return null;
  }

  if (asEmbed) {
    const embed = new EmbedBuilder()
      .setColor(color)
      .setDescription(text || '​')
      .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL() })
      .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
      .setTimestamp();
    const payload = { embeds: [embed] };
    if (ping) {
      payload.content = `<@${member.id}>`;
      payload.allowedMentions = { users: [member.id] };
    } else {
      payload.allowedMentions = { parse: [] };
    }
    return channel.send(payload).catch((err) => logger.warn(`[welcome] send: ${err.message}`));
  }

  return channel
    .send({ content: text, allowedMentions: { users: ping ? [member.id] : [] } })
    .catch((err) => logger.warn(`[welcome] send: ${err.message}`));
}

/** Beitritt: Kanal-Nachricht + optionale DM. */
async function sendJoin(member) {
  if (member.user.bot) return;
  const s = settingsModel.get(member.guild.id);
  if (!s.welcome_enabled) return;

  const color = parseHexColor(s.welcome_color, config.branding.color);

  if (s.welcome_channel_id) {
    await post(member.guild, s.welcome_channel_id, {
      asEmbed: s.welcome_embed !== 0,
      color,
      text: render(s.welcome_message || config.defaults.welcomeMessage, member, member.guild),
      member,
      ping: s.welcome_ping !== 0,
    });
  }

  if (s.welcome_dm_enabled && s.welcome_dm_message) {
    await member
      .send(render(s.welcome_dm_message, member, member.guild).slice(0, 2000))
      .catch(() => null); // DMs des Nutzers evtl. geschlossen
  }
}

/** Verlassen: Abschieds-Nachricht (Standard: aus). */
async function sendLeave(member) {
  const s = settingsModel.get(member.guild.id);
  if (!s.leave_enabled || !s.leave_channel_id) return;
  await post(member.guild, s.leave_channel_id, {
    asEmbed: false,
    color: config.branding.color,
    text: render(s.leave_message || config.defaults.leaveMessage, member, member.guild).slice(0, 2000),
    member,
    ping: false,
  });
}

module.exports = { sendJoin, sendLeave, render };
