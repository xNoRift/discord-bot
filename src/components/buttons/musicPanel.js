'use strict';

const { MessageFlags } = require('discord.js');
const music = require('../../services/musicService');
const embeds = require('../../utils/embeds');
const { canControl } = require('../../utils/music');
const { L } = require('../../utils/i18n');

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
      return interaction.reply({ embeds: [embeds.error(undefined, L('Es läuft gerade nichts.', 'Nothing is playing right now.'))], flags: MessageFlags.Ephemeral });
    }
    if (!canControl(interaction.member, interaction.settings)) {
      return interaction.reply({ embeds: [embeds.error(undefined, L('Dir fehlt die DJ-Rolle.', 'You don\'t have the DJ role.'))], flags: MessageFlags.Ephemeral });
    }

    if (action === 'queue') {
      const q = session.queue
        .slice(0, 15)
        .map((t, i) => `\`${i + 1}.\` ${t.title}${t.live ? ' _(Live)_' : ` \`${music.fmtDuration(t.duration)}\``}`);
      const more = session.queue.length > 15 ? '\n' + L('… und **{n}** weitere', '… and **{n}** more', { n: session.queue.length - 15 }) : '';
      return interaction.reply({
        embeds: [embeds.brand(L('🎶 Warteschlange', '🎶 Queue'), `**Jetzt:** ${session.current.title}\n\n${q.join('\n') || '_leer_'}${more}`)],
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
        return interaction.reply({ embeds: [embeds.error(undefined, L('Unbekannte Aktion.', 'Unknown action.'))], flags: MessageFlags.Ephemeral });
    }

    await interaction.deferUpdate();
  },
};
