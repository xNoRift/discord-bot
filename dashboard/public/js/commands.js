/* global document, Dash */
'use strict';

const { apiFor, getChannels, escapeHtml, toast, trackForm } = Dash;

let COMMANDS = [];
let CHANNELS = { text: [] };

function channelChips(cmdName, selected) {
  if (!CHANNELS.text.length) return '<span class="muted">Keine Textkanäle gefunden.</span>';
  return CHANNELS.text
    .map((ch) => `
      <span class="chip-check">
        <input type="checkbox" id="cmdch-${cmdName}-${ch.id}" name="ch_${cmdName}_${ch.id}" value="${ch.id}" ${selected.has(ch.id) ? 'checked' : ''}>
        <label for="cmdch-${cmdName}-${ch.id}">#${escapeHtml(ch.name)}</label>
      </span>`)
    .join('');
}

function render() {
  const box = document.getElementById('cmdList');
  const byCat = new Map();
  for (const c of COMMANDS) {
    if (!byCat.has(c.categoryLabel)) byCat.set(c.categoryLabel, []);
    byCat.get(c.categoryLabel).push(c);
  }

  box.innerHTML = [...byCat.entries()]
    .map(([label, cmds]) => `
      <div class="set-block">
        <div class="set-block__title">${escapeHtml(label)}</div>
        ${cmds
          .map((c) => {
            const selected = new Set((c.channel_ids || '').split(',').filter(Boolean));
            return `
            <div class="setting-row" style="align-items:flex-start;">
              <label class="toggle" style="margin-top:2px;">
                <input type="checkbox" name="enabled_${c.name}" ${c.enabled ? 'checked' : ''}><span class="toggle__track"></span>
              </label>
              <div class="setting-row__text">
                <b>/${escapeHtml(c.name)}</b>
                <span>${escapeHtml(c.description)}</span>
                <details class="cmd-row__more">
                  <summary>Auf Kanäle beschränken (optional)</summary>
                  <div class="chip-row">${channelChips(c.name, selected)}</div>
                </details>
              </div>
            </div>`;
          })
          .join('')}
      </div>`)
    .join('');
}

function collect() {
  const map = {};
  for (const c of COMMANDS) {
    const enabled = !!document.querySelector(`#cmdList input[name="enabled_${c.name}"]`)?.checked;
    const channelIds = [...document.querySelectorAll(`#cmdList input[name^="ch_${c.name}_"]:checked`)]
      .map((el) => el.value)
      .join(',');
    map[c.name] = { enabled, channel_ids: channelIds };
  }
  return map;
}

async function load() {
  [COMMANDS, CHANNELS] = await Promise.all([apiFor('GET', '/commands'), getChannels()]);
  render();
}

async function save() {
  try {
    await apiFor('PATCH', '/commands', collect());
    document.getElementById('cmdStatus').textContent = 'Gespeichert ✓';
    toast('Befehle gespeichert.', 'success');
    await load();
  } catch (err) {
    toast(err.message, 'error');
    throw err;
  }
}

load()
  .then(() => trackForm(document.getElementById('cmdList'), save, { reset: load }))
  .catch((e) => toast(e.message, 'error'));
