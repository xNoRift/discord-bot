'use strict';

const { MessageFlags } = require('discord.js');
const music = require('../../services/musicService');
const embeds = require('../../utils/embeds');
const { canControl } = require('../../utils/music');

/**
 * Buttons am "Läuft gerade"-Panel im Textkanal (siehe musicService.js Session#panelPayload).
 * Das Panel aktualisiert sich nach jeder Aktion selbst (Session#refreshPanel bzw. _next()),
 * daher hier nur die Aktion ausführen und die Interaktion per deferUpdate bestätigen.
 */
module.exports = {
  prefix: 'music:panel',
  async execute(interaction) {
    const action = interaction.customId.split(':')[2];
    const session = music.getSession(interaction.guildId);
    if (!session || !session.current) {
      return interaction.reply({ embeds: [embeds.error(undefined, 'Es läuft gerade nichts.')], flags: MessageFlags.Ephemeral });
    }
    if (!canControl(interaction.member, interaction.settings)) {
      return interaction.reply({ embeds: [embeds.error(undefined, 'Dir fehlt die DJ-Rolle.')], flags: MessageFlags.Ephemeral });
    }

    if (action === 'queue') {
      const q = session.queue
        .slice(0, 15)
        .map((t, i) => `\`${i + 1}.\` ${t.title}${t.live ? ' _(Live)_' : ` \`${music.fmtDuration(t.duration)}\``}`);
      const more = session.queue.length > 15 ? `\n… und **${session.queue.length - 15}** weitere` : '';
      return interaction.reply({
        embeds: [embeds.brand('🎶 Warteschlange', `**Jetzt:** ${session.current.title}\n\n${q.join('\n') || '_leer_'}${more}`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    switch (action) {
      case 'pause':
        session.paused ? session.resume() : session.pause();
        break;
      case 'skip':
        session.skip();
        break;
      case 'stop':
        session.stop();
        break;
      case 'loop':
        session.toggleLoop();
        break;
      case 'shuffle':
        session.shuffle();
        break;
      case 'volup':
        session.setVolume(Math.min(1.5, session.volume + 0.1));
        break;
      case 'voldown':
        session.setVolume(Math.max(0, session.volume - 0.1));
        break;
      default:
        return interaction.reply({ embeds: [embeds.error(undefined, 'Unbekannte Aktion.')], flags: MessageFlags.Ephemeral });
    }

    await interaction.deferUpdate();
  },
};
