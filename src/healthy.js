// Healthy page: a vertical, TikTok-style feed of talks and essays, taken from the
// Studywarts app's Healthy page (~/Dev/studywarts, src/pages/HealthyPage.tsx and
// src/lib/healthyFeed.ts). William, 2026-11-23: "lägg till en ny sektion i
// dashboarden som heter healthy page och ta bara alla videos och konceptet från
// studywarts sidan ... samma me spara videos".
//
// Same concept as there:
// - One player at a time. Only the card in view gets a YouTube iframe; the rest
//   show the video's own thumbnail, so scrolling stays smooth.
// - A video counts as watched after it has been the card in view for 4 seconds.
//   Watched videos leave the feed but stay in History, where "Visa igen" brings
//   one back.
// - Saved (heart), collections (bookmark), a note per video, and the feed opens
//   on the video you stopped at.
// - Nothing is rehosted: every video plays from youtube-nocookie.com.
// Local-first like in Studywarts: everything is kept in this browser's
// localStorage (keys "shredbound.healthy.*") and works without a network write.
// Videos added with a YouTube link are kept there too.

export const HEALTHY_FEED = [
  { id: 'Fi1wkUczuyk', title: 'FINANCIAL STATEMENTS: all the basics in 8 MINS!', author: 'Accounting Stuff' },
  { id: 'GCu97AQMtJI', title: 'Perfect Pitch Training | Imprint Notes In Your Brain | Absolute Pitch', author: 'Jacobs Vocal Academy' },
  { id: 'ZWS_7BqKb7A', title: 'How to Argue Like a Lawyer (and WIN) with 4-Step Formula', author: 'Matthew Harris Law, PLLC' },
  { id: 'xuCn8ux2gbs', title: 'history of the entire world, i guess', author: 'bill wurtz' },
  { id: 'X47Whg8H1rk', title: 'how to easily enter flow state in 2 minutes.', author: 'riskambition' },
  { id: 'o7TcCr3uRkg', title: 'Are You Willing to Pay the Price of Greatness?', author: 'bridges' },
  { id: 'eHJnEHyyN1Y', title: '6 Tips on Being a Successful Entrepreneur | John Mullins | TED', author: 'TED' },
  { id: 'vuiJp0iR0-w', title: 'I Know I Will Succeed.', author: 'Willspire' },
  { id: '8-vXMo9o7pI', title: 'Why Every Great Character Must Break First', author: 'Final Somow' },
  { id: 'BLl3xREFEsY', title: 'The fear of being average', author: 'Verse Creates' },
  { id: 'V_Z8XoPVDBg', title: 'The Power of Delusional Self Belief', author: 'Modern Ideas' },
  { id: 'FmVbFhsmzcw', title: 'The Pursuit of Perfection', author: 'imdanjo' },
  { id: '7Pq-S557XQU', title: 'What Happened to Horses Is Happening to Us', author: 'CGP Grey' },
  { id: 'IJhgZBn-LHg', title: 'How Earth Moves', author: 'Vsauce' },
  { id: 'Du2lkZ_cux8', title: 'The Secret Behind Weirdly Addictive Apps', author: 'Tim Gabe' },
  { id: 'heh5XLwZVOY', title: '9 Stoic Rules For A Better Life (From Marcus Aurelius)', author: 'Daily Stoic' },
  { id: 'OmyfB513E1s', title: 'A notebook to save you from infinite scrolling.', author: 'Reysu' },
];

export const SEEN_AFTER_MS = 4000;
const KEY = name => 'shredbound.healthy.' + name;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const embedUrl = (id, autoplay) => `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?${new URLSearchParams({ rel: '0', modestbranding: '1', playsinline: '1', autoplay: autoplay ? '1' : '0' })}`;
export const watchUrl = id => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
export const thumbUrl = id => `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`;

/** A YouTube video id from a link (watch, youtu.be, shorts, embed) or a bare id. */
export function youtubeId(input) {
  const s = String(input ?? '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^www\.|^m\./, '');
    if (host === 'youtu.be') return /^[A-Za-z0-9_-]{11}$/.test(u.pathname.slice(1, 12)) ? u.pathname.slice(1, 12) : null;
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      const v = u.searchParams.get('v');
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
      const m = u.pathname.match(/^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})/);
      return m ? m[1] : null;
    }
  } catch {}
  return null;
}

