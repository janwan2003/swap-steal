// Shared browser helpers: API calls, per-swap identity in localStorage, small DOM helpers.
export const $ = (sel, el = document) => el.querySelector(sel);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const KEY = (id) => `swapsteal:${id}`;
export function getMe(id) {
  try { return JSON.parse(localStorage.getItem(KEY(id))) || null; } catch { return null; }
}
export function setMe(id, v) {
  try { if (v) localStorage.setItem(KEY(id), JSON.stringify(v)); else localStorage.removeItem(KEY(id)); } catch { /* private mode */ }
}

export async function api(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (token) headers['x-token'] = token;
  let res;
  try {
    res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error('No connection. Check your internet and try again.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    const e = new Error((data && data.error) || `Something went wrong (${res.status}).`);
    e.status = res.status;
    throw e;
  }
  return data;
}

let toastTimer;
export function toast(msg) {
  let t = $('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

const COLORS = ['#17603f', '#c8323c', '#b7791f', '#2b6cb0', '#6b46c1', '#2c7a7b', '#c05621', '#97266d'];
export function color(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}
export const initial = (name) => (String(name).trim()[0] || '?').toUpperCase();
