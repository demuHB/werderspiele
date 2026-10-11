import { parseSheet, isWerder } from './parse.js';
import * as S from './stats.js';
import { validate, fmt } from './validate.js';

const DATA_URL = 'data/werderspiele.xlsx';
const state = { games: [], extra: [], clubs: {}, stadiums: {}, players: null, issues: [], extraIssues: [], charts: [], gameFilter: {} };

// ---------- Hilfen ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x) => `${Math.round(x)} %`;
const dec = (x, d = 2) => x.toFixed(d).replace('.', ',');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const initials = (s) => String(s || '?').replace(/^(\d+\.\s*)?(FC|SC|SV|VfL|VfB|1\.|TSG|SpVgg|DSC|SSV|FSV|BSC|RB|AJ|OGC|CF)\s+/g, '')
  .split(/[\s-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

function club(name) {
  if (isWerder(name)) return { ...state.clubs['Werder Bremen'], short: name === 'Werder Bremen' ? 'Werder' : name.replace('Werder Bremen', 'Werder') };
  return state.clubs[name] || null;
}
const short = (name) => club(name)?.short || name;

function crest(name, size = 28) {
  const c = club(name);
  const img = c?.id ? `<img src="assets/logos/${c.id}.png" alt="" loading="lazy" onerror="this.remove()">` : '';
  return `<span class="crest" style="--sz:${size}px;--c:${c?.color || 'var(--muted)'}" title="${esc(name)}">${img}<b>${esc(initials(name))}</b></span>`;
}

function avatar(name, team, size = 40) {
  const p = state.players.lookup(name, team);
  const img = p?.img ? `<img src="${esc(p.img)}" alt="" loading="lazy" onerror="this.remove()">` : '';
  const color = team === 'Werder' ? 'var(--green)' : (state.clubs[team]?.color || 'var(--muted)');
  return `<span class="avatar" style="--sz:${size}px;--c:${color}" title="${esc(p?.full || name)}">${img}<b>${esc(initials(p?.full || name))}</b></span>`;
}

const fullName = (name, team) => state.players.lookup(name, team)?.full || name;

function resultText(g) {
  if (!g.res) return esc(g.raw.ergebnis);
  return `${g.res.home}:${g.res.away}`;
}

function gameCard(g) {
  const werderH = isWerder(g.home), werderA = isWerder(g.away);
  const sub = g.res?.pens ? `${g.res.pens.home}:${g.res.pens.away} i.E.` : g.res?.ht ? `(${g.res.ht.home}:${g.res.ht.away})` : '';
  return `<button class="game ${g.outcome || ''}" data-game="${g.kind}:${g.row}">
    <div class="meta"><span class="nr">#${g.nr ?? '–'}</span><span>${fmt(g.date)}</span><span>${esc(g.comp)}${g.round && g.round !== '/' ? ' · ' + esc(g.round) : ''}</span><span>${esc(g.stadiumRaw)}</span></div>
    <div class="team home ${werderH ? 'werder' : ''}">${crest(g.home)}<span>${esc(short(g.home))}</span></div>
    <div class="score">${resultText(g)}${sub ? `<small>${sub}</small>` : ''}</div>
    <div class="team away ${werderA ? 'werder' : ''}">${crest(g.away)}<span>${esc(short(g.away))}</span></div>
  </button>`;
}

function miniGame(g, extra = '') {
  return `<li data-game="${g.kind}:${g.row}"><span class="d">${fmt(g.date)}</span>${crest(g.opp, 20)}
    <span class="t">${g.venue === 'H' ? 'vs.' : g.venue === 'N' ? 'gg.' : '@'} ${esc(short(g.opp))}${extra}</span>
    <span class="res-pill ${g.outcome}">${g.outcome}</span><span class="r">${g.gf}:${g.ga}</span></li>`;
}

function sunBar(r) {
  const t = r.S + r.U + r.N || 1;
  return `<div class="sun-bar" role="img" aria-label="${r.S} Siege, ${r.U} Unentschieden, ${r.N} Niederlagen">
    <span class="s" style="flex:${r.S / t}" title="${r.S} Siege"></span><span class="u" style="flex:${r.U / t}" title="${r.U} Unentschieden"></span><span class="n" style="flex:${r.N / t}" title="${r.N} Niederlagen"></span></div>
    <div class="legend"><span><i style="background:var(--win)"></i>${r.S} Siege</span><span><i style="background:var(--draw)"></i>${r.U} Unentschieden</span><span><i style="background:var(--loss)"></i>${r.N} Niederlagen</span></div>`;
}

function hbars(entries, { label = (k) => k, max } = {}) {
  const m = max ?? Math.max(1, ...entries.map((e) => e[1]));
  return `<div class="hbars">${entries.map(([k, v]) => `<div class="hbar" title="${esc(label(k))}: ${v}"><span>${esc(label(k))}</span><div class="track"><div class="fill" style="width:${(v / m) * 100}%"></div></div><span class="v">${v}</span></div>`).join('')}</div>`;
}

function rankList(items, { limit = 10, id }) {
  const max = items[0]?.value || 1;
  const row = (it, i) => `<li class="podium-${i + 1}" ${it.game ? `data-game="${it.game}"` : ''}><span class="pos">${i + 1}</span>${it.icon}
      <div class="who"><b>${esc(it.title)}</b><small>${it.sub || ''}</small><div class="bar" style="width:${(it.value / max) * 100}%"></div></div>
      <span class="val">${it.value}</span></li>`;
  const more = items.length > limit ? `<button class="btn more-btn" data-more="${id}">Alle ${items.length} anzeigen</button>` : '';
  return `<ol class="rank" id="${id}">${items.slice(0, limit).map(row).join('')}</ol>${more}
    <template id="${id}-all">${items.map(row).join('')}</template>`;
}

// ---------- Charts ----------
function chart(canvasId, config) {
  const el = document.getElementById(canvasId);
  if (!el || !window.Chart) return;
  const grid = css('--line'), text = css('--text-2');
  Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
  Chart.defaults.color = text;
  config.options = Object.assign({
    responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 3 } }, tooltip: { cornerRadius: 8, padding: 10 } },
  }, config.options || {});
  for (const ax of Object.values(config.options.scales || {})) {
    ax.grid = { color: grid, drawTicks: false, ...(ax.grid || {}) };
    ax.border = { display: false };
    ax.ticks = { padding: 6, ...(ax.ticks || {}) };
  }
  state.charts.push(new Chart(el, config));
}
const barDefaults = { borderRadius: 4, borderSkipped: 'start', borderWidth: 0, maxBarThickness: 28 };