// ------------------------------------------------------------------ storage

function read(name, fallback) {
  try { const raw = localStorage.getItem(KEY(name)); const v = raw ? JSON.parse(raw) : fallback; return v && typeof v === 'object' ? v : fallback; } catch { return fallback; }
}
function write(name, value) { try { localStorage.setItem(KEY(name), JSON.stringify(value)); } catch {} }

export function loadState() {
  return {
    seen: read('seen', {}),            // id -> watched at (ms)
    favourites: read('favourites', []), // ids
    collections: read('collections', {}), // name -> ids
    notes: read('notes', {}),          // id -> text
    custom: read('custom', []),        // added videos {id, title, author}
    position: (() => { try { return localStorage.getItem(KEY('position')); } catch { return null; } })(),
    tab: (() => { try { return localStorage.getItem(KEY('tab')) || 'feed'; } catch { return 'feed'; } })(),
  };
}
const save = st => { write('seen', st.seen); write('favourites', st.favourites); write('collections', st.collections); write('notes', st.notes); write('custom', st.custom); try { st.position ? localStorage.setItem(KEY('position'), st.position) : localStorage.removeItem(KEY('position')); localStorage.setItem(KEY('tab'), st.tab); } catch {} };

export const allVideos = st => [...st.custom, ...HEALTHY_FEED.filter(v => !st.custom.some(c => c.id === v.id))];
/** The feed: everything not watched yet, starting at the video you stopped on. */
export function feedOf(st) {
  const list = allVideos(st).filter(v => !st.seen[v.id]);
  const at = list.findIndex(v => v.id === st.position);
  return at > 0 ? [...list.slice(at), ...list.slice(0, at)] : list;
}

// ------------------------------------------------------------------ view

const TABS = [['feed', 'Flöde'], ['favourites', 'Sparade'], ['collections', 'Samlingar'], ['history', 'Historik']];
const when = ms => new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));

function card(v, st) {
  const fav = st.favourites.includes(v.id), note = st.notes[v.id];
  const inCollections = Object.entries(st.collections).filter(([, ids]) => ids.includes(v.id)).map(([n]) => n);
  return `<article class="hl-card" data-id="${esc(v.id)}">
<div class="hl-player"><img src="${thumbUrl(v.id)}" alt="" loading="lazy"><button class="hl-play" data-hl-play="${esc(v.id)}" aria-label="Spela ${esc(v.title)}">▶</button></div>
<div class="hl-side">
<button class="hl-action${fav ? ' on' : ''}" data-hl-fav="${esc(v.id)}" aria-pressed="${fav}" aria-label="${fav ? 'Ta bort från sparade' : 'Spara'}">${fav ? '♥' : '♡'}</button>
<button class="hl-action${inCollections.length ? ' on' : ''}" data-hl-collect="${esc(v.id)}" aria-label="Lägg i samling">🔖</button>
<button class="hl-action${note ? ' on' : ''}" data-hl-note="${esc(v.id)}" aria-label="Anteckning">✎</button>
<a class="hl-action" href="${watchUrl(v.id)}" target="_blank" rel="noopener" aria-label="Öppna på YouTube">↗</a>
</div>
<div class="hl-meta"><b>${esc(v.title)}</b><span>${esc(v.author || 'YouTube')}</span>${inCollections.length ? `<span class="hl-tags">${inCollections.map(n => `<em>${esc(n)}</em>`).join('')}</span>` : ''}${note ? `<p class="hl-note">${esc(note)}</p>` : ''}</div>
</article>`;
}

function row(v, st, extra = '') {
  return `<div class="hl-row"><img src="${thumbUrl(v.id)}" alt="" loading="lazy"><div><b>${esc(v.title)}</b><span>${esc(v.author || 'YouTube')}${extra}</span>${st.notes[v.id] ? `<p class="hl-note">${esc(st.notes[v.id])}</p>` : ''}</div><div class="hl-row-actions"><button class="text-button" data-hl-open="${esc(v.id)}">Spela</button>${st.seen[v.id] ? `<button class="text-button" data-hl-unsee="${esc(v.id)}">Visa igen</button>` : ''}</div></div>`;
}

