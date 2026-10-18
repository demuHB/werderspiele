import { parseSheet, isWerder, markLabels } from './parse.js';
import * as S from './stats.js';
import { validate, fmt } from './validate.js';
import * as U from './upload.js';

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

// Klickbar machen: führt zur Spielliste mit diesen Filtern (oder mit {tab} zu einem anderen Tab)
const go = (params) => ` data-go="${esc(new URLSearchParams(params).toString())}" role="link" tabindex="0"`;
const scorerGo = (t, werder) => ({ player: t.key, pside: werder ? 'w' : 'o', label: fullName(t.name, werder ? 'Werder' : t.team) });

// Beschriftung der Zusatz-Filter (Chips über der Spielliste)
function drillLabel(k, f) {
  const v = f[k];
  switch (k) {
    case 'wd': return S.WEEKDAYS[+v];
    case 'month': return S.MONTHS[+v];
    case 'year': return `Jahr ${v}`;
    case 'age': return `Mit ${v} Jahren`;
    case 'day': return `Am ${v}`;
    case 'score': return `Ergebnis ${v}`;
    case 'player': return `Tore: ${f.label || v.split('@')[0]}${f.pside === 'w' ? ' (für Werder)' : f.pside === 'o' ? ' (gegen Werder)' : ''}`;
    case 'fact': return S.FACTS[v]?.label || v;
    case 'rows': return f.label || 'Auswahl';
    default: return v;
  }
}

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

// Kurzes Datum (TT.MM.JJ) wird auf dem Handy per CSS statt des langen gezeigt
const rowsGo = (games, label) => ({ rows: games.map((g) => g.row).join(','), label });
const fmtShort = (d) => (d ? fmt(d).replace(/\.(\d\d)(\d\d)$/, '.$2') : '–');

// extra: optionale zweite Zeile (z. B. Torschütze oder Besuchsnummer)
function miniGame(g, extra = '') {
  return `<li data-game="${g.kind}:${g.row}"><span class="d"><span class="d-long">${fmt(g.date)}</span><span class="d-short">${fmtShort(g.date)}</span></span>${crest(g.opp, 20)}
    <span class="t"><span class="t1">${g.venue === 'H' ? 'vs.' : g.venue === 'N' ? 'gg.' : '@'} ${esc(short(g.opp))}</span>${extra ? `<span class="t2">${extra}</span>` : ''}</span>
    <span class="res-pill ${g.outcome}">${g.outcome}</span><span class="r">${g.gf}:${g.ga}</span></li>`;
}

function sunBar(r) {
  const t = r.S + r.U + r.N || 1;
  return `<div class="sun-bar" role="img" aria-label="${r.S} Siege, ${r.U} Unentschieden, ${r.N} Niederlagen">
    <span class="s" style="flex:${r.S / t}" title="${r.S} Siege"></span><span class="u" style="flex:${r.U / t}" title="${r.U} Unentschieden"></span><span class="n" style="flex:${r.N / t}" title="${r.N} Niederlagen"></span></div>
    <div class="legend"><span><i style="background:var(--win)"></i>${r.S} Siege</span><span><i style="background:var(--draw)"></i>${r.U} Unentschieden</span><span><i style="background:var(--loss)"></i>${r.N} Niederlagen</span></div>`;
}

function hbars(entries, { label = (k) => k, max, to } = {}) {
  const m = max ?? Math.max(1, ...entries.map((e) => e[1]));
  return `<div class="hbars">${entries.map(([k, v]) => `<div class="hbar${to ? ' clickable' : ''}" title="${esc(label(k))}: ${v}"${to ? go(to(k)) : ''}><span>${esc(label(k))}</span><div class="track"><div class="fill" style="width:${(v / m) * 100}%"></div></div><span class="v">${v}</span></div>`).join('')}</div>`;
}

function rankList(items, { limit = 10, id }) {
  const max = items[0]?.value || 1;
  const row = (it, i) => `<li class="podium-${i + 1}${it.go ? ' clickable' : ''}"${it.go ? go(it.go) : ''}><span class="pos">${i + 1}</span>${it.icon}
      <div class="who"><b>${esc(it.title)}</b><small>${it.sub || ''}</small><div class="bar" style="width:${(it.value / max) * 100}%"></div></div>
      <span class="val">${it.value}</span></li>`;
  const more = items.length > limit ? `<button class="btn more-btn" data-more="${id}">Alle ${items.length} anzeigen</button>` : '';
  return `<ol class="rank" id="${id}">${items.slice(0, limit).map(row).join('')}</ol>${more}
    <template id="${id}-all">${items.map(row).join('')}</template>`;
}