// ---------- Views ----------
function viewOverview() {
  const g = state.games, r = S.record(g);
  const opp = S.opponents(g), st = S.stadiums(g);
  const top = S.topScorers(g, state.players, { werder: true })[0];
  const fav = opp.filter((o) => o.n >= 5).sort((a, b) => b.ppg - a.ppg)[0];
  const bogey = opp.filter((o) => o.n >= 5).sort((a, b) => a.ppg - b.ppg)[0];
  const streak = S.streaks(g);
  const last = g.slice(-6).reverse();
  const nextMile = Math.ceil((g.length + 1) / 50) * 50;
  const miles = [1, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500].filter((n) => n <= g.length).map((n) => g[n - 1]);
  const away = st.filter((s) => !s.name.startsWith('Weserstadion'))[0];
  const seasons = S.bySeason(g);

  return `
  <div class="kpis">
    <div class="kpi"><span class="num">${r.n}</span><span class="lbl">Spiele</span><span class="sub">seit ${fmt(g[0]?.date)}</span></div>
    <div class="kpi win"><span class="num">${r.S}</span><span class="lbl">Siege</span><span class="sub">${pct(r.winPct)}</span></div>
    <div class="kpi draw"><span class="num">${r.U}</span><span class="lbl">Unentschieden</span><span class="sub">${pct(r.U / r.n * 100)}</span></div>
    <div class="kpi loss"><span class="num">${r.N}</span><span class="lbl">Niederlagen</span><span class="sub">${pct(r.N / r.n * 100)}</span></div>
    <div class="kpi"><span class="num">${r.gf}:${r.ga}</span><span class="lbl">Tore</span><span class="sub">Ø ${dec((r.gf + r.ga) / r.n, 1)} pro Spiel</span></div>
    <div class="kpi"><span class="num">${dec(r.ppg)}</span><span class="lbl">Punkte / Spiel</span><span class="sub">${r.pts} Punkte</span></div>
    <div class="kpi"><span class="num">${st.length}</span><span class="lbl">Stadien</span><span class="sub">${opp.length} Gegner</span></div>
    <div class="kpi"><span class="num">${seasons.length}</span><span class="lbl">Saisons</span><span class="sub">Ø ${dec(r.n / seasons.length, 1)} Spiele</span></div>
  </div>

  <div class="grid grid-2" style="margin-top:14px">
    <div class="card"><h3>Bilanz</h3>${sunBar(r)}
      <p class="small muted" style="margin:10px 0 0">Spiele mit Elfmeterschießen zählen als Sieg bzw. Niederlage.</p>
      <p style="margin:12px 0 0"><b>Nächstes Jubiläum:</b> Spiel Nr. ${nextMile} – noch ${nextMile - g.length} ${nextMile - g.length === 1 ? 'Spiel' : 'Spiele'}.</p>
    </div>
    <div class="card"><h3>Letzte Spiele</h3><ul class="mini">${last.map((x) => miniGame(x)).join('')}</ul></div>
  </div>

  <div class="grid grid-3" style="margin-top:14px">
    ${top ? `<div class="card highlight">${avatar(top.name, 'Werder', 56)}<div><div class="lbl">Meiste Tore gesehen</div><div class="big">${esc(fullName(top.name, 'Werder'))}</div><div class="sub">${top.goals} Tore in ${top.games.size} Spielen</div></div></div>` : ''}
    ${fav ? `<div class="card highlight">${crest(fav.opp, 48)}<div><div class="lbl">Lieblingsgegner</div><div class="big">${esc(short(fav.opp))}</div><div class="sub">${fav.S}-${fav.U}-${fav.N} · ${dec(fav.ppg)} Pkt/Spiel</div></div></div>` : ''}
    ${bogey ? `<div class="card highlight">${crest(bogey.opp, 48)}<div><div class="lbl">Angstgegner</div><div class="big">${esc(short(bogey.opp))}</div><div class="sub">${bogey.S}-${bogey.U}-${bogey.N} · ${dec(bogey.ppg)} Pkt/Spiel</div></div></div>` : ''}
    <div class="card highlight">${crest('Werder Bremen', 48)}<div><div class="lbl">Längste Siegesserie</div><div class="big">${streak.best.win.length} Siege</div><div class="sub">${fmt(streak.best.win[0]?.date)} – ${fmt(streak.best.win.at(-1)?.date)}</div></div></div>
    <div class="card highlight">${crest('Werder Bremen', 48)}<div><div class="lbl">Längste Serie ungeschlagen</div><div class="big">${streak.best.unbeaten.length} Spiele</div><div class="sub">${fmt(streak.best.unbeaten[0]?.date)} – ${fmt(streak.best.unbeaten.at(-1)?.date)}</div></div></div>
    ${away ? `<div class="card highlight">${crest(away.games[0].opp, 48)}<div><div class="lbl">Häufigstes Auswärtsstadion</div><div class="big">${esc(away.name)}</div><div class="sub">${plural(away.n, 'Besuch', 'Besuche')}</div></div></div>` : ''}
  </div>

  <h2>Spiele pro Saison</h2>
  <div class="card"><div class="chart-box tall"><canvas id="ch-seasons" aria-label="Spiele pro Saison nach Ergebnis"></canvas></div></div>

  <h2>Meilensteine</h2>
  <div class="card"><ul class="mini">${miles.map((x) => miniGame(x, ` <span class="muted small">· Spiel Nr. ${x.nr}</span>`)).join('')}</ul></div>`;
}
function afterOverview() {
  const seasons = S.bySeason(state.games);
  chart('ch-seasons', {
    type: 'bar',
    data: {
      labels: seasons.map((s) => s.season.replace(/^20(\d\d)\/20(\d\d)$/, '$1/$2')),
      datasets: [
        { label: 'Siege', data: seasons.map((s) => s.S), backgroundColor: css('--win'), ...barDefaults, borderSkipped: false, borderRadius: 2 },
        { label: 'Unentschieden', data: seasons.map((s) => s.U), backgroundColor: css('--draw'), ...barDefaults, borderSkipped: false, borderRadius: 2 },
        { label: 'Niederlagen', data: seasons.map((s) => s.N), backgroundColor: css('--loss'), ...barDefaults, borderSkipped: false, borderRadius: 2 },
      ],
    },
    options: {
      datasets: { bar: { borderColor: css('--surface'), borderWidth: { top: 2 } } },
      scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: { precision: 0 } } },
      plugins: { tooltip: { callbacks: { footer: (items) => `Spiele: ${items.reduce((a, i) => a + i.raw, 0)}` } } },
    },
  });
}

