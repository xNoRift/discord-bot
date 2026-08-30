'use strict';

/**
 * Zentrale Konfiguration.
 * Liest alle Werte aus der .env-Datei (via dotenv, geladen in index.js / den Entrypoints)
 * und stellt sie typisiert bereit. Hier findet ausserdem die Validierung statt.
 */

const path = require('node:path');

function required(name) {
  const value = process.env[name];
  if (!value || String(value).trim() === '') {
    return null;
  }
  return String(value).trim();
}

function optional(name, fallback = '') {
  const value = process.env[name];
  if (value === undefined || String(value).trim() === '') return fallback;
  return String(value).trim();
}

function bool(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function list(name) {
  return optional(name)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

const rootDir = path.resolve(__dirname, '..');

const databaseUrl = optional('DATABASE_URL', './data/database.sqlite');
const databasePath = path.isAbsolute(databaseUrl)
  ? databaseUrl
  : path.resolve(rootDir, databaseUrl);

const config = {
  rootDir,

  discord: {
    token: required('DISCORD_TOKEN'),
    clientId: required('CLIENT_ID'),
    clientSecret: required('CLIENT_SECRET'),
    devGuildId: optional('DEV_GUILD_ID'),
    // Privilegierte Gateway-Intents (im Developer Portal aktivieren!).
    // Falls noch nicht aktiviert: hier auf 0 setzen, damit der Bot trotzdem startet.
    intentGuildMembers: bool('INTENT_GUILD_MEMBERS', true), // Auto-Rolle, Willkommen, Verlassen
    intentMessageContent: bool('INTENT_MESSAGE_CONTENT', true), // Zähl-Spiel / Spiele
  },

  database: {
    // Für die Session-DB legen wir eine zweite Datei neben der Haupt-DB an.
    path: databasePath,
    dir: path.dirname(databasePath),
  },

  dashboard: {
    url: optional('DASHBOARD_URL', 'http://localhost:3000').replace(/\/+$/, ''),
    port: Number.parseInt(optional('PORT', '3000'), 10),
    redirectUri: optional('OAUTH_REDIRECT_URI', 'http://localhost:3000/auth/discord/callback'),
    sessionSecret: required('SESSION_SECRET') || 'unsafe-dev-secret-change-me',
    secureCookies: bool('SECURE_COOKIES', false),
  },

  ownerIds: list('BOT_OWNER_IDS'),

  env: optional('NODE_ENV', 'development'),
  isProduction: optional('NODE_ENV', 'development') === 'production',

  // OAuth2
  oauth: {
    authorizeUrl: 'https://discord.com/api/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    apiBase: 'https://discord.com/api',
    scopes: ['identify', 'guilds'],
  },

  // Farben / Branding für Embeds und Dashboard
  branding: {
    color: 0x7c5cff, // Violett/Blau (Dashboard-Akzent)
    success: 0x35c98b,
    danger: 0xf0616d,
    warning: 0xf2b34b,
    info: 0x7c5cff,
    name: optional('BRAND_NAME', 'NoRift'),
  },

  defaults: {
    ticketNameFormat: 'ticket-{number}',
    ticketMaxPerUser: 1,
    ticketWelcome:
      'Willkommen {user}! Ein Teammitglied wird sich in Kürze um dein Anliegen kümmern.\nBitte beschreibe dein Problem so genau wie möglich.',
    ticketPanelTitle: '🎫 Support',
    ticketPanelMessage:
      'Brauchst du Hilfe?\nErstelle hier ein Ticket und unser Team wird dir helfen.',
    giveawayWinnerRoleDurationMs: 24 * 60 * 60 * 1000,
    welcomeMessage:
      'Willkommen auf **{server}**, {user}! 🎉\nDu bist unser **{membercount}.** Mitglied. Viel Spaß!',
    leaveMessage: '{username} hat den Server verlassen. 👋',
    applicationPanelTitle: '📋 Bewerbung',
    applicationPanelMessage:
      'Du möchtest unserem Team beitreten?\nWähle unten die gewünschte Position aus.',
  },
};

/**
 * Prüft, ob alle Pflichtwerte für einen bestimmten Modus vorhanden sind.
 * @param {'bot'|'dashboard'|'all'} mode
 * @returns {string[]} Liste fehlender Variablen
 */
function validate(mode = 'all') {
  const missing = [];
  const need = (cond, key) => {
    if (!cond) missing.push(key);
  };

  if (mode === 'bot' || mode === 'all') {
    need(config.discord.token, 'DISCORD_TOKEN');
    need(config.discord.clientId, 'CLIENT_ID');
  }

  if (mode === 'dashboard' || mode === 'all') {
    need(config.discord.clientId, 'CLIENT_ID');
    need(config.discord.clientSecret, 'CLIENT_SECRET');
    need(process.env.SESSION_SECRET, 'SESSION_SECRET');
  }

  return missing;
}

config.validate = validate;

module.exports = config;