// ---------- Charts ----------
function chart(canvasId, config, onPick) {
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
  if (onPick) {
    config.options.onClick = (evt) => {
      const c = evt.chart;
      const hit = c.getElementsAtEventForMode(evt.native, 'nearest', { intersect: true }, false);
      const els = hit.length ? hit : c.getElementsAtEventForMode(evt.native, 'index', { intersect: false }, false);
      if (els.length) onPick(els[0].index, hit.length ? els[0].datasetIndex : null);
    };
    config.options.onHover = (evt, els) => { evt.native.target.style.cursor = els.length ? 'pointer' : 'default'; };
  }
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
  // Jubiläen zählen alle Stadionbesuche (Spalte Nr.), unabhängig vom Testspiel-Haken
  const all = state.allGames;
  const nextMile = Math.ceil((all.length + 1) / 50) * 50;
  const miles = [1, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500].filter((n) => n <= all.length).map((n) => all[n - 1]);
  const away = st.filter((s) => !s.name.startsWith('Weserstadion'))[0];
  const seasons = S.bySeason(g);

  return `
  <div class="kpis">
    <div class="kpi clickable"${go({})}><span class="num">${r.n}</span><span class="lbl">Spiele</span><span class="sub">seit ${fmt(g[0]?.date)}</span></div>
    <div class="kpi win clickable"${go({ outcome: 'S' })}><span class="num">${r.S}</span><span class="lbl">Siege</span><span class="sub">${pct(r.winPct)}</span></div>
    <div class="kpi draw clickable"${go({ outcome: 'U' })}><span class="num">${r.U}</span><span class="lbl">Unentschieden</span><span class="sub">${pct(r.U / r.n * 100)}</span></div>
    <div class="kpi loss clickable"${go({ outcome: 'N' })}><span class="num">${r.N}</span><span class="lbl">Niederlagen</span><span class="sub">${pct(r.N / r.n * 100)}</span></div>
    <div class="kpi clickable"${go({})}><span class="num">${r.gf}:${r.ga}</span><span class="lbl">Tore</span><span class="sub">Ø ${dec((r.gf + r.ga) / r.n, 1)} pro Spiel</span></div>
    <div class="kpi clickable"${go({})}><span class="num">${dec(r.ppg)}</span><span class="lbl">Punkte / Spiel</span><span class="sub">${r.pts} Punkte</span></div>
    <div class="kpi clickable"${go({ tab: 'stadien' })}><span class="num">${st.length}</span><span class="lbl">Stadien</span><span class="sub">${opp.length} Gegner</span></div>
    <div class="kpi clickable"${go({ tab: 'statistiken' })}><span class="num">${seasons.length}</span><span class="lbl">Saisons</span><span class="sub">Ø ${dec(r.n / seasons.length, 1)} Spiele</span></div>
  </div>

  <div class="grid grid-2" style="margin-top:14px">
    <div class="card"><h3>Bilanz</h3>${sunBar(r)}
      <p class="small muted" style="margin:10px 0 0">${state.hiddenFriendlies ? `Ohne ${state.hiddenFriendlies} Testspiele (oben einblendbar). ` : ''}Spiele mit Elfmeterschießen zählen als Sieg bzw. Niederlage.</p>
      <p style="margin:12px 0 0"><b>Nächstes Jubiläum:</b> Besuch Nr. ${nextMile} – noch ${nextMile - all.length} ${nextMile - all.length === 1 ? 'Spiel' : 'Spiele'}.</p>
    </div>
    <div class="card"><h3>Letzte Spiele</h3><ul class="mini">${last.map((x) => miniGame(x)).join('')}</ul></div>
  </div>

  <div class="grid grid-3" style="margin-top:14px">
    ${top ? `<div class="card highlight clickable"${go(scorerGo(top, true))}>${avatar(top.name, 'Werder', 56)}<div><div class="lbl">Meiste Tore gesehen</div><div class="big">${esc(fullName(top.name, 'Werder'))}</div><div class="sub">${top.goals} Tore in ${top.games.size} Spielen</div></div></div>` : ''}
    ${fav ? `<div class="card highlight clickable"${go({ opp: fav.opp })}>${crest(fav.opp, 48)}<div><div class="lbl">Lieblingsgegner</div><div class="big">${esc(short(fav.opp))}</div><div class="sub">${fav.S}-${fav.U}-${fav.N} · ${dec(fav.ppg)} Pkt/Spiel</div></div></div>` : ''}
    ${bogey ? `<div class="card highlight clickable"${go({ opp: bogey.opp })}>${crest(bogey.opp, 48)}<div><div class="lbl">Angstgegner</div><div class="big">${esc(short(bogey.opp))}</div><div class="sub">${bogey.S}-${bogey.U}-${bogey.N} · ${dec(bogey.ppg)} Pkt/Spiel</div></div></div>` : ''}
    <div class="card highlight clickable"${go(rowsGo(streak.best.win, `${streak.best.win.length} Siege in Folge`))}>${crest('Werder Bremen', 48)}<div><div class="lbl">Längste Siegesserie</div><div class="big">${streak.best.win.length} Siege</div><div class="sub">${fmt(streak.best.win[0]?.date)} – ${fmt(streak.best.win.at(-1)?.date)}</div></div></div>
    <div class="card highlight clickable"${go(rowsGo(streak.best.unbeaten, `${streak.best.unbeaten.length} Spiele ungeschlagen`))}>${crest('Werder Bremen', 48)}<div><div class="lbl">Längste Serie ungeschlagen</div><div class="big">${streak.best.unbeaten.length} Spiele</div><div class="sub">${fmt(streak.best.unbeaten[0]?.date)} – ${fmt(streak.best.unbeaten.at(-1)?.date)}</div></div></div>
    ${away ? `<div class="card highlight clickable"${go({ stadium: away.name })}>${crest(away.games[0].opp, 48)}<div><div class="lbl">Häufigstes Auswärtsstadion</div><div class="big">${esc(away.name)}</div><div class="sub">${plural(away.n, 'Besuch', 'Besuche')}</div></div></div>` : ''}
  </div>

  <h2>Spiele pro Saison</h2>
  <div class="card"><div class="chart-box tall"><canvas id="ch-seasons" aria-label="Spiele pro Saison nach Ergebnis"></canvas></div></div>

  <h2>Meilensteine</h2>
  <div class="card"><p class="section-sub" style="margin:0 0 8px">nach Stadionbesuch, inkl. Testspielen</p><ul class="mini">${miles.map((x) => miniGame(x, `Besuch Nr. ${x.nr}`)).join('')}</ul></div>`;
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
  }, (i, ds) => goGames({ season: seasons[i].season, ...(ds != null ? { outcome: ['S', 'U', 'N'][ds] } : {}) }));
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
  return state.games.filter((g) => S.matchDrill(g, f, state.players) &&
    (!f.season || g.season === f.season) && (!f.comp || g.comp === f.comp) && (!f.opp || g.opp === f.opp) &&
    (!f.stadium || g.stadium === f.stadium) && (!f.venue || g.venue === f.venue) && (!f.outcome || g.outcome === f.outcome) &&
    (!q || [g.home, g.away, g.stadiumRaw, g.comp, g.season, g.raw.scorers, fmt(g.date), short(g.opp),
      ...g.scorers.map((s) => fullName(s.name, s.team))].join(' ').toLowerCase().includes(q)));
}
function renderGamesList() {
  const list = filteredGames();
  const r = S.record(list);
  const bySeason = S.groupBy([...list].reverse(), (g) => g.season);
  const f = state.gameFilter;
  const active = Object.entries(f).some(([k, v]) => k !== 'label' && k !== 'pside' && v);
  const chips = S.DRILL_KEYS.filter((k) => f[k] != null && f[k] !== '')
    .map((k) => `<button class="chip-filter" data-drop="${k}" title="Filter entfernen">${esc(drillLabel(k, f))} <span aria-hidden="true">✕</span></button>`).join('');
  $('#games-out').innerHTML = `
    ${chips ? `<div class="drill-chips">${chips}</div>` : ''}
    <div class="filter-summary"><b>${plural(list.length, 'Spiel', 'Spiele')}</b>
      <span><span class="res-pill S">S</span> ${r.S}</span><span><span class="res-pill U">U</span> ${r.U}</span><span><span class="res-pill N">N</span> ${r.N}</span>
      <span>Tore ${r.gf}:${r.ga}</span><span>${dec(r.ppg)} Pkt/Spiel</span>
      ${active ? '<button class="btn" id="f-reset">Filter zurücksetzen</button>' : ''}</div>
    ${list.length ? [...bySeason.entries()].map(([season, gs]) => {
      const sr = S.record(gs);
      return `<div class="season-head"><h3>Saison ${esc(season)}</h3><span class="small muted">${plural(gs.length, 'Spiel', 'Spiele')} · ${sr.S}-${sr.U}-${sr.N}</span></div>
        <div class="games">${gs.map(gameCard).join('')}</div>`;
    }).join('') : '<p class="muted">Keine Spiele gefunden.</p>'}`;
  $('#f-reset')?.addEventListener('click', () => goGames({}));
  for (const b of document.querySelectorAll('[data-drop]')) {
    b.addEventListener('click', () => {
      const k = b.dataset.drop;
      delete f[k];
      if (k === 'player') delete f.pside;
      if (k === 'rows' || k === 'player') delete f.label;
      goGames({ ...f });
    });
  }
  syncHash();
}
// Aktuelle Filter in die URL schreiben, ohne neuen Verlaufseintrag (Zurück-Button bleibt sinnvoll)
function syncHash() {
  const qs = new URLSearchParams(Object.entries(state.gameFilter).filter(([, v]) => v != null && v !== '')).toString();
  history.replaceState(null, '', `#/spiele${qs ? '?' + qs : ''}`);
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
    return { icon: avatar(t.name, team, 40), title: fullName(t.name, team), value: t.goals, go: scorerGo(t, werder),
      sub: `${werder ? '' : esc(teams) + ' · '}${plural(t.games.size, 'Spiel', 'Spielen')}${t.pens ? ` · ${t.pens} Elfm.` : ''}${t.hattricks ? ` · ${t.hattricks}× Hattrick` : ''}` };
  };
  const streakFact = (arr, lbl) => `<div class="fact clickable"${go(rowsGo(arr, `${arr.length} ${lbl}`))}><span class="num">${arr.length}</span><span class="lbl">${lbl}</span><div class="small muted">${arr.length ? `${fmt(arr[0].date)} – ${fmt(arr.at(-1).date)}` : '–'}</div></div>`;
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
      ${perSeason.map((s) => `<tr${s.players.length ? go({ ...scorerGo(s.players[0], true), season: s.season }) : ''}><td class="l">${esc(s.season)}</td><td class="l">${s.players.length ? `<span class="clubcell">${s.players.map((p) => avatar(p.name, 'Werder', 26)).join('')} ${s.players.map((p) => esc(fullName(p.name, 'Werder'))).join(', ')}</span>` : '<span class="muted">–</span>'}</td><td>${s.goals}</td></tr>`).join('')}
      </tbody></table></div></div>
    <div class="card"><h3>Tor-Fakten</h3>
      <div class="facts">
        <div class="fact clickable"${go({})}><span class="num">${dec((r.gf + r.ga) / r.n, 2)}</span><span class="lbl">Tore pro Spiel</span></div>
        <div class="fact clickable"${go({})}><span class="num">${dec(r.gf / r.n, 2)}</span><span class="lbl">Werder-Tore pro Spiel</span></div>
        <div class="fact"><span class="num"><a class="num-link"${go({ fact: 'pen-for' })}>${gs.pens.forW}</a>:<a class="num-link"${go({ fact: 'pen-against' })}>${gs.pens.againstW}</a></span><span class="lbl">Elfmetertore (für : gegen)</span></div>
        <div class="fact"><span class="num"><a class="num-link"${go({ fact: 'own-for' })}>${gs.own.forW}</a>:<a class="num-link"${go({ fact: 'own-against' })}>${gs.own.againstW}</a></span><span class="lbl">Eigentore (für : gegen Werder)</span></div>
        <div class="fact clickable"${go({ fact: 'clean' })}><span class="num">${rec.cleanSheets}</span><span class="lbl">Spiele zu Null</span></div>
        <div class="fact clickable"${go({ fact: 'noscore' })}><span class="num">${rec.failedToScore}</span><span class="lbl">Spiele ohne Werder-Tor</span></div>
        <div class="fact clickable"${go({ fact: 'goalless' })}><span class="num">${rec.goalless}</span><span class="lbl">Torlose Remis (0:0)</span></div>
        <div class="fact clickable"${go({ fact: 'hattrick' })}><span class="num">${gs.hattricks.length}</span><span class="lbl">Hattricks gesehen</span></div>
        <div class="fact clickable"${go({ tab: 'statistiken' })}><span class="num">${wTop.length}</span><span class="lbl">verschiedene Werder-Torschützen</span></div>
      </div>
      <h3 style="margin-top:18px">Hattricks</h3>
      <ul class="mini">${gs.hattricks.map(({ g: x, s }) => miniGame(x, `<b>${esc(fullName(s.name, s.team))}</b> (${s.n})`)).join('')}</ul>
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
    <div class="card"><h3>Häufigste Ergebnisse</h3><p class="section-sub">aus Werder-Sicht</p>${hbars(lines.slice(0, 10), { to: (k) => ({ score: k }) })}</div>
  </div>
  <div class="grid grid-2" style="margin-top:14px">
    <div class="card"><h3>Zur Halbzeit gedreht</h3><p class="section-sub">Rückstand zur Pause, am Ende gewonnen: <a class="link"${go({ fact: 'turnaround' })}>${rec.turnarounds.length}×</a></p><ul class="mini">${rec.turnarounds.map((x) => miniGame(x, `Halbzeit ${x.htf}:${x.hta}`)).join('')}</ul></div>
    <div class="card"><h3>Führung verspielt</h3><p class="section-sub">Führung zur Pause, am Ende verloren: <a class="link"${go({ fact: 'thrown' })}>${rec.thrownAway.length}×</a></p><ul class="mini">${rec.thrownAway.map((x) => miniGame(x, `Halbzeit ${x.htf}:${x.hta}`)).join('')}</ul></div>
  </div>

  <h2>Kalender</h2>
  <div class="facts">
    <div class="fact clickable"${go({ day: topDays[0] })}><span class="num">${topDays.join(', ')}</span><span class="lbl">häufigstes Datum (${topDayCount}× im Stadion)</span></div>
    <div class="fact clickable"${go({ wd: S.WEEKDAYS.indexOf(topWd[0]) })}><span class="num">${topWd[0]}</span><span class="lbl">häufigster Wochentag (${topWd[1]}×)</span></div>
    <div class="fact clickable"${go({ month: topMonth[0] })}><span class="num">${S.MONTHS[topMonth[0]]}</span><span class="lbl">häufigster Monat (${topMonth[1]}×)</span></div>
    <div class="fact clickable"${go({ season: topSeason[0] })}><span class="num">${topSeason[0]}</span><span class="lbl">Saison mit den meisten Spielen (${topSeason[1]})</span></div>
    <div class="fact clickable"${go({ year: topYear[0] })}><span class="num">${topYear[0]}</span><span class="lbl">Kalenderjahr mit den meisten Spielen (${topYear[1]})</span></div>
  </div>
  <div class="grid grid-2" style="margin-top:14px">
    <div class="card"><h3>Häufigste Daten</h3><p class="section-sub">Tag & Monat, über alle Jahre</p>${hbars(dm.slice(0, 12), { to: (k) => ({ day: k }) })}</div>
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
  const single = (id, labels, data, label, onPick) => chart(id, {
    type: 'bar', data: { labels, datasets: [{ label, data, backgroundColor: green, ...barDefaults }] },
    options: { plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { ticks: { precision: 0 } } } },
  }, onPick);
  const wdOrder = [1, 2, 3, 4, 5, 6, 0];
  single('ch-wd', ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'], wdOrder.map((d) => cal.weekday.get(d) || 0), 'Spiele', (i) => goGames({ wd: wdOrder[i] }));
  single('ch-month', S.MONTHS.map((m) => m.slice(0, 3)), S.MONTHS.map((_, i) => cal.month.get(i) || 0), 'Spiele', (i) => goGames({ month: i }));
  const years = [...cal.year.keys()].sort();
  const allYears = []; for (let y = years[0]; y <= years.at(-1); y++) allYears.push(y);
  single('ch-year', allYears, allYears.map((y) => cal.year.get(y) || 0), 'Spiele', (i) => goGames({ year: allYears[i] }));
  const ages = [...cal.age.keys()].filter((a) => a != null && !Number.isNaN(a)).sort((a, b) => a - b);
  const allAges = []; for (let a = ages[0]; a <= ages.at(-1); a++) allAges.push(a);
  single('ch-age', allAges.map((a) => `${a}`), allAges.map((a) => cal.age.get(a) || 0), 'Spiele', (i) => goGames({ age: allAges[i] }));
  const seasons = S.bySeason(state.games);
  chart('ch-ppg', {
    type: 'line',
    data: { labels: seasons.map((s) => s.season.replace(/^20(\d\d)\/20(\d\d)$/, '$1/$2')),
      datasets: [{ label: 'Punkte pro Spiel', data: seasons.map((s) => +s.ppg.toFixed(2)), borderColor: green, backgroundColor: green, borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, tension: .25 }] },
    options: { plugins: { legend: { display: false }, tooltip: { callbacks: { afterLabel: (i) => { const s = seasons[i.dataIndex]; return `${s.n} Spiele · ${s.S}-${s.U}-${s.N}`; } } } },
      scales: { x: { grid: { display: false } }, y: { min: 0, max: 3 } } },
  }, (i) => goGames({ season: seasons[i].season }));
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
      <li>Mehrere Tore mit Elfer: <code>Ailton (3, FE)</code> = 3 Tore, davon 1 Foulelfmeter · <code>Ailton (3, 2 FE)</code> = davon 2 Foulelfmeter · gemischt: <code>(3, FE, HE)</code>.</li>
      <li>Excel speichern, oben auf den <b>Upload-Pfeil</b> klicken, Vorschau prüfen und „Hochladen“ – nach ca. 1 Minute ist die Seite überall aktuell.</li>
    </ol></div>`;
}

// ---------- Spiel-Dialog ----------
function openGame(key) {
  const [kind, row] = key.split(':');
  const g = (kind === 'extra' ? state.allExtra : state.allGames).find((x) => String(x.row) === row);
  if (!g) return;
  const side = (homeSide) => g.scorers.filter((s) => (s.forWerder === g.werderHome) === homeSide);
  const li = (s) => `<li>${avatar(s.name, s.team, 34)}<span>${esc(fullName(s.name, s.team))}${s.n > 1 ? ` <b>(${s.n})</b>` : ''}${markLabels(s).map((t) => `<span class="tag" title="${{ ET: 'Eigentor', FE: 'Foulelfmeter', HE: 'Handelfmeter' }[t.slice(-2)]}${s.n > 1 && t.slice(-2) !== 'ET' ? ' (davon)' : ''}">${t}</span>`).join('')}</span></li>`;
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
  const [tab, query] = location.hash.replace(/^#\/?/, '').split('?');
  if (tab === 'spiele') state.gameFilter = Object.fromEntries(new URLSearchParams(query || ''));
  const [view, after] = routes[tab] || routes[''];
  if ($('#game-dialog').open) $('#game-dialog').close();
  state.charts.forEach((c) => c.destroy());
  state.charts = [];
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === (routes[tab] ? tab : '')));
  $('#view').innerHTML = view();
  after?.();
}

function goGames(filter) {
  const { tab, ...rest } = filter;
  if (tab) { location.hash = `#/${tab}`; return; }
  const qs = new URLSearchParams(Object.entries(rest).filter(([, v]) => v != null && v !== '')).toString();
  const target = `#/spiele${qs ? '?' + qs : ''}`;
  if (location.hash === target) render(); else location.hash = target;
  window.scrollTo(0, 0);
}

