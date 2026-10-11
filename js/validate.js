// Datencheck: findet Unstimmigkeiten in der Excel. Jede Meldung: {level: 'error'|'warn'|'info', game, msg}

export function validate(games, { clubs, players, kind = 'main' }) {
  const out = [];
  const add = (level, g, msg) => out.push({ level, g, msg });
  const seen = new Map();
  let prev = null;
  let bdLo = null, bdHi = null; // Fenster für Geburtstag (aus Alter + Datum)

  for (const g of games) {
    const r = g.raw;
    if (!g.date) add('error', g, `Datum „${r.datum}“ nicht lesbar (Format TT.MM.JJ)`);
    if (!g.res) add('error', g, `Ergebnis „${r.ergebnis}“ nicht lesbar (Format 2:1 (1:0))`);
    if (!g.isWerderGame && kind === 'main') add('error', g, `Kein Werder-Team in „${r.spiel}“ (Format „Heim - Gast“)`);
    if (kind === 'main' && !String(r.spiel).includes(' - ')) add('error', g, 'Spiel ohne „ - “ zwischen Heim und Gast');

    // Nummerierung & Reihenfolge
    if (prev) {
      if (g.nr && prev.nr && g.nr !== prev.nr + 1) add('warn', g, `Nr. springt von ${prev.nr} auf ${g.nr}`);
      if (g.date && prev.date && g.date < prev.date) add('warn', g, `Datum liegt vor dem vorherigen Spiel (${fmt(prev.date)})`);
    }
    prev = g;

    // Saison passt zum Datum (Saison läuft ca. Juni bis Juni)
    if (g.date && /^\d{4}\/\d{4}$/.test(g.season)) {
      const y = +g.season.slice(0, 4), d = g.date;
      const ok = (d.getFullYear() === y && d.getMonth() >= 5) || (d.getFullYear() === y + 1 && d.getMonth() <= 6);
      if (!ok) add('error', g, `Saison ${g.season} passt nicht zum Datum ${fmt(d)}`);
    } else if (g.season) add('warn', g, `Saison „${g.season}“ nicht im Format JJJJ/JJJJ`);

    // Duplikate
    if (g.date) {
      const k = `${+g.date}|${g.home}|${g.away}`;
      if (seen.has(k)) add('error', g, `Doppelter Eintrag (wie Nr. ${seen.get(k).nr})`);
      seen.set(k, g);
    }

    // Torschützen vs. Ergebnis
    if (g.res && kind === 'main') {
      if (g.scorerSideIssue) add('error', g, g.scorerSideIssue);
      else {
        const sh = g.scorers.filter((s) => s.forWerder === g.werderHome).reduce((a, s) => a + s.n, 0);
        const sa = g.scorers.filter((s) => s.forWerder !== g.werderHome).reduce((a, s) => a + s.n, 0);
        if (sh !== g.res.home || sa !== g.res.away)
          add('error', g, `Torschützen ergeben ${sh}:${sa}, Ergebnis ist ${g.res.home}:${g.res.away}`);
      }
      if (g.res.ht && (g.res.ht.home > g.res.home || g.res.ht.away > g.res.away))
        add('error', g, 'Halbzeitstand höher als Endstand');
      if (!g.res.ht && g.res.home + g.res.away > 0) add('info', g, 'Kein Halbzeitstand angegeben');
      for (const s of g.scorers) {
        if (s.unknownTags.length) add('warn', g, `Unbekannte Markierung „(${s.unknownTags.join(', ')})“ bei ${s.name} (erlaubt: Zahl, ET, FE, HE)`);
        if (/[.;]/.test(s.name.replace(/^[A-ZÄÖÜ]\.\s/, ''))) add('warn', g, `Verdächtiges Zeichen im Namen „${s.name}“ (Komma vergessen?)`);
        // "Bartels Kruse": zwei großgeschriebene Wörter, keine Initiale, nicht als Spieler bekannt
        const words = s.name.replace(/^[A-ZÄÖÜ]\.\s/, '').split(/\s+/);
        if (words.length >= 2 && words.every((w) => /^[A-ZÄÖÜ]/.test(w)) && !players.lookup(s.name, s.team)?.wiki)
          add('warn', g, `„${s.name}“: evtl. zwei Namen ohne Komma?`);
      }
    }

    // Alter konsistent? Geburtstag liegt in (Datum - (Alter+1) Jahre, Datum - Alter Jahre]
    if (g.date && g.age != null && !Number.isNaN(g.age)) {
      const lo = new Date(g.date); lo.setFullYear(lo.getFullYear() - g.age - 1); lo.setDate(lo.getDate() + 1);
      const hi = new Date(g.date); hi.setFullYear(hi.getFullYear() - g.age);
      const nLo = bdLo && lo < bdLo ? bdLo : lo, nHi = bdHi && hi > bdHi ? bdHi : hi;
      if (nLo > nHi) add('warn', g, `Alter ${g.age} passt nicht zu den übrigen Altersangaben`);
      else { bdLo = nLo; bdHi = nHi; }
    }

    // Vereine bekannt (für Logo)?
    for (const t of [g.home, g.away]) {
      if (t && !/^Werder/.test(t) && !clubs[t]) add('info', g, `Verein „${t}“ fehlt in data/clubs.json (kein Logo)`);
    }
  }

  // Spieler ohne Zuordnung (kein Foto) – einmal je Name
  if (kind === 'main') {
    const missing = new Map();
    for (const g of games) for (const s of g.scorers) {
      if (!players.lookup(s.name, s.team)) {
        const k = `${s.name}@${s.team}`;
        if (!missing.has(k)) missing.set(k, g);
      }
    }
    for (const [k, g] of missing) add('info', g, `Spieler „${k.replace('@', '“ (')}) ohne Eintrag in data/players.json`);
  }
  return out;
}

export const fmt = (d) => d ? `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}` : '–';
