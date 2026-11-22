/* GhOuL music — веб-версия (PWA). Без сборки и зависимостей. */
(() => {
'use strict';
const C = window.GHOUL_CONFIG;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = s => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const hash = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const plural = (n, a, b, c) => { const m = n % 100, k = n % 10; return n + ' ' + (m > 10 && m < 15 ? c : k === 1 ? a : k > 1 && k < 5 ? b : c); };
const today = () => new Date().toISOString().slice(0, 10);

/* ---------- Хранилище ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem('ghoul.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('ghoul.' + k, JSON.stringify(v)); } catch { /* приватный режим */ } },
  del(k) { try { localStorage.removeItem('ghoul.' + k); } catch { } },
};
const S = {
  favs: store.get('favs', []),
  playlists: store.get('playlists', []),
  history: store.get('history', []),
  stats: store.get('stats', { byDay: {} }),
  settings: Object.assign({ theme: 'ghoul', calm: false }, store.get('settings', {})),
  session: store.get('session', null),
  libUpdated: store.get('libUpdated', 0),
};
const save = k => store.set(k, S[k]);

/* IndexedDB для собственных аудиофайлов (остаются на устройстве) */
const idb = {
  db: null,
  open() {
    if (this.db) return this.db;
    this.db = new Promise((res, rej) => {
      const r = indexedDB.open('ghoul-files', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('files', { keyPath: 'id' });
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return this.db;
  },
  async tx(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => { const t = db.transaction('files', mode); const rq = fn(t.objectStore('files')); t.oncomplete = () => res(rq && rq.result); t.onerror = () => rej(t.error); });
  },
  put: f => idb.tx('readwrite', s => s.put(f)),
  get: id => idb.tx('readonly', s => s.get(id)),
  del: id => idb.tx('readwrite', s => s.delete(id)),
  all: () => idb.tx('readonly', s => s.getAll()),
};
let localTracks = [];

/* ---------- Реестр треков ---------- */
const TR = new Map();
const LISTS = {};
const reg = t => { TR.set(t.id, t); return t; };
const slim = t => ({ id: t.id, title: t.title, artist: t.artist, album: t.album || '', art: t.art || '', src: t.src || '', dur: t.dur || 0, source: t.source || '' });
S.favs.forEach(reg); S.playlists.forEach(p => p.tracks.forEach(reg)); S.history.forEach(h => reg(h.track));
const isFav = id => S.favs.some(t => t.id === id);

function art(t) {
  if (t.art) return t.art;
  // Чёрное стекло с искрой; лёгкий оттенок зависит от трека
  const h = hash(t.title + t.artist) % 360;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='hsl(${h} 14% 26%)'/><stop offset='1' stop-color='hsl(${h} 12% 6%)'/></linearGradient><radialGradient id='r'><stop offset='0' stop-color='#fff' stop-opacity='.35'/><stop offset='1' stop-color='#fff' stop-opacity='0'/></radialGradient></defs><rect width='100' height='100' fill='url(#g)'/><circle cx='50' cy='50' r='30' fill='url(#r)'/><path d='M50 22c1.600 14 8 26 28 28-20 2-26.400 14-28 28-1.600-14-8-26-28-28 20-2 26.400-14 28-28z' fill='none' stroke='#fff' stroke-opacity='.85' stroke-width='1.600' stroke-linejoin='round'/></svg>`);
}
const icon = n => `<svg><use href="#i-${n}"/></svg>`;

/* ---------- Мелкие помощники UI ---------- */
let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2800);
}
function openSheet(html, mount) {
  const w = $('#sheetWrap'); $('#sheet').innerHTML = html; w.hidden = false;
  if (mount) mount($('#sheet'));
}
const closeSheet = () => { $('#sheetWrap').hidden = true; };
const THEMES = ['ghoul', 'ice', 'ember', 'toxic', 'violet'];
let accRGB = [244, 244, 248];
function applySettings() {
  if (!THEMES.includes(S.settings.theme)) S.settings.theme = 'ghoul';
  document.body.dataset.theme = S.settings.theme;
  document.body.classList.toggle('calm', !!S.settings.calm);
  const cs = getComputedStyle(document.body);
  const c = cs.getPropertyValue('--bg');
  const m = $('meta[name=theme-color]'); if (m) m.content = c.trim() || '#050507';
  let a = cs.getPropertyValue('--accent').trim().replace('#', '');
  if (a.length === 3) a = [...a].map(x => x + x).join('');
  if (/^[0-9a-f]{6}$/i.test(a)) accRGB = [0, 2, 4].map(i => parseInt(a.slice(i, i + 2), 16));
  svgMotion(); if (window.__stars) window.__stars.restart();
}
const calmNow = () => !!S.settings.calm || matchMedia('(prefers-reduced-motion:reduce)').matches;
const svgMotion = () => $$('svg.orbit').forEach(s => { try { calmNow() ? s.pauseAnimations() : s.unpauseAnimations(); } catch { } });

/* ---------- Аккаунт (Supabase Auth) ---------- */
class AuthError extends Error {
  constructor(status, data, retryAfter) { super('auth'); this.status = status; this.data = data || {}; this.retryAfter = parseInt(retryAfter, 10) || 0; }
}
async function sb(path, { method = 'POST', body, token, prefer } = {}) {
  let res;
  try {
    res = await fetch(C.SUPABASE_URL + path, {
      method,
      headers: { apikey: C.SUPABASE_KEY, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(prefer ? { Prefer: prefer } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch { throw new AuthError(0, {}, 0); }
  let data = null; try { data = await res.json(); } catch { /* пустой ответ */ }
  if (!res.ok) throw new AuthError(res.status, data, res.headers.get('Retry-After'));
  return data;
}

/* Главное исправление: 429 больше не «Попробуй войти», а понятное сообщение
   под конкретное действие + таймер ожидания, переживающий перезагрузку. */
function authError(action, e) {
  const d = e.data, code = String(d.error_code || d.code || ''), msg = String(d.msg || d.message || d.error_description || d.error || '').toLowerCase();
  if (e.status === 0) return { text: 'Нет соединения с сервером. Проверь интернет.' };
  if (e.status === 429 || /over_.*rate_limit|too.?many|rate limit/.test(code + ' ' + msg)) {
    const isMail = code === 'over_email_send_rate_limit' || /email/.test(msg);
    const secs = e.retryAfter || (isMail ? C.EMAIL_COOLDOWN : C.DEFAULT_COOLDOWN);
    let text;
    if (action === 'signup') text = isMail
      ? 'Сервер исчерпал лимит писем с подтверждением. Если ты уже регистрировался — просто войди; иначе повтори позже.'
      : 'Слишком много попыток регистрации. Подожди немного и повтори.';
    else text = 'Слишком много попыток входа. Подожди немного и повтори.';
    return { text, cooldown: secs, rate: true };
  }
  if (code === 'user_already_exists' || /already (registered|exists)/.test(msg)) return { text: 'Такой email уже зарегистрирован. Попробуй войти.', switchTo: 'login' };
  if (code === 'invalid_credentials' || /invalid login/.test(msg)) return { text: 'Неверный email или пароль.' };
  if (code === 'email_not_confirmed' || /not confirmed/.test(msg)) return { text: 'Сначала подтверди адрес через письмо на почте.' };
  if (code === 'weak_password' || /password/.test(msg)) return { text: 'Пароль слишком простой: минимум 8 символов, лучше с цифрами.' };
  if (code === 'signup_disabled') return { text: 'Регистрация сейчас отключена на сервере.' };
  if (code === 'validation_failed' || /email/.test(msg)) return { text: 'Введите действительный email.' };
  return { text: `Сервер ответил ошибкой (HTTP ${e.status}). Попробуй позже.` };
}
const cdKey = a => 'cd.' + a;
const cooldownLeft = a => Math.max(0, Math.ceil((store.get(cdKey(a), 0) - Date.now()) / 1000));

function setSession(d) {
  S.session = { access_token: d.access_token, refresh_token: d.refresh_token, expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600), user: d.user };
  save('session');
}
async function getToken() {
  const s = S.session; if (!s) return null;
  if (s.expires_at - 60 > Date.now() / 1000) return s.access_token;
  try { setSession(await sb('/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: s.refresh_token } })); return S.session.access_token; }
  catch (e) { if (e.status === 400 || e.status === 401) logout(true); return null; }
}
function logout(silent) {
  S.session = null; store.del('session'); syncState('off'); if (!silent) toast('Ты вышел из аккаунта'); route();
}

/* Синхронизация избранного и плейлистов (таблица из README) */
let syncTimer, syncStatus = 'off';
function syncState(s) {
  syncStatus = s; const b = $('#syncBadge');
  b.hidden = !S.session;
  b.textContent = { ok: '● Синхронизировано', busy: '● Синхронизация…', fail: '● Синхронизация недоступна' }[s] || '';
  b.classList.toggle('on', s === 'ok');
}
async function syncNow(pullFirst) {
  if (!S.session) return;
  const token = await getToken(); if (!token) return syncState('fail');
  syncState('busy');
  try {
    if (pullFirst) {
      const rows = await sb(`/rest/v1/${C.SYNC_TABLE}?select=data,updated_at&limit=1`, { method: 'GET', token });
      const r = rows && rows[0];
      if (r && r.data) {
        const have = new Set(S.favs.map(t => t.id));
        (r.data.favs || []).forEach(t => { if (!have.has(t.id)) S.favs.push(reg(t)); });
        const pl = new Map(S.playlists.map(p => [p.id, p]));
        (r.data.playlists || []).forEach(p => { p.tracks.forEach(reg); pl.set(p.id, p); });
        S.playlists = [...pl.values()]; save('favs'); save('playlists');
      }
    }
    await sb(`/rest/v1/${C.SYNC_TABLE}?on_conflict=user_id`, {
      token, prefer: 'resolution=merge-duplicates,return=minimal', body: { user_id: S.session.user.id, data: { favs: S.favs.map(slim), playlists: S.playlists.map(p => ({ ...p, tracks: p.tracks.map(slim) })) }, updated_at: new Date().toISOString() },
    });
    S.libUpdated = Date.now(); save('libUpdated'); syncState('ok');
  } catch { syncState('fail'); }
}
function queueSync() { if (!S.session) return; clearTimeout(syncTimer); syncTimer = setTimeout(() => syncNow(false), 1500); }
function changed(...keys) { keys.forEach(save); queueSync(); }

/* ---------- Плеер ---------- */
const audio = $('#audio');
const P = { queue: [], i: -1, cur: null, shuffle: false, repeat: 0, url: null, token: 0, errs: 0, lyr: null, lyrOn: false, lastT: 0, counted: false };

async function playList(key, i) { const l = LISTS[key]; if (l) playQueue(l, i); }
function playQueue(list, i = 0) { P.queue = list.slice(); P.i = i; playIndex(i); }
async function playIndex(i) {
  const t = P.queue[i]; if (!t) return;
  P.i = i; const my = ++P.token; P.cur = reg(t); P.counted = false; P.lastT = 0;
  let src = t.src;
  if (t.id.startsWith('local:')) {
    const f = await idb.get(t.id).catch(() => null);
    if (my !== P.token) return;
    if (!f) { toast('Этот файл хранится на другом устройстве'); return step(1, true); }
    if (P.url) URL.revokeObjectURL(P.url); P.url = URL.createObjectURL(f.blob); src = P.url;
  }
  audio.src = src;
  paintPlayer(); ambient(t); loadLyrics(t);
  try { await audio.play(); } catch { /* автозапуск запрещён — пользователь нажмёт play */ }
  setMedia(t); markNow();
}
function step(dir, auto) {
  if (!P.queue.length) return;
  if (auto && P.repeat === 2) { audio.currentTime = 0; audio.play(); return; }
  if (!auto && dir < 0 && audio.currentTime > 3) { audio.currentTime = 0; return; }
  let i;
  if (P.shuffle && P.queue.length > 1) { do { i = Math.floor(Math.random() * P.queue.length); } while (i === P.i); }
  else i = P.i + dir;
  if (i >= P.queue.length) { if (P.repeat === 1 || !auto) i = 0; else { audio.pause(); return; } }
  if (i < 0) i = P.queue.length - 1;
  playIndex(i);
}
const toggle = () => { if (!P.cur) return; audio.paused ? audio.play().catch(() => { }) : audio.pause(); };

audio.addEventListener('play', paintState);
audio.addEventListener('pause', paintState);
audio.addEventListener('ended', () => step(1, true));
audio.addEventListener('error', () => {
  if (!audio.src) return;
  toast('Не удалось воспроизвести трек'); P.errs++;
  if (P.errs < 3) setTimeout(() => step(1, true), 900); else P.errs = 0;
});
audio.addEventListener('playing', () => {
  P.errs = 0;
  if (!P.counted && P.cur) { P.counted = true; const h = S.history; if (!h[0] || h[0].track.id !== P.cur.id) { h.unshift({ track: slim(P.cur), ts: Date.now() }); h.length = Math.min(h.length, 300); save('history'); } }
});
audio.addEventListener('timeupdate', () => {
  const d = audio.duration || (P.cur && P.cur.dur) || 0, t = audio.currentTime;
  const pct = d ? t / d * 100 : 0;
  $('#miniBar').style.width = pct + '%';
  const sk = $('#seek'); if (!sk.matches(':active')) { sk.value = d ? t / d * 1000 : 0; sk.style.setProperty('--p', pct + '%'); }
  $('#tCur').textContent = fmt(t); $('#tDur').textContent = fmt(d);
  const dt = t - P.lastT; P.lastT = t;
  if (dt > 0 && dt < 2) { S.stats.byDay[today()] = (S.stats.byDay[today()] || 0) + dt; if (!statsT) statsT = setTimeout(() => { statsT = 0; save('stats'); }, 15000); }
  syncLyrics(t);
});
let statsT = 0;

function paintState() {
  const pl = !audio.paused;
  const ic = pl ? 'pause' : 'play';
  $('#miniPlay use').setAttribute('href', '#i-' + ic); $('#pPlay use').setAttribute('href', '#i-' + ic);
  $('#player').classList.toggle('playing', pl);
  markNow(); if (pl) startViz(); paintDrum();
}
/* Капсула внутри барабана на главной */
function paintDrum() {
  const ti = $('#dcTitle'); if (!ti) return;
  const t = P.cur;
  ti.textContent = t ? t.title : 'Моя волна';
  $('#dcArtist').textContent = t ? t.artist : 'Нажми и слушай';
  $('#dcPlay use').setAttribute('href', '#i-' + (t && !audio.paused ? 'pause' : 'play'));
}
function paintPlayer() {
  const t = P.cur; if (!t) return;
  $('#mini').hidden = false;
  $('#miniArt').src = art(t); $('#miniTitle').textContent = t.title; $('#miniArtist').textContent = t.artist;
  $('#pArt').src = art(t); $('#pTitle').textContent = t.title; $('#pArtist').textContent = t.artist;
  $('#pSource').textContent = t.id.startsWith('local:') ? 'Файл на устройстве' : (t.source || 'Сейчас играет');
  $('#pFav').classList.toggle('on', isFav(t.id));
  $('#pShuffle').classList.toggle('on', P.shuffle);
  $('#pRepeat').classList.toggle('on', P.repeat > 0);
  $('#pRepeat').style.opacity = P.repeat === 2 ? 1 : '';
  $('#pRepeat').title = ['Повтор выключен', 'Повтор очереди', 'Повтор трека'][P.repeat];
  document.title = `${t.title} — ${t.artist}`;
  paintDrum();
}
function markNow() {
  $$('#view .row').forEach(r => {
    const now = P.cur && r.dataset.id === P.cur.id; r.classList.toggle('now', !!now);
    const b = $('b', r), eq = $('.eq', b);
    if (now && !eq) b.insertAdjacentHTML('afterbegin', '<span class="eq"><i></i><i></i><i></i></span>');
    if (!now && eq) eq.remove();
  });
  document.body.classList.toggle('paused', audio.paused);
}
function setMedia(t) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album || '', artwork: t.art ? [{ src: t.art, sizes: '400x400' }] : [] });
    navigator.mediaSession.setActionHandler('play', toggle); navigator.mediaSession.setActionHandler('pause', toggle);
    navigator.mediaSession.setActionHandler('nexttrack', () => step(1, false)); navigator.mediaSession.setActionHandler('previoustrack', () => step(-1, false));
  } catch { }
}

/* Подсветка под обложку */
function ambient(t) {
  const set = c => document.documentElement.style.setProperty('--amb', c);
  const h = hash(t.title + t.artist) % 360;
  if (!t.art) return set(`hsl(${h} 28% 27%)`);
  const im = new Image(); im.crossOrigin = 'anonymous';
  im.onload = () => {
    try {
      const c = document.createElement('canvas'); c.width = c.height = 8; const x = c.getContext('2d'); x.drawImage(im, 0, 0, 8, 8);
      const d = x.getImageData(0, 0, 8, 8).data; let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) { const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]); const w = 1 + (mx - mn) / 40; r += d[i] * w; g += d[i + 1] * w; b += d[i + 2] * w; n += w; }
      r /= n; g /= n; b /= n; const l = (r + g + b) / 3, k = 0.78; r = r * .55 + l * .45; g = g * .55 + l * .45; b = b * .55 + l * .45; set(`rgb(${r * k | 0},${g * k | 0},${b * k | 0})`);
    } catch { set(`hsl(${h} 28% 27%)`); }
  };
  im.onerror = () => set(`hsl(${h} 28% 27%)`); im.src = t.art;
}

/* Декоративный визуализатор (не анализ звука) */
let vizOn = false;
function startViz() {
  if (vizOn) return; vizOn = true;
  const cv = $('#viz'), g = cv.getContext('2d');
  const loop = ts => {
    if (audio.paused || !$('#player').classList.contains('open') || S.settings.calm) { vizOn = false; g.clearRect(0, 0, cv.width, cv.height); return; }
    const W = cv.width, H = cv.height, n = 56, w = W / n; g.clearRect(0, 0, W, H);
    const gr = g.createLinearGradient(0, H, 0, 0); gr.addColorStop(0, `rgba(${accRGB},.05)`); gr.addColorStop(1, `rgba(${accRGB},.95)`);
    g.fillStyle = gr;
    for (let i = 0; i < n; i++) {
      const v = (Math.sin(ts / 280 + i * .55) + Math.sin(ts / 530 + i * 1.3) + 2) / 4;
      const h = 6 + v * H * .9 * (0.4 + 0.6 * Math.sin(i / n * Math.PI));
      g.beginPath(); g.roundRect(i * w + w * .3, H - h, w * .4, h, 2); g.fill();
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

/* Тексты песен (LRCLIB) */
const lyrCache = new Map();
function parseLRC(s) {
  const out = [];
  s.split('\n').forEach(l => { const m = l.match(/^\s*((?:\[\d+:\d+(?:\.\d+)?\])+)\s*(.*)$/); if (!m) return; [...m[1].matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)].forEach(x => out.push({ t: +x[1] * 60 + +x[2], text: m[2] })); });
  return out.sort((a, b) => a.t - b.t);
}
async function fetchLyrics(t) {
  const q = new URLSearchParams({ artist_name: t.artist, track_name: t.title }); if (t.album) q.set('album_name', t.album);
  try {
    let r = await fetch('https://lrclib.net/api/get?' + q); let j = r.ok ? await r.json() : null;
    if (!j) { r = await fetch('https://lrclib.net/api/search?q=' + encodeURIComponent(t.artist + ' ' + t.title)); const a = r.ok ? await r.json() : []; j = a && a[0]; }
    if (!j) return { none: true };
    const preview = !t.id.startsWith('local:');
    if (j.syncedLyrics && !preview) return { lines: parseLRC(j.syncedLyrics), synced: true };
    const plain = j.plainLyrics || (j.syncedLyrics ? parseLRC(j.syncedLyrics).map(x => x.text).join('\n') : '');
    return plain ? { lines: plain.split('\n').map(text => ({ t: 0, text })), synced: false, preview } : { none: true };
  } catch { return { error: true }; }
}
async function loadLyrics(t) {
  P.lyr = null; renderLyrics();
  if (!P.lyrOn) return;
  if (!lyrCache.has(t.id)) lyrCache.set(t.id, await fetchLyrics(t));
  if (P.cur && P.cur.id === t.id) { P.lyr = lyrCache.get(t.id); renderLyrics(); }
}
function renderLyrics() {
  const el = $('#lyrics'), pl = $('#player');
  pl.classList.toggle('has-lyrics', P.lyrOn); el.hidden = !P.lyrOn; $('#pLyricsBtn').classList.toggle('on', P.lyrOn);
  if (!P.lyrOn) return;
  const L = P.lyr;
  if (!L) { el.innerHTML = '<div class="note">Ищу текст…</div>'; return; }
  if (L.none) { el.innerHTML = '<div class="note">Текст для этой песни не найден.</div>'; return; }
  if (L.error) { el.innerHTML = '<div class="note">Не удалось загрузить текст. Проверь интернет.</div>'; return; }
  el.innerHTML = (L.preview ? '<div class="note" style="padding:6px 0 14px;text-align:left">Играет 30-секундный фрагмент, поэтому строки не синхронизированы.</div>' : '') +
    L.lines.map((l, i) => `<p class="${L.synced ? '' : 'plain'}" data-i="${i}">${esc(l.text) || '&nbsp;'}</p>`).join('');
  lastLine = -1;
}
let lastLine = -1;
function syncLyrics(t) {
  const L = P.lyr; if (!P.lyrOn || !L || !L.synced) return;
  let k = -1; for (let i = 0; i < L.lines.length && L.lines[i].t <= t + .15; i++) k = i;
  if (k === lastLine) return; lastLine = k;
  const el = $('#lyrics'); $$('p.cur', el).forEach(p => p.classList.remove('cur'));
  const p = $(`p[data-i="${k}"]`, el); if (p) { p.classList.add('cur'); p.scrollIntoView({ block: 'center', behavior: S.settings.calm ? 'auto' : 'smooth' }); }
}

/* ---------- Поиск (iTunes Search API) ---------- */
const norm = r => reg({ id: 'it:' + r.trackId, title: r.trackName, artist: r.artistName, album: r.collectionName || '', art: (r.artworkUrl100 || '').replace('100x100', '400x400'), src: r.previewUrl, dur: 30, source: 'Фрагмент 30 сек · iTunes' });
async function itunes(term, { limit = 30, country = '', signal } = {}) {
  const u = `https://itunes.apple.com/search?media=music&entity=song&limit=${limit}&term=${encodeURIComponent(term)}${country ? '&country=' + country : ''}`;
  const r = await fetch(u, { signal });
  if (r.status === 429 || r.status === 403) throw new Error('rate');
  if (!r.ok) throw new Error('http');
  const j = await r.json();
  return (j.results || []).filter(x => x.previewUrl && x.trackName).map(norm);
}
const searchErr = e => e.message === 'rate' ? 'Сервис поиска ограничил частоту запросов. Попробуй позже.' : 'Не удалось выполнить поиск. Проверь интернет.';

/* ---------- Шаблоны ---------- */
function rowHTML(t, key, i, compact) {
  const now = P.cur && P.cur.id === t.id;
  return `<div class="row${now ? ' now' : ''}" data-id="${esc(t.id)}">
    <button class="main" data-play="${key}:${i}"><img src="${esc(art(t))}" alt="" loading="lazy">
      <span class="t"><b>${now ? '<span class="eq"><i></i><i></i><i></i></span>' : ''}${esc(t.title)}</b><small>${esc(t.artist)}${!compact && t.album ? ' · ' + esc(t.album) : ''}</small></span></button>
    ${compact ? '' : `<button class="ico fav${isFav(t.id) ? ' on' : ''}" data-fav="${esc(t.id)}" aria-label="В избранное">${icon('heart')}</button>`}
    <button class="ico" data-more="${esc(t.id)}" data-ctx="${key}" aria-label="Действия">${icon('more')}</button></div>`;
}
function listHTML(tracks, key, compact) { LISTS[key] = tracks; return `<div class="list">${tracks.map((t, i) => rowHTML(t, key, i, compact)).join('')}</div>`; }
function shelfHTML(tracks, key) {
  LISTS[key] = tracks;
  return `<div class="shelf">${tracks.map((t, i) => `<button class="card" data-play="${key}:${i}"><img src="${esc(art(t))}" alt="" loading="lazy"><b>${esc(t.title)}</b><small>${esc(t.artist)}</small></button>`).join('')}</div>`;
}
const skelShelf = () => `<div class="shelf">${'<div class="card"><div class="skel" style="width:138px;height:138px"></div></div>'.repeat(5)}</div>`;
const emptyHTML = (t, s) => `<div class="empty"><b>${t}</b>${s || ''}</div>`;

/* ---------- Экраны ---------- */
const V = { name: 'home', arg: null, tab: 'fav', q: '', authMode: 'login', authMsg: null };
const view = $('#view');
const render = html => { view.innerHTML = `<div class="view-in">${html}</div>`; view.scrollTop = 0; };

function route(name = V.name, arg = V.arg) {
  V.name = name; V.arg = arg;
  const navOf = { playlist: 'library', history: 'home' }[name] || name;
  $$('#nav button').forEach(b => b.classList.toggle('on', b.dataset.go === navOf));
  ({ home: vHome, search: vSearch, library: vLibrary, playlist: vPlaylist, profile: vProfile, history: vHistory }[name] || vHome)();
  markNow();
}

const SHELVES = [
  { id: 'hits', title: 'Хиты сейчас', q: 'top hits' },
  { id: 'rap', title: 'Русский рэп', q: 'русский рэп', country: 'RU' },
  { id: 'rock', title: 'Рок-классика', q: 'classic rock' },
  { id: 'edm', title: 'Электроника', q: 'electronic dance' },
  { id: 'chill', title: 'Чилл и лоу-фай', q: 'lofi chill' },
];
const shelfCache = {};
function greeting() { const h = new Date().getHours(); return h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер'; }

const recentTracks = max => {
  const out = [], seen = new Set();
  S.history.forEach(h => { if (!seen.has(h.track.id) && out.length < max) { seen.add(h.track.id); out.push(reg(h.track)); } });
  return out;
};
const CHEV = '<svg class="chev"><use href="#i-chev"/></svg>';

function vHome() {
  const recent = recentTracks(5);
  render(`<section class="hero2"><i class="beam"></i>
      <button class="wave-pill" id="waveBtn">${icon('sparkle')}<span>Моя волна</span></button>
      <div class="mark">
        <svg class="orbit" viewBox="0 0 400 200" aria-hidden="true">
          <g transform="rotate(-12 200 100)"><ellipse cx="200" cy="100" rx="196" ry="52" class="o1"/><circle r="3.500" class="dot"><animateMotion dur="18s" repeatCount="indefinite" path="M4 100a196 52 0 1 0 392 0a196 52 0 1 0 -392 0"/></circle></g>
          <g transform="rotate(10 200 100)"><ellipse cx="200" cy="100" rx="182" ry="40" class="o2"/></g>
        </svg>
        <h1 class="wordmark silver">GhOuL</h1><div class="wm-sub">music</div>
      </div>
      <div class="drum" id="drum"><canvas id="drumCv"></canvas>
        <div class="drum-card">
          <button class="dc-btn" id="dcOpen" aria-label="Открыть плеер">${icon('eq')}</button>
          <button class="dc-main" id="dcMain"><b id="dcTitle"></b><small id="dcArtist"></small></button>
          <button class="dc-btn dc-play" id="dcPlay" aria-label="Пауза/играть">${icon('pause')}</button>
        </div>
      </div>
      <p class="tagline"><span>Музыка, которая всегда с тобой.</span></p>
    </section>
    <nav class="quick">
      <button data-lib="fav">${icon('sparkle')}<span>Избранное</span>${CHEV}</button>
      <button data-lib="pl">${icon('list')}<span>Плейлисты</span>${CHEV}</button>
      <button data-scroll="shelves">${icon('flame')}<span>Тренды</span>${CHEV}</button>
    </nav>
    <h3>Недавно прослушанное${recent.length ? `<button class="more-link" data-go="history">Все ${icon('arrow')}</button>` : ''}</h3>
    ${recent.length ? listHTML(recent, 'recent', true) : '<p class="sub">Здесь появятся треки, которые ты послушаешь.</p>'}
    <div id="shelves">${SHELVES.map(s => `<h3>${s.title}</h3><div id="sh-${s.id}">${skelShelf()}</div>`).join('')}</div>`);
  $('#waveBtn').onclick = startWave;
  const toPlayer = () => P.cur ? openPlayer() : startWave();
  $('#dcOpen').onclick = toPlayer; $('#dcMain').onclick = toPlayer;
  $('#dcPlay').onclick = () => P.cur ? toggle() : startWave();
  paintDrum(); startDrum(); svgMotion();
  SHELVES.forEach(async s => {
    const box = () => $('#sh-' + s.id); if (!box()) return;
    try {
      if (!shelfCache[s.id]) shelfCache[s.id] = await itunes(s.q, { limit: 18, country: s.country });
      if (box() && V.name === 'home') { box().innerHTML = shelfCache[s.id].length ? shelfHTML(shelfCache[s.id], 'shelf-' + s.id) : '<p class="sub">Пусто</p>'; }
    } catch (e) { if (box() && V.name === 'home') box().innerHTML = `<p class="sub">${esc(searchErr(e))}</p>`; }
  });
}
/* ---------- Барабан: стеклянный цилиндр с эквалайзером (canvas) ---------- */
function glow(g, x, y, s, A, k = 1) {
  const gr = g.createRadialGradient(x, y, 0, x, y, s);
  gr.addColorStop(0, `rgba(255,255,255,${.95 * k})`); gr.addColorStop(.3, `rgba(${A},${.4 * k})`); gr.addColorStop(1, `rgba(${A},0)`);
  g.fillStyle = gr; g.beginPath(); g.arc(x, y, s, 0, 6.2832); g.fill();
}
function sparkle(g, x, y, s, A, k = 1) {
  glow(g, x, y, s, A, k);
  const L = s * 3.2;
  [[x - L, y, x + L, y], [x, y - L, x, y + L]].forEach(([a, b, c, d]) => {
    const gr = g.createLinearGradient(a, b, c, d);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(.5, `rgba(255,255,255,${.9 * k})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.strokeStyle = gr; g.lineWidth = 1; g.beginPath(); g.moveTo(a, b); g.lineTo(c, d); g.stroke();
  });
}
function drawDrum(g, W, H, dpr, t, en, rot, seeds) {
  const PI = Math.PI, TAU = PI * 2, N = seeds.length, A = accRGB.join(',');
  const cx = W / 2, rx = W * .43, ry = rx * .2, yt = H * .19, hc = H * .46, yb = yt + hc;
  const ell = (x, y, a, b, a0, a1) => { g.beginPath(); g.ellipse(x, y, a, b, 0, a0, a1); };
  const beat = Math.pow(Math.max(0, Math.sin(t / 80)), 6) * en;
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  g.lineCap = 'round';

  // внешние орбиты (задняя половина)
  const rA = { y: yb + ry + W * .02, rx: rx * 1.04, ry: ry * 1.35 }, rB = { y: yb + ry * .6, rx: rx * 1.09, ry: ry * 1.1 };
  g.lineWidth = 1;
  [rA, rB].forEach((r, k) => { g.strokeStyle = `rgba(${A},${k ? .14 : .26})`; ell(cx, r.y, r.rx, r.ry, PI, TAU); g.stroke(); });

  // постамент: боковина + верхняя площадка
  const pr = rx * 1.07, pry = ry * 1.13, pd = W * .03;
  g.beginPath(); g.moveTo(cx - pr, yb); g.lineTo(cx - pr, yb + pd); g.ellipse(cx, yb + pd, pr, pry, 0, PI, 0, true);
  g.lineTo(cx + pr, yb); g.ellipse(cx, yb, pr, pry, 0, 0, PI, false); g.closePath();
  let gr = g.createLinearGradient(cx - pr, 0, cx + pr, 0);
  gr.addColorStop(0, '#42424d'); gr.addColorStop(.25, '#1b1b21'); gr.addColorStop(.7, '#0c0c10'); gr.addColorStop(1, '#2a2a32');
  g.fillStyle = gr; g.fill();
  g.lineWidth = 1.2; ell(cx, yb + pd, pr, pry, 0, PI); g.strokeStyle = 'rgba(255,255,255,.4)'; g.stroke();
  ell(cx, yb, pr, pry, 0, TAU); gr = g.createLinearGradient(0, yb - pry, 0, yb + pry);
  gr.addColorStop(0, '#15151a'); gr.addColorStop(1, '#2b2b33'); g.fillStyle = gr; g.fill();
  g.strokeStyle = 'rgba(255,255,255,.5)'; g.stroke();
  // свечение пола под столбиками
  g.save(); g.translate(cx, yb); g.scale(1, ry / rx * 1.05);
  gr = g.createRadialGradient(0, 0, 0, 0, 0, rx);
  const fl = (.3 + .35 * beat) * (.4 + .6 * en);
  gr.addColorStop(0, `rgba(${A},${fl})`); gr.addColorStop(.6, `rgba(${A},${fl * .25})`); gr.addColorStop(1, `rgba(${A},0)`);
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, rx, 0, TAU); g.fill(); g.restore();

  // задняя внутренняя стенка стекла
  g.beginPath(); g.moveTo(cx - rx, yt); g.ellipse(cx, yt, rx, ry, 0, PI, TAU); g.lineTo(cx + rx, yb); g.ellipse(cx, yb, rx, ry, 0, TAU, PI, true); g.closePath();
  gr = g.createLinearGradient(0, yt - ry, 0, yb); gr.addColorStop(0, 'rgba(255,255,255,.1)'); gr.addColorStop(1, 'rgba(255,255,255,.015)');
  g.fillStyle = gr; g.fill();

  // столбики-колонны по кругу
  const bars = [], bw = Math.max(3, W / 100);
  for (let i = 0; i < N; i++) {
    const th = i / N * TAU + rot, z = Math.sin(th), k = i / N * TAU;
    let v = (Math.sin(t / 230 + seeds[i].a + k * 3) + Math.sin(t / 410 + seeds[i].b + k * 5) * .8 + Math.sin(t / 95 + i * 1.7) * .35 + 2.15) / 4.3;
    v = Math.max(0, Math.min(1, v));
    const idle = .09 + .2 * Math.pow(Math.sin(i * 1.7 + seeds[i].a), 2) + .05 * (1 + Math.sin(t / 1100 + i * .5));
    const lv = Math.min(1, idle * (1 - en) + (.16 + Math.pow(v, 1.4) * .82 + beat * .2 * (1 - v * .5)) * en);
    bars.push({ x: cx + Math.cos(th) * rx * .88, y: yb + z * ry * .88, z, h: Math.max(4, lv * hc * .96) });
  }
  bars.sort((a, b) => a.z - b.z);
  for (const b of bars) {
    const a = b.z < 0 ? .72 : 1, x0 = b.x - bw / 2, top = b.y - b.h;
    g.globalCompositeOperation = 'lighter'; g.fillStyle = `rgba(${A},${.07 * a})`; g.fillRect(b.x - bw * 1.7, top, bw * 3.4, b.h);
    g.globalCompositeOperation = 'source-over';
    gr = g.createLinearGradient(x0, 0, x0 + bw, 0);
    gr.addColorStop(0, `rgba(255,255,255,${.95 * a})`); gr.addColorStop(.4, `rgba(${A},${.85 * a})`); gr.addColorStop(1, `rgba(${A},${.3 * a})`);
    g.fillStyle = gr; g.fillRect(x0, top, bw, b.h);
    gr = g.createLinearGradient(0, b.y, 0, top); gr.addColorStop(0, 'rgba(5,5,7,.7)'); gr.addColorStop(.6, 'rgba(5,5,7,0)');
    g.fillStyle = gr; g.fillRect(x0, top, bw, b.h);
    ell(b.x, top, bw / 2, bw * .3, 0, TAU); g.fillStyle = `rgba(255,255,255,${a})`; g.fill();
    if (b.h > hc * .5) glow(g, b.x, top, bw * 2.4, A, .5 * a);
  }

  // передняя стеклянная стенка
  const wall = () => { g.beginPath(); g.moveTo(cx - rx, yt); g.ellipse(cx, yt, rx, ry, 0, PI, 0, true); g.lineTo(cx + rx, yb); g.ellipse(cx, yb, rx, ry, 0, 0, PI, false); g.closePath(); };
  wall();
  gr = g.createLinearGradient(cx - rx, 0, cx + rx, 0);
  [[0, .34], [.04, .12], [.14, .035], [.5, .02], [.86, .04], [.96, .12], [1, .34]].forEach(([o, al]) => gr.addColorStop(o, `rgba(255,255,255,${al})`)); g.fillStyle = gr; g.fill();
  gr = g.createLinearGradient(0, yt, 0, yb + ry);
  [[0, .16], [.35, .0], [.8, .0], [1, .14]].forEach(([o, al]) => gr.addColorStop(o, `rgba(255,255,255,${al})`)); g.fillStyle = gr; g.fill();
  // блики скользят по стеклу
  g.save(); wall(); g.clip();
  [[Math.sin(rot * .9) * .72, .15, .2], [Math.sin(rot * .9 + 1.2) * .72 + .1, .04, .09]].forEach(([o, w, al]) => {
    const gx = cx + o * rx, bwd = rx * w, sh = g.createLinearGradient(gx - bwd, 0, gx + bwd, 0);
    sh.addColorStop(0, 'rgba(255,255,255,0)'); sh.addColorStop(.5, `rgba(255,255,255,${al})`); sh.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = sh; g.fillRect(gx - bwd, yt - ry, bwd * 2, hc + ry * 3);
  });
  g.restore();

  // толстая кромка стекла сверху
  g.beginPath(); g.ellipse(cx, yt, rx, ry, 0, 0, TAU); g.moveTo(cx + rx - 9, yt); g.ellipse(cx, yt, rx - 9, ry - 2.2, 0, 0, TAU);
  g.fillStyle = 'rgba(255,255,255,.13)'; g.fill('evenodd');
  g.lineWidth = 1.2; ell(cx, yt, rx, ry, 0, TAU); g.strokeStyle = 'rgba(255,255,255,.55)'; g.stroke();
  ell(cx, yt, rx - 9, ry - 2.2, 0, TAU); g.strokeStyle = 'rgba(255,255,255,.22)'; g.stroke();
  g.lineWidth = 2; ell(cx, yt, rx, ry, 0, PI); g.strokeStyle = 'rgba(255,255,255,.92)'; g.stroke();
  g.lineWidth = 1.4; ell(cx, yb, rx, ry, 0, PI); g.strokeStyle = 'rgba(255,255,255,.6)'; g.stroke();
  [-1, 1].forEach(s => {
    const lg = g.createLinearGradient(0, yt, 0, yb); lg.addColorStop(0, 'rgba(255,255,255,.8)'); lg.addColorStop(1, 'rgba(255,255,255,.25)');
    g.strokeStyle = lg; g.lineWidth = 1.6; g.beginPath(); g.moveTo(cx + s * rx, yt); g.lineTo(cx + s * rx, yb); g.stroke();
  });

  // орбиты (передняя половина) и летящие огоньки
  g.lineWidth = 1;
  [rA, rB].forEach((r, k) => { g.strokeStyle = `rgba(${A},${k ? .22 : .5})`; ell(cx, r.y, r.rx, r.ry, 0, PI); g.stroke(); });
  [[rA, rot * 1.6, 3], [rA, rot * 1.6 + 2.6, 2.2], [rB, -rot * 1.1 + 1, 2.6], [rB, -rot * 1.1 + 4, 2]].forEach(([r, ph, s]) =>
    glow(g, cx + Math.cos(ph) * r.rx, r.y + Math.sin(ph) * r.ry, s * 3.4, A, Math.sin(ph) > 0 ? 1 : .5));

  // искры
  const p = 1 + .15 * Math.sin(t / 420) + beat * .3, u = W / 700;
  sparkle(g, cx, yt - ry, 5.5 * u * p + 2, A, .95);
  sparkle(g, cx, yb + pry, 6 * u * p + 2, A, 1);
  sparkle(g, cx, rA.y + rA.ry, 4.5 * u + 1.5, A, .9);
  [-1, 1].forEach(s => { sparkle(g, cx + s * rx, yt, 3.2 * u + 1.2, A, .9); sparkle(g, cx + s * rA.rx * .97, rA.y, 3.4 * u + 1.2, A, .8); });
}
let drumRaf = 0;
function startDrum() {
  cancelAnimationFrame(drumRaf);
  const cv = $('#drumCv'); if (!cv) return;
  const g = cv.getContext('2d'), N = 72;
  const seeds = Array.from({ length: N }, () => ({ a: Math.random() * 6.283, b: Math.random() * 6.283 }));
  let W = 0, H = 0, dpr = 1, en = audio.paused ? 0 : 1, rot = Math.random() * 6, last = performance.now(), dirty = true;
  const size = () => { const r = cv.getBoundingClientRect(); if (!r.width) return false; dpr = Math.min(devicePixelRatio || 1, 2); W = r.width; H = r.height; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); dirty = true; return true; };
  const frame = ts => {
    if (!cv.isConnected) { drumRaf = 0; return; }
    drumRaf = requestAnimationFrame(frame);
    const r = cv.getBoundingClientRect();
    if (Math.abs(r.width - W) > 1 || Math.abs(r.height - H) > 1) size();
    if (!W || $('#player').classList.contains('open')) { last = ts; return; }
    const dt = Math.min(60, ts - last); last = ts;
    const target = audio.paused ? 0 : 1, calm = calmNow();
    en += (target - en) * Math.min(1, dt / 280);
    if (calm) { if (!dirty && Math.abs(target - en) < .01) return; en = target; }
    else rot += dt * (.00012 + en * .0003);
    dirty = false;
    drawDrum(g, W, H, dpr, calm ? 0 : ts, en, rot, seeds);
  };
  drumRaf = requestAnimationFrame(frame);
}

/* ---------- Звёздное небо на фоне ---------- */
window.__stars = (() => {
  const cv = $('#stars'), g = cv.getContext('2d');
  const rnd = () => Math.random();
  const stars = Array.from({ length: 170 }, () => ({ u: rnd(), v: rnd(), r: rnd() * 1.05 + .3, p: rnd() * 6.28, s: rnd() * 1.4 + .3 }));
  const sparks = Array.from({ length: 6 }, () => ({ u: .08 + rnd() * .84, v: .05 + rnd() * .9, r: 2 + rnd() * 2.5, p: rnd() * 6.28, s: rnd() * .7 + .3 }));
  let W = 0, H = 0, dpr = 1, raf = 0;
  const size = () => { dpr = Math.min(devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); };
  const draw = ts => {
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const t = ts / 1000, n = Math.min(stars.length, Math.round(W * H / 6000));
    g.fillStyle = '#fff';
    for (let i = 0; i < n; i++) { const s = stars[i]; g.globalAlpha = .15 + .6 * (.5 + .5 * Math.sin(t * s.s + s.p)); g.beginPath(); g.arc(s.u * W, s.v * H, s.r, 0, 6.2832); g.fill(); }
    g.globalAlpha = 1;
    for (const s of sparks) sparkle(g, s.u * W, s.v * H, s.r, accRGB.join(','), .15 + .5 * (.5 + .5 * Math.sin(t * s.s + s.p)));
  };
  const loop = ts => { draw(ts); raf = requestAnimationFrame(loop); };
  const restart = () => { cancelAnimationFrame(raf); raf = 0; calmNow() ? draw(0) : (raf = requestAnimationFrame(loop)); };
  addEventListener('resize', () => { size(); restart(); });
  size();
  return { restart };
})();

async function startWave() {
  const btn = $('#waveBtn'); if (btn) btn.disabled = true;
  try {
    const arts = {}; [...S.favs, ...S.history.map(h => h.track)].forEach(t => arts[t.artist] = (arts[t.artist] || 0) + 1);
    const top = Object.entries(arts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(a => a[0]);
    const seeds = top.length ? top.sort(() => Math.random() - .5).slice(0, 3) : ['top hits'];
    const res = (await Promise.all(seeds.map(q => itunes(q, { limit: 15 }).catch(() => [])))).flat();
    const uniq = [...new Map(res.map(t => [t.id, t])).values()].sort(() => Math.random() - .5);
    if (!uniq.length) throw new Error('empty');
    playQueue(uniq, 0); toast(top.length ? 'Волна по твоим вкусам' : 'Волна: хиты');
  } catch { toast('Не удалось собрать волну. Проверь интернет.'); }
  if (btn) btn.disabled = false;
}

let searchAbort, searchT;
function vSearch() {
  render(`<h1>Поиск</h1><label class="field">${icon('search')}<input id="q" type="search" placeholder="Трек, исполнитель, альбом" value="${esc(V.q)}" autocomplete="off" enterkeyhint="search"></label>
    <div class="tags">${['Звери', 'Imagine Dragons', 'Монеточка', 'Daft Punk', 'Скриптонит', 'The Weeknd'].map(t => `<button class="chip" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}</div>
    <div id="res">${V.q ? '' : emptyHTML('Что послушаем?', 'Ищи по каталогу или среди своих файлов и избранного.')}</div>`);
  const inp = $('#q'); inp.oninput = () => { V.q = inp.value; clearTimeout(searchT); searchT = setTimeout(doSearch, 380); };
  inp.onkeydown = e => { if (e.key === 'Enter') { clearTimeout(searchT); doSearch(); inp.blur(); } };
  if (V.q) doSearch(); else setTimeout(() => inp.focus(), 50);
}
async function doSearch() {
  const q = V.q.trim(), box = $('#res'); if (!box) return;
  if (!q) { box.innerHTML = emptyHTML('Что послушаем?', 'Ищи по каталогу или среди своих файлов и избранного.'); return; }
  if (q.length < 2) { box.innerHTML = emptyHTML('Введи от 2 символов'); return; }
  const lq = q.toLowerCase();
  const mine = [...localTracks, ...S.favs].filter((t, i, a) => a.findIndex(x => x.id === t.id) === i && (t.title + ' ' + t.artist).toLowerCase().includes(lq));
  const head = mine.length ? `<h3>В моей музыке <small>${mine.length}</small></h3>${listHTML(mine, 'mine')}` : '';
  box.innerHTML = head + `<h3>Каталог</h3><div id="cat">${skelShelf()}</div>`;
  if (searchAbort) searchAbort.abort(); searchAbort = new AbortController();
  try {
    const r = await itunes(q, { signal: searchAbort.signal });
    const cat = $('#cat'); if (!cat || V.q.trim() !== q) return;
    cat.innerHTML = r.length ? listHTML(r, 'search') : emptyHTML('Ничего не найдено', 'Попробуй другое название или исполнителя.'); markNow();
  } catch (e) { if (e.name === 'AbortError') return; const cat = $('#cat'); if (cat) cat.innerHTML = emptyHTML('Поиск недоступен', esc(searchErr(e))); }
}

function vLibrary() {
  const tabs = [['fav', 'Избранное'], ['pl', 'Плейлисты'], ['files', 'Файлы']];
  let body = '';
  if (V.tab === 'fav') body = S.favs.length
    ? `<div style="display:flex;gap:10px;margin-bottom:10px"><button class="btn" data-all="play">${icon('play')} Слушать</button><button class="btn ghost" data-all="shuffle">${icon('shuffle')} Вперемешку</button></div>${listHTML(S.favs, 'favs')}`
    : emptyHTML('Пока пусто', 'Нажми ♥ у любого трека — он появится здесь.');
  if (V.tab === 'pl') body = `<button class="btn block" data-newpl style="margin-bottom:14px">${icon('plus')} Новый плейлист</button>` +
    (S.playlists.length ? S.playlists.map(p => `<button class="pl-card" data-openpl="${p.id}"><span class="pl-cover">${p.tracks[0] && p.tracks[0].art ? `<img src="${esc(p.tracks[0].art)}" alt="">` : icon('lib')}</span><span><b>${esc(p.name)}</b><br><small style="color:var(--muted)">${plural(p.tracks.length, 'трек', 'трека', 'треков')}</small></span></button>`).join('') : emptyHTML('Плейлистов нет', 'Создай первый и добавляй в него треки через ⋯'));
  if (V.tab === 'files') body = `<button class="btn block" data-import style="margin-bottom:6px">${icon('file')} Добавить аудиофайлы</button><p class="sub" style="font-size:13px">Файлы хранятся только на этом устройстве и не отправляются на сервер.</p>` +
    (localTracks.length ? listHTML(localTracks, 'files') : emptyHTML('Аудиофайлов пока нет', 'Импортируй mp3, m4a, flac, ogg — играют целиком, с синхронным текстом.'));
  render(`<h1>Библиотека</h1><div class="tabs">${tabs.map(([k, n]) => `<button data-tab="${k}" class="${V.tab === k ? 'on' : ''}">${n}</button>`).join('')}</div>${body}`);
}
function vHistory() {
  const all = recentTracks(100);
  render(`<button class="chip" data-go="home" style="margin:8px 0 4px">${icon('back')} Главная</button><h1>Недавно прослушанное</h1><p class="sub">${plural(all.length, 'трек', 'трека', 'треков')}</p>
    ${all.length ? `<div style="display:flex;gap:10px;margin-bottom:10px"><button class="btn" data-all="hist">${icon('play')} Слушать</button></div>${listHTML(all, 'history')}` : emptyHTML('Пока пусто', 'Включи любой трек — он появится здесь.')}`);
}
function vPlaylist() {
  const p = S.playlists.find(x => x.id === V.arg); if (!p) return route('library');
  render(`<button class="chip" data-go="library" style="margin:8px 0 4px">${icon('back')} Библиотека</button><h1>${esc(p.name)}</h1><p class="sub">${plural(p.tracks.length, 'трек', 'трека', 'треков')}</p>
    <div style="display:flex;gap:10px;margin-bottom:10px">${p.tracks.length ? `<button class="btn" data-all="plplay">${icon('play')} Слушать</button>` : ''}<button class="btn ghost" data-rename="${p.id}">Переименовать</button><button class="btn ghost" data-delpl="${p.id}" aria-label="Удалить">${icon('trash')}</button></div>
    ${p.tracks.length ? listHTML(p.tracks, 'pl:' + p.id) : emptyHTML('Плейлист пуст', 'Добавляй треки через ⋯ рядом с песней.')}`);
}

function vProfile() {
  const u = S.session && S.session.user;
  const days = Object.keys(S.stats.byDay).length, mins = Math.round(Object.values(S.stats.byDay).reduce((a, b) => a + b, 0) / 60);
  const arts = {}; S.history.forEach(h => arts[h.track.artist] = (arts[h.track.artist] || 0) + 1);
  const top = Object.entries(arts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const themes = [['ghoul', 'Серебро', 'linear-gradient(145deg,#fff,#7d7d88)'], ['ice', 'Лёд', 'linear-gradient(145deg,#d9f3ff,#2a7fb0)'], ['ember', 'Медь', 'linear-gradient(145deg,#ffd9bd,#c2501c)'], ['toxic', 'Токсик', 'linear-gradient(145deg,#e4ff9a,#5f8f14)'], ['violet', 'Гуль', 'linear-gradient(145deg,#e4d8ff,#6d3fe0)']];
  render(`<h1>Профиль</h1>
    ${u ? accountPanel(u) : authPanel()}
    <h3>Твой отпечаток</h3>
    <div class="stats"><div class="stat"><b>${mins}</b><small>минут</small></div><div class="stat"><b>${days}</b><small>дней</small></div><div class="stat"><b>${S.favs.length}</b><small>лайков</small></div></div>
    ${top.length ? `<div class="panel"><h4>Чаще всего слушаешь</h4><p style="margin:8px 0 0">${top.map(([a, n]) => `${esc(a)} <span style="color:var(--muted)">×${n}</span>`).join('<br>')}</p></div>` : '<p class="sub" style="margin-top:10px">Включи музыку — здесь появится твоя настоящая статистика. История хранится только на этом устройстве.</p>'}
    <h3>Оформление</h3>
    <div class="panel"><div class="themes">${themes.map(([k, n, c]) => `<button class="sw${S.settings.theme === k ? ' on' : ''}" data-theme="${k}" style="background:${c}" aria-label="${n}" title="${n}"></button>`).join('')}</div>
    <div class="toggle" style="margin-top:12px"><span><b>Спокойный режим</b><br><small style="color:var(--muted)">Без анимаций фона и диска</small></span><button class="sw-btn${S.settings.calm ? ' on' : ''}" data-calm role="switch" aria-checked="${!!S.settings.calm}" aria-label="Спокойный режим"></button></div></div>
    <h3>Данные</h3><div class="panel"><p>Очистить историю и статистику на этом устройстве. Плейлисты и избранное сохранятся.</p><button class="btn ghost" data-clearhist>${icon('trash')} Очистить историю</button></div>`);
  bindAuth();
}
function accountPanel(u) {
  return `<div class="panel"><h4>${esc(u.email || 'Аккаунт GhOuL')}</h4><p>Избранное и плейлисты синхронизируются через аккаунт. Личные аудиофайлы остаются на этом устройстве.</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn ghost" data-sync>Синхронизировать</button><button class="btn ghost" data-logout>Выйти</button></div></div>`;
}
function authPanel() {
  const su = V.authMode === 'signup', m = V.authMsg;
  return `<div class="panel"><h4>${su ? 'Создать аккаунт' : 'Войти в GhOuL'}</h4>
    <p>${su ? 'Email понадобится для подтверждения аккаунта.' : 'Синхронизируй избранное и плейлисты между устройствами.'}</p>
    ${m ? `<div class="msg ${m.kind}" role="alert"><div>${m.title ? `<b>${esc(m.title)}</b>` : ''}${esc(m.text)}${m.switchTo ? ` <a class="link" href="#" data-authmode="${m.switchTo}">Войти</a>` : ''}</div></div>` : ''}
    <form id="authForm" novalidate>
      <label class="in"><span>Email</span><div class="box"><input id="aEmail" type="email" autocomplete="email" inputmode="email" placeholder="you@mail.com" required></div></label>
      <label class="in"><span>Пароль${su ? ' (минимум 8 символов)' : ''}</span><div class="box"><input id="aPass" type="password" autocomplete="${su ? 'new-password' : 'current-password'}" required minlength="8"><button type="button" class="eye" data-eye aria-label="Показать пароль">${icon('eye')}</button></div></label>
      <button class="btn block" id="aBtn" type="submit">${su ? 'Зарегистрироваться' : 'Войти'}</button>
    </form>
    <p class="center" style="margin:14px 0 0"><a class="link" href="#" data-authmode="${su ? 'login' : 'signup'}">${su ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Зарегистрироваться'}</a></p></div>`;
}
let authBusy = false;
function bindAuth() {
  const f = $('#authForm'); if (!f) return;
  f.onsubmit = async ev => {
    ev.preventDefault(); if (authBusy) return;
    const action = V.authMode, email = $('#aEmail').value.trim(), pass = $('#aPass').value;
    if (cooldownLeft(action)) return;
    const setMsg = (kind, text, extra = {}) => { V.authMsg = { kind, text, ...extra }; const keep = [email, pass]; vProfile(); $('#aEmail').value = keep[0]; $('#aPass').value = keep[1]; };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return setMsg('err', 'Введите действительный email.');
    if (action === 'signup' && pass.length < 8) return setMsg('err', 'Пароль: минимум 8 символов.');
    if (!pass) return setMsg('err', 'Введи пароль.');
    authBusy = true; const b = $('#aBtn'); b.disabled = true; b.textContent = 'Секунду…';
    try {
      if (action === 'signup') {
        const d = await sb('/auth/v1/signup', { body: { email, password: pass } });
        const u = d.user || d;
        if (d.access_token) { setSession(d); V.authMsg = null; toast('Аккаунт создан'); syncState('busy'); syncNow(true); authBusy = false; return route('profile'); }
        if (u && Array.isArray(u.identities) && u.identities.length === 0) { authBusy = false; return setMsg('err', 'Такой email уже зарегистрирован. Попробуй войти.', { switchTo: 'login' }); }
        V.authMode = 'login'; authBusy = false;
        return setMsg('ok', 'Проверь почту и подтверди адрес, затем войди в аккаунт.', { title: 'Письмо отправлено' });
      }
      const d = await sb('/auth/v1/token?grant_type=password', { body: { email, password: pass } });
      setSession(d); V.authMsg = null; toast('Ты в аккаунте'); syncNow(true); authBusy = false; route('profile');
    } catch (e) {
      authBusy = false; const r = authError(action, e);
      if (r.cooldown) store.set(cdKey(action), Date.now() + r.cooldown * 1000);
      if (r.switchTo) { V.authMsg = { kind: 'err', text: r.text, switchTo: r.switchTo }; vProfile(); $('#aEmail').value = email; return; }
      setMsg('err', r.text, r.rate ? { title: 'Подожди немного' } : {});
    }
  };
  tickAuth();
}
function tickAuth() {
  const b = $('#aBtn'); if (!b || authBusy) return;
  const left = cooldownLeft(V.authMode), su = V.authMode === 'signup';
  b.disabled = left > 0; b.textContent = left > 0 ? `Повтори через ${fmt(left)}` : (su ? 'Зарегистрироваться' : 'Войти');
}
setInterval(tickAuth, 1000);

/* ---------- Действия ---------- */
function toggleFav(id) {
  const t = TR.get(id); if (!t) return;
  if (isFav(id)) { S.favs = S.favs.filter(x => x.id !== id); toast('Убрано из избранного'); }
  else { S.favs.unshift(slim(t)); toast('В избранном'); }
  changed('favs');
  $$(`[data-fav="${CSS.escape(id)}"]`).forEach(b => b.classList.toggle('on', isFav(id)));
  if (P.cur && P.cur.id === id) $('#pFav').classList.toggle('on', isFav(id));
  if (V.name === 'library' && V.tab === 'fav') vLibrary();
}
function askName(title, value, cb) {
  openSheet(`<h4>${title}</h4><label class="in"><div class="box"><input id="nm" maxlength="60" value="${esc(value || '')}" placeholder="Название"></div></label><button class="btn block" id="nmOk">Готово</button>`, s => {
    const i = $('#nm', s), go = () => { const v = i.value.trim(); if (v.length < 1) return toast('Введите название плейлиста.'); closeSheet(); cb(v); };
    $('#nmOk', s).onclick = go; i.onkeydown = e => { if (e.key === 'Enter') go(); }; setTimeout(() => i.focus(), 60);
  });
}
function addToPlaylistSheet(t) {
  openSheet(`<h4>В плейлист</h4><button class="act" data-sheet="newpl">${icon('plus')} Новый плейлист</button>${S.playlists.map(p => `<button class="act" data-sheet="addpl" data-pl="${p.id}">${icon('lib')} ${esc(p.name)} <small style="margin-left:auto;color:var(--muted)">${p.tracks.length}</small></button>`).join('')}`, s => {
    s.onclick = e => {
      const b = e.target.closest('[data-sheet]'); if (!b) return;
      if (b.dataset.sheet === 'newpl') askName('Новый плейлист', '', n => { S.playlists.unshift({ id: uid(), name: n, tracks: [slim(t)] }); changed('playlists'); toast('Плейлист создан'); route(); });
      else { const p = S.playlists.find(x => x.id === b.dataset.pl); if (p.tracks.some(x => x.id === t.id)) toast('Уже в этом плейлисте'); else { p.tracks.push(slim(t)); changed('playlists'); toast('Добавлено в «' + p.name + '»'); } closeSheet(); route(); }
    };
  });
}
function trackSheet(id, ctx) {
  const t = TR.get(id); if (!t) return;
  const inPl = ctx && ctx.startsWith('pl:'), local = id.startsWith('local:');
  openSheet(`<div class="sheet-head"><img src="${esc(art(t))}" alt=""><div><b>${esc(t.title)}</b><br><small>${esc(t.artist)}</small></div></div>
    <button class="act" data-a="fav">${icon('heart')} ${isFav(id) ? 'Убрать из избранного' : 'В избранное'}</button>
    <button class="act" data-a="pl">${icon('plus')} В плейлист</button>
    <button class="act" data-a="next">${icon('next')} Играть следующим</button>
    ${inPl ? `<button class="act danger" data-a="rmpl">${icon('trash')} Убрать из плейлиста</button>` : ''}
    ${local ? `<button class="act danger" data-a="rmfile">${icon('trash')} Удалить файл с устройства</button>` : ''}`, s => {
    s.onclick = async e => {
      const a = e.target.closest('[data-a]'); if (!a) return; closeSheet();
      if (a.dataset.a === 'fav') toggleFav(id);
      if (a.dataset.a === 'pl') addToPlaylistSheet(t);
      if (a.dataset.a === 'next') { if (!P.queue.length) playQueue([t], 0); else { P.queue.splice(P.i + 1, 0, t); toast('Сыграет следующим'); } }
      if (a.dataset.a === 'rmpl') { const p = S.playlists.find(x => x.id === ctx.slice(3)); p.tracks = p.tracks.filter(x => x.id !== id); changed('playlists'); route(); }
      if (a.dataset.a === 'rmfile') { await idb.del(id); localTracks = localTracks.filter(x => x.id !== id); S.favs = S.favs.filter(x => x.id !== id); S.playlists.forEach(p => p.tracks = p.tracks.filter(x => x.id !== id)); changed('favs', 'playlists'); toast('Файл удалён'); route(); }
    };
  });
}
function queueSheet() {
  if (!P.queue.length) return toast('Очередь пуста');
  openSheet(`<h4>Очередь <small style="color:var(--muted);font-weight:400">${P.queue.length}</small></h4><div class="list">${P.queue.map((t, i) => `<div class="row${i === P.i ? ' now' : ''}"><button class="main" data-q="${i}"><img src="${esc(art(t))}" alt=""><span class="t"><b>${esc(t.title)}</b><small>${esc(t.artist)}</small></span></button></div>`).join('')}</div>`, s => {
    s.onclick = e => { const b = e.target.closest('[data-q]'); if (b) { closeSheet(); playIndex(+b.dataset.q); } };
    const n = $('.now', s); if (n) n.scrollIntoView({ block: 'center' });
  });
}

/* Импорт локальных файлов */
async function importFiles(files) {
  let ok = 0;
  for (const f of files) {
    if (!f.type.startsWith('audio/') && !/\.(mp3|m4a|aac|flac|ogg|opus|wav)$/i.test(f.name)) continue;
    const base = f.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim(); const m = base.split(/\s[-–—]\s/);
    const meta = { id: 'local:' + uid(), title: m.length > 1 ? m.slice(1).join(' - ') : base, artist: m.length > 1 ? m[0] : 'Неизвестный исполнитель', album: '', art: '', src: '', source: 'Файл на устройстве', dur: await duration(f), added: Date.now() };
    try { await idb.put({ ...meta, blob: f }); localTracks.unshift(reg(meta)); ok++; } catch { toast('Не хватило места для файла'); break; }
  }
  toast(ok ? `Добавлено файлов: ${ok}` : 'Подходящих аудиофайлов нет'); if (V.name === 'library') vLibrary();
}
const duration = f => new Promise(res => { const a = new Audio(), u = URL.createObjectURL(f); const done = d => { URL.revokeObjectURL(u); res(d || 0); }; a.preload = 'metadata'; a.onloadedmetadata = () => done(a.duration); a.onerror = () => done(0); setTimeout(() => done(0), 4000); a.src = u; });

/* ---------- События ---------- */
document.addEventListener('click', e => {
  const t = e.target;
  let el;
  if ((el = t.closest('[data-go]'))) { e.preventDefault(); return route(el.dataset.go); }
  if ((el = t.closest('[data-play]'))) { const s = el.dataset.play, k = s.lastIndexOf(':'); return playList(s.slice(0, k), +s.slice(k + 1)); }
  if ((el = t.closest('[data-fav]'))) return toggleFav(el.dataset.fav);
  if ((el = t.closest('[data-more]'))) return trackSheet(el.dataset.more, el.dataset.ctx);
  if ((el = t.closest('[data-lib]'))) { V.tab = el.dataset.lib; return route('library'); }
  if ((el = t.closest('[data-scroll]'))) { const s = document.getElementById(el.dataset.scroll); if (s) s.scrollIntoView({ behavior: calmNow() ? 'auto' : 'smooth', block: 'start' }); return; }
  if ((el = t.closest('[data-tag]'))) { V.q = el.dataset.tag; return vSearch(); }
  if ((el = t.closest('[data-tab]'))) { V.tab = el.dataset.tab; return vLibrary(); }
  if ((el = t.closest('[data-all]'))) {
    const k = el.dataset.all; const l = k === 'plplay' ? S.playlists.find(p => p.id === V.arg).tracks : k === 'hist' ? (LISTS.history || []) : S.favs;
    if (k === 'shuffle') { P.shuffle = true; paintPlayer(); return playQueue(l, Math.floor(Math.random() * l.length)); } return playQueue(l, 0);
  }
  if (t.closest('[data-newpl]')) return askName('Новый плейлист', '', n => { S.playlists.unshift({ id: uid(), name: n, tracks: [] }); changed('playlists'); vLibrary(); });
  if ((el = t.closest('[data-openpl]'))) return route('playlist', el.dataset.openpl);
  if ((el = t.closest('[data-rename]'))) { const p = S.playlists.find(x => x.id === el.dataset.rename); return askName('Переименовать', p.name, n => { p.name = n; changed('playlists'); vPlaylist(); }); }
  if ((el = t.closest('[data-delpl]'))) { if (confirm('Удалить плейлист? Треки останутся в избранном.')) { S.playlists = S.playlists.filter(p => p.id !== el.dataset.delpl); changed('playlists'); route('library'); } return; }
  if (t.closest('[data-import]')) return $('#filePick').click();
  if ((el = t.closest('.sw[data-theme]'))) { S.settings.theme = el.dataset.theme; save('settings'); applySettings(); return vProfile(); }
  if (t.closest('[data-calm]')) { S.settings.calm = !S.settings.calm; save('settings'); applySettings(); return vProfile(); }
  if (t.closest('[data-clearhist]')) { S.history = []; S.stats = { byDay: {} }; save('history'); save('stats'); toast('История очищена'); return vProfile(); }
  if (t.closest('[data-logout]')) return logout();
  if (t.closest('[data-sync]')) return syncNow(true).then(() => toast(syncStatus === 'ok' ? 'Синхронизировано' : 'Синхронизация недоступна'));
  if ((el = t.closest('[data-authmode]'))) { e.preventDefault(); V.authMode = el.dataset.authmode; V.authMsg = null; return vProfile(); }
  if (t.closest('[data-eye]')) { const i = $('#aPass'); i.type = i.type === 'password' ? 'text' : 'password'; return; }
  if (t.id === 'sheetBack') return closeSheet();
});
$('#filePick').onchange = e => { importFiles([...e.target.files]); e.target.value = ''; };
$('#syncBadge').onclick = () => syncNow(true);

function openPlayer() { $('#player').classList.add('open'); $('#player').setAttribute('aria-hidden', 'false'); startViz(); }
$('#miniOpen').onclick = openPlayer;
$('#pClose').onclick = () => { $('#player').classList.remove('open'); $('#player').setAttribute('aria-hidden', 'true'); };
$('#miniPlay').onclick = toggle; $('#pPlay').onclick = toggle;
$('#miniNext').onclick = () => step(1, false); $('#pNext').onclick = () => step(1, false); $('#pPrev').onclick = () => step(-1, false);
$('#pShuffle').onclick = () => { P.shuffle = !P.shuffle; paintPlayer(); };
$('#pRepeat').onclick = () => { P.repeat = (P.repeat + 1) % 3; paintPlayer(); toast(['Повтор выключен', 'Повтор очереди', 'Повтор трека'][P.repeat]); };
$('#pFav').onclick = () => P.cur && toggleFav(P.cur.id);
$('#pMore').onclick = () => P.cur && trackSheet(P.cur.id, '');
$('#pQueueBtn').onclick = queueSheet;
$('#pLyricsBtn').onclick = () => { P.lyrOn = !P.lyrOn; if (P.lyrOn && P.cur) loadLyrics(P.cur); else renderLyrics(); };
$('#lyrics').onclick = e => { const p = e.target.closest('p[data-i]'); if (p && P.lyr && P.lyr.synced) { audio.currentTime = P.lyr.lines[+p.dataset.i].t; } };
$('#seek').oninput = e => { const d = audio.duration || (P.cur && P.cur.dur) || 0; if (d) audio.currentTime = e.target.value / 1000 * d; e.target.style.setProperty('--p', e.target.value / 10 + '%'); };
document.addEventListener('keydown', e => {
  if (/input|textarea/i.test(e.target.tagName)) return;
  if (e.code === 'Space') { e.preventDefault(); toggle(); }
  if (e.key === 'n') step(1, false); if (e.key === 'p') step(-1, false);
  if (e.key === 'Escape') { closeSheet(); $('#player').classList.remove('open'); }
});

/* ---------- Старт ---------- */
(async () => {
  applySettings(); route('home');
  try { localTracks = (await idb.all()).map(f => { const { blob, ...m } = f; return reg(m); }).sort((a, b) => b.added - a.added); } catch { }
  if (S.session) { syncState('busy'); syncNow(true); }
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => { });
})();
})();