// ----- Spiele -----
function uniq(arr) { return [...new Set(arr)]; }
function viewGames() {
  const g = state.games, f = state.gameFilter;
  const opt = (vals, sel, lbl = (v) => v) => vals.map((v) => `<option value="${esc(v)}" ${String(sel) === String(v) ? 'selected' : ''}>${esc(lbl(v))}</option>`).join('');
  const seasons = uniq(g.map((x) => x.season)).reverse();
  const comps = S.sortedEntries(S.countBy(g, (x) => x.comp)).map((e) => e[0]);
  const opps = uniq(g.map((x) => x.opp)).sort((a, b) => short(a).localeCompare(short(b), 'de'));
  const stads = uniq(g.map((x) => x.stadium)).sort((a, b) => a.localeCompare(b, 'de'));
  return `
  <div class="filters">
    <input type="search" id="f-q" placeholder="Suche: Gegner, Torschütze, Stadion …" value="${esc(f.q || '')}">
    <select id="f-season"><option value="">Alle Saisons</option>${opt(seasons, f.season)}</select>
    <select id="f-comp"><option value="">Alle Wettbewerbe</option>${opt(comps, f.comp)}</select>
    <select id="f-opp"><option value="">Alle Gegner</option>${opt(opps, f.opp, short)}</select>
    <select id="f-stadium"><option value="">Alle Stadien</option>${opt(stads, f.stadium)}</select>
    <select id="f-venue"><option value="">Heim &amp; Auswärts</option>${opt(['H', 'A', 'N'], f.venue, (v) => ({ H: 'Heimspiele', A: 'Auswärtsspiele', N: 'Neutral (Finale)' }[v]))}</select>
    <select id="f-outcome"><option value="">Alle Ergebnisse</option>${opt(['S', 'U', 'N'], f.outcome, (v) => ({ S: 'Siege', U: 'Unentschieden', N: 'Niederlagen' }[v]))}</select>
  </div>
  <div id="games-out"></div>`;
}
function filteredGames() {
  const f = state.gameFilter;
  const q = (f.q || '').toLowerCase().trim();
  return state.games.filter((g) =>
    (!f.season || g.season === f.season) && (!f.comp || g.comp === f.comp) && (!f.opp || g.opp === f.opp) &&
    (!f.stadium || g.stadium === f.stadium) && (!f.venue || g.venue === f.venue) && (!f.outcome || g.outcome === f.outcome) &&
    (!q || [g.home, g.away, g.stadiumRaw, g.comp, g.season, g.raw.scorers, fmt(g.date), short(g.opp),
      ...g.scorers.map((s) => fullName(s.name, s.team))].join(' ').toLowerCase().includes(q)));
}
function renderGamesList() {
  const list = filteredGames();
  const r = S.record(list);
  const bySeason = S.groupBy([...list].reverse(), (g) => g.season);
  const active = Object.values(state.gameFilter).some(Boolean);
  $('#games-out').innerHTML = `
    <div class="filter-summary"><b>${plural(list.length, 'Spiel', 'Spiele')}</b>
      <span><span class="res-pill S">S</span> ${r.S}</span><span><span class="res-pill U">U</span> ${r.U}</span><span><span class="res-pill N">N</span> ${r.N}</span>
      <span>Tore ${r.gf}:${r.ga}</span><span>${dec(r.ppg)} Pkt/Spiel</span>
      ${active ? '<button class="btn" id="f-reset">Filter zurücksetzen</button>' : ''}</div>
    ${list.length ? [...bySeason.entries()].map(([season, gs]) => {
      const sr = S.record(gs);
      return `<div class="season-head"><h3>Saison ${esc(season)}</h3><span class="small muted">${plural(gs.length, 'Spiel', 'Spiele')} · ${sr.S}-${sr.U}-${sr.N}</span></div>
        <div class="games">${gs.map(gameCard).join('')}</div>`;
    }).join('') : '<p class="muted">Keine Spiele gefunden.</p>'}`;
  $('#f-reset')?.addEventListener('click', () => { state.gameFilter = {}; render(); });
}
function afterGames() {
  const map = { 'f-q': 'q', 'f-season': 'season', 'f-comp': 'comp', 'f-opp': 'opp', 'f-stadium': 'stadium', 'f-venue': 'venue', 'f-outcome': 'outcome' };
  for (const [id, key] of Object.entries(map)) {
    $('#' + id).addEventListener(id === 'f-q' ? 'input' : 'change', (e) => { state.gameFilter[key] = e.target.value; renderGamesList(); });
  }
  renderGamesList();
}

