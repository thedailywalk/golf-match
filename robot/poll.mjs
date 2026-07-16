// Major Match Tracker — alerts robot
// Runs on a schedule (GitHub Actions). Polls ESPN's public golf feed, compares
// against last-seen scores, and pushes a phone notification via ntfy.sh when
// your team's score moves. Weekend-aware: once config.weekend.locked is true it
// scores exactly like the app (all-6 through the cut + your 4 starters + penalties)
// and only alerts on starter moves. No server, no keys — just a scheduled fetch.

import { readFile, writeFile } from 'node:fs/promises';

const API = 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard';
const HERE = new URL('.', import.meta.url);
const cfg = JSON.parse(await readFile(new URL('config.json', HERE), 'utf8'));
const STATE = new URL('state.json', HERE);
const wk = cfg.weekend || {};
const weekend = !!wk.locked;

const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, '').trim();
const num = (v) => (v === 'E' ? 0 : (Number.isNaN(Number(v)) ? null : Number(v)));
const pretty = (n) => (n == null ? '—' : n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}`);

async function loadState() { try { return JSON.parse(await readFile(STATE, 'utf8')); } catch { return {}; } }
async function saveState(s) { await writeFile(STATE, JSON.stringify(s, null, 2)); }

function pickEvent(d, wanted) {
  const evs = d.events || [];
  if (!evs.length) return null;
  const inplay = evs.find((e) => e.status?.type?.state === 'in');
  if (inplay) return inplay;
  const withPlayers = evs.find((e) =>
    (e.competitions?.[0]?.competitors || []).some((c) => wanted.has(norm(c.athlete?.displayName))));
  return withPlayers || evs[0];
}

function readCompetitors(ev) {
  const map = {};
  for (const c of (ev.competitions?.[0]?.competitors || [])) {
    const nm = norm(c.athlete?.displayName);
    if (!nm) continue;
    const cs = c.status || {};
    let thru = '';
    if (typeof cs.thru === 'number') thru = (cs.thru >= 18) ? 'F' : `Thru ${cs.thru}`;
    else if (cs.thru != null && cs.thru !== '') thru = String(cs.thru);
    else if (cs.type?.shortDetail) thru = cs.type.shortDetail;
    map[nm] = { toPar: num(c.score), thru, name: c.athlete?.displayName };
  }
  return map;
}

// Rounds 1–2 / not locked: best-N cumulative. Weekend (locked): mirrors the app.
function bestNTotal(players, live, countBest) {
  const scored = players.map((p) => live[norm(p)]?.toPar).filter((v) => v != null).sort((a, b) => a - b);
  const n = Math.min(countBest || players.length, scored.length);
  return scored.slice(0, n).reduce((a, b) => a + b, 0);
}
function weekendTotal(players, seventh, starters, snap, live) {
  let base = 0;
  for (const p of players) { const k = norm(p); const s = (k in snap) ? snap[k] : live[k]?.toPar; if (s != null) base += s; }
  const valid = (starters || []).slice(0, 4);   // app already filtered to cut-making picks
  let delta = 0;
  for (const p of valid) { const k = norm(p); const cur = live[k]?.toPar; const sn = (k in snap) ? snap[k] : cur; if (cur != null) delta += (cur - sn); }
  return base + delta + 10 * Math.max(0, 4 - valid.length);
}
function totalFor(which, live) {
  if (weekend) {
    const snap = wk.cutSnapshot || {};
    return which === 'mine'
      ? weekendTotal(cfg.players, wk.seventh, wk.starters, snap, live)
      : weekendTotal(cfg.opponentPlayers, wk.opponentSeventh, wk.opponentStarters, snap, live);
  }
  return which === 'mine'
    ? bestNTotal(cfg.players, live, cfg.countBest)
    : bestNTotal(cfg.opponentPlayers, live, cfg.countBest);
}

async function push(topic, title, body, tags, priority) {
  if (!topic) return;
  const url = `${cfg.ntfyServer.replace(/\/$/, '')}/${topic}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Title': title, 'Tags': tags || 'golf', 'Priority': String(priority || 'default'), 'Content-Type': 'text/plain; charset=utf-8' },
    body
  });
  if (!res.ok) throw new Error(`ntfy ${res.status}`);
  console.log(`pushed[${topic}]:`, title, '/', body);
}

// One entry per phone/subscriber, each seeing THEIR team as "mine".
function recipients() {
  const r = [{
    topic: cfg.ntfyTopic, name: cfg.teamName, players: cfg.players, seventh: wk.seventh, starters: wk.starters,
    oppName: cfg.opponentName, oppPlayers: cfg.opponentPlayers, oppSeventh: wk.opponentSeventh, oppStarters: wk.opponentStarters
  }];
  if (cfg.opponentTopic) r.push({
    topic: cfg.opponentTopic, name: cfg.opponentName, players: cfg.opponentPlayers, seventh: wk.opponentSeventh, starters: wk.opponentStarters,
    oppName: cfg.teamName, oppPlayers: cfg.players, oppSeventh: wk.seventh, oppStarters: wk.starters
  });
  return r;
}
function totalOf(players, seventh, starters, live) {
  return weekend ? weekendTotal(players, seventh, starters, wk.cutSnapshot || {}, live) : bestNTotal(players, live, cfg.countBest);
}

