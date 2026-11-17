// Domare: William's review of reported judges in Shredbound's ranked matches.
// William, 2026-11-17 (Swedish, in the game's chat): judges are rated 1-5 after every
// ranked match, lose judging for a week under 2.0 after 10 rated matches, can be
// reported, and "i should be able to check replays from reported matches and see if
// judge cheated". The reports, the matches, the ratings and the recordings come from
// the "riders" edge function (admin.* actions, admin secret from the Koder tab). A
// recording is the reporter's own view of the match: every rider's body ten times a
// second, every trick called, every judge's call and every ruling. The viewer draws
// the riders as figures with their skis in 3D, on a timeline with the calls on it.
import * as online from './online.js';

const h = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reasonText = { helped_friend: 'Hjälpte en kompis', wrong_calls: 'Fel beslut med flit', other: 'Något annat' };
const statusText = { open: 'Öppen', dismissed: 'Avfärdad', banned: 'Bannad' };
const colours = ['#ff8a33', '#3dd6a3', '#5fb4ff', '#f2c94c', '#c58bff', '#ff6b7a'];
const errorText = { no_recording: 'Ingen inspelning finns för den här rapporten.', not_found: 'Finns inte längre. Uppdatera.' };

const state = {
  status: 'open', loading: false, error: null, data: null, riders: null, selected: null,
  replay: null, replayFor: null, replayError: null, replayLoading: false,
  playing: false, t: 0, speed: 1, follow: null, yaw: 0.7, pitch: 0.32, dist: 8, last: 0, busy: '',
};

export function judgesView() {
  return '<div id="judges-root"></div>';
}

export function mountJudges(main) {
  const root = main.querySelector('#judges-root');
  if (!root) return;
  paint(root);
  if (!state.data && !state.loading && online.adminSecret()) load(root);
}

async function load(root, force = false) {
  if (state.loading && !force) return;
  state.loading = true; state.error = null; paint(root);
  try {
    const secret = online.adminSecret();
    const [reports, riders] = await Promise.all([
      online.call('riders', 'admin.reports', { status: state.status }, secret),
      online.call('riders', 'admin.riders', {}, secret),
    ]);
    state.data = reports; state.riders = riders.riders || [];
    if (state.selected && !(reports.reports || []).some(r => r.id === state.selected)) state.selected = null;
  } catch (e) { state.error = e; }
  state.loading = false; paint(root);
}

const name = (id) => {
  const r = state.data?.riders?.[id];
  return r?.name || id;
};
const judgeLine = (j) => {
  if (!j) return '—';
  if (j.banned) return 'Bannad från att döma';
  if (j.locked_until && new Date(j.locked_until) > new Date()) return 'Låst till ' + when(j.locked_until);
  return j.average == null ? 'Inga betyg än' : `${String(j.average).replace('.', ',')} / 5 (${j.rated} matcher)`;
};
const when = s => s ? new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(s)) : '—';
const modeText = m => m === 'duel' ? 'Ranked 1v1' : 'Ranked SLVSH';

