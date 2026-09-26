'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const moduleSettings = require('../database/models/moduleSettings');
const ruleSections = require('../database/models/ruleSections');
const config = require('../../config/config');
const { parseHexColor, validEmoji } = require('../utils/embeds');
const { L, D } = require('../utils/i18n');

/**
 * Regeln: eine Nachricht mit Titel, Text und Hinweis, darunter je Abschnitt ein Button.
 * Ein Klick auf den Button zeigt die Regeln des Abschnitts nur dem Klickenden (ephemeral).
 */

/** Beispiel-Regeln zum Loslegen (deutsch) – der Server-Besitzer passt sie im Dashboard an. */
const TEMPLATE_DE = [
  {
    label: '§1 Allgemein',
    emoji: '📌',
    title: '§1 – Allgemeine Regeln',
    content: [
      '**1.1** Sei respektvoll. Beleidigungen, Mobbing, Diskriminierung und Hass haben hier keinen Platz.',
      '**1.2** Kein Spam und keine Werbung – auch keine Einladungslinks zu anderen Servern ohne Erlaubnis des Teams.',
      '**1.3** Keine pornografischen, gewaltverherrlichenden oder illegalen Inhalte.',
      '**1.4** Veröffentliche keine privaten Daten anderer (Namen, Adressen, Fotos) ohne deren Zustimmung.',
      '**1.5** Es gelten die [Nutzungsbedingungen](https://discord.com/terms) und [Community-Richtlinien](https://discord.com/guidelines) von Discord.',
      '**1.6** Den Anweisungen des Teams ist Folge zu leisten.',
    ].join('\n'),
  },
  {
    label: '§2 Sprachkanäle',
    emoji: '🔊',
    title: '§2 – Sprachkanäle',
    content: [
      '**2.1** Lass andere ausreden und bleibe freundlich.',
      '**2.2** Keine Störgeräusche, Soundboards oder laute Musik, die andere stört. Bei Hintergrundgeräuschen nutze bitte „Push-to-Talk“.',
      '**2.3** Aufnahmen sind nur mit Zustimmung aller Beteiligten erlaubt.',
      '**2.4** Wechsle nicht ständig zwischen den Kanälen hin und her.',
    ].join('\n'),
  },
  {
    label: '§3 Textkanäle',
    emoji: '💬',
    title: '§3 – Textkanäle',
    content: [
      '**3.1** Schreibe im Kanal, der zum Thema passt.',
      '**3.2** Wiederhole keine Nachrichten, schreibe nicht nur in Großbuchstaben und erwähne (@) nicht unnötig viele Personen.',
      '**3.3** Nutze Bots nur in den dafür vorgesehenen Kanälen.',
      '**3.4** Halte Diskussionen sachlich – bei Streit wende dich an das Team statt ihn im Chat auszutragen.',
    ].join('\n'),
  },
  {
    label: '§4 Team & Strafen',
    emoji: '🔨',
    title: '§4 – Team & Strafen',
    content: [
      '**4.1** Verstöße können je nach Schwere zu einer Verwarnung, Stummschaltung, einem Kick oder einem Bann führen.',
      '**4.2** Das Serverteam hat das letzte Wort.',
      '**4.3** Du hast ein Problem oder findest eine Strafe ungerecht? Melde dich per Ticket beim Team – wir schauen uns das an.',
    ].join('\n'),
  },
];


/** Dieselben Beispiel-Regeln auf Englisch (für Server mit Bot-Sprache Englisch). */
const TEMPLATE_EN = [
  {
    label: '§1 General',
    emoji: '📌',
    title: '§1 – General rules',
    content: [
      '**1.1** Be respectful. Insults, bullying, discrimination and hate have no place here.',
      "**1.2** No spam and no advertising – including invite links to other servers without the team's permission.",
      '**1.3** No pornographic, violence-glorifying or illegal content.',
      "**1.4** Do not share other people's private data (names, addresses, photos) without their consent.",
      "**1.5** Discord's [Terms of Service](https://discord.com/terms) and [Community Guidelines](https://discord.com/guidelines) apply.",
      '**1.6** Follow the instructions of the team.',
    ].join('\n'),
  },
  {
    label: '§2 Voice channels',
    emoji: '🔊',
    title: '§2 – Voice channels',
    content: [
      '**2.1** Let others finish speaking and stay friendly.',
      '**2.2** No noise, soundboards or loud music that disturbs others. Use push-to-talk if there is background noise.',
      '**2.3** Recordings are only allowed with the consent of everyone involved.',
      "**2.4** Don't keep hopping between channels.",
    ].join('\n'),
  },
  {
    label: '§3 Text channels',
    emoji: '💬',
    title: '§3 – Text channels',
    content: [
      '**3.1** Post in the channel that fits the topic.',
      "**3.2** Don't repeat messages, don't write only in capital letters and don't mention (@) more people than necessary.",
      '**3.3** Only use bots in the channels meant for them.',
      '**3.4** Keep discussions civil – if there is a dispute, contact the team instead of fighting it out in chat.',
    ].join('\n'),
  },
  {
    label: '§4 Team & penalties',
    emoji: '🔨',
    title: '§4 – Team & penalties',
    content: [
      '**4.1** Depending on severity, violations can lead to a warning, mute, kick or ban.',
      '**4.2** The server team has the final say.',
      '**4.3** Do you have a problem or think a penalty is unfair? Contact the team via ticket – we will look into it.',
    ].join('\n'),
  },
];