document.addEventListener('click', (e) => {
  const gEl = e.target.closest('[data-game]');
  if (gEl) return openGame(gEl.dataset.game);
  const goEl = e.target.closest('[data-go]');
  if (goEl) { e.preventDefault(); return goGames(Object.fromEntries(new URLSearchParams(goEl.dataset.go))); }
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
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[data-go], li[data-game]')) { e.preventDefault(); e.target.click(); }
});

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

// ---------- Excel aktualisieren (Upload zu GitHub) ----------
const upDlg = () => $('#upload-dialog');
const gameKey = (g) => `${+g.date}|${g.home}|${g.away}`;
let toastTimer;
function toast(html, ms = 6000) {
  const t = $('#toast');
  t.innerHTML = html;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
function openUpload(html) {
  $('#upload-body').innerHTML = html;
  if (!upDlg().open) upDlg().showModal();
}

function viewTokenSetup(msg = '') {
  const has = !!U.getToken();
  openUpload(`
    ${msg ? `<div class="msg err">${esc(msg)}</div>` : ''}
    <p>Zum Hochladen braucht das Dashboard einmalig einen <b>GitHub-Token</b>. Er wird nur in diesem Browser gespeichert.</p>
    <ol>
      <li><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Neuen Fine-grained Token anlegen</a> (bei GitHub eingeloggt als <b>${esc(U.REPO.split('/')[0])}</b>).</li>
      <li>Name z. B. „Werderspiele Upload“, Ablaufdatum nach Wunsch.</li>
      <li><b>Repository access:</b> „Only select repositories“ → <b>${esc(U.REPO)}</b>.</li>
      <li><b>Permissions → Repository → Contents:</b> „Read and write“.</li>
      <li>„Generate token“ klicken und den Token hier einfügen.</li>
    </ol>
    <label class="field"><span class="small muted">Token</span>
      <input type="password" id="token-input" autocomplete="off" spellcheck="false" placeholder="github_pat_…"></label>
    <div class="actions">
      <button class="btn primary" id="token-save">Speichern &amp; prüfen</button>
      ${has ? '<button class="btn" id="token-clear">Token entfernen</button>' : ''}
      ${U.canRemember() ? '<button class="btn link" id="file-forget">Gemerkte Datei vergessen</button>' : ''}
    </div>
    <p class="small muted" style="margin:12px 0 0">Status: Token ${has ? '<b>gespeichert</b>' : 'nicht gespeichert'} · <span id="file-status">${U.canRemember() ? 'Datei wird geprüft …' : 'Dieser Browser kann sich keine Datei merken (nur Chrome/Edge am PC).'}</span></p>`);
  if (U.canRemember()) U.rememberedName().then((n) => { const el = $('#file-status'); if (el) el.innerHTML = n ? `Gemerkte Datei: <b>${esc(n)}</b>` : 'Noch keine Datei gemerkt'; });
  $('#token-input').focus();
}

async function saveToken() {
  const input = $('#token-input'), btn = $('#token-save');
  btn.disabled = true;
  btn.textContent = 'Prüfe …';
  const res = await U.checkToken(input.value.trim());
  if (!res.ok) return viewTokenSetup(res.msg);
  U.setToken(input.value);
  openUpload(`<div class="msg ok"><b>Token gespeichert.</b> Ab jetzt reicht der Upload-Button oben.</div>
    <p>${U.canRemember()
      ? `Wähle jetzt einmalig deine Datei <b>„${esc(U.EXPECTED_NAME)}“</b> aus (z. B. in <code>B:\\!Altes C\\Dokumente</code>). Der Browser merkt sich den Ort.`
      : 'Wähle jetzt deine Excel-Datei aus.'}</p>
    <div class="actions"><button class="btn primary" id="pick-file">Datei auswählen</button></div>`);
}

const pickAgain = (msg) => openUpload(`<div class="msg err">${msg}</div>
  <div class="actions"><button class="btn primary" id="pick-file">Andere Datei wählen</button></div>`);

async function startUpload({ forcePick = false } = {}) {
  if (!U.getToken()) return viewTokenSetup();
  const btn = $('#upload-btn');
  let file;
  try {
    btn.classList.add('busy');
    file = await U.getFile({ forcePick });
  } catch (e) {
    console.error(e);
    return pickAgain(`Datei konnte nicht geöffnet werden: ${esc(e.message)}`);
  } finally {
    btn.classList.remove('busy');
  }
  if (!file) return;
  const buf = await file.arrayBuffer();
  let parsed;
  try { parsed = parseWorkbook(buf); } catch {
    return pickAgain(`„${esc(file.name)}“ ist keine lesbare Excel-Datei.`);
  }
  state.pendingUpload = { file, buf, parsed };
  viewPreview();
}

function viewPreview() {
  const p = state.pendingUpload, { file, parsed } = p;
  const oldByKey = new Map(state.allGames.map((g) => [gameKey(g), JSON.stringify(g.raw)]));
  const newKeys = new Set(parsed.allGames.map(gameKey));
  p.added = parsed.allGames.filter((g) => !oldByKey.has(gameKey(g)));
  const removed = state.allGames.filter((g) => !newKeys.has(gameKey(g)));
  const changed = parsed.allGames.filter((g) => oldByKey.has(gameKey(g)) && oldByKey.get(gameKey(g)) !== JSON.stringify(g.raw));
  const errs = [...parsed.issues, ...parsed.extraIssues].filter((i) => i.level !== 'info');
  const r = S.record(parsed.allGames);
  const min = Math.round((Date.now() - file.lastModified) / 6e4);
  const ageTxt = min < 60 ? `vor ${min} Min.` : min < 1440 ? `vor ${Math.round(min / 60)} Std.` : `am ${fmt(new Date(file.lastModified))}`;
  const anyChange = p.added.length || changed.length || removed.length;
  openUpload(`
    <p class="small muted" style="margin-bottom:10px">📄 <b>${esc(file.name)}</b> · gespeichert ${ageTxt}</p>
    ${U.fileNote ? `<div class="msg ${U.fileNote.startsWith('Es war noch') ? 'ok' : 'warn'}">${esc(U.fileNote)}</div>` : ''}
    ${file.name !== U.EXPECTED_NAME ? `<div class="msg warn">Der Dateiname weicht von „${esc(U.EXPECTED_NAME)}“ ab – richtige Datei?</div>` : ''}
    <div class="diff-grid">
      <div class="fact"><span class="num">${p.added.length}</span><span class="lbl">neue Spiele</span></div>
      <div class="fact"><span class="num">${changed.length}</span><span class="lbl">geänderte Zeilen</span></div>
      <div class="fact"><span class="num">${removed.length}</span><span class="lbl">entfernte Spiele</span></div>
    </div>
    ${p.added.length ? `<ul class="mini" style="margin-bottom:12px">${p.added.map((g) => (g.res && g.date
      ? miniGame(g, `Nr. ${g.nr ?? '–'}`)
      : `<li><span class="t">${esc(g.raw.spiel)}</span></li>`)).join('')}</ul>` : ''}
    <p class="small">Danach: <b>${parsed.allGames.length} Spiele</b> · ${r.S} S / ${r.U} U / ${r.N} N (inkl. Testspiele)</p>
    ${errs.length
      ? `<div class="msg warn"><b>Datencheck: ${errs.length} ${errs.length === 1 ? 'Auffälligkeit' : 'Auffälligkeiten'}</b><br>${errs.slice(0, 5).map((i) => `Nr. ${i.g.nr ?? '–'}: ${esc(i.msg)}`).join('<br>')}${errs.length > 5 ? '<br>…' : ''}</div>`
      : '<div class="msg ok">Datencheck: keine Fehler.</div>'}
    <div class="actions">
      <button class="btn primary" id="do-upload">${anyChange ? 'Hochladen' : 'Trotzdem hochladen'}</button>
      <button class="btn" id="pick-file">Andere Datei</button>
      <button class="btn link" id="open-settings">Einstellungen</button>
    </div>`);
}

async function doUpload() {
  const { buf, parsed, added } = state.pendingUpload;
  const btn = $('#do-upload');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Lade hoch …'; }
  const nrs = added.map((g) => g.nr).filter(Boolean);
  const msg = !nrs.length ? 'Excel aktualisiert'
    : `Excel aktualisiert: ${nrs.length === 1 ? `Spiel Nr. ${nrs[0]}` : `Spiele Nr. ${Math.min(...nrs)}–${Math.max(...nrs)}`}`;
  try {
    const res = await U.uploadExcel(buf, msg);
    ingest(parsed);
    render();
    state.pendingUpload = null;
    if (res.status === 'unchanged') {
      openUpload('<div class="msg ok"><b>Schon aktuell.</b> Auf GitHub liegt bereits genau diese Datei – nichts hochgeladen.</div>');
    } else {
      upDlg().close();
      toast(`✓ Hochgeladen. In ca. 1 Minute ist die Seite auf allen Geräten aktuell.${res.url ? ` <a href="${esc(res.url)}" target="_blank" rel="noopener">Commit ansehen</a>` : ''}`, 9000);
    }
  } catch (e) {
    console.error(e);
    openUpload(`<div class="msg err"><b>Hochladen fehlgeschlagen.</b><br>${esc(e.message)}</div>
      <div class="actions">${/Token/.test(e.message)
        ? '<button class="btn primary" id="open-settings">Token ändern</button>'
        : '<button class="btn primary" id="do-upload">Nochmal versuchen</button>'}</div>`);
  }
}

$('#upload-btn').addEventListener('click', () => startUpload());
$('#upload-dialog').addEventListener('click', async (e) => {
  if (e.target.id === 'upload-dialog') return e.target.close();
  const b = e.target.closest('button');
  switch (b?.id) {
    case 'token-save': return saveToken();
    case 'token-clear': U.clearToken(); return viewTokenSetup();
    case 'file-forget': await U.forgetFile(); b.textContent = 'Vergessen ✓'; return;
    case 'pick-file': return startUpload({ forcePick: true });
    case 'open-settings': return viewTokenSetup();
    case 'do-upload': return doUpload();
  }
});
$('#upload-dialog').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'token-input') { e.preventDefault(); saveToken(); }
});