function paint(root) {
  const secret = online.adminSecret();
  if (!secret) {
    root.innerHTML = `<section class="panel"><div class="panel-body"><h2>Domare</h2><p>Lås upp med admin-nyckeln i fliken <a href="#codes">Koder</a>. Här granskar du anmälda domare: se om domaren fuskade, spela upp matchen och banna eller frikänn.</p></div></section>`;
    return;
  }
  const reports = state.data?.reports || [];
  const matches = new Map((state.data?.matches || []).map(m => [m.match_key, m]));
  const head = `<div class="judges-head"><div><h2>Domare</h2><p class="muted">Anmälda domare i ranked-matcher. Under 2,0 i snitt efter 10 betygsatta matcher låser domandet en vecka av sig själv; fusk (som att hjälpa en kompis) bannar du här.</p></div>
    <div class="judges-actions"><label class="field compact"><span>Visa</span><select id="judges-status"><option value="open"${state.status === 'open' ? ' selected' : ''}>Öppna</option><option value="all"${state.status === 'all' ? ' selected' : ''}>Alla</option><option value="banned"${state.status === 'banned' ? ' selected' : ''}>Bannade</option><option value="dismissed"${state.status === 'dismissed' ? ' selected' : ''}>Avfärdade</option></select></label>
    <button class="button secondary small" id="judges-refresh">${state.loading ? 'Hämtar…' : 'Uppdatera'}</button></div></div>`;
  const error = state.error ? `<div class="error">Domare: ${h(state.error.message)}</div>` : '';
  const list = reports.length === 0
    ? `<p class="muted">${state.loading ? 'Hämtar rapporter…' : 'Inga rapporter här.'}</p>`
    : `<div class="report-list">${reports.map(r => {
      const m = matches.get(r.match_key);
      return `<button class="report-item${r.id === state.selected ? ' selected' : ''}" data-report="${r.id}">
        <span class="report-top"><b>${h(name(r.judge_id))}</b> <span class="badge ${r.status === 'open' ? 'open' : r.status === 'banned' ? 'failed' : 'passed'}">${statusText[r.status] || h(r.status)}</span></span>
        <span class="report-sub">${h(reasonText[r.reason] || r.reason)} · av ${h(name(r.reporter_id))} · ${when(r.created_at)}</span>
        <span class="report-sub">${m ? modeText(m.mode) + ' · ' + h(m.lobby_code) : 'Matchen saknas'}${r.recording_path ? ' · inspelning' : ' · ingen inspelning'}</span></button>`;
    }).join('')}</div>`;
  const selected = reports.find(r => r.id === state.selected);
  root.innerHTML = head + error + `<div class="judges-grid"><section class="panel"><div class="panel-body">${list}</div></section>
    <section class="panel">${selected ? detail(selected, matches.get(selected.match_key)) : '<div class="panel-body"><p class="muted">Välj en rapport.</p></div>'}</section></div>` + judgesTable();
  bind(root);
  if (selected && state.replay && state.replayFor === selected.id) startViewer(root);
}

function detail(r, m) {
  const judge = state.data?.riders?.[r.judge_id];
  const ban = (state.data?.bans || []).find(b => b.player_id === r.judge_id);
  const ratings = (state.data?.ratings || []).filter(x => x.match_key === r.match_key && x.judge_id === r.judge_id);
  const verdicts = (m?.verdicts || []);
  const riders = m ? m.riders.map((id, i) => `<span class="rider-chip" style="--c:${colours[i % colours.length]}">${h(name(id))}${id === m.winner_id ? ' · vann' : ''}</span>`).join(' ') : '';
  const judges = m ? m.judges.map(id => `<span class="rider-chip judge">${h(name(id))} · domare</span>`).join(' ') : '';
  const calls = verdicts.length ? `<table class="data-table"><thead><tr><th>Försök</th><th>Åkare</th><th>Vem</th><th>Beslut</th></tr></thead><tbody>${verdicts.map(v => `<tr><td>${v.n >= 0 ? v.n + 1 : '—'}</td><td>${h(name(v.runner))}</td><td>${v.kind === 'ruling' ? 'Slutbeslut' : h(name(v.judge))}</td><td>${v.kind === 'vote' ? v.call + ' / 5' : v.call ? 'Landad' : 'Miss'}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Inga beslut i rapporten från värden.</p>';
  const banned = !!(ban && ban.judge_banned_at);
  const locked = ban && ban.judge_locked_until && new Date(ban.judge_locked_until) > new Date();
  return `<div class="panel-body report-detail">
    <h3>${h(name(r.judge_id))} <span class="muted">— ${h(judgeLine(judge?.judge))}</span></h3>
    <p><b>${h(reasonText[r.reason] || r.reason)}</b>${r.note ? ' · ”' + h(r.note) + '”' : ''} · anmäld av ${h(name(r.reporter_id))} · ${when(r.created_at)}</p>
    <p>${m ? modeText(m.mode) + ' · lobby ' + h(m.lobby_code) + ' · ' + when(m.created_at) + (m.counted ? '' : ' · <b>räknades inte</b> (låst domare)') : 'Matchen saknas.'}</p>
    <p>${riders} ${judges}</p>
    <p>Betyg från åkarna i matchen: ${ratings.length ? ratings.map(x => `${h(name(x.rater_id))}: ${x.stars}/5`).join(' · ') : 'inga'}</p>
    <details class="data-table" open><summary>Domarnas beslut (från värdens rapport)</summary>${calls}</details>
    <div class="replay">${r.recording_path ? (state.replayFor === r.id && state.replay ? viewerHtml() : `<button class="button" id="replay-load">${state.replayLoading ? 'Hämtar inspelningen…' : 'Spela upp matchen'}</button>${state.replayError ? `<div class="error">${h(state.replayError)}</div>` : ''}`) : '<p class="muted">Ingen inspelning laddades upp med rapporten.</p>'}</div>
    <div class="report-buttons">
      ${banned ? `<button class="button secondary" data-judge-act="admin.judge_unban">Häv banet</button>` : `<button class="button danger" data-judge-act="admin.judge_ban">Banna från att döma</button>`}
      ${locked ? `<button class="button secondary" data-judge-act="admin.judge_unlock">Lås upp domandet</button>` : ''}
      ${r.status === 'open' ? `<button class="button secondary" data-report-act="dismissed">Avfärda (inget fusk)</button>` : `<button class="button secondary" data-report-act="open">Öppna igen</button>`}
      <button class="text-button" data-report-delete="1">Radera rapporten</button>
      ${state.busy ? `<span class="eyebrow">${h(state.busy)}</span>` : ''}
    </div></div>`;
}

