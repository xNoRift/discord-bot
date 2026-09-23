'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const music = require('../../services/musicService');
const embeds = require('../../utils/embeds');
const { requireVoice, canControl } = require('../../utils/music');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('playlist')
    .setDescription('Eigene Playlists – nur auf diesem Server, nicht serverübergreifend.')
    .addSubcommand((s) =>
      s
        .setName('save')
        .setDescription('Speichert einen Link/Suchbegriff (oder die aktuelle Warteschlange) als Playlist.')
        .addStringOption((o) => o.setName('name').setDescription('Name der Playlist').setRequired(true))
        .addStringOption((o) =>
          o.setName('quelle').setDescription('YouTube-/Spotify-Link oder Suchbegriff (leer = aktuelle Warteschlange speichern)').setRequired(false),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('play')
        .setDescription('Spielt eine gespeicherte Playlist dieses Servers ab.')
        .addStringOption((o) => o.setName('name').setDescription('Name der Playlist').setRequired(true).setAutocomplete(true)),
    )
    .addSubcommand((s) => s.setName('list').setDescription('Zeigt alle Playlists dieses Servers.'))
    .addSubcommand((s) =>
      s
        .setName('delete')
        .setDescription('Löscht eine Playlist dieses Servers.')
        .addStringOption((o) => o.setName('name').setDescription('Name der Playlist').setRequired(true).setAutocomplete(true)),
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const choices = music
      .listPlaylists(interaction.guildId)
      .filter((p) => p.name.toLowerCase().includes(focused))
      .slice(0, 25)
      .map((p) => ({ name: `${p.name} (${p.track_count} Titel)`, value: p.name }));
    await interaction.respond(choices);
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const list = music.listPlaylists(interaction.guildId);
      if (!list.length) {
        return interaction.reply({
          embeds: [embeds.brand('🎶 Playlists', 'Auf diesem Server gibt es noch keine Playlists. Speichere eine mit `/playlist save`.')],
          flags: MessageFlags.Ephemeral,
        });
      }
      const lines = list.map((p) => `**${p.name}** — ${p.track_count} Titel`);
      return interaction.reply({ embeds: [embeds.brand('🎶 Playlists dieses Servers', lines.join('\n'))], flags: MessageFlags.Ephemeral });
    }

    if (!canControl(interaction.member, interaction.settings)) {
      return interaction.reply({ embeds: [embeds.error(undefined, 'Dir fehlt die DJ-Rolle.')], flags: MessageFlags.Ephemeral });
    }

    if (sub === 'delete') {
      const name = interaction.options.getString('name');
      const pl = music.listPlaylists(interaction.guildId).find((p) => p.name.toLowerCase() === name.toLowerCase());
      if (!pl || !music.deletePlaylist(interaction.guildId, pl.id)) {
        return interaction.reply({ embeds: [embeds.error(undefined, `Playlist „${name}" wurde nicht gefunden.`)], flags: MessageFlags.Ephemeral });
      }
      return interaction.reply({ embeds: [embeds.success('🗑️ Gelöscht', `Playlist **${pl.name}** wurde gelöscht.`)], flags: MessageFlags.Ephemeral });
    }

    if (sub === 'save') {
      const name = interaction.options.getString('name');
      const query = interaction.options.getString('quelle');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const r = await music.savePlaylist(interaction.guild, name, query, interaction.user.id);
        await interaction.editReply({
          embeds: [embeds.success('💾 Gespeichert', `Playlist **${r.name}** mit **${r.count}** Titel${r.count === 1 ? '' : 'n'} gespeichert – nur auf diesem Server abrufbar.`)],
        });
      } catch (e) {
        await interaction.editReply({ embeds: [embeds.error(undefined, e.message)] });
      }
      return;
    }

    if (sub === 'play') {
      let vc;
      try {
        vc = await requireVoice(interaction);
      } catch (e) {
        return interaction.reply({ embeds: [embeds.error(undefined, e.message)], flags: MessageFlags.Ephemeral });
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const name = interaction.options.getString('name');
        const r = await music.playPlaylist(interaction.guild, vc, interaction.channelId, name, {
          id: interaction.user.id,
          tag: interaction.user.tag,
        });
        await interaction.editReply({ embeds: [embeds.success('🎵 Playlist', `➕ **${r.added}** Titel aus **${r.label}** zur Warteschlange hinzugefügt.`)] });
      } catch (e) {
        await interaction.editReply({ embeds: [embeds.error(undefined, e.message)] });
      }
    }
  },
};
