// Reine Statistik-Funktionen über die geparsten Spiele.

export const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
export const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

export const countBy = (arr, fn) => {
  const m = new Map();
  for (const x of arr) {
    const k = fn(x);
    if (k == null) continue;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
};
export const sortedEntries = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]);

export function record(games) {
  const r = { n: games.length, S: 0, U: 0, N: 0, gf: 0, ga: 0 };
  for (const g of games) {
    if (g.outcome) r[g.outcome]++;
    r.gf += g.gf || 0;
    r.ga += g.ga || 0;
  }
  r.pts = r.S * 3 + r.U;
  r.ppg = r.n ? r.pts / r.n : 0;
  r.winPct = r.n ? (r.S / r.n) * 100 : 0;
  r.diff = r.gf - r.ga;
  return r;
}

export function groupBy(games, fn) {
  const m = new Map();
  for (const g of games) {
    const k = fn(g);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(g);
  }
  return m;
}

// Spieler-Identität: aufgelöster Wikipedia-Titel, sonst Name@Team
export function playerKey(s, players) {
  const p = players.lookup(s.name, s.team);
  return p?.wiki || `${s.name}@${s.team}`;
}

export function topScorers(games, players, { werder }) {
  const m = new Map();
  for (const g of games) for (const s of g.scorers) {
    if (s.own || s.forWerder !== werder) continue;
    const key = playerKey(s, players);
    if (!m.has(key)) m.set(key, { key, name: s.name, team: s.team, teams: new Set(), goals: 0, games: new Set(), pens: 0, hattricks: 0, first: g, last: g });
    const e = m.get(key);
    e.goals += s.n;
    e.games.add(g);
    e.teams.add(s.team);
    if (s.pen) e.pens++;
    if (s.n >= 3) e.hattricks++;
    e.last = g;
  }
  return [...m.values()].sort((a, b) => b.goals - a.goals || a.games.size - b.games.size);
}

export function streaks(games) {
  const best = { win: [], unbeaten: [], winless: [], loss: [], scoring: [], cleanSheet: [] };
  const cur = { win: [], unbeaten: [], winless: [], loss: [], scoring: [], cleanSheet: [] };
  const tests = {
    win: (g) => g.outcome === 'S',
    unbeaten: (g) => g.outcome !== 'N',
    winless: (g) => g.outcome !== 'S',
    loss: (g) => g.outcome === 'N',
    scoring: (g) => g.gf > 0,
    cleanSheet: (g) => g.ga === 0,
  };
  for (const g of games) {
    for (const k of Object.keys(tests)) {
      if (tests[k](g)) {
        cur[k].push(g);
        if (cur[k].length > best[k].length) best[k] = [...cur[k]];
      } else cur[k] = [];
    }
  }
  return { best, current: cur };
}

export function records(games) {
  const withRes = games.filter((g) => g.res);
  const by = (fn) => [...withRes].sort(fn);
  const margin = (g) => g.gf - g.ga;
  const total = (g) => g.gf + g.ga;
  return {
    biggestWins: by((a, b) => margin(b) - margin(a) || b.gf - a.gf).filter((g) => margin(g) > 0).slice(0, 5),
    biggestLosses: by((a, b) => margin(a) - margin(b) || b.ga - a.ga).filter((g) => margin(g) < 0).slice(0, 5),
    mostGoals: by((a, b) => total(b) - total(a)).slice(0, 5),
    turnarounds: withRes.filter((g) => g.htf != null && g.htf < g.hta && g.outcome === 'S'),
    thrownAway: withRes.filter((g) => g.htf != null && g.htf > g.hta && g.outcome === 'N'),
    cleanSheets: withRes.filter((g) => g.ga === 0).length,
    failedToScore: withRes.filter((g) => g.gf === 0).length,
    goalless: withRes.filter((g) => g.gf === 0 && g.ga === 0).length,
  };
}

export function scorelines(games) {
  // aus Werder-Sicht, z. B. "2:1"
  return sortedEntries(countBy(games.filter((g) => g.res), (g) => `${g.gf}:${g.ga}`));
}

export function calendar(games) {
  const dated = games.filter((g) => g.date);
  const dayMonth = sortedEntries(countBy(dated, (g) => `${String(g.date.getDate()).padStart(2, '0')}.${String(g.date.getMonth() + 1).padStart(2, '0')}.`));
  const weekday = countBy(dated, (g) => g.date.getDay());
  const month = countBy(dated, (g) => g.date.getMonth());
  const year = countBy(dated, (g) => g.date.getFullYear());
  const season = countBy(games, (g) => g.season);
  const age = countBy(games, (g) => g.age);
  // Spiele im selben Kalendermonat/Tag in verschiedenen Jahren
  return { dayMonth, weekday, month, year, season, age };
}

export function goalStats(games) {
  let own = { forW: 0, againstW: 0 }, pens = { forW: 0, againstW: 0 }, hattricks = [];
  for (const g of games) for (const s of g.scorers) {
    if (s.own) s.forWerder ? own.forW += s.n : own.againstW += s.n;
    if (s.pen) s.forWerder ? pens.forW++ : pens.againstW++;
    if (s.n >= 3 && !s.own) hattricks.push({ g, s });
  }
  return { own, pens, hattricks };
}

export function opponents(games) {
  const m = groupBy(games, (g) => g.opp);
  return [...m.entries()].map(([opp, gs]) => {
    const r = record(gs);
    r.opp = opp;
    r.games = gs;
    r.H = gs.filter((g) => g.venue === 'H').length;
    r.A = gs.filter((g) => g.venue === 'A').length;
    r.Nv = gs.filter((g) => g.venue === 'N').length;
    r.comps = countBy(gs, (g) => g.comp);
    return r;
  }).sort((a, b) => b.n - a.n || b.ppg - a.ppg);
}

export function stadiums(games) {
  const m = groupBy(games, (g) => g.stadium);
  return [...m.entries()].map(([name, gs]) => {
    const r = record(gs);
    r.name = name;
    r.games = gs;
    r.names = new Set(gs.map((g) => g.stadiumRaw));
    return r;
  }).sort((a, b) => b.n - a.n);
}

export function bySeason(games) {
  const m = groupBy(games, (g) => g.season);
  return [...m.entries()].map(([season, gs]) => {
    const r = record(gs);
    r.season = season;
    r.games = gs;
    return r;
  }).sort((a, b) => a.season.localeCompare(b.season));
}

export function topScorerPerSeason(games, players) {
  return bySeason(games).map((s) => {
    const top = topScorers(s.games, players, { werder: true });
    const max = top[0]?.goals || 0;
    return { season: s.season, goals: max, players: top.filter((t) => t.goals === max && max > 0) };
  });
}
