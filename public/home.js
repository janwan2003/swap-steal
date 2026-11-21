import { $, api, setMe } from './common.js';

const form = $('#create');
const giftFields = $('#giftFields');
const sync = () => {
  const online = form.mode.value === 'online';
  giftFields.classList.toggle('hidden', !online || !$('#plays').checked);
};
form.addEventListener('change', sync);
sync();

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#createErr');
  err.textContent = '';
  const title = $('#title').value.trim();
  const name = $('#name').value.trim();
  if (!title) { err.textContent = 'Give your swap a name.'; $('#title').focus(); return; }
  if (!name) { err.textContent = 'Type your name.'; $('#name').focus(); return; }
  const mode = form.mode.value;
  const plays = $('#plays').checked;
  const body = { title, name, mode, plays, maxSteals: Number($('#steals').value), finalSwap: $('#finalSwap').checked };
  if (mode === 'online' && plays) {
    body.gift = { label: $('#gLabel').value, hint: $('#gHint').value, link: $('#gLink').value };
    if (!body.gift.label.trim()) { err.textContent = 'Describe the gift you are bringing.'; $('#gLabel').focus(); return; }
  }
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    const r = await api('/api/g', { method: 'POST', body });
    setMe(r.id, { token: r.token, id: r.me });
    location.href = `/g/${r.id}?new=1`;
  } catch (x) {
    err.textContent = x.message;
    btn.disabled = false;
  }
});