function judgesTable() {
  const judges = (state.riders || []).filter(r => r.judge && (r.judge.rated > 0 || r.judge.banned || r.judge.locked_until)).sort((a, b) => (a.judge.average ?? 9) - (b.judge.average ?? 9));
  if (!judges.length) return '';
  return `<section class="panel"><div class="panel-body"><h3>Alla domare</h3><table class="data-table"><thead><tr><th>Domare</th><th>Snitt</th><th>Matcher</th><th>Status</th><th>Kod</th></tr></thead><tbody>${judges.map(r => `<tr><td>${h(r.name)}</td><td>${r.judge.average == null ? '—' : String(r.judge.average).replace('.', ',')}</td><td>${r.judge.rated}</td><td>${h(judgeLine(r.judge))}</td><td>${h(r.code_name || '—')}</td></tr>`).join('')}</tbody></table></div></section>`;
}

function bind(root) {
  root.querySelector('#judges-status')?.addEventListener('change', e => { state.status = e.target.value; state.data = null; state.selected = null; load(root, true); });
  root.querySelector('#judges-refresh')?.addEventListener('click', () => load(root, true));
  root.querySelectorAll('[data-report]').forEach(b => b.addEventListener('click', () => {
    state.selected = Number(b.dataset.report); state.playing = false;
    if (state.replayFor !== state.selected) { state.replay = null; state.replayError = null; }
    paint(root);
  }));
  root.querySelector('#replay-load')?.addEventListener('click', () => loadReplay(root, state.selected));
  root.querySelectorAll('[data-judge-act]').forEach(b => b.addEventListener('click', () => judgeAction(root, b.dataset.judgeAct)));
  root.querySelectorAll('[data-report-act]').forEach(b => b.addEventListener('click', () => reportAction(root, 'admin.report_close', { status: b.dataset.reportAct })));
  root.querySelector('[data-report-delete]')?.addEventListener('click', () => {
    if (confirm('Radera rapporten och dess inspelning? Det går inte att ångra.')) reportAction(root, 'admin.report_delete', {});
  });
}

async function judgeAction(root, action) {
  const r = (state.data?.reports || []).find(x => x.id === state.selected);
  if (!r) return;
  const who = name(r.judge_id);
  const ask = action === 'admin.judge_ban' ? `Banna ${who} från att döma? Domaren kan inte döma ranked-matcher förrän du häver banet.` : action === 'admin.judge_unban' ? `Häva banet för ${who}?` : `Låsa upp domandet för ${who} nu?`;
  if (!confirm(ask)) return;
  state.busy = 'Sparar…'; paint(root);
  try {
    await online.call('riders', action, { player_id: r.judge_id, report_id: r.id, note: action === 'admin.judge_ban' ? (reasonText[r.reason] || r.reason) : undefined }, online.adminSecret());
    state.busy = '';
    await load(root, true);
  } catch (e) { state.busy = ''; state.error = e; paint(root); }
}