// ----- Statistiken -----
function viewStats() {
  const g = state.games, P = state.players;
  const wTop = S.topScorers(g, P, { werder: true });
  const oTop = S.topScorers(g, P, { werder: false });
  const perSeason = S.topScorerPerSeason(g, P).reverse();
  const gs = S.goalStats(g), rec = S.records(g), str = S.streaks(g), cal = S.calendar(g), lines = S.scorelines(g);
  const r = S.record(g);
  const scorerItem = (t, werder) => {
    const team = werder ? 'Werder' : t.team;
    const teams = [...t.teams].map(short).join(', ');
    return { icon: avatar(t.name, team, 40), title: fullName(t.name, team), value: t.goals,
      sub: `${werder ? '' : esc(teams) + ' · '}${plural(t.games.size, 'Spiel', 'Spielen')}${t.pens ? ` · ${t.pens} Elfm.` : ''}${t.hattricks ? ` · ${t.hattricks}× Hattrick` : ''}` };
  };
  const streakFact = (arr, lbl) => `<div class="fact"><span class="num">${arr.length}</span><span class="lbl">${lbl}</span><div class="small muted">${arr.length ? `${fmt(arr[0].date)} – ${fmt(arr.at(-1).date)}` : '–'}</div></div>`;
  const comps = [...S.groupBy(g, (x) => x.comp).entries()].map(([c, gs2]) => ({ c, ...S.record(gs2) })).sort((a, b) => b.n - a.n);
  const dm = cal.dayMonth;
  const topDayCount = dm[0]?.[1] || 0;
  const topDays = dm.filter((d) => d[1] === topDayCount).map((d) => d[0]);
  const wd = [1, 2, 3, 4, 5, 6, 0].map((d) => [S.WEEKDAYS[d], cal.weekday.get(d) || 0]);
  const topWd = [...wd].sort((a, b) => b[1] - a[1])[0];
  const topMonth = S.sortedEntries(cal.month)[0];
  const topSeason = S.sortedEntries(cal.season)[0];
  const topYear = S.sortedEntries(cal.year)[0];

  return `
  <h2>Torschützen</h2>
  <div class="grid grid-2">
    <div class="card"><h3>Werder-Torjäger</h3><p class="section-sub">Tore, die ich live gesehen habe (ohne Eigentore)</p>${rankList(wTop.map((t) => scorerItem(t, true)), { limit: 10, id: 'rk-w' })}</div>
    <div class="card"><h3>Werder-Schreck</h3><p class="section-sub">Gegnerische Spieler mit den meisten Toren gegen Werder</p>${rankList(oTop.map((t) => scorerItem(t, false)), { limit: 10, id: 'rk-o' })}</div>
  </div>
  <div class="grid grid-2" style="margin-top:14px">
    <div class="card"><h3>Bester Werder-Schütze je Saison</h3>
      <div class="table-wrap"><table><thead><tr><th class="l">Saison</th><th class="l">Spieler</th><th>Tore</th></tr></thead><tbody>
      ${perSeason.map((s) => `<tr><td class="l">${esc(s.season)}</td><td class="l">${s.players.length ? `<span class="clubcell">${s.players.map((p) => avatar(p.name, 'Werder', 26)).join('')} ${s.players.map((p) => esc(fullName(p.name, 'Werder'))).join(', ')}</span>` : '<span class="muted">–</span>'}</td><td>${s.goals}</td></tr>`).join('')}
      </tbody></table></div></div>
    <div class="card"><h3>Tor-Fakten</h3>
      <div class="facts">
        <div class="fact"><span class="num">${dec((r.gf + r.ga) / r.n, 2)}</span><span class="lbl">Tore pro Spiel</span></div>
        <div class="fact"><span class="num">${dec(r.gf / r.n, 2)}</span><span class="lbl">Werder-Tore pro Spiel</span></div>
        <div class="fact"><span class="num">${gs.pens.forW}:${gs.pens.againstW}</span><span class="lbl">Elfmetertore (für : gegen)</span></div>
        <div class="fact"><span class="num">${gs.own.forW}:${gs.own.againstW}</span><span class="lbl">Eigentore (für : gegen Werder)</span></div>
        <div class="fact"><span class="num">${rec.cleanSheets}</span><span class="lbl">Spiele zu Null</span></div>
        <div class="fact"><span class="num">${rec.failedToScore}</span><span class="lbl">Spiele ohne Werder-Tor</span></div>
        <div class="fact"><span class="num">${rec.goalless}</span><span class="lbl">Torlose Remis (0:0)</span></div>
        <div class="fact"><span class="num">${gs.hattricks.length}</span><span class="lbl">Hattricks gesehen</span></div>
        <div class="fact"><span class="num">${wTop.length}</span><span class="lbl">verschiedene Werder-Torschützen</span></div>
      </div>
      <h3 style="margin-top:18px">Hattricks</h3>
      <ul class="mini">${gs.hattricks.map(({ g: x, s }) => miniGame(x, ` · <b>${esc(fullName(s.name, s.team))}</b> (${s.n})`)).join('')}</ul>
    </div>
  </div>

  <h2>Rekorde</h2>
  <div class="grid grid-3">
    <div class="card"><h3>Höchste Siege</h3><ul class="mini">${rec.biggestWins.map((x) => miniGame(x)).join('')}</ul></div>
    <div class="card"><h3>Höchste Niederlagen</h3><ul class="mini">${rec.biggestLosses.map((x) => miniGame(x)).join('')}</ul></div>
    <div class="card"><h3>Torreichste Spiele</h3><ul class="mini">${rec.mostGoals.map((x) => miniGame(x)).join('')}</ul></div>
  </div>
  <div class="grid grid-2" style="margin-top:14px">
    <div class="card"><h3>Serien</h3>
      <div class="facts">
        ${streakFact(str.best.win, 'Siege in Folge')}
        ${streakFact(str.best.unbeaten, 'Spiele ungeschlagen')}
        ${streakFact(str.best.winless, 'Spiele sieglos')}
        ${streakFact(str.best.loss, 'Niederlagen in Folge')}
        ${streakFact(str.best.scoring, 'Spiele mit Werder-Tor')}
        ${streakFact(str.best.cleanSheet, 'Spiele zu Null in Folge')}
      </div>
      <p class="small muted" style="margin:12px 0 0">Aktuell: ${str.current.win.length ? `${plural(str.current.win.length, 'Sieg', 'Siege')} in Folge` : str.current.unbeaten.length ? `${str.current.unbeaten.length} ungeschlagen` : `${str.current.winless.length} sieglos`}.</p>
    </div>
    <div class="card"><h3>Häufigste Ergebnisse</h3><p class="section-sub">aus Werder-Sicht</p>${hbars(lines.slice(0, 10))}</div>
  </div>
  <div class="grid grid-2" style="margin-top:14px">
    <div class="card"><h3>Zur Halbzeit gedreht</h3><p class="section-sub">Rückstand zur Pause, am Ende gewonnen: ${rec.turnarounds.length}×</p><ul class="mini">${rec.turnarounds.map((x) => miniGame(x, ` <span class="muted small">(${x.htf}:${x.hta})</span>`)).join('')}</ul></div>
    <div class="card"><h3>Führung verspielt</h3><p class="section-sub">Führung zur Pause, am Ende verloren: ${rec.thrownAway.length}×</p><ul class="mini">${rec.thrownAway.map((x) => miniGame(x, ` <span class="muted small">(${x.htf}:${x.hta})</span>`)).join('')}</ul></div>
  </div>

  <h2>Kalender</h2>
  <div class="facts">
    <div class="fact"><span class="num">${topDays.join(', ')}</span><span class="lbl">häufigstes Datum (${topDayCount}× im Stadion)</span></div>
    <div class="fact"><span class="num">${topWd[0]}</span><span class="lbl">häufigster Wochentag (${topWd[1]}×)</span></div>
    <div class="fact"><span class="num">${S.MONTHS[topMonth[0]]}</span><span class="lbl">häufigster Monat (${topMonth[1]}×)</span></div>
    <div class="fact"><span class="num">${topSeason[0]}</span><span class="lbl">Saison mit den meisten Spielen (${topSeason[1]})</span></div>
    <div class="fact"><span class="num">${topYear[0]}</span><span class="lbl">Kalenderjahr mit den meisten Spielen (${topYear[1]})</span></div>
  </div>
  <div class="grid grid-2" style="margin-top:14px">
    <div class="card"><h3>Häufigste Daten</h3><p class="section-sub">Tag & Monat, über alle Jahre</p>${hbars(dm.slice(0, 12))}</div>
    <div class="card"><h3>Wochentage</h3><div class="chart-box"><canvas id="ch-wd"></canvas></div></div>
    <div class="card"><h3>Monate</h3><div class="chart-box"><canvas id="ch-month"></canvas></div></div>
    <div class="card"><h3>Spiele pro Kalenderjahr</h3><div class="chart-box"><canvas id="ch-year"></canvas></div></div>
    <div class="card"><h3>Spiele pro Lebensjahr</h3><p class="section-sub">nach Alter beim Spiel</p><div class="chart-box"><canvas id="ch-age"></canvas></div></div>
    <div class="card"><h3>Punkte pro Spiel je Saison</h3><p class="section-sub">3 Punkte für einen Sieg, 1 für ein Remis</p><div class="chart-box"><canvas id="ch-ppg"></canvas></div></div>
  </div>

  <h2>Wettbewerbe</h2>
  <div class="card"><div class="table-wrap"><table><thead><tr><th class="l">Wettbewerb</th><th>Sp</th><th>S</th><th>U</th><th>N</th><th>Tore</th><th>Pkt/Sp</th><th class="l">Bilanz</th></tr></thead><tbody>
    ${comps.map((c) => `<tr data-filter-comp="${esc(c.c)}"><td class="l">${esc(c.c)}</td><td>${c.n}</td><td>${c.S}</td><td>${c.U}</td><td>${c.N}</td><td>${c.gf}:${c.ga}</td><td>${dec(c.ppg)}</td><td class="l" style="min-width:120px"><div class="sun-bar" style="margin:0"><span class="s" style="flex:${c.S}"></span><span class="u" style="flex:${c.U}"></span><span class="n" style="flex:${c.N}"></span></div></td></tr>`).join('')}
  </tbody></table></div></div>`;
}
function afterStats() {
  const cal = S.calendar(state.games);
  const green = css('--accent');
  const single = (id, labels, data, label) => chart(id, {
    type: 'bar', data: { labels, datasets: [{ label, data, backgroundColor: green, ...barDefaults }] },
    options: { plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { ticks: { precision: 0 } } } },
  });
  single('ch-wd', ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'], [1, 2, 3, 4, 5, 6, 0].map((d) => cal.weekday.get(d) || 0), 'Spiele');
  single('ch-month', S.MONTHS.map((m) => m.slice(0, 3)), S.MONTHS.map((_, i) => cal.month.get(i) || 0), 'Spiele');
  const years = [...cal.year.keys()].sort();
  const allYears = []; for (let y = years[0]; y <= years.at(-1); y++) allYears.push(y);
  single('ch-year', allYears, allYears.map((y) => cal.year.get(y) || 0), 'Spiele');
  const ages = [...cal.age.keys()].filter((a) => a != null && !Number.isNaN(a)).sort((a, b) => a - b);
  const allAges = []; for (let a = ages[0]; a <= ages.at(-1); a++) allAges.push(a);
  single('ch-age', allAges.map((a) => `${a}`), allAges.map((a) => cal.age.get(a) || 0), 'Spiele');
  const seasons = S.bySeason(state.games);
  chart('ch-ppg', {
    type: 'line',
    data: { labels: seasons.map((s) => s.season.replace(/^20(\d\d)\/20(\d\d)$/, '$1/$2')),
      datasets: [{ label: 'Punkte pro Spiel', data: seasons.map((s) => +s.ppg.toFixed(2)), borderColor: green, backgroundColor: green, borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, tension: .25 }] },
    options: { plugins: { legend: { display: false }, tooltip: { callbacks: { afterLabel: (i) => { const s = seasons[i.dataIndex]; return `${s.n} Spiele · ${s.S}-${s.U}-${s.N}`; } } } },
      scales: { x: { grid: { display: false } }, y: { min: 0, max: 3 } } },
  });
}