// ---------- Testspiele ----------
const isFriendly = (g) => /friendly|testspiel|abschied/i.test(g.comp);

// Setzt state.games/state.extra je nach Haken "Testspiele einbeziehen" und aktualisiert den Header.
function applyFriendlyFilter() {
  const keep = (g) => state.withFriendlies || !isFriendly(g);
  state.games = state.allGames.filter(keep);
  state.extra = state.allExtra.filter(keep);
  state.hiddenFriendlies = state.allGames.length - state.games.length;
  // Filter im Spiele-Tab, die es in der neuen Auswahl nicht mehr gibt, zurücksetzen
  const f = state.gameFilter;
  if (f.comp && !state.games.some((g) => g.comp === f.comp)) delete f.comp;
  if (f.opp && !state.games.some((g) => g.opp === f.opp)) delete f.opp;
  if (f.stadium && !state.games.some((g) => g.stadium === f.stadium)) delete f.stadium;
  if (f.season && !state.games.some((g) => g.season === f.season)) delete f.season;
  renderHeader();
}

function renderHeader() {
  const r = S.record(state.games);
  const nFriendly = state.allGames.filter(isFriendly).length;
  $('#hero-sub').textContent = `Dennis Mulert · ${state.allGames.length} Spiele im Stadion seit ${state.allGames[0]?.date?.getFullYear() ?? ''}`;
  $('#hero-record').innerHTML = `<a class="chip" href="#/spiele?outcome=S"><b>${r.S}</b>Siege</a><a class="chip" href="#/spiele?outcome=U"><b>${r.U}</b>Remis</a><a class="chip" href="#/spiele?outcome=N"><b>${r.N}</b>Niederlagen</a><a class="chip" href="#/spiele"><b>${r.gf}:${r.ga}</b>Tore</a>
    <label class="chip toggle"><input type="checkbox" id="toggle-friendlies" ${state.withFriendlies ? 'checked' : ''}> inkl. ${nFriendly} Testspiele</label>`;
}

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

