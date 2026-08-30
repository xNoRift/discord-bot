'use strict';

const { ActivityType } = require('discord.js');
const client = require('../core/client');
const botConfig = require('../database/models/botConfig');
const logger = require('../utils/logger');

/**
 * Setzt Status + Aktivität des Bots anhand der globalen Bot-Konfiguration.
 */

const TYPE_MAP = {
  playing: ActivityType.Playing,
  streaming: ActivityType.Streaming,
  listening: ActivityType.Listening,
  watching: ActivityType.Watching,
  competing: ActivityType.Competing,
  custom: ActivityType.Custom,
};

const VALID_STATUS = ['online', 'idle', 'dnd', 'invisible'];

function apply() {
  if (!client.user) return;
  const cfg = botConfig.get();

  const status = VALID_STATUS.includes(cfg.presence_status) ? cfg.presence_status : 'online';
  const presence = { status };

  const type = cfg.activity_type || 'none';
  const text = (cfg.activity_text || '').trim();

  if (type === 'none' || !text) {
    presence.activities = [];
  } else if (type === 'custom') {
    presence.activities = [{ name: 'Custom Status', type: ActivityType.Custom, state: text.slice(0, 128) }];
  } else if (type === 'streaming') {
    const url =
      cfg.activity_url && /^https?:\/\/(www\.)?(twitch\.tv|youtube\.com)\//i.test(cfg.activity_url)
        ? cfg.activity_url
        : 'https://twitch.tv/discord';
    presence.activities = [{ name: text.slice(0, 128), type: ActivityType.Streaming, url }];
  } else {
    presence.activities = [{ name: text.slice(0, 128), type: TYPE_MAP[type] ?? ActivityType.Playing }];
  }

  try {
    client.user.setPresence(presence);
  } catch (err) {
    logger.warn('[presence] setPresence fehlgeschlagen:', err.message);
  }
}

module.exports = { apply, VALID_STATUS, TYPES: Object.keys(TYPE_MAP) };
