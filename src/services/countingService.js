'use strict';

const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const counting = require('../database/models/countingGame');
const config = require('../../config/config');
const logger = require('../utils/logger');
const { L } = require('../utils/i18n');

/**
 * Zähl-Spiel: In einem festgelegten Kanal zählen die Mitglieder abwechselnd
 * hoch (1, 2, 3, …). Falsche Zahl oder – je nach Einstellung – zweimal
 * hintereinander zählen setzt die Kette zurück.
 */

const NUMBER_RE = /^\s*(\d{1,15})\s*$/;
const _panelThrottle = new Map(); // guildId -> letzter Panel-Edit (ms)

function buildPanelEmbed(state) {
  const next = (state.current || 0) + 1;
  return new EmbedBuilder()
    .setColor(config.branding.color)
    .setTitle(L('🔢 Zähl-Spiel', '🔢 Counting game'))
    .setDescription(
      [
        L('Zählt hier gemeinsam hoch! Schreibt einfach die **nächste Zahl** in den Chat.', 'Count up together here! Just type the **next number** in the chat.'),
        '',
        `**${L('Nächste Zahl', 'Next number')}:** \`${next}\``,
        `**${L('Rekord', 'Record')}:** \`${state.best || 0}\``,
        '',
        L('Regeln:', 'Rules:'),
        L('• Immer nur **+1** – richtige Zahlen bekommen {emoji}', '• Always **+1** only – correct numbers get {emoji}', { emoji: state.react_emoji || '✅' }),
        L('• **Nicht** zweimal hintereinander zählen (auch nicht dieselbe Zahl doppelt)', '• **Don\'t** count twice in a row (not even the same number twice)'),
        state.reset_on_fail
          ? L('• Ein Fehler setzt die Kette zurück auf **1**', '• A mistake resets the chain back to **1**')
          : L('• Bei einem Fehler geht es einfach weiter', '• After a mistake it simply continues'),
      ].join('\n'),
    )
    .setFooter({ text: L('Insgesamt gezählt: {n}', 'Total counted: {n}', { n: state.total_counts || 0 }) });
}

async function botCanUse(channel, me, needManage = false) {
  if (!channel || !channel.isTextBased?.() || !me) return false;
  const p = channel.permissionsFor(me);
  return Boolean(
    p?.has(PermissionFlagsBits.ViewChannel) &&
      p?.has(PermissionFlagsBits.SendMessages) &&
      p?.has(PermissionFlagsBits.AddReactions) &&
      (!needManage || p?.has(PermissionFlagsBits.ManageMessages)),
  );
}

/** Postet (oder ersetzt) das Info-Panel im Zähl-Kanal und pinnt es. */
async function postPanel(guild) {
  const state = counting.get(guild.id);
  if (!state.channel_id) throw new Error('Bitte zuerst einen Kanal wählen und speichern.');

  const channel =
    guild.channels.cache.get(state.channel_id) ??
    (await guild.channels.fetch(state.channel_id).catch(() => null));
  const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  if (!(await botCanUse(channel, me))) {
    throw new Error('Der Bot darf in diesem Kanal nicht schreiben/reagieren.');
  }

  // Altes Panel entfernen
  if (state.panel_message_id && state.panel_channel_id) {
    const old =
      guild.channels.cache.get(state.panel_channel_id) ??
      (await guild.channels.fetch(state.panel_channel_id).catch(() => null));
    await old?.messages?.fetch(state.panel_message_id).then((m) => m.delete()).catch(() => null);
  }

  const msg = await channel.send({ embeds: [buildPanelEmbed(state)] });
  await msg.pin().catch(() => null);
  counting.setPanel(guild.id, channel.id, msg.id);
  return msg;
}

/** Panel aktualisieren – gedrosselt, Fehler werden verschluckt. */
async function updatePanel(guild, state) {
  if (!state.panel_message_id || !state.panel_channel_id) return;
  const last = _panelThrottle.get(guild.id) || 0;
  if (Date.now() - last < 4000) return;
  _panelThrottle.set(guild.id, Date.now());

  const channel =
    guild.channels.cache.get(state.panel_channel_id) ??
    (await guild.channels.fetch(state.panel_channel_id).catch(() => null));
  const msg = await channel?.messages?.fetch(state.panel_message_id).catch(() => null);
  if (!msg) return;
  await msg.edit({ embeds: [buildPanelEmbed(state)] }).catch(() => null);
}

async function handleMessage(message) {
  if (message.author?.bot || !message.inGuild()) return;

  const state = counting.get(message.guild.id);
  if (!state.enabled || !state.channel_id || state.channel_id !== message.channelId) return;

  const match = NUMBER_RE.exec(message.content || '');
  if (!match) return; // normales Geplauder ignorieren

  const number = Number.parseInt(match[1], 10);
  if (!Number.isSafeInteger(number)) return;

  const expected = state.current + 1;
  const sameUser = state.last_user_id && state.last_user_id === message.author.id;

  let failReason = null;
  if (sameUser) {
    failReason = L('Du darfst nicht zweimal hintereinander zählen – warte, bis jemand anderes weiterzählt.', 'You can\'t count twice in a row – wait for someone else to continue.');
  } else if (number !== expected) {
    failReason = L('Falsche Zahl – als Nächstes kam **{n}**.', 'Wrong number – the next one was **{n}**.', { n: expected });
  }

  try {
    if (failReason) {
      await handleFail(message, state, number, failReason);
    } else {
      const next = counting.recordCorrect(message.guild.id, number, message.author.id);
      await message.react(state.react_emoji || '✅').catch(() => null);
      if (next.best === number && number > 0 && number % 100 === 0) {
        await message.channel
          .send({ embeds: [new EmbedBuilder().setColor(config.branding.success).setDescription(L('🏆 Neuer Rekord: **{n}**!', '🏆 New record: **{n}**!', { n: number }))] })
          .catch(() => null);
      }
      await updatePanel(message.guild, next);
    }
  } catch (err) {
    logger.warn(`[counting] ${err.message}`);
  }
}

async function handleFail(message, state, number, reason) {
  await message.react('❌').catch(() => null);

  if (state.reset_on_fail) {
    const after = counting.resetCount(message.guild.id);
    const embed = new EmbedBuilder()
      .setColor(config.branding.danger)
      .setDescription(
        `${reason}\n` +
          L('**{user}** hat die Kette bei **{n}** zerstört. Weiter geht\'s wieder bei **1**.\n🏆 Rekord: **{best}**', '**{user}** broke the chain at **{n}**. Starting again from **1**.\n🏆 Record: **{best}**', {
            user: String(message.author), n: number, best: state.best,
          }),
      );
    await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } }).catch(() => null);
    _panelThrottle.delete(message.guild.id); // Reset sofort im Panel zeigen
    await updatePanel(message.guild, after);
  } else {
    await message
      .reply({ content: `${reason} ${L('Versuch\'s nochmal mit **{n}**.', 'Try again with **{n}**.', { n: state.current + 1 })}`, allowedMentions: { repliedUser: false } })
      .catch(() => null);
  }
}

module.exports = { handleMessage, postPanel, buildPanelEmbed };