async function reportAction(root, action, extra) {
  const r = (state.data?.reports || []).find(x => x.id === state.selected);
  if (!r) return;
  state.busy = 'Sparar…'; paint(root);
  try {
    await online.call('riders', action, { report_id: r.id, ...extra }, online.adminSecret());
    state.busy = '';
    if (action === 'admin.report_delete') { state.selected = null; state.replay = null; }
    await load(root, true);
  } catch (e) { state.busy = ''; state.error = e; paint(root); }
}

// ------------------------------------------------------------------ the recording

export async function readRecording(buffer) {
  const bytes = new Uint8Array(buffer);
  let text;
  if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    text = await new Response(stream).text();
  } else {
    text = new TextDecoder().decode(bytes);
  }
  const replay = JSON.parse(text);
  if (replay.format !== 'shredbound-judge-replay') throw Error('Okänt format.');
  return prepare(replay);
}

export function prepare(replay) {
  replay.duration = 0;
  replay.tracks = (replay.riders || []).filter(r => replay.frames?.[r.id]).map((r, i) => {
    const f = replay.frames[r.id];
    const end = f.t.length ? f.t[f.t.length - 1] : 0;
    replay.duration = Math.max(replay.duration, end);
    return { id: r.id, name: r.name, colour: colours[i % colours.length], t: f.t, p: f.p };
  });
  replay.calls = (replay.calls || []).slice().sort((a, b) => a.t - b.t);
  return replay;
}

async function loadReplay(root, reportId) {
  state.replayLoading = true; state.replayError = null; paint(root);
  try {
    const body = await online.call('riders', 'admin.recording', { report_id: reportId }, online.adminSecret());
    const res = await fetch(body.url);
    if (!res.ok) throw Error('Inspelningen kunde inte hämtas (' + res.status + ').');
    state.replay = await readRecording(await res.arrayBuffer());
    state.replayFor = reportId; state.t = 0; state.playing = false;
    state.follow = state.replay.tracks[0]?.id || null;
  } catch (e) {
    state.replayError = errorText[e?.message] || e.message;
  }
  state.replayLoading = false; paint(root);
}

const sec = ms => {
  const s = Math.max(0, ms / 1000);
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

function callLabel(c, replay) {
  const who = id => (replay.riders || []).find(r => r.id === id)?.name || id || '';
  switch (c.kind) {
    case 'call': return `${who(c.runner)} ropar: ${c.trick}`;
    case 'verdict': return `${who(c.judge)} dömer försök ${c.n + 1} (${who(c.runner)}): ${c.value ? 'LANDAD' : 'MISS'}`;
    case 'judged': return `Beslut försök ${c.n + 1}, ${who(c.runner)}: ${c.value ? 'LANDAD' : 'MISS'}${c.trick ? ' · ' + c.trick : ''}`;
    case 'vote': return `${who(c.judge)} ger ${who(c.runner)} ${c.value} stjärnor`;
    case 'stars': return `${who(c.runner)} har ${c.value} stjärnor (${c.n} röster)`;
    case 'winner': return `${who(c.runner)} vinner`;
    default: return c.kind;
  }
}

function viewerHtml() {
  const r = state.replay;
  const marks = r.calls.filter(c => c.kind !== 'stars').map(c => `<span class="mark ${h(c.kind)}" style="left:${(c.t / Math.max(1, r.duration)) * 100}%" title="${h(callLabel(c, r))}"></span>`).join('');
  return `<div class="viewer">
    <canvas id="replay-canvas" width="960" height="540"></canvas>
    <div class="viewer-controls">
      <button class="button small" id="replay-play">${state.playing ? 'Paus' : 'Spela'}</button>
      <label class="field compact"><span>Fart</span><select id="replay-speed">${[0.25, 0.5, 1, 2].map(s => `<option value="${s}"${s === state.speed ? ' selected' : ''}>${String(s).replace('.', ',')}×</option>`).join('')}</select></label>
      <label class="field compact"><span>Följ</span><select id="replay-follow">${r.tracks.map(t => `<option value="${h(t.id)}"${t.id === state.follow ? ' selected' : ''}>${h(t.name)}</option>`).join('')}</select></label>
      <span class="eyebrow" id="replay-time">${sec(state.t)} / ${sec(r.duration)}</span>
    </div>
    <div class="timeline"><input id="replay-scrub" type="range" min="0" max="${r.duration}" step="10" value="${Math.round(state.t)}">${marks}</div>
    <p class="muted">Dra i bilden för att vrida, scrolla för att zooma. Klicka på en rad för att hoppa dit (3 s före).</p>
    <ol class="call-list">${r.calls.map(c => `<li data-seek="${c.t}" class="${h(c.kind)}"><span>${sec(c.t)}</span> ${h(callLabel(c, r))}</li>`).join('')}</ol>
  </div>`;
}

// ------------------------------------------------------------------ the viewer

function pose(track, t) {
  const times = track.t;
  if (!times.length) return null;
  let lo = 0, hi = times.length - 1;
  if (t <= times[0]) return track.p[0];
  if (t >= times[hi]) return track.p[hi];
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (times[mid] <= t) lo = mid; else hi = mid; }
  const a = track.p[lo], b = track.p[hi], k = (t - times[lo]) / Math.max(1, times[hi] - times[lo]);
  return a.map((v, i) => v + (b[i] - v) * k);
}

