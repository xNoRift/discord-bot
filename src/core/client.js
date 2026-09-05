'use strict';

const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const config = require('../../config/config');

/**
 * Einzelne, geteilte Discord-Client-Instanz.
 * Bot UND Dashboard laufen im selben Node-Prozess und greifen auf denselben
 * Client zu (das Dashboard liest Guild-/Channel-/Rollen-Daten und loest Aktionen aus).
 *
 * Es werden bewusst KEINE privilegierten Intents benoetigt:
 *  - GuildMembers/MessageContent sind nicht aktiviert.
 *  - Mitglieder werden bei Bedarf per REST (guild.members.fetch(id)) geladen.
 */
const intents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages, // Ticket-Aktivität (Auto-Close) – nicht privilegiert
  GatewayIntentBits.GuildVoiceStates, // Temp-Voice ("Join to Create") – nicht privilegiert
  GatewayIntentBits.GuildModeration, // Anti-Nuke: Ban-Events – nicht privilegiert
  GatewayIntentBits.GuildWebhooks, // Anti-Nuke: Webhook-Erstellung/-Löschung – nicht privilegiert
];
if (config.discord.intentGuildMembers) {
  intents.push(GatewayIntentBits.GuildMembers); // Auto-Rolle, Willkommen, Verlassen – PRIVILEGIERT
}
if (config.discord.intentMessageContent) {
  intents.push(GatewayIntentBits.MessageContent); // Zähl-Spiel / Spiele – PRIVILEGIERT
}

const client = new Client({
  intents,
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember],
  allowedMentions: { parse: ['users', 'roles'], repliedUser: false },
});

// Registries
client.commands = new Collection();       // name -> command module
client.buttons = new Collection();         // prefix -> handler module
client.selectMenus = new Collection();     // prefix -> handler module
client.modals = new Collection();          // prefix -> handler module

module.exports = client;
