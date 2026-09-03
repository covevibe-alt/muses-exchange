/*
 * Scoring tests for the Champions League pool.
 *
 *   node ucl/scoring.test.mjs
 *
 * The app is a single self-contained HTML file, so there's nothing to import:
 * this pulls the module script out of index.html, keeps everything above the
 * rendering section (which is the pure scoring/parsing half), stubs the three
 * browser globals it touches at load time, and imports that.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');
const js = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const MARK = '/* \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 rendering \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550 */';
const cut = js.indexOf(MARK);
if (cut < 0) throw new Error('could not find the rendering marker in index.html');

const stub = `const location = { origin: 'http://test', pathname: '/' };
globalThis.document = { hidden: true, querySelector: () => null };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
`;
const exports = `
export { state, SCORING, MULT, TIE_BONUS, matchTier, matchPoints, multOf, buildTies,
         tieAgg, tieWinnerId, tieBonus, tieOfSecondLeg, leagueRows, playerTotals,
         finalMethodBonus, parseEspnEvent, stageFromText, stageFromDate, legFromText,
         matchdayFromText, officialLeagueWinner, finalSides, normName };
`;
const tmp = path.join(os.tmpdir(), `ucl-core-${process.pid}.mjs`);
fs.writeFileSync(tmp, stub + js.slice(0, cut) + exports);
const C = await import(pathToFileURL(tmp).href);
fs.unlinkSync(tmp);

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; } else { fail++; console.log(`  ✗ ${label}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`); }
};

/* ── 1. stage / leg parsing ─────────────────────────────────────────── */
console.log('\n1. Stage + leg detection from feed labels');
eq('quarterfinals is QF not FINAL', C.stageFromText('UEFA Champions League - Quarterfinals, Leg 1'), 'QF');
eq('semifinals is SF not FINAL',    C.stageFromText('Semifinals - Leg 2'), 'SF');
eq('the final is FINAL',            C.stageFromText('UEFA Champions League - Final'), 'FINAL');
eq('round of 16',                   C.stageFromText('Round of 16 - Leg 1'), 'R16');
eq('knockout play-off',             C.stageFromText('Knockout Phase Play-offs, Leg 2'), 'PO');
eq('league phase matchday',         C.stageFromText('League Phase: Matchday 3'), 'LEAGUE');
eq('unknown falls through to null', C.stageFromText('something else entirely'), null);
eq('leg 1', C.legFromText('Round of 16 - Leg 1'), 1);
eq('leg 2', C.legFromText('Quarterfinals, 2nd Leg'), 2);
eq('no leg', C.legFromText('Final'), null);
eq('matchday 7', C.matchdayFromText('League Phase: Matchday 7'), 7);
eq('date fallback: october is league phase', C.stageFromDate('2026-10-21T19:00:00Z'), 'LEAGUE');
eq('date fallback: february is play-offs',   C.stageFromDate('2027-02-17T20:00:00Z'), 'PO');
eq('date fallback: late may is the final',   C.stageFromDate('2027-05-29T19:00:00Z'), 'FINAL');

/* ── 2. ESPN event parsing ──────────────────────────────────────────── */
console.log('2. ESPN event parsing');
const ev = {
  id: '700123', date: '2027-03-10T20:00Z',
  competitions: [{
    notes: [{ headline: 'UEFA Champions League - Round of 16, Leg 1' }],
    venue: { fullName: 'Emirates Stadium', address: { city: 'London' } },
    competitors: [
      { homeAway: 'home', score: '2', winner: true,  team: { id: '359', displayName: 'Arsenal', shortDisplayName: 'Arsenal', abbreviation: 'ARS', logo: 'http://x/ars.png' } },
      { homeAway: 'away', score: '0', winner: false, team: { id: '86',  displayName: 'Real Madrid', shortDisplayName: 'Real Madrid', abbreviation: 'RMA', logo: 'http://x/rma.png' } },
    ],
    status: { type: { completed: true, state: 'post', name: 'STATUS_FULL_TIME' } },
    details: [
      { scoringPlay: true,  ownGoal: false, athletesInvolved: [{ displayName: 'Bukayo Saka' }] },
      { scoringPlay: true,  ownGoal: true,  athletesInvolved: [{ displayName: 'Own Goaler' }] },
      { scoringPlay: false, ownGoal: false, athletesInvolved: [{ displayName: 'Not A Goal' }] },
    ],
  }],
};
const p = C.parseEspnEvent(ev);
eq('id',        p.id, '700123');
eq('stage',     p.stage, 'R16');
eq('leg',       p.leg, 1);
eq('teams',     [p.home.name, p.away.name], ['Arsenal', 'Real Madrid']);
eq('score',     [p.hs, p.as], [2, 0]);
eq('completed', p.completed, true);
eq('advances',  p.advances, 'home');
eq('venue',     `${p.venue} ${p.city}`, 'Emirates Stadium London');
eq('own goals + non-goals excluded from scorers', p.scorers, [{ n: 'Bukayo Saka' }]);
eq('decidedBy regular', p.decidedBy, 'REGULAR');