// ----- Gegner -----
let oppSort = { key: 'n', dir: -1 };
function viewOpponents() {
  const opp = S.opponents(state.games);
  const min = 5;
  const elig = opp.filter((o) => o.n >= min);
  const fav = [...elig].sort((a, b) => b.ppg - a.ppg || b.n - a.n).slice(0, 3);
  const bog = [...elig].sort((a, b) => a.ppg - b.ppg || b.n - a.n).slice(0, 3);
  const card = (o) => `<li data-filter-opp="${esc(o.opp)}">${crest(o.opp, 28)}<span class="t"><b>${esc(short(o.opp))}</b> <span class="muted small">${o.n} Sp · ${o.S}-${o.U}-${o.N}</span></span><span class="r">${dec(o.ppg)}</span></li>`;
  return `
  <div class="grid grid-2" style="margin-top:16px">
    <div class="card"><h3>Lieblingsgegner</h3><p class="section-sub">beste Punkte pro Spiel (ab ${min} Spielen)</p><ul class="mini">${fav.map(card).join('')}</ul></div>
    <div class="card"><h3>Angstgegner</h3><p class="section-sub">schlechteste Punkte pro Spiel (ab ${min} Spielen)</p><ul class="mini">${bog.map(card).join('')}</ul></div>
  </div>
  <h2>Alle Gegner <span class="muted small" style="font-family:Inter;text-transform:none">(${opp.length})</span></h2>
  <div class="card"><div class="table-wrap" id="opp-table"></div></div>`;
}
function renderOppTable() {
  const opp = S.opponents(state.games);
  const cols = [
    ['opp', 'Verein', 'l'], ['n', 'Sp'], ['H', 'H'], ['A', 'A'], ['S', 'S'], ['U', 'U'], ['N', 'N'],
    ['winPct', 'Sieg %'], ['gf', 'Tore'], ['ga', 'Gegent.'], ['diff', 'Diff'], ['ppg', 'Pkt/Sp'],
  ];
  const k = oppSort.key;
  opp.sort((a, b) => (k === 'opp' ? short(a.opp).localeCompare(short(b.opp), 'de') : (a[k] - b[k])) * oppSort.dir || b.n - a.n);
  $('#opp-table').innerHTML = `<table><thead><tr>${cols.map(([key, l, c]) => `<th class="${c || ''} ${key === k ? 'sorted' : ''}" data-sort="${key}">${l}</th>`).join('')}</tr></thead><tbody>
    ${opp.map((o) => `<tr data-filter-opp="${esc(o.opp)}" title="${[...o.comps.entries()].map(([c, n]) => `${c}: ${n}`).join(', ')}">
      <td class="l"><span class="clubcell">${crest(o.opp, 24)}${esc(short(o.opp))}</span></td><td><b>${o.n}</b></td><td>${o.H}</td><td>${o.A + o.Nv}</td>
      <td>${o.S}</td><td>${o.U}</td><td>${o.N}</td><td>${Math.round(o.winPct)}</td><td>${o.gf}</td><td>${o.ga}</td>
      <td class="${o.diff > 0 ? 'pos-diff' : o.diff < 0 ? 'neg-diff' : ''}">${o.diff > 0 ? '+' : ''}${o.diff}</td><td>${dec(o.ppg)}</td></tr>`).join('')}
    </tbody></table>`;
  $('#opp-table thead').addEventListener('click', (e) => {
    const key = e.target.closest('th')?.dataset.sort;
    if (!key) return;
    oppSort = { key, dir: oppSort.key === key ? -oppSort.dir : key === 'opp' ? 1 : -1 };
    renderOppTable();
  });
}

