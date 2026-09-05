'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const ticketService = require('../../services/ticketService');
const ticketsModel = require('../../database/models/tickets');
const { isSupport } = require('../../utils/permissions');

/**
 * /ticket – Verwaltung eines Tickets aus dem Ticket-Kanal heraus.
 * Ergänzt die vorhandenen Buttons; nutzt dieselbe ticketService-Logik.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Verwaltet das Ticket in diesem Kanal.')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('claim').setDescription('Ticket übernehmen.'))
    .addSubcommand((s) => s.setName('unclaim').setDescription('Ticket wieder freigeben.'))
    .addSubcommand((s) => s.setName('close').setDescription('Ticket schließen (nicht löschen).'))
    .addSubcommand((s) => s.setName('reopen').setDescription('Geschlossenes Ticket wieder öffnen.'))
    .addSubcommand((s) =>
      s
        .setName('rename')
        .setDescription('Ticket-Kanal umbenennen.')
        .addStringOption((o) => o.setName('name').setDescription('Neuer Kanalname').setRequired(true).setMaxLength(90)),
    )
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Einen Nutzer zum Ticket hinzufügen.')
        .addUserOption((o) => o.setName('nutzer').setDescription('Wer soll Zugriff bekommen?').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Einen Nutzer wieder aus dem Ticket entfernen.')
        .addUserOption((o) => o.setName('nutzer').setDescription('Wer soll den Zugriff verlieren?').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('delete').setDescription('Ticket endgültig löschen.')),

  async execute(interaction) {
    const ticket = ticketsModel.getByChannel(interaction.channelId);
    if (!ticket || ticket.status === 'deleted') {
      return interaction.reply({
        embeds: [embeds.error(undefined, 'Dieser Befehl funktioniert nur in einem Ticket-Kanal.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const sub = interaction.options.getSubcommand();
    const member = interaction.member;
    const support = isSupport(member, interaction.settings);
    const isOpener = interaction.user.id === ticket.opener_id;
    const isClaimer = ticket.claimed_by === interaction.user.id;

    const deny = (msg) =>
      interaction.reply({ embeds: [embeds.error(undefined, msg)], flags: MessageFlags.Ephemeral });

    // Berechtigungen je Unterbefehl
    if (['claim', 'rename', 'add', 'remove', 'delete', 'reopen'].includes(sub) && !support) {
      return deny('Dafür brauchst du eine Support-Rolle.');
    }
    if (sub === 'unclaim' && !support && !isClaimer) {
      return deny('Nur das Support-Team oder wer das Ticket übernommen hat, kann es freigeben.');
    }
    if (sub === 'close') {
      if (interaction.settings?.ticket_close_restricted === 1 && !support) {
        return deny('Auf diesem Server dürfen nur Support-Mitglieder Tickets schließen.');
      }
      if (!support && !isOpener) return deny('Nur der Ersteller oder das Support-Team kann dieses Ticket schließen.');
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const { channel } = interaction;
      switch (sub) {
        case 'claim':
          await ticketService.claimTicket(channel, member);
          return interaction.editReply({ embeds: [embeds.success('📌 Übernommen', 'Du kümmerst dich jetzt um dieses Ticket.')] });
        case 'unclaim':
          await ticketService.unclaimTicket(channel, member);
          return interaction.editReply({ embeds: [embeds.success('📌 Freigegeben', 'Das Ticket ist wieder frei.')] });
        case 'close':
          await ticketService.closeTicket(channel, member);
          return interaction.editReply({ embeds: [embeds.success('🔒 Geschlossen', 'Das Ticket wurde geschlossen.')] });
        case 'reopen':
          await ticketService.reopenTicket(channel, member);
          return interaction.editReply({ embeds: [embeds.success('🔓 Wieder geöffnet', 'Das Ticket ist wieder offen.')] });
        case 'rename': {
          const name = await ticketService.renameTicket(channel, member, interaction.options.getString('name'));
          return interaction.editReply({ embeds: [embeds.success('✏️ Umbenannt', `Neuer Name: **#${name}**`)] });
        }
        case 'add': {
          const user = interaction.options.getUser('nutzer');
          await ticketService.addMemberToTicket(channel, member, user);
          return interaction.editReply({ embeds: [embeds.success('➕ Hinzugefügt', `<@${user.id}> hat jetzt Zugriff.`)] });
        }
        case 'remove': {
          const user = interaction.options.getUser('nutzer');
          await ticketService.removeMemberFromTicket(channel, member, user);
          return interaction.editReply({ embeds: [embeds.success('➖ Entfernt', `<@${user.id}> hat keinen Zugriff mehr.`)] });
        }
        case 'delete':
          await ticketService.deleteTicket(channel, member);
          return interaction.editReply({ embeds: [embeds.warning('🗑️ Wird gelöscht', 'Der Kanal wird gleich entfernt.')] });
        default:
          return interaction.editReply({ embeds: [embeds.error(undefined, 'Unbekannter Unterbefehl.')] });
      }
    } catch (err) {
      return interaction.editReply({ embeds: [embeds.error(undefined, err.message)] });
    }
  },
};
