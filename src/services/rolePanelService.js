'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');
const rolePanels = require('../database/models/rolePanels');
const settingsModel = require('../database/models/settings');
const { botCanManageRole } = require('../utils/permissions');
const config = require('../../config/config');

/**
 * Rollen-Panels: Mitglieder schalten sich über Buttons oder ein Auswahlmenü
 * selbst Rollen frei. Mehrere Panels pro Server, "single" = nur eine Rolle
 * aus diesem Panel gleichzeitig, "multi" = beliebig viele.
 */

const BUTTON_STYLES = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
};

function parseColor(hex) {
  if (!hex) return null;
  const m = String(hex).match(/^#?([0-9a-fA-F]{6})$/);
  return m ? parseInt(m[1], 16) : null;
}

function labelFor(r, guild) {
  if (r.label) return r.label;
  const role = guild?.roles.cache.get(r.role_id);
  return role ? role.name : r.role_id;
}

/**
 * @param {object} panel  role_panels-Zeile
 * @param {object[]} roles role_panel_roles-Zeilen
 * @param {import('discord.js').Guild} [guild]  fürs Auflösen fehlender Labels
 */
function buildPanelMessage(panel, roles, guild) {
  const embed = new EmbedBuilder()
    .setColor(parseColor(panel.color) ?? parseColor(settingsModel.get(panel.guild_id).embed_color) ?? config.branding.color)
    .setTitle(panel.title || panel.name)
    .setDescription(panel.description || 'Wähle eine Rolle:');

  if (/^https?:\/\//i.test(panel.image_url || '')) embed.setImage(panel.image_url);
  if (/^https?:\/\//i.test(panel.thumbnail_url || '')) embed.setThumbnail(panel.thumbnail_url);

  const components = [];
  if (!roles.length) return { embeds: [embed], components };

  if (panel.style === 'select') {
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`rolepanel:select:${panel.id}`)
          .setPlaceholder(panel.mode === 'single' ? 'Wähle eine Rolle…' : 'Wähle Rollen…')
          .setMinValues(0)
          .setMaxValues(panel.mode === 'single' ? 1 : Math.min(25, roles.length))
          .addOptions(
            roles.slice(0, 25).map((r) => ({
              label: labelFor(r, guild).slice(0, 100),
              value: r.role_id,
              emoji: r.emoji || undefined,
            })),
          ),
      ),
    );
  } else {
    let row = new ActionRowBuilder();
    roles.slice(0, 25).forEach((r, i) => {
      if (i > 0 && i % 5 === 0) {
        components.push(row);
        row = new ActionRowBuilder();
      }
      const button = new ButtonBuilder()
        .setCustomId(`rolepanel:toggle:${panel.id}:${r.role_id}`)
        .setLabel(labelFor(r, guild).slice(0, 80))
        .setStyle(BUTTON_STYLES[r.button_style] ?? ButtonStyle.Secondary);
      if (r.emoji) button.setEmoji(r.emoji);
      row.addComponents(button);
    });
    if (row.components.length) components.push(row);
  }

  return { embeds: [embed], components };
}

/**
 * Postet ein Panel in seinen Kanal oder aktualisiert die bestehende Nachricht.
 * @param {import('discord.js').Guild} guild
 * @param {number} panelId
 * @param {string} [channelId]
 */
async function postOrUpdatePanel(guild, panelId, channelId) {
  const panel = rolePanels.getPanel(panelId);
  if (!panel || panel.guild_id !== guild.id) throw new Error('Panel nicht gefunden.');

  const targetChannelId = channelId || panel.channel_id;
  if (!targetChannelId) throw new Error('Für dieses Panel wurde kein Kanal ausgewählt.');

  const channel = guild.channels.cache.get(targetChannelId) ?? (await guild.channels.fetch(targetChannelId).catch(() => null));
  if (!channel || !channel.isTextBased()) throw new Error('Panel-Kanal nicht gefunden oder kein Textkanal.');

  const roles = rolePanels.listRoles(panelId);
  if (!roles.length) throw new Error('Diesem Panel sind noch keine Rollen zugewiesen.');
  const payload = buildPanelMessage(panel, roles, guild);

  if (panel.channel_id === targetChannelId && panel.message_id) {
    const existing = await channel.messages.fetch(panel.message_id).catch(() => null);
    if (existing) {
      await existing.edit(payload);
      rolePanels.updatePanel(panelId, { channel_id: targetChannelId });
      return existing;
    }
  }

  const message = await channel.send(payload);
  rolePanels.updatePanel(panelId, { channel_id: targetChannelId, message_id: message.id });
  return message;
}

/** Button-Klick: schaltet genau eine Rolle an/aus. */
async function toggleRole(interaction, panelId, roleId) {
  const panel = rolePanels.getPanel(panelId);
  if (!panel) throw new Error('Dieses Panel existiert nicht mehr.');
  const panelRoles = rolePanels.listRoles(panelId);
  if (!panelRoles.some((r) => r.role_id === roleId)) throw new Error('Diese Rolle gehört nicht (mehr) zu diesem Panel.');

  const guild = interaction.guild;
  const role = guild.roles.cache.get(roleId) ?? (await guild.roles.fetch(roleId).catch(() => null));
  if (!role) throw new Error('Diese Rolle existiert nicht mehr.');
  const can = botCanManageRole(guild, role);
  if (!can.ok) throw new Error(can.reason);

  const member = interaction.member;

  if (member.roles.cache.has(roleId)) {
    await member.roles.remove(role, `Rollen-Panel: ${panel.name}`);
    return { granted: false, name: role.name };
  }

  if (panel.mode === 'single') {
    for (const r of panelRoles) {
      if (r.role_id !== roleId && member.roles.cache.has(r.role_id)) {
        await member.roles.remove(r.role_id, `Rollen-Panel: ${panel.name} (Single-Choice)`).catch(() => null);
      }
    }
  }

  await member.roles.add(role, `Rollen-Panel: ${panel.name}`);
  return { granted: true, name: role.name };
}

/** Auswahlmenü-Änderung: interaction.values ist die vollständige gewünschte Auswahl. */
async function applySelection(interaction, panelId, selectedRoleIds) {
  const panel = rolePanels.getPanel(panelId);
  if (!panel) throw new Error('Dieses Panel existiert nicht mehr.');
  const panelRoles = rolePanels.listRoles(panelId);
  const panelRoleIds = new Set(panelRoles.map((r) => r.role_id));
  const selected = new Set(selectedRoleIds.filter((id) => panelRoleIds.has(id)));

  const guild = interaction.guild;
  const member = interaction.member;
  const granted = [];
  const removed = [];

  for (const r of panelRoles) {
    const has = member.roles.cache.has(r.role_id);
    const wants = selected.has(r.role_id);
    if (has === wants) continue;

    const role = guild.roles.cache.get(r.role_id) ?? (await guild.roles.fetch(r.role_id).catch(() => null));
    if (!role) continue;
    const can = botCanManageRole(guild, role);
    if (!can.ok) continue; // eine blockierte Rolle darf die anderen nicht verhindern

    if (wants) {
      await member.roles.add(role, `Rollen-Panel: ${panel.name}`).catch(() => null);
      granted.push(role.name);
    } else {
      await member.roles.remove(role, `Rollen-Panel: ${panel.name}`).catch(() => null);
      removed.push(role.name);
    }
  }

  return { granted, removed };
}

module.exports = { buildPanelMessage, postOrUpdatePanel, toggleRole, applySelection };