/* ── 3. build a season and check the scoring ────────────────────────── */
console.log('3. Match points and round multipliers');
const T = (id, name) => ({ id, name, abbr: name.slice(0, 3).toUpperCase(), logo: '' });
const ARS = T('1', 'Arsenal'), BAY = T('2', 'Bayern'), RMA = T('3', 'Real'), INT = T('4', 'Inter');
const M = (o) => ({ state: 'post', completed: true, so: null, winner: null, advances: null,
                    decidedBy: null, scorers: null, venue: '', city: '', leg: null, matchday: null, ...o });
C.state.matches = [
  M({ id: 'l1', date: '2026-09-16T19:00Z', stage: 'LEAGUE', matchday: 1, home: ARS, away: BAY, hs: 2, as: 1, winner: 'home' }),
  M({ id: 'l2', date: '2026-09-16T19:00Z', stage: 'LEAGUE', matchday: 1, home: RMA, away: INT, hs: 0, as: 0, winner: 'draw' }),
  M({ id: 'l3', date: '2026-09-30T19:00Z', stage: 'LEAGUE', matchday: 2, home: BAY, away: RMA, hs: 1, as: 3, winner: 'away' }),
  // R16 tie: Arsenal 2-0 Real, then Real 1-0 Arsenal -> Arsenal through 2-1
  M({ id: 'k1', date: '2027-03-10T20:00Z', stage: 'R16', leg: 1, home: ARS, away: RMA, hs: 2, as: 0, winner: 'home', advances: 'home' }),
  M({ id: 'k2', date: '2027-03-17T20:00Z', stage: 'R16', leg: 2, home: RMA, away: ARS, hs: 1, as: 0, winner: 'home', advances: 'away' }),
  // Final: 1-1, Arsenal win on penalties
  M({ id: 'f1', date: '2027-05-29T19:00Z', stage: 'FINAL', home: ARS, away: INT, hs: 1, as: 1,
      winner: 'draw', advances: 'home', so: { h: 4, a: 2 }, decidedBy: 'PENS' }),
];
C.buildTies();
C.state.dbMatches = new Map();
C.state.settings = new Map();

const byId = (id) => C.state.matches.find((m) => m.id === id);
eq('league match ×1: exact = 5',        C.matchPoints({ h: 2, a: 1 }, byId('l1')), 5);
eq('league match ×1: goal diff = 3',    C.matchPoints({ h: 3, a: 2 }, byId('l1')), 3);
eq('league match ×1: winner only = 2',  C.matchPoints({ h: 4, a: 1 }, byId('l1')), 2);
eq('league match ×1: wrong = 0',        C.matchPoints({ h: 0, a: 1 }, byId('l1')), 0);
eq('called draw, wrong score, = 3',     C.matchPoints({ h: 1, a: 1 }, byId('l2')), 3);
eq('R16 ×2: exact = 10',                C.matchPoints({ h: 2, a: 0 }, byId('k1')), 10);
eq('FINAL ×5: exact = 25',              C.matchPoints({ h: 1, a: 1 }, byId('f1')), 25);
eq('FINAL ×5: called the draw = 15',    C.matchPoints({ h: 2, a: 2 }, byId('f1')), 15);
eq('FINAL ×5: backed a winner in a drawn final = 0', C.matchPoints({ h: 3, a: 0 }, byId('f1')), 0);
eq('unfinished match scores null',      C.matchPoints({ h: 1, a: 1 }, { ...byId('l1'), completed: false }), null);