// ----- Stadien -----
function viewStadiums() {
  const st = S.stadiums(state.games);
  const max = st[0]?.n || 1;
  return `<p class="section-sub" style="margin-top:16px">${st.length} verschiedene Stadien. Umbenannte Stadien sind zusammengefasst.</p>
  <div class="grid grid-3">${st.map((s) => {
    const host = S.sortedEntries(S.countBy(s.games, (g) => g.home))[0][0];
    return `<div class="card" data-filter-stadium="${esc(s.name)}" style="cursor:pointer">
      <div class="highlight">${crest(host, 40)}<div style="min-width:0"><div class="big">${esc(s.name)}</div>
      <div class="sub">${plural(s.n, 'Besuch', 'Besuche')} · ${dec(s.ppg)} Pkt/Spiel · Tore ${s.gf}:${s.ga}</div></div></div>
      ${s.names.size > 1 ? `<p class="small muted" style="margin:8px 0 0">${[...s.names].map(esc).join(' · ')}</p>` : ''}
      <div class="sun-bar" style="margin-top:10px;width:${Math.max(8, (s.n / max) * 100)}%"><span class="s" style="flex:${s.S}"></span><span class="u" style="flex:${s.U}"></span><span class="n" style="flex:${s.N}"></span></div>
      <div class="small muted">${s.S}-${s.U}-${s.N} · erstes Mal ${fmt(s.games[0].date)}</div></div>`;
  }).join('')}</div>`;
}

