'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const moduleSettings = require('../database/models/moduleSettings');
const ruleSections = require('../database/models/ruleSections');
const config = require('../../config/config');

/**
 * Regeln: eine Nachricht mit Titel, Text und Hinweis, darunter je Abschnitt ein Button.
 * Ein Klick auf den Button zeigt die Regeln des Abschnitts nur dem Klickenden (ephemeral).
 */

const validEmoji = (e) => /^(\p{Extended_Pictographic}|<a?:\w+:\d+>)/u.test(String(e || ''));

/** Beispiel-Regeln zum Loslegen – der Server-Besitzer passt sie im Dashboard an. */
const TEMPLATE = [
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

function colorOf(cfg) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(cfg.color || '').trim());
  return m ? Number.parseInt(m[1], 16) : config.branding.color;
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

  const embed = new EmbedBuilder().setColor(colorOf(cfg)).setTitle(cfg.title || '📜 Server-Regeln');
  if (cfg.intro) embed.setDescription(cfg.intro);
  if (cfg.noticeText) embed.addFields({ name: cfg.noticeTitle || 'Hinweis', value: cfg.noticeText });
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

module.exports = { TEMPLATE, validEmoji, sectionEmbed, buildPanel, postPanel };