/** Beispiel-Regeln in der Sprache des Servers. */
const template = () => (L('de', 'en') === 'en' ? TEMPLATE_EN : TEMPLATE_DE);

function colorOf(cfg) {
  return parseHexColor(cfg.color, config.branding.color);
}

/** Antwort auf einen Button-Klick: die Regeln eines Abschnitts. */
function sectionEmbed(cfg, section) {
  const heading = (section.title || section.label).slice(0, 240);
  return new EmbedBuilder()
    .setColor(colorOf(cfg))
    .setTitle(`${validEmoji(section.emoji) ? section.emoji + ' ' : ''}${heading}`.slice(0, 256))
    .setDescription(section.content.slice(0, 4000));
}

/** Die öffentliche Regel-Nachricht (Embed + Buttons). */
function buildPanel(guild) {
  const cfg = moduleSettings.get(guild.id, 'rules');
  const sections = ruleSections.list(guild.id).slice(0, ruleSections.MAX_SECTIONS);

  const embed = new EmbedBuilder().setColor(colorOf(cfg)).setTitle(D(cfg.title || '📜 Server-Regeln'));
  if (cfg.intro) embed.setDescription(D(cfg.intro));
  if (cfg.noticeText) embed.addFields({ name: D(cfg.noticeTitle || 'Hinweis'), value: D(cfg.noticeText) });
  if (/^https:\/\//i.test(cfg.imageUrl)) embed.setImage(cfg.imageUrl);
  if (cfg.footer) embed.setFooter({ text: cfg.footer });

  const rows = [];
  for (let i = 0; i < sections.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(
      sections.slice(i, i + 5).map((s) => {
        const btn = new ButtonBuilder().setCustomId(`rules:show:${s.id}`).setLabel(s.label.slice(0, 80)).setStyle(ButtonStyle.Secondary);
        if (validEmoji(s.emoji)) btn.setEmoji(s.emoji);
        return btn;
      }),
    ));
  }
  return { embeds: [embed], components: rows };
}

/** Sendet (oder aktualisiert) die Regel-Nachricht im gewählten Kanal. */
async function postPanel(guild) {
  const cfg = moduleSettings.get(guild.id, 'rules');
  const channel = guild.channels.cache.get(cfg.channelId);
  if (!channel || !channel.isTextBased()) throw new Error('Bitte einen Kanal wählen und speichern.');
  const me = guild.members.me ?? (await guild.members.fetchMe());
  const perms = channel.permissionsFor(me);
  if (!perms?.has(PermissionFlagsBits.ViewChannel) || !perms?.has(PermissionFlagsBits.SendMessages) || !perms?.has(PermissionFlagsBits.EmbedLinks)) {
    throw new Error('Dem Bot fehlt „Kanal ansehen“ / „Nachrichten senden“ / „Links einbetten“ in diesem Kanal.');
  }

  const payload = buildPanel(guild);
  let msg = null;
  if (cfg.messageId) {
    if (cfg.messageChannelId === channel.id) {
      msg = await channel.messages.fetch(cfg.messageId).catch(() => null);
    } else {
      // Kanal gewechselt: die alte Nachricht im alten Kanal entfernen, damit keine doppelten Regeln stehen bleiben
      const old = guild.channels.cache.get(cfg.messageChannelId);
      const oldMsg = old?.isTextBased() ? await old.messages.fetch(cfg.messageId).catch(() => null) : null;
      await oldMsg?.delete().catch(() => null);
    }
  }
  msg = msg ? await msg.edit(payload) : await channel.send(payload);
  moduleSettings.update(guild.id, 'rules', { messageId: msg.id, messageChannelId: channel.id });
  return msg;
}

module.exports = { template, sectionEmbed, buildPanel, postPanel };
