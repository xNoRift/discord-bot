'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const moduleSettings = require('../../database/models/moduleSettings');
const twitchSubs = require('../../database/models/twitchSubs');
const twitchSubService = require('../../services/twitchSubService');
const { L } = require('../../utils/i18n');

const tierText = (t) => (t ? L('Stufe {t}', 'Tier {t}', { t }) : L('kein Sub', 'not subscribed'));

module.exports = {
  prefix: 'twitchsub',
  async execute(interaction) {
    const action = interaction.customId.split(':')[1];
    const cfg = moduleSettings.get(interaction.guildId, 'twitchsubs');
    if (!cfg.enabled || !twitchSubService.configured()) {
      return interaction.reply({ content: L('Die Twitch-Sub-Rollen sind gerade nicht aktiv.', 'Twitch sub roles are not active right now.'), flags: MessageFlags.Ephemeral });
    }
    const broadcaster = twitchSubs.getBroadcaster(interaction.guildId);
    if (!broadcaster) {
      return interaction.reply({ content: L('Auf diesem Server ist noch kein Twitch-Kanal verbunden. Bitte einen Admin informieren.', 'No Twitch channel is connected on this server yet. Please let an admin know.'), flags: MessageFlags.Ephemeral });
    }

    if (action === 'link') {
      const link = twitchSubs.getLink(interaction.user.id);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(twitchSubService.linkUrl(interaction.user.id, interaction.guildId)).setLabel(L('Mit Twitch anmelden', 'Log in with Twitch')),
      );
      const intro = link
        ? L('Du bist bereits mit **{name}** verknüpft. Über den Link kannst du ein anderes Twitch-Konto verknüpfen.', 'You are already linked to **{name}**. Use the link to connect a different Twitch account.', { name: link.twitch_name || link.twitch_login })
        : L('Klicke auf den Button und melde dich bei Twitch an. Danach bekommst du automatisch deine Sub-Rolle.', 'Click the button and log in with Twitch. You will then get your sub role automatically.');
      return interaction.reply({
        content: `${intro}\n-# ${L('Der Link ist 15 Minuten gültig und nur für dich. Der Bot sieht nur deinen Twitch-Namen – kein Passwort, keine Rechte.', 'The link is valid for 15 minutes and only for you. The bot only sees your Twitch name – no password, no permissions.')}`,
        components: [row],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (action === 'check') {
      const link = twitchSubs.getLink(interaction.user.id);
      if (!link) return interaction.reply({ content: L('Du hast noch kein Twitch-Konto verknüpft. Klicke zuerst auf „Twitch verknüpfen".', 'You haven\'t linked a Twitch account yet. Click "Link Twitch" first.'), flags: MessageFlags.Ephemeral });
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const results = await twitchSubService.syncUser(interaction.user.id);
      const here = results.find((r) => r.guildId === interaction.guildId);
      if (!here || here.error) return interaction.editReply(L('Der Sub-Status konnte gerade nicht geprüft werden. Versuche es später erneut.', 'The sub status could not be checked right now. Please try again later.'));
      return interaction.editReply(L('Verknüpft mit **{name}** – Status bei **{channel}**: **{tier}**. Deine Rollen wurden aktualisiert.', 'Linked to **{name}** – status on **{channel}**: **{tier}**. Your roles have been updated.', {
        name: link.twitch_name || link.twitch_login, channel: here.channel, tier: tierText(here.tier),
      }));
    }

    if (action === 'unlink') {
      if (!twitchSubs.getLink(interaction.user.id)) return interaction.reply({ content: L('Du hast kein Twitch-Konto verknüpft.', 'You have no Twitch account linked.'), flags: MessageFlags.Ephemeral });
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await twitchSubService.unlinkAccount(interaction.user.id);
      return interaction.editReply(L('Die Verknüpfung wurde gelöst und die Sub-Rollen entfernt.', 'Your Twitch account was unlinked and the sub roles were removed.'));
    }
    return undefined;
  },
};