// Excel-Inhalt parsen und prüfen, ohne den State zu verändern (auch für die Upload-Vorschau)
function parseWorkbook(buf) {
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const mainName = wb.SheetNames.find((n) => /haupt/i.test(n)) || wb.SheetNames[0];
  const extraName = wb.SheetNames.find((n) => /u23|all ?stars/i.test(n));
  const ctx = { clubs: state.clubs, stadiums: state.stadiums };
  const allGames = parseSheet(wb.Sheets[mainName], { ...ctx, kind: 'main' });
  const allExtra = extraName ? parseSheet(wb.Sheets[extraName], { ...ctx, kind: 'extra' }) : [];
  return {
    allGames, allExtra,
    issues: validate(allGames, { clubs: state.clubs, players: state.players, kind: 'main' }),
    extraIssues: validate(allExtra, { clubs: state.clubs, players: state.players, kind: 'extra' }).filter((i) => i.level !== 'info'),
  };
}

// Geparste Daten übernehmen: State, Header, Datencheck-Badge, Fußzeile
function ingest(parsed) {
  Object.assign(state, parsed);
  applyFriendlyFilter();
  const last = state.allGames.at(-1);
  const nErr = [...state.issues, ...state.extraIssues].filter((i) => i.level !== 'info').length;
  const badge = $('#check-badge');
  badge.hidden = false;
  badge.textContent = nErr || '✓';
  badge.classList.toggle('ok', !nErr);
  $('#foot').innerHTML = `Letztes Spiel: ${fmt(last?.date)} · Daten aus <code>${DATA_URL}</code> · Logos &amp; Fotos: Wikipedia/Wikimedia Commons · privates, nicht-kommerzielles Projekt`;
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
    try { state.withFriendlies = localStorage.getItem('withFriendlies') === '1'; } catch { /* ohne Storage */ }
    ingest(parseWorkbook(buf));
    window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
    $('#hero-record').addEventListener('change', (e) => {
      if (e.target.id !== 'toggle-friendlies') return;
      state.withFriendlies = e.target.checked;
      try { localStorage.setItem('withFriendlies', state.withFriendlies ? '1' : '0'); } catch { /* egal */ }
      applyFriendlyFilter();
      render();
    });
    render();
  } catch (err) {
    console.error(err);
    $('#view').innerHTML = `<div class="error-box"><b>Daten konnten nicht geladen werden.</b><br>${esc(err.message)}<br><span class="small muted">Tipp: Lokal über einen Webserver öffnen (z. B. <code>python -m http.server</code>), nicht per Doppelklick.</span></div>`;
  }
}
load();
