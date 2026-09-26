'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const ticketService = require('../../services/ticketService');
const ticketsModel = require('../../database/models/tickets');
const { isSupport } = require('../../utils/permissions');
const { L } = require('../../utils/i18n');

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
    .addSubcommand((s) => s.setName('delete').setDescription('Ticket endgültig löschen.'))
    .addSubcommand((s) => s.setName('closerequest').setDescription('Den Ersteller fragen, ob das Ticket geschlossen werden kann.'))
    .addSubcommand((s) =>
      s
        .setName('open')
        .setDescription('Ein Ticket im Auftrag eines Nutzers öffnen.')
        .addUserOption((o) => o.setName('nutzer').setDescription('Für wen wird das Ticket geöffnet?').setRequired(true))
        .addStringOption((o) => o.setName('kategorie').setDescription('Ticket-Kategorie').setRequired(true).setAutocomplete(true)),
    ),

  /** Autocomplete für "kategorie": nur Kategorien, in denen man im Auftrag öffnen darf. */
  async autocomplete(interaction) {
    const focused = String(interaction.options.getFocused() || '').toLowerCase();
    const list = ticketService
      .onBehalfCategories(interaction.guildId, interaction.member, interaction.settings || {})
      .filter((c) => `${c.label} ${c.panel}`.toLowerCase().includes(focused))
      .slice(0, 25)
      .map((c) => ({ name: `${c.label} (${c.panel})`.slice(0, 100), value: String(c.id) }));
    await interaction.respond(list);
  },

  async execute(interaction) {
    // "open" funktioniert überall (nicht nur in Ticket-Kanälen)
    if (interaction.options.getSubcommand() === 'open') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const user = interaction.options.getUser('nutzer');
        const { channel } = await ticketService.openOnBehalf(
          interaction.guild,
          interaction.member,
          user,
          Number.parseInt(interaction.options.getString('kategorie'), 10),
        );
        return interaction.editReply({ embeds: [embeds.success(L('📝 Ticket geöffnet', '📝 Ticket opened'), L('Ticket für {user} erstellt: {channel}', 'Ticket created for {user}: {channel}', { user: `<@${user.id}>`, channel: String(channel) }))] });
      } catch (err) {
        return interaction.editReply({ embeds: [embeds.error(undefined, err.message)] });
      }
    }

    const ticket = ticketsModel.getByChannel(interaction.channelId);
    if (!ticket || ticket.status === 'deleted') {
      return interaction.reply({
        embeds: [embeds.error(undefined, L('Dieser Befehl funktioniert nur in einem Ticket-Kanal.', 'This command only works in a ticket channel.'))],
        flags: MessageFlags.Ephemeral,
      });
    }

    const sub = interaction.options.getSubcommand();
    const member = interaction.member;
    const support = isSupport(member, interaction.settings, ticket);
    const isOpener = interaction.user.id === ticket.opener_id;
    const isClaimer = ticket.claimed_by === interaction.user.id;

    const deny = (msg) =>
      interaction.reply({ embeds: [embeds.error(undefined, msg)], flags: MessageFlags.Ephemeral });

    // Berechtigungen je Unterbefehl
    if (['claim', 'rename', 'remove', 'delete', 'reopen', 'closerequest'].includes(sub) && !support) {
      return deny(L('Dafür brauchst du eine Support-Rolle.', 'You need a support role for that.'));
    }
    // Personen hinzufügen: Team – oder der Ersteller, wenn das Panel es erlaubt
    if (sub === 'add' && !support) {
      const panel = ticket.panel_id ? require('../../database/models/ticketPanels').getPanel(ticket.panel_id) : null;
      const allowUserAdd = panel && require('../../database/models/ticketPanels').panelCfg(panel).allowUserAdd;
      if (!(isOpener && allowUserAdd)) return deny(L('Dafür brauchst du eine Support-Rolle.', 'You need a support role for that.'));
    }
    if (sub === 'unclaim' && !support && !isClaimer) {
      return deny(L('Nur das Support-Team oder wer das Ticket übernommen hat, kann es freigeben.', 'Only the support team or whoever claimed the ticket can unclaim it.'));
    }
    if (sub === 'close') {
      const denied = ticketService.closePermissionError(member, ticket, interaction.settings);
      if (denied) return deny(denied);
      const closeQs = ticketService.closeFormQuestions(ticket);
      if (closeQs.length) {
        return interaction.showModal(ticketService.buildQuestionsModal(`ticket:closeform:${ticket.id}`, L('Ticket schließen', 'Close ticket'), closeQs));
      }
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const { channel } = interaction;
      switch (sub) {
        case 'claim':
          await ticketService.claimTicket(channel, member);
          return interaction.editReply({ embeds: [embeds.success(L('📌 Übernommen', '📌 Claimed'), L('Du kümmerst dich jetzt um dieses Ticket.', 'You are now handling this ticket.'))] });
        case 'unclaim':
          await ticketService.unclaimTicket(channel, member);
          return interaction.editReply({ embeds: [embeds.success(L('📌 Freigegeben', '📌 Unclaimed'), L('Das Ticket ist wieder frei.', 'The ticket is available again.'))] });
        case 'close':
          await ticketService.closeTicket(channel, member);
          return interaction.editReply({ embeds: [embeds.success(L('🔒 Geschlossen', '🔒 Closed'), L('Das Ticket wurde geschlossen.', 'The ticket has been closed.'))] });
        case 'reopen':
          await ticketService.reopenTicket(channel, member);
          return interaction.editReply({ embeds: [embeds.success(L('🔓 Wieder geöffnet', '🔓 Reopened'), L('Das Ticket ist wieder offen.', 'The ticket is open again.'))] });
        case 'rename': {
          const name = await ticketService.renameTicket(channel, member, interaction.options.getString('name'));
          return interaction.editReply({ embeds: [embeds.success('✏️ Umbenannt', `Neuer Name: **#${name}**`)] });
        }
        case 'add': {
          const user = interaction.options.getUser('nutzer');
          await ticketService.addMemberToTicket(channel, member, user);
          return interaction.editReply({ embeds: [embeds.success(L('➕ Hinzugefügt', '➕ Added'), `<@${user.id}> hat jetzt Zugriff.`)] });
        }
        case 'remove': {
          const user = interaction.options.getUser('nutzer');
          await ticketService.removeMemberFromTicket(channel, member, user);
          return interaction.editReply({ embeds: [embeds.success('➖ Entfernt', `<@${user.id}> hat keinen Zugriff mehr.`)] });
        }
        case 'closerequest':
          await ticketService.requestClose(channel, member);
          return interaction.editReply({ embeds: [embeds.success(L('📨 Gesendet', '📨 Sent'), L('Der Ersteller wurde gefragt.', 'The creator has been asked.'))] });
        case 'delete':
          await ticketService.deleteTicket(channel, member);
          return interaction.editReply({ embeds: [embeds.warning(L('🗑️ Wird gelöscht', '🗑️ Deleting'), L('Der Kanal wird gleich entfernt.', 'The channel will be removed shortly.'))] });
        default:
          return interaction.editReply({ embeds: [embeds.error(undefined, 'Unbekannter Unterbefehl.')] });
      }
    } catch (err) {
      return interaction.editReply({ embeds: [embeds.error(undefined, err.message)] });
    }
  },
};
