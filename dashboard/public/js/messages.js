/* global document, Dash */
'use strict';

const { apiFor, fillSelectors, toast } = Dash;

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
