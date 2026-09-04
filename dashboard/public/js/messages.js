/* global document, Dash */
'use strict';

const { apiFor, fillSelectors, toast, escapeHtml, fmtRelative } = Dash;

const form = document.getElementById('msgForm');
const asEmbed = document.getElementById('msgAsEmbed');
const embedOpts = document.getElementById('msgEmbedOpts');
const content = document.getElementById('msgContent');
const countEl = document.getElementById('msgCount');
const maxEl = document.getElementById('msgMax');
const colorPick = document.getElementById('msgColor');
const colorText = document.getElementById('msgColorText');
const statusEl = document.getElementById('msgStatus');
const sendBtn = document.getElementById('msgSend');

(async function init() {
  try {
    await fillSelectors({});
  } catch (e) {
    toast(e.message, 'error');
  }
})();

function syncEmbedUi() {
  const on = asEmbed.checked;
  embedOpts.hidden = !on;
  maxEl.textContent = on ? '4096' : '2000';
  updateCount();
}
function updateCount() {
  const max = asEmbed.checked ? 4096 : 2000;
  countEl.textContent = String(content.value.length);
  countEl.style.color = content.value.length > max ? 'var(--red)' : '';
}

asEmbed.addEventListener('change', syncEmbedUi);
content.addEventListener('input', updateCount);
colorPick.addEventListener('input', () => { colorText.value = colorPick.value; });
colorText.addEventListener('input', () => {
  if (/^#?[0-9a-fA-F]{6}$/.test(colorText.value.trim())) {
    colorPick.value = colorText.value.trim().startsWith('#') ? colorText.value.trim() : '#' + colorText.value.trim();
  }
});
colorText.value = colorPick.value;
syncEmbedUi();

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    channelId: document.getElementById('msgChannel').value,
    content: content.value,
    asEmbed: asEmbed.checked,
    embedTitle: document.getElementById('msgEmbedTitle').value,
    embedColor: colorText.value,
    messageId: document.getElementById('msgEditId').value.trim(),
  };
  if (!body.channelId) return toast('Bitte einen Kanal wählen.', 'error');

  sendBtn.disabled = true;
  statusEl.textContent = 'Wird gesendet…';
  try {
    const r = await apiFor('POST', '/message', body);
    toast(r.edited ? 'Nachricht bearbeitet.' : 'Nachricht gesendet.', 'success');
    statusEl.innerHTML = (r.edited ? 'Bearbeitet ✓ ' : 'Gesendet ✓ ') +
      (r.url ? `<a href="${r.url}" target="_blank" rel="noopener">In Discord ansehen</a>` : '');
    if (!r.edited) {
      content.value = '';
      document.getElementById('msgEmbedTitle').value = '';
      updateCount();
    }
  } catch (err) {
    toast(err.message, 'error');
    statusEl.textContent = err.message;
  } finally {
    sendBtn.disabled = false;
  }
});

/* ---------------- Nachrichten-Verlauf ---------------- */

const histChannel = document.getElementById('histChannel');
const histList = document.getElementById('histList');
const histStatus = document.getElementById('histStatus');
const histLoadBtn = document.getElementById('histLoad');

function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function renderHistory(data) {
  document.getElementById('histIntentBox').hidden = data.intentActive !== false;
  if (!data.messages.length) {
    histList.innerHTML = '<p class="muted">Keine Nachrichten gefunden.</p>';
    return;
  }
  histList.innerHTML = data.messages
    .map((m) => {
      const hasText = m.content && m.content.trim();
      const textHtml = hasText
        ? escapeHtml(m.content)
        : m.embeds
          ? '<span class="msg-row__text--empty">(Embed, kein Text)</span>'
          : '<span class="msg-row__text--empty">(kein Text sichtbar)</span>';
      const attach = m.attachments.length
        ? `<div class="msg-row__attach">${m.attachments
            .map((a) => `<a href="${escapeHtml(a.url)}" target="_blank" rel="noopener">📎 ${escapeHtml(a.name || 'Datei')}</a>`)
            .join('')}</div>`
        : '';
      return `<div class="msg-row">
        <img class="msg-row__avatar" src="${escapeHtml(m.authorAvatar)}" alt="" loading="lazy" />
        <div class="msg-row__body">
          <div class="msg-row__head">
            <span class="msg-row__name${m.bot ? ' msg-row__name--bot' : ''}">${escapeHtml(m.authorTag)}${m.bot ? ' 🤖' : ''}</span>
            <span class="msg-row__time" title="${new Date(m.createdAt).toLocaleString('de-DE')}">${fmtRelative ? fmtRelative(m.createdAt) : fmtTime(m.createdAt)}</span>
            ${m.editedAt ? '<span class="msg-row__time">(bearbeitet)</span>' : ''}
          </div>
          <div class="msg-row__text">${textHtml}</div>
          ${attach}
        </div>
      </div>`;
    })
    .join('');
  histList.scrollTop = histList.scrollHeight;
}

async function loadHistory() {
  const channelId = histChannel.value;
  if (!channelId) return toast('Bitte einen Kanal wählen.', 'error');
  const limit = document.getElementById('histLimit').value;
  histStatus.textContent = 'Lädt…';
  histLoadBtn.disabled = true;
  try {
    const data = await apiFor('GET', `/messages/history?channelId=${channelId}&limit=${limit}`);
    renderHistory(data);
    histStatus.textContent = `${data.messages.length} Nachricht(en) aus #${data.channelName}`;
  } catch (err) {
    toast(err.message, 'error');
    histStatus.textContent = err.message;
  } finally {
    histLoadBtn.disabled = false;
  }
}

histLoadBtn.addEventListener('click', loadHistory);
document.getElementById('histReload').addEventListener('click', () => histChannel.value && loadHistory());
histChannel.addEventListener('change', () => { if (histChannel.value) loadHistory(); });
