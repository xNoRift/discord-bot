'use strict';

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} = require('discord.js');
const customCommands = require('../database/models/customCommands');
const settingsModel = require('../database/models/settings');
const config = require('../../config/config');
const logger = require('../utils/logger');

/**
 * Custom Commands: reagiert auf Prefix-Befehle (Standard-Prefix aus
 * guild_settings.bot_prefix) und antwortet mit Text oder Embed, optional mit
 * Bild und reinen Link-Buttons. Platzhalter werden zur Laufzeit ersetzt.
 */

function parseColor(hex) {
  if (!hex) return null;
  const m = String(hex).match(/^#?([0-9a-fA-F]{6})$/);
  return m ? parseInt(m[1], 16) : null;
}

/**
 * Unterstützte Platzhalter: {user} {mention} {username} {user.tag} {server}
 * {guild} {member_count} {membercount} {channel} {date} {time}
 */
function applyPlaceholders(text, { message, guild, member }) {
  if (!text) return text;
  const now = new Date();
  const count = String(guild.memberCount ?? guild.members?.cache?.size ?? 0);
  return String(text)
    .replaceAll('{user}', `<@${member.id}>`)
    .replaceAll('{mention}', `<@${member.id}>`)
    .replaceAll('{username}', member.user.username)
    .replaceAll('{user.tag}', member.user.tag)
    .replaceAll('{server}', guild.name)
    .replaceAll('{guild}', guild.name)
    .replaceAll('{member_count}', count)
    .replaceAll('{membercount}', count)
    .replaceAll('{channel}', `<#${message.channelId}>`)
    .replaceAll('{date}', now.toLocaleDateString('de-DE'))
    .replaceAll('{time}', now.toLocaleTimeString('de-DE'))
    .slice(0, 4000);
}

function buildResponse(cmd, ctx) {
  const payload = { allowedMentions: { parse: [] } }; // nie @everyone/@here aus Custom Commands
  const content = applyPlaceholders(cmd.content, ctx);

  if (cmd.response_type === 'embed') {
    const embed = new EmbedBuilder().setColor(
      parseColor(cmd.embed_color) ?? parseColor(settingsModel.get(ctx.guild.id).embed_color) ?? config.branding.color,
    );
    if (cmd.embed_title) embed.setTitle(applyPlaceholders(cmd.embed_title, ctx).slice(0, 240));
    if (content) embed.setDescription(content);
    if (/^https?:\/\//i.test(cmd.embed_image_url || '')) embed.setImage(cmd.embed_image_url);
    if (/^https?:\/\//i.test(cmd.embed_thumbnail_url || '')) embed.setThumbnail(cmd.embed_thumbnail_url);
    payload.embeds = [embed];
  } else {
    payload.content = content || '​';
  }

  let buttons = [];
  try {
    const parsed = JSON.parse(cmd.buttons_json || '[]');
    if (Array.isArray(parsed)) buttons = parsed;
  } catch {
    buttons = [];
  }
  buttons = buttons.filter((b) => /^https?:\/\//i.test(b.url || '')).slice(0, 5);
  if (buttons.length) {
    const row = new ActionRowBuilder();
    for (const b of buttons) {
      const btn = new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(b.url).setLabel((b.label || 'Link').slice(0, 80));
      if (b.emoji) btn.setEmoji(b.emoji);
      row.addComponents(btn);
    }
    payload.components = [row];
  }

  return payload;
}

/** @returns {Promise<boolean>} true, wenn ein Custom Command ausgeführt wurde. */
async function handleMessage(message) {
  if (!message.guildId || message.author?.bot || !message.content) return false;

  const settings = settingsModel.get(message.guildId);
  const prefix = settings.bot_prefix || '!';
  if (!message.content.startsWith(prefix)) return false;

  const name = message.content.slice(prefix.length).trim().split(/\s+/)[0]?.toLowerCase();
  if (!name) return false;

  const cmd = customCommands.getByName(message.guildId, name);
  if (!cmd || !cmd.enabled) return false;

  const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
  if (!member) return false;

  const me = message.guild.members.me ?? (await message.guild.members.fetchMe().catch(() => null));
  const perms = me ? message.channel.permissionsFor(me) : null;
  if (!perms?.has(PermissionFlagsBits.SendMessages)) return false;

  try {
    await message.channel.send(buildResponse(cmd, { message, guild: message.guild, member }));
    if (cmd.delete_invocation && perms.has(PermissionFlagsBits.ManageMessages)) {
      await message.delete().catch(() => null);
    }
    return true;
  } catch (err) {
    logger.warn(`[customCommand] ${name}: ${err.message}`);
    return false;
  }
}

module.exports = { handleMessage, applyPlaceholders, buildResponse };