export function healthyView(st = loadState()) {
  const byId = new Map(allVideos(st).map(v => [v.id, v]));
  const chips = `<div class="chips hl-tabs">${TABS.map(([id, label]) => `<button class="chip" data-hl-tab="${id}" aria-pressed="${st.tab === id}">${label}${id === 'favourites' && st.favourites.length ? ` ${st.favourites.length}` : ''}</button>`).join('')}</div>`;
  let body;
  if (st.tab === 'favourites') {
    const list = st.favourites.map(id => byId.get(id)).filter(Boolean);
    body = list.length ? list.map(v => row(v, st)).join('') : '<p class="empty-line">Inget sparat ännu. Tryck ♡ på en video i flödet.</p>';
  } else if (st.tab === 'collections') {
    const names = Object.keys(st.collections).sort((a, b) => a.localeCompare(b, 'sv'));
    body = names.length ? names.map(n => `<details class="hl-collection" open><summary>${esc(n)} <span class="muted">${st.collections[n].length}</span></summary>${st.collections[n].map(id => byId.get(id)).filter(Boolean).map(v => row(v, st, ` · <button class="text-button" data-hl-uncollect="${esc(v.id)}" data-name="${esc(n)}">Ta bort ur samlingen</button>`)).join('')}</details>`).join('') : '<p class="empty-line">Inga samlingar ännu. Tryck 🔖 på en video för att lägga den i en.</p>';
  } else if (st.tab === 'history') {
    const list = Object.entries(st.seen).sort((a, b) => b[1] - a[1]).map(([id, at]) => [byId.get(id), at]).filter(([v]) => v);
    body = list.length ? list.map(([v, at]) => row(v, st, ` · sedd ${when(at)}`)).join('') : '<p class="empty-line">Inget sett ännu.</p>';
  } else {
    const feed = feedOf(st);
    body = feed.length
      ? `<div class="hl-feed" id="hl-feed">${feed.map(v => card(v, st)).join('')}</div>`
      : `<div class="empty"><div class="empty-mark" aria-hidden="true">✓</div><strong>Du har sett allt</strong><p>Nya videor dyker upp här. Allt du sett finns under Historik.</p><button class="button secondary" data-hl-reset>Börja om flödet</button></div>`;
  }
  const add = `<details class="hl-add"><summary>Lägg till video</summary><form id="hl-add-form" class="inline-form"><label class="field" for="hl-url"><span>YouTube-länk</span><input id="hl-url" name="url" required placeholder="https://youtu.be/…"></label><label class="field" for="hl-title"><span>Titel (valfri)</span><input id="hl-title" name="title" maxlength="120"></label><button class="button" type="submit">Lägg till</button></form><p class="error" id="hl-add-error" role="alert"></p></details>`;
  return `<div class="page-heading"><h1>Healthy page</h1></div>${chips}${body}${add}`;
}

// ------------------------------------------------------------------ behaviour

let observer = null, seenTimer = null, active = null;

