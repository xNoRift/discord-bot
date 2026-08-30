'use strict';

/**
 * Registriert alle Slash-Commands bei Discord.
 *
 *   node src/deploy-commands.js            -> Guild-Deploy (sofort), wenn DEV_GUILD_ID gesetzt ist,
 *                                             sonst globaler Deploy.
 *   node src/deploy-commands.js --global   -> erzwingt globalen Deploy (bis zu 1h Verzögerung).
 *   node src/deploy-commands.js --clear    -> löscht alle Commands (Guild bzw. global).
 */

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { REST, Routes } = require('discord.js');
const config = require('../config/config');
const logger = require('./utils/logger');
const { collectFiles } = require('./handlers/loaders');

async function main() {
  const missing = config.validate('bot');
  if (missing.length) {
    logger.error(`Fehlende .env-Variablen: ${missing.join(', ')}`);
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const forceGlobal = args.includes('--global');
  const clear = args.includes('--clear');
  const useGuild = !forceGlobal && Boolean(config.discord.devGuildId);

  const commands = [];
  if (!clear) {
    const dir = path.join(__dirname, 'commands');
    for (const file of collectFiles(dir)) {
      const mod = require(file);
      if (mod?.data?.toJSON) {
        commands.push(mod.data.toJSON());
        logger.info(`+ /${mod.data.name}`);
      }
    }
  }

  const rest = new REST({ version: '10' }).setToken(config.discord.token);
  const route = useGuild
    ? Routes.applicationGuildCommands(config.discord.clientId, config.discord.devGuildId)
    : Routes.applicationCommands(config.discord.clientId);

  logger.info(
    `${clear ? 'Lösche' : 'Registriere'} ${commands.length} Command(s) ${useGuild ? `für Guild ${config.discord.devGuildId}` : 'global'} …`,
  );

  const data = await rest.put(route, { body: commands });
  logger.success(`Fertig. ${Array.isArray(data) ? data.length : 0} Command(s) aktiv.`);
  if (!useGuild && !clear) {
    logger.warn('Globale Commands können bis zu 1 Stunde brauchen, bis sie überall sichtbar sind.');
  }
}

main().catch((err) => {
  logger.error('Deploy fehlgeschlagen:', err);
  process.exit(1);
});