(async () => {
  const wanted = new Set([...cfg.players, ...cfg.opponentPlayers].map(norm));
  const d = await (await fetch(API, { headers: { 'cache-control': 'no-cache' } })).json();
  const ev = pickEvent(d, wanted);
  if (!ev) { console.log('no event'); return; }

  const state = (ev.status?.type?.state) || 'pre';
  const round = ev.status?.period || 0;
  const evName = ev.shortName || ev.name || 'Event';
  if (state === 'pre') { console.log('event not started:', evName); return; }

  const live = readCompetitors(ev);
  const prev = await loadState();
  const next = { event: evName, round, players: {}, lockReminded: prev.lockReminded, finalSent: prev.finalSent };

  // snapshot every tracked player's current score (for change detection next run)
  const allPlayers = [...cfg.players, ...cfg.opponentPlayers, wk.seventh, wk.opponentSeventh].filter(Boolean);
  for (const p of allPlayers) { const k = norm(p); const l = live[k]; if (l && l.toPar != null) next.players[k] = l.toPar; }
  await saveState(next);

  // First run just seeds state (no spam)
  if (prev.players === undefined) { console.log('seeded state, no alert on first run'); return; }

  // Weekend has begun but the lineup isn't locked in config yet — nudge the manager once.
  if (round >= 3 && !weekend && !prev.lockReminded) {
    next.lockReminded = true; await saveState(next);
    await push(cfg.ntfyTopic, '🔒 Lock your weekend lineup',
      `${evName}: the cut is in. In the app, set your 4 starters, tap Lock, then "Copy robot config" → paste into robot/config.json so the weekend scores correctly.`,
      'lock,golf', 'high');
    return;
  }

  const finalNow = (state === 'post' && !prev.finalSent);
  if (finalNow) { next.finalSent = true; await saveState(next); }

  // Push each subscriber their OWN team's update, on their OWN topic
  for (const r of recipients()) {
    const myTot = totalOf(r.players, r.seventh, r.starters, live);
    const oppTot = totalOf(r.oppPlayers, r.oppSeventh, r.oppStarters, live);
    const margin = oppTot - myTot; // >0 => this recipient leads
    const standing = margin === 0 ? 'all square' : margin > 0 ? `leading by ${margin}` : `trailing by ${-margin}`;

    if (finalNow) {
      const won = margin > 0, tie = margin === 0;
      await push(r.topic, `${r.name} ${pretty(myTot)} — ${won ? 'WIN 🏆' : tie ? 'TIED 🤝' : 'lost'}`,
        `${evName} final\n${r.name} ${pretty(myTot)} vs ${r.oppName} ${pretty(oppTot)}`,
        won ? 'trophy,golf' : 'golf', won ? 'high' : 'default');
      continue;
    }

    // this recipient's relevant movers (their starters on the weekend, all 6 in R1–2)
    const roster = (weekend && r.seventh) ? [...r.players, r.seventh] : r.players;
    const relevant = new Set((weekend ? (r.starters || []) : r.players).map(norm));
    const moves = [];
    for (const p of roster) {
      const k = norm(p); const l = live[k]; if (!l || l.toPar == null) continue;
      const before = prev.players?.[k];
      if (before !== undefined && before !== l.toPar && relevant.has(k))
        moves.push({ name: l.name || p, to: l.toPar, delta: l.toPar - before, thru: l.thru });
    }
    if (!moves.length) continue;

    moves.sort((a, b) => a.delta - b.delta);
    const best = moves[0];
    const verb = best.delta <= -2 ? 'eagle! 🦅' : best.delta === -1 ? 'birdie 🐦' : best.delta === 1 ? 'bogey' : best.delta >= 2 ? 'double+' : 'move';
    const arrow = best.delta < 0 ? '▼' : '▲';
    const last = best.name.split(' ').slice(-1)[0];
    await push(r.topic, `${r.name} ${pretty(myTot)} · ${standing}`,
      `${last} ${arrow}${Math.abs(best.delta)} ${verb}${best.thru ? ' · ' + best.thru : ''}\nnow ${pretty(best.to)}${moves.length > 1 ? `  (+${moves.length - 1} more moved)` : ''}`,
      best.delta < 0 ? 'golf,chart_with_downwards_trend' : 'golf',
      best.delta <= -2 ? 'high' : 'default');
  }
})().catch((e) => { console.error('robot error:', e.message); process.exit(0); });