/** Wires the rendered page: one player at a time, watched after 4 s, buttons, the add form. */
export function mountHealthy(root, rerender) {
  observer?.disconnect(); clearTimeout(seenTimer); active = null;
  const feed = root.querySelector('#hl-feed');
  const play = (cardEl, autoplay) => {
    if (!cardEl || cardEl === active) return;
    if (active) { const old = active.querySelector('iframe'); if (old) { old.remove(); active.querySelector('.hl-player img').hidden = false; active.querySelector('.hl-play').hidden = false; } }
    active = cardEl;
    const id = cardEl.dataset.id, box = cardEl.querySelector('.hl-player');
    box.querySelector('img').hidden = true; box.querySelector('.hl-play').hidden = true;
    const frame = document.createElement('iframe');
    frame.src = embedUrl(id, autoplay);
    frame.title = cardEl.querySelector('.hl-meta b')?.textContent || 'YouTube';
    frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    frame.allowFullscreen = true;
    box.appendChild(frame);
    // Only the position: the rest of the state may have changed since the page rendered.
    try { localStorage.setItem(KEY('position'), id); } catch {}
    clearTimeout(seenTimer);
    seenTimer = setTimeout(() => { const now = loadState(); if (!now.seen[id]) { now.seen[id] = Date.now(); save(now); } }, SEEN_AFTER_MS);
  };
  if (feed && 'IntersectionObserver' in window) {
    observer = new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting && e.intersectionRatio >= 0.6) play(e.target, false);
    }, { root: feed, threshold: [0.6] });
    feed.querySelectorAll('.hl-card').forEach(c => observer.observe(c));
  }
  root.onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    const now = loadState(), ds = b.dataset;
    if (ds.hlTab) { now.tab = ds.hlTab; save(now); return rerender(); }
    if (ds.hlPlay) { play(b.closest('.hl-card'), true); return; }
    if (ds.hlOpen) { now.tab = 'feed'; delete now.seen[ds.hlOpen]; now.position = ds.hlOpen; save(now); return rerender(); }
    if (ds.hlUnsee) { delete now.seen[ds.hlUnsee]; save(now); return rerender(); }
    if (b.hasAttribute('data-hl-reset')) { now.seen = {}; now.position = null; save(now); return rerender(); }
    if (ds.hlFav) {
      const on = now.favourites.includes(ds.hlFav);
      now.favourites = on ? now.favourites.filter(x => x !== ds.hlFav) : [...now.favourites, ds.hlFav];
      save(now); b.classList.toggle('on', !on); b.textContent = on ? '♡' : '♥'; b.setAttribute('aria-pressed', String(!on));
      if (now.tab !== 'feed') rerender();
      return;
    }
    if (ds.hlCollect) {
      const names = Object.keys(now.collections);
      const name = (prompt(`Vilken samling?${names.length ? ' Du har: ' + names.join(', ') : ''}`, names[0] || '') || '').trim().slice(0, 40);
      if (!name) return;
      const list = now.collections[name] || [];
      if (!list.includes(ds.hlCollect)) now.collections[name] = [...list, ds.hlCollect];
      save(now); b.classList.add('on');
      return;
    }
    if (ds.hlUncollect) {
      const list = (now.collections[ds.name] || []).filter(x => x !== ds.hlUncollect);
      if (list.length) now.collections[ds.name] = list; else delete now.collections[ds.name];
      save(now); return rerender();
    }
    if (ds.hlNote) {
      const text = prompt('Anteckning till videon (tomt tar bort den):', now.notes[ds.hlNote] || '');
      if (text === null) return;
      if (text.trim()) now.notes[ds.hlNote] = text.trim().slice(0, 1000); else delete now.notes[ds.hlNote];
      save(now);
      const cardEl = b.closest('.hl-card');
      if (cardEl) { b.classList.toggle('on', !!text.trim()); let p = cardEl.querySelector('.hl-note'); if (text.trim()) { if (!p) { p = document.createElement('p'); p.className = 'hl-note'; cardEl.querySelector('.hl-meta').appendChild(p); } p.textContent = text.trim(); } else p?.remove(); }
      else rerender();
    }
  };
  const form = root.querySelector('#hl-add-form');
  if (form) form.onsubmit = e => {
    e.preventDefault();
    const id = youtubeId(form.elements.url.value), err = root.querySelector('#hl-add-error');
    if (!id) { err.textContent = 'Det ser inte ut som en YouTube-länk.'; return; }
    const now = loadState();
    if (!allVideos(now).some(v => v.id === id)) now.custom = [{ id, title: form.elements.title.value.trim().slice(0, 120) || 'YouTube-video', author: '' }, ...now.custom];
    delete now.seen[id]; now.position = id; now.tab = 'feed'; save(now);
    rerender();
  };
}

/** Stops the player when leaving the tab. */
export function unmountHealthy() { observer?.disconnect(); observer = null; clearTimeout(seenTimer); active = null; }