function startViewer(root) {
  const canvas = root.querySelector('#replay-canvas');
  if (!canvas) return;
  const r = state.replay;
  root.querySelector('#replay-play').addEventListener('click', () => { state.playing = !state.playing; if (state.t >= r.duration) state.t = 0; root.querySelector('#replay-play').textContent = state.playing ? 'Paus' : 'Spela'; });
  root.querySelector('#replay-speed').addEventListener('change', e => { state.speed = Number(e.target.value); });
  root.querySelector('#replay-follow').addEventListener('change', e => { state.follow = e.target.value; });
  const scrub = root.querySelector('#replay-scrub');
  scrub.addEventListener('input', () => { state.t = Number(scrub.value); });
  root.querySelectorAll('[data-seek]').forEach(li => li.addEventListener('click', () => { state.t = Math.max(0, Number(li.dataset.seek) - 3000); }));
  let drag = null;
  canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, yaw: state.yaw, pitch: state.pitch }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => { if (!drag) return; state.yaw = drag.yaw - (e.clientX - drag.x) * 0.008; state.pitch = Math.max(-0.2, Math.min(1.45, drag.pitch + (e.clientY - drag.y) * 0.006)); });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('wheel', e => { e.preventDefault(); state.dist = Math.max(2.5, Math.min(60, state.dist * (e.deltaY > 0 ? 1.1 : 0.9))); }, { passive: false });
  state.last = performance.now();
  const frame = now => {
    if (!canvas.isConnected) return;
    const dt = Math.min(100, now - state.last); state.last = now;
    if (state.playing) { state.t = Math.min(r.duration, state.t + dt * state.speed); if (state.t >= r.duration) { state.playing = false; const b = root.querySelector('#replay-play'); if (b) b.textContent = 'Spela'; } }
    if (document.activeElement !== scrub) scrub.value = Math.round(state.t);
    const label = root.querySelector('#replay-time'); if (label) label.textContent = `${sec(state.t)} / ${sec(r.duration)}`;
    draw(canvas, r, state.t);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

export function draw(canvas, r, t) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const sky = ctx.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#0d1520'); sky.addColorStop(1, '#1b2a3a');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
  const poses = r.tracks.map(track => ({ track, p: pose(track, t) })).filter(x => x.p);
  const followed = poses.find(x => x.track.id === state.follow) || poses[0];
  if (!followed) return;
  const P = (p, i) => [p[i * 3] / 100, p[i * 3 + 1] / 100, p[i * 3 + 2] / 100];
  // The snow under each rider, when the recording has it ("Ground": the first thing
  // under the pelvis); else the skis' own height.
  const g = (r.points || []).indexOf('Ground');
  const groundOf = p => g >= 0 && p.length >= (g + 1) * 3 ? P(p, g) : [P(p, 0)[0], Math.min(P(p, 13)[1], P(p, 16)[1]) - 0.06, P(p, 0)[2]];
  const target = P(followed.p, 0);
  const floor = groundOf(followed.p)[1];
  const cy = Math.cos(state.yaw), sy = Math.sin(state.yaw), cp = Math.cos(state.pitch), sp = Math.sin(state.pitch);
  const eye = [target[0] + state.dist * cp * sy, target[1] + state.dist * sp, target[2] + state.dist * cp * cy];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = a => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const fwd = norm(sub(target, eye)), right = norm(cross(fwd, [0, 1, 0])), up = cross(right, fwd);
  const focal = (H / 2) / Math.tan((55 * Math.PI / 180) / 2);
  const project = q => { const d = sub(q, eye), z = dot(d, fwd); if (z < 0.1) return null; return [W / 2 + dot(d, right) / z * focal, H / 2 - dot(d, up) / z * focal, z]; };
  // The snow: a grid of 2 m squares round the followed rider, at its skis' height.
  ctx.strokeStyle = 'rgba(200,220,240,0.12)'; ctx.lineWidth = 1;
  const gx = Math.round(target[0] / 2) * 2, gz = Math.round(target[2] / 2) * 2;
  for (let i = -15; i <= 15; i++) {
    for (const [a, b] of [[[gx + i * 2, floor, gz - 30], [gx + i * 2, floor, gz + 30]], [[gx - 30, floor, gz + i * 2], [gx + 30, floor, gz + i * 2]]]) {
      const pa = project(a), pb = project(b);
      if (pa && pb) { ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke(); }
    }
  }
  for (const { track, p } of poses) {
    // A shadow on the snow under the rider, and in the air a line down to it.
    const ground = groundOf(p), pelvis = P(p, 0);
    const ring = Array.from({ length: 16 }, (_, k) => project([pelvis[0] + Math.cos(k / 8 * Math.PI) * 0.55, ground[1] + 0.01, pelvis[2] + Math.sin(k / 8 * Math.PI) * 0.55]));
    if (ring.every(Boolean)) { ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ring.forEach((q, k) => k ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.closePath(); ctx.fill(); }
    const height = pelvis[1] - ground[1];
    if (height > 1.4) {
      const a = project(pelvis), b = project([pelvis[0], ground[1], pelvis[2]]);
      if (a && b) { ctx.setLineDash([4, 5]); ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.setLineDash([]);
        ctx.font = '12px system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.textAlign = 'left'; ctx.fillText((height - 1).toFixed(1).replace('.', ',') + ' m', b[0] + 6, (a[1] + b[1]) / 2); }
    }
    const pts = (r.points || []).map((_, i) => project(P(p, i)));
    ctx.lineCap = 'round';
    (r.lines || []).forEach(([a, b], li) => {
      const pa = pts[a], pb = pts[b];
      if (!pa || !pb) return;
      const ski = li >= (r.lines.length - 2);
      ctx.strokeStyle = ski ? '#e8eef5' : track.colour;
      ctx.lineWidth = Math.max(1.5, (ski ? 0.07 : 0.11) * focal / ((pa[2] + pb[2]) / 2));
      ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke();
    });
    const head = pts[4];
    if (head) {
      ctx.fillStyle = track.colour; ctx.beginPath(); ctx.arc(head[0], head[1], Math.max(3, 0.13 * focal / head[2]), 0, Math.PI * 2); ctx.fill();
      ctx.font = 'bold 15px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
      ctx.fillText(track.name, head[0], head[1] - Math.max(12, 0.35 * focal / head[2]));
    }
  }
  // The last call, held a few seconds on the picture.
  const recent = (r.calls || []).filter(c => c.kind !== 'stars' && c.t <= t && t - c.t < 4000).slice(-2);
  ctx.textAlign = 'left'; ctx.font = 'bold 18px system-ui, sans-serif';
  recent.forEach((c, i) => {
    ctx.fillStyle = c.kind === 'verdict' || c.kind === 'judged' ? (c.value ? '#3dd68c' : '#ff5b5b') : '#f2c94c';
    ctx.fillText(callLabel(c, r), 18, 30 + i * 26);
  });
}
