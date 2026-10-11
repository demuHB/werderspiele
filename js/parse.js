// Liest die Excel (SheetJS) und macht aus jeder Zeile ein strukturiertes Spiel-Objekt.
// Spalten: A Nr | B Datum | C Saison | D Wettbewerb | E Sptg | F Spiel | G Stadion | H Ergebnis | I Torschützen | J Alter

export const isWerder = (name) => /^Werder\b/.test(name || '');

const MARKERS = ['ET', 'FE', 'HE'];

export function parseDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return new Date(v.getFullYear(), v.getMonth(), v.getDate());
  if (typeof v === 'number') { // Excel-Seriennummer
    const d = new Date(Math.round((v - 25569) * 864e5));
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  const m = String(v).trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/);
  if (!m) return null;
  let y = +m[3];
  if (y < 100) y += y < 70 ? 2000 : 1900;
  return new Date(y, +m[2] - 1, +m[1]);
}

export function parseResult(s) {
  s = String(s ?? '').trim();
  const m = s.match(/^(\d+)\s*:\s*(\d+)/);
  if (!m) return null;
  const r = { home: +m[1], away: +m[2], ht: null, pens: null };
  const p = s.match(/,\s*(\d+)\s*:\s*(\d+)\s*n\.\s*E\./i);
  if (p) r.pens = { home: +p[1], away: +p[2] };
  const h = s.match(/\((\d+)\s*:\s*(\d+)\)/);
  if (h) r.ht = { home: +h[1], away: +h[2] };
  return r;
}

// "Pizarro (2), Kruse (FE), Naldo (ET)" -> [{name, n, own, pen}]
export function parseScorerList(txt) {
  const out = [];
  for (let p of String(txt || '').split(',')) {
    p = p.trim();
    if (!p || p === '/' || p === '*') continue;
    const tags = [...p.matchAll(/\(([^)]*)\)/g)].map((m) => m[1].trim());
    const name = p.replace(/\s*\([^)]*\)/g, '').trim();
    let n = 1;
    for (const t of tags) if (/^\d+$/.test(t)) n = +t;
    out.push({
      name, n,
      own: tags.includes('ET'),
      pen: tags.includes('FE') || tags.includes('HE'),
      tags: tags.filter((t) => MARKERS.includes(t)),
      unknownTags: tags.filter((t) => !/^\d+$/.test(t) && !MARKERS.includes(t)),
    });
  }
  return out;
}

function splitTeams(f) {
  const parts = String(f || '').split(' - ').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  return { home: parts[0], away: parts.slice(1).join(' - ') };
}

function normRound(e) {
  const s = String(e ?? '').trim();
  return s.replace(/^(\d)\.\s*R$/, '$1. R');
}

export function parseSheet(ws, { clubs, stadiums, kind }) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  const alias = {};
  for (const [k, v] of Object.entries(clubs)) for (const a of v.aliases || []) alias[a] = k;
  const games = [];
  rows.forEach((r, i) => {
    if (i < 4) return;
    const [nr, datum, saison, wettbewerb, sptg, spiel, stadion, ergebnis, scorers, alter] = r;
    if (!String(spiel).trim()) return;
    const raw = { nr, datum, saison, wettbewerb, sptg, spiel, stadion, ergebnis, scorers, alter, row: i + 1 };
    const t = splitTeams(spiel);
    const home = t ? alias[t.home] || t.home : String(spiel);
    const away = t ? alias[t.away] || t.away : '';
    const werderHome = isWerder(home);
    const werderAway = !werderHome && isWerder(away);
    const res = parseResult(ergebnis);
    const g = {
      kind, raw, row: i + 1,
      nr: +nr || null,
      date: parseDate(datum),
      season: String(saison).trim(),
      comp: String(wettbewerb).trim(),
      round: normRound(sptg),
      home, away,
      werderHome,
      isWerderGame: werderHome || werderAway,
      opp: werderHome ? away : home,
      stadiumRaw: String(stadion).trim().replace(/\s+/g, ' '),
      res,
      age: alter === '' ? null : +alter,
      scorers: [],
      scorerSideIssue: null,
    };
    g.stadium = stadiums[g.stadiumRaw] || g.stadiumRaw;
    // H = Werder als Heimteam, A = als Gast, N = Endspiel auf neutralem Platz
    g.venue = g.round === 'FIN' ? 'N' : werderHome ? 'H' : 'A';

    if (res) {
      const w = werderHome ? res.home : res.away;
      const o = werderHome ? res.away : res.home;
      g.gf = w; g.ga = o;
      let outcome = w > o ? 'S' : w < o ? 'N' : 'U';
      if (outcome === 'U' && res.pens) {
        const pw = werderHome ? res.pens.home : res.pens.away;
        const po = werderHome ? res.pens.away : res.pens.home;
        outcome = pw > po ? 'S' : 'N';
        g.decidedByPens = true;
      }
      g.outcome = outcome;
      if (res.ht) { g.htf = werderHome ? res.ht.home : res.ht.away; g.hta = werderHome ? res.ht.away : res.ht.home; }
    }

    // Torschützen: "Heim-Schützen - Gast-Schützen"; nur eine Liste -> Seite, die getroffen hat
    const sc = String(scorers || '').trim();
    if (sc && sc !== '/') {
      let parts = sc.split(/\s+-\s+/);
      if (parts.length === 1 && res) {
        if (res.away === 0) parts = [parts[0], ''];
        else if (res.home === 0) parts = ['', parts[0]];
        else g.scorerSideIssue = 'Nur eine Torschützen-Liste, aber beide Teams haben getroffen';
      }
      if (parts.length > 2) parts = [parts[0], parts.slice(1).join(', ')];
      parts.forEach((txt, side) => {
        const forWerder = (side === 0) === werderHome;
        for (const s of parseScorerList(txt)) {
          // Spieler-Verein: bei Eigentor die andere Seite
          const playerWerder = forWerder !== s.own;
          g.scorers.push({ ...s, forWerder, playerWerder, team: playerWerder ? 'Werder' : g.opp });
        }
      });
    }
    games.push(g);
  });
  return games;
}