// ----- U23 & Allstars -----
function viewExtra() {
  const g = state.extra;
  const r = S.record(g.filter((x) => x.outcome));
  return `<p class="section-sub" style="margin-top:16px">U23, Amateure, Abschieds- und Allstar-Spiele – fließen nicht in die anderen Statistiken ein.</p>
  <div class="kpis"><div class="kpi"><span class="num">${g.length}</span><span class="lbl">Spiele</span></div>
    <div class="kpi win"><span class="num">${r.S}</span><span class="lbl">Siege</span></div>
    <div class="kpi draw"><span class="num">${r.U}</span><span class="lbl">Unentschieden</span></div>
    <div class="kpi loss"><span class="num">${r.N}</span><span class="lbl">Niederlagen</span></div></div>
  <div class="games" style="margin-top:16px">${[...g].reverse().map(gameCard).join('')}</div>`;
}

// ----- Datencheck -----
function viewCheck() {
  const all = [...state.issues.map((i) => ({ ...i, sheet: 'Haupttabelle' })), ...state.extraIssues.map((i) => ({ ...i, sheet: 'U23 + All Stars' }))];
  const errs = all.filter((i) => i.level !== 'info');
  const infos = all.filter((i) => i.level === 'info');
  const item = (i) => `<div class="issue ${i.level}"><span class="lvl ${i.level}">${{ error: 'Fehler', warn: 'Prüfen', info: 'Hinweis' }[i.level]}</span>
    <div><div>${esc(i.msg)}</div><div class="where">${esc(i.sheet)} · Zeile ${i.g.row} · Nr. ${i.g.nr ?? '–'} · ${fmt(i.g.date)} · ${esc(i.g.raw.spiel)}</div></div></div>`;
  return `<p class="section-sub" style="margin-top:16px">Prüft die Excel bei jedem Laden: Torschützen vs. Ergebnis, Datum, Saison, Alter, Duplikate, Schreibweisen und fehlende Logos/Fotos.</p>
  ${errs.length ? errs.map(item).join('') : '<div class="ok-box"><b>Alles sauber.</b> Keine Fehler in den Daten gefunden.</div>'}
  ${infos.length ? `<details class="card" style="margin-top:14px"><summary>${infos.length} Hinweise (fehlende Logos/Fotos, Halbzeitstände …)</summary><div style="margin-top:12px">${infos.map(item).join('')}</div></details>` : ''}
  <div class="card" style="margin-top:14px"><h3>So trägst du neue Spiele ein</h3>
    <ol class="small" style="margin:0;padding-left:18px;line-height:1.8">
      <li>Neue Zeile in der Excel, gleiches Format: <code>Werder Bremen - Gegner</code>, Ergebnis <code>2:1 (1:0)</code>, Torschützen <code>Heim-Schützen - Gast-Schützen</code>, z. B. <code>Füllkrug (2), Stage (FE) - Kane</code>.</li>
      <li>Markierungen: <code>(2)</code> Anzahl, <code>(ET)</code> Eigentor, <code>(FE)</code> Foulelfmeter, <code>(HE)</code> Handelfmeter, <code>/</code> keine Tore, Elfmeterschießen: <code>1:1, 4:3 n. E. (0:1)</code>.</li>
      <li>Die Datei auf GitHub als <code>data/werderspiele.xlsx</code> hochladen – nach ca. 1 Minute ist die Seite aktuell.</li>
    </ol></div>`;
}

// ---------- Spiel-Dialog ----------
function openGame(key) {
  const [kind, row] = key.split(':');
  const g = (kind === 'extra' ? state.extra : state.games).find((x) => String(x.row) === row);
  if (!g) return;
  const side = (homeSide) => g.scorers.filter((s) => (s.forWerder === g.werderHome) === homeSide);
  const li = (s) => `<li>${avatar(s.name, s.team, 34)}<span>${esc(fullName(s.name, s.team))}${s.n > 1 ? ` <b>(${s.n})</b>` : ''}${s.tags.map((t) => `<span class="tag" title="${{ ET: 'Eigentor', FE: 'Foulelfmeter', HE: 'Handelfmeter' }[t]}">${t}</span>`).join('')}</span></li>`;
  const sub = g.res?.pens ? `${g.res.pens.home}:${g.res.pens.away} i.E.` : g.res?.ht ? `Halbzeit ${g.res.ht.home}:${g.res.ht.away}` : '';
  $('#game-dialog-body').innerHTML = `
    <div class="dlg-head"><div class="meta">Spiel Nr. ${g.nr ?? '–'} · ${fmt(g.date)} · ${S.WEEKDAYS[g.date?.getDay()] || ''}</div>
      <div class="dlg-teams"><div class="tm">${crest(g.home, 56)}<span>${esc(g.home)}</span></div>
      <div class="dlg-score">${resultText(g)}${sub ? `<small>${sub}</small>` : ''}</div>
      <div class="tm">${crest(g.away, 56)}<span>${esc(g.away)}</span></div></div></div>
    <div class="dlg-body">
      ${g.scorers.length ? `<div class="goal-cols"><ul class="home">${side(true).map(li).join('')}</ul><ul class="away">${side(false).map(li).join('')}</ul></div>`
        : kind === 'extra' ? `<p class="small">${esc(g.raw.scorers)}</p>` : '<p class="muted" style="text-align:center">Keine Tore</p>'}
      <dl class="dl"><dt>Wettbewerb</dt><dd>${esc(g.comp)}${g.round && g.round !== '/' ? ` · ${/^\d+$/.test(g.round) ? g.round + '. Spieltag' : esc(g.round)}` : ''}</dd>
        <dt>Saison</dt><dd>${esc(g.season)}</dd><dt>Stadion</dt><dd>${esc(g.stadiumRaw)}</dd>
        ${g.age != null ? `<dt>Mein Alter</dt><dd>${g.age} Jahre</dd>` : ''}
        ${g.outcome ? `<dt>Ergebnis</dt><dd><span class="res-pill ${g.outcome}">${g.outcome}</span> ${{ S: 'Sieg', U: 'Unentschieden', N: 'Niederlage' }[g.outcome]}${g.decidedByPens ? ' im Elfmeterschießen' : ''}</dd>` : ''}
      </dl></div>`;
  $('#game-dialog').showModal();
}

