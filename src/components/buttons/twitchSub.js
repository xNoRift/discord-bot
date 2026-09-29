'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const moduleSettings = require('../../database/models/moduleSettings');
const twitchSubs = require('../../database/models/twitchSubs');
const twitchSubService = require('../../services/twitchSubService');
const { L } = require('../../utils/i18n');

const tierText = (t) => (t ? L('Stufe {t}', 'Tier {t}', { t }) : L('kein Sub', 'not subscribed'));
const profileHint = () => L(
  'Verknüpfe Twitch in deinem Discord-Profil (**Einstellungen → Verknüpfungen → Twitch**). Discord meldet deinen Sub dann automatisch, und du bekommst die Rolle – meist innerhalb weniger Minuten.',
  'Link Twitch in your Discord profile (**Settings → Connections → Twitch**). Discord then reports your sub automatically and you get the role – usually within a few minutes.',
);

module.exports = {
  prefix: 'twitchsub',
  async execute(interaction) {
    const action = interaction.customId.split(':')[1];
    const cfg = moduleSettings.get(interaction.guildId, 'twitchsubs');
    if (!cfg.enabled) {
      return interaction.reply({ content: L('Die Twitch-Sub-Rollen sind gerade nicht aktiv.', 'Twitch sub roles are not active right now.'), flags: MessageFlags.Ephemeral });
    }
    // Twitch-Login nur möglich, wenn der Server seinen Kanal verbunden hat – sonst läuft alles über Discords Integration
    const canLogin = twitchSubService.configured() && Boolean(twitchSubs.getBroadcaster(interaction.guildId));

    if (action === 'link') {
      if (!canLogin) return interaction.reply({ content: profileHint(), flags: MessageFlags.Ephemeral });
      const link = twitchSubs.getLink(interaction.user.id);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(twitchSubService.linkUrl(interaction.user.id, interaction.guildId)).setLabel(L('Mit Twitch anmelden', 'Log in with Twitch')),
      );
      const intro = link
        ? L('Du bist bereits mit **{name}** verknüpft. Über den Link kannst du ein anderes Twitch-Konto verknüpfen.', 'You are already linked to **{name}**. Use the link to connect a different Twitch account.', { name: link.twitch_name || link.twitch_login })
        : L('Klicke auf den Button und melde dich bei Twitch an. Danach bekommst du automatisch deine Sub-Rolle.', 'Click the button and log in with Twitch. You will then get your sub role automatically.');
      return interaction.reply({
        content: `${intro}\n-# ${L('Der Link ist 15 Minuten gültig und nur für dich. Der Bot sieht nur deinen Twitch-Namen – kein Passwort, keine Rechte.', 'The link is valid for 15 minutes and only for you. The bot only sees your Twitch name – no password, no permissions.')}\n\n${L('Oder ohne Login:', 'Or without logging in:')} ${profileHint()}`,
        components: [row],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (action === 'check') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      let r;
      try {
        r = await twitchSubService.syncMember(interaction.member);
      } catch {
        return interaction.editReply(L('Der Sub-Status konnte gerade nicht geprüft werden. Versuche es später erneut.', 'The sub status could not be checked right now. Please try again later.'));
      }
      if (r?.tier) {
        return interaction.editReply(L('Dein Status: **{tier}** – deine Rollen wurden aktualisiert. 💜', 'Your status: **{tier}** – your roles have been updated. 💜', { tier: tierText(r.tier) }));
      }
      return interaction.editReply(`${L('Ich finde gerade kein Twitch-Abo für dich.', 'I can\'t find a Twitch subscription for you right now.')}\n${profileHint()}`);
    }

    if (action === 'unlink') {
      if (!twitchSubs.getLink(interaction.user.id)) {
        return interaction.reply({ content: L('Du hast kein Twitch-Konto per Login verknüpft. Eine Verknüpfung im Discord-Profil löst du in den Discord-Einstellungen unter „Verknüpfungen“.', 'You have no Twitch account linked via login. A connection in your Discord profile can be removed in Discord settings under "Connections".'), flags: MessageFlags.Ephemeral });
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await twitchSubService.unlinkAccount(interaction.user.id);
      return interaction.editReply(L('Die Verknüpfung wurde gelöst und deine Rollen neu berechnet.', 'Your Twitch account was unlinked and your roles were recalculated.'));
    }
    return undefined;
  },
};
