'use strict';

const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');

/**
 * Einzelne, geteilte Discord-Client-Instanz.
 * Bot UND Dashboard laufen im selben Node-Prozess und greifen auf denselben
 * Client zu (das Dashboard liest Guild-/Channel-/Rollen-Daten und loest Aktionen aus).
 *
 * Es werden bewusst KEINE privilegierten Intents benoetigt:
 *  - GuildMembers/MessageContent sind nicht aktiviert.
 *  - Mitglieder werden bei Bedarf per REST (guild.members.fetch(id)) geladen.
 */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages, // Ticket-Aktivität (Auto-Close) – nicht privilegiert
    GatewayIntentBits.GuildMembers, // Auto-Rolle & "Aktion beim Verlassen" – PRIVILEGIERT!
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember],
  allowedMentions: { parse: ['users', 'roles'], repliedUser: false },
});

// Registries
client.commands = new Collection();       // name -> command module
client.buttons = new Collection();         // prefix -> handler module
client.selectMenus = new Collection();     // prefix -> handler module
client.modals = new Collection();          // prefix -> handler module

module.exports = client;