console.log('4. Two-legged ties');
const tie = [...C.state.ties.values()].find((t) => t.stage === 'R16');
eq('tie found and paired into 2 legs',  tie.legs.map((m) => m.id), ['k1', 'k2']);
eq('aggregate is 2-1 to Arsenal',       [C.tieAgg(tie).a, C.tieAgg(tie).b], [2, 1]);
eq('Arsenal go through',                C.tieWinnerId(tie), '1');
eq('second leg carries the pick',       C.tieOfSecondLeg(byId('k2'))?.key, tie.key);
eq('first leg carries no pick',         C.tieOfSecondLeg(byId('k1')), null);
// leg 2 is Real (home) v Arsenal (away), so picking Arsenal = 'away'
eq('right tie pick scores +4',          C.tieBonus(tie, { advances: 'away' }), C.TIE_BONUS.R16);
eq('wrong tie pick scores 0',           C.tieBonus(tie, { advances: 'home' }), 0);
eq('no pick scores null',               C.tieBonus(tie, {}), null);

console.log('5. The final: method and shootout');
const F = byId('f1');
eq('called penalties = +5',                 C.finalMethodBonus({ method: 'PENS' }, F), C.SCORING.method);
eq('penalties + right shootout = +8',       C.finalMethodBonus({ method: 'PENS', soPick: 'home' }, F), C.SCORING.method + C.SCORING.shootout);
eq('penalties + wrong shootout = +5',       C.finalMethodBonus({ method: 'PENS', soPick: 'away' }, F), C.SCORING.method);
eq('called 90 minutes = 0',                 C.finalMethodBonus({ method: 'REGULAR' }, F), 0);
eq('champion / runner-up read off the final', C.finalSides(), { champion: 'Arsenal', runnerUp: 'Inter' });

console.log('6. League phase table');
const rows = C.leagueRows();
eq('four teams in the table', rows.length, 4);
eq('order: Real 4, Arsenal 3, Inter 1, Bayern 0',
   rows.map((r) => `${r.team.name}:${r.pts}`), ['Real:4', 'Arsenal:3', 'Inter:1', 'Bayern:0']);
eq('Real GD +2, GF 3, GA 1', [rows[0].gf - rows[0].ga, rows[0].gf, rows[0].ga], [2, 3, 1]);
eq('league winner needs every league match played', C.officialLeagueWinner(), 'Real');

console.log('7. Full ranking, end to end');
C.state.players = [{ id: 'ann', name: 'Ann' }, { id: 'bob', name: 'Bob' }];
const preds = {
  // Ann: exact on l1 (6), called the draw on l2 (4), missed k2 (0) but called
  // Arsenal through (+4), exact final (30) + pens (5) + shootout (3) = 52
  ann: { l1: { h: 2, a: 1 }, l2: { h: 1, a: 1 }, k2: { h: 0, a: 1, advances: 'away' },
         f1: { h: 1, a: 1, method: 'PENS', soPick: 'home' } },
  // Bob: winner only on l1 (2), exact on k2 (12), wrong tie pick (0), backed a
  // winner in a drawn final (0), wrong method (0), Inter runner-up (+10) = 24
  bob: { l1: { h: 3, a: 0 }, k2: { h: 1, a: 0, advances: 'home' },
         f1: { h: 2, a: 0, method: 'REGULAR' } },
};
C.state.preds = new Map();
for (const [pid, byMatch] of Object.entries(preds)) {
  for (const [mid, v] of Object.entries(byMatch)) {
    if (!C.state.preds.has(mid)) C.state.preds.set(mid, []);
    C.state.preds.get(mid).push({ player_id: pid, ...v });
  }
}
C.state.finals = new Map([
  ['ann', { champion: 'Arsenal', league_winner: 'Real', top_scorer: 'Saka' }],   // +30 +10
  ['bob', { champion: 'Inter',   league_winner: 'Bayern', top_scorer: null }],   // +10 runner-up
]);
const { rows: lb } = C.playerTotals();
eq('Ann: 5+3+0+4+25+5+3 +30 +10 = 85', lb.find((r) => r.name === 'Ann').total, 85);
eq('Bob: 2+10+0+0+0 +10(runner-up) = 22', lb.find((r) => r.name === 'Bob').total, 22);
eq('Ann leads', lb[0].name, 'Ann');
eq('Ann exact count = 2 (l1, f1)', lb.find((r) => r.name === 'Ann').exacts, 2);
eq('champion hit flagged', lb.find((r) => r.name === 'Ann').champHit, true);
eq('runner-up flagged for Bob', lb.find((r) => r.name === 'Bob').runnerHit, true);
eq('league-phase winner hit for Ann', lb.find((r) => r.name === 'Ann').lgHit, true);

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