// ---------- Routing ----------
const routes = {
  '': [viewOverview, afterOverview], spiele: [viewGames, afterGames], statistiken: [viewStats, afterStats],
  gegner: [viewOpponents, renderOppTable], stadien: [viewStadiums], u23: [viewExtra], check: [viewCheck],
};
function render() {
  const tab = location.hash.replace(/^#\/?/, '').split('?')[0];
  const [view, after] = routes[tab] || routes[''];
  if ($('#game-dialog').open) $('#game-dialog').close();
  state.charts.forEach((c) => c.destroy());
  state.charts = [];
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === (routes[tab] ? tab : '')));
  $('#view').innerHTML = view();
  after?.();
}

function goGames(filter) {
  state.gameFilter = filter;
  if (location.hash === '#/spiele') render(); else location.hash = '#/spiele';
  window.scrollTo(0, 0);
}

document.addEventListener('click', (e) => {
  const gEl = e.target.closest('[data-game]');
  if (gEl) return openGame(gEl.dataset.game);
  const more = e.target.closest('[data-more]');
  if (more) { const id = more.dataset.more; $('#' + id).innerHTML = $('#' + id + '-all').innerHTML; more.remove(); return; }
  const fo = e.target.closest('[data-filter-opp]');
  if (fo) return goGames({ opp: fo.dataset.filterOpp });
  const fs = e.target.closest('[data-filter-stadium]');
  if (fs) return goGames({ stadium: fs.dataset.filterStadium });
  const fc = e.target.closest('[data-filter-comp]');
  if (fc) return goGames({ comp: fc.dataset.filterComp });
});
$('#game-dialog').addEventListener('click', (e) => { if (e.target.id === 'game-dialog') e.target.close(); });

// Theme
function applyTheme(t) {
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
}
try { applyTheme(localStorage.getItem('theme')); } catch { /* ohne Storage */ }
$('#theme-toggle').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  const t = dark ? 'light' : 'dark';
  applyTheme(t);
  try { localStorage.setItem('theme', t); } catch { /* egal */ }
  render();
});

// ---------- Laden ----------
function makePlayers(data) {
  return {
    data,
    lookup(name, team) { return data[`${name}@${team}`] || null; },
  };
}

async function waitForLibs() {
  for (let i = 0; i < 100 && !(window.XLSX && window.Chart); i++) await new Promise((r) => setTimeout(r, 50));
  if (!window.XLSX) throw new Error('Excel-Bibliothek (SheetJS) konnte nicht geladen werden.');
}

async function load() {
  try {
    const [clubsJson, playersJson, buf] = await Promise.all([
      fetch('data/clubs.json', { cache: 'no-cache' }).then((r) => r.json()),
      fetch('data/players.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
      fetch(DATA_URL, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(`${DATA_URL} nicht gefunden (${r.status})`); return r.arrayBuffer(); }),
      waitForLibs(),
    ]);
    state.clubs = clubsJson.clubs;
    state.stadiums = Object.fromEntries(Object.entries(clubsJson.stadiums || {}).filter(([k]) => !k.startsWith('_')));
    state.players = makePlayers(playersJson);
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const mainName = wb.SheetNames.find((n) => /haupt/i.test(n)) || wb.SheetNames[0];
    const extraName = wb.SheetNames.find((n) => /u23|all ?stars/i.test(n));
    const ctx = { clubs: state.clubs, stadiums: state.stadiums };
    state.games = parseSheet(wb.Sheets[mainName], { ...ctx, kind: 'main' });
    state.extra = extraName ? parseSheet(wb.Sheets[extraName], { ...ctx, kind: 'extra' }) : [];
    state.issues = validate(state.games, { clubs: state.clubs, players: state.players, kind: 'main' });
    state.extraIssues = validate(state.extra, { clubs: state.clubs, players: state.players, kind: 'extra' }).filter((i) => i.level !== 'info');

    const r = S.record(state.games);
    const last = state.games.at(-1);
    $('#hero-sub').textContent = `Dennis Mulert · ${r.n} Spiele im Stadion seit ${state.games[0]?.date?.getFullYear() ?? ''}`;
    $('#hero-record').innerHTML = `<span class="chip"><b>${r.S}</b>Siege</span><span class="chip"><b>${r.U}</b>Remis</span><span class="chip"><b>${r.N}</b>Niederlagen</span><span class="chip"><b>${r.gf}:${r.ga}</b>Tore</span>`;
    const nErr = [...state.issues, ...state.extraIssues].filter((i) => i.level !== 'info').length;
    const badge = $('#check-badge');
    badge.hidden = false;
    badge.textContent = nErr || '✓';
    badge.classList.toggle('ok', !nErr);
    $('#foot').innerHTML = `Letztes Spiel: ${fmt(last?.date)} · Daten aus <code>${DATA_URL}</code> · Logos &amp; Fotos: Wikipedia/Wikimedia Commons · privates, nicht-kommerzielles Projekt`;
    window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
    render();
  } catch (err) {
    console.error(err);
    $('#view').innerHTML = `<div class="error-box"><b>Daten konnten nicht geladen werden.</b><br>${esc(err.message)}<br><span class="small muted">Tipp: Lokal über einen Webserver öffnen (z. B. <code>python -m http.server</code>), nicht per Doppelklick.</span></div>`;
  }
}
load();
