'use strict';

const { EmbedBuilder } = require('discord.js');
const counting = require('../database/models/countingGame');
const config = require('../../config/config');
const logger = require('../utils/logger');

/**
 * Zähl-Spiel: In einem festgelegten Kanal zählen die Mitglieder abwechselnd
 * hoch (1, 2, 3, …). Falsche Zahl oder – je nach Einstellung – zweimal
 * hintereinander zählen setzt die Kette zurück.
 */

const NUMBER_RE = /^\s*(\d{1,15})\s*$/;

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
  if (sameUser && !state.allow_same_user) {
    failReason = 'Du darfst nicht zweimal hintereinander zählen.';
  } else if (number !== expected) {
    failReason = `Falsche Zahl – als Nächstes kam **${expected}**.`;
  }

  try {
    if (failReason) {
      await handleFail(message, state, number, failReason);
    } else {
      const next = counting.recordCorrect(message.guild.id, number, message.author.id);
      await message.react(state.react_emoji || '✅').catch(() => null);
      if (next.best === number && number > 0 && number % 100 === 0) {
        await message.channel
          .send({ embeds: [new EmbedBuilder().setColor(config.branding.success).setDescription(`🏆 Neuer Rekord: **${number}**!`)] })
          .catch(() => null);
      }
    }
  } catch (err) {
    logger.warn(`[counting] ${err.message}`);
  }
}

async function handleFail(message, state, number, reason) {
  await message.react('❌').catch(() => null);

  if (state.reset_on_fail) {
    counting.resetCount(message.guild.id);
    const embed = new EmbedBuilder()
      .setColor(config.branding.danger)
      .setDescription(
        `${reason}\n**${message.author}** hat die Kette bei **${number}** zerstört. ` +
          `Weiter geht's wieder bei **1**.\n🏆 Rekord: **${state.best}**`,
      );
    await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } }).catch(() => null);
  } else {
    await message
      .reply({ content: `${reason} Versuch's nochmal mit **${state.current + 1}**.`, allowedMentions: { repliedUser: false } })
      .catch(() => null);
  }
}

module.exports = { handleMessage };
