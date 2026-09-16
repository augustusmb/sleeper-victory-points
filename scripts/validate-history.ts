/**
 * Validate the victory-point math against completed seasons.
 *
 * Walks back through `previous_league_id` and prints the full regular-season
 * standings table for each prior season, so the output can be diffed by hand
 * against the Notion table.
 *
 *   node scripts/validate-history.ts          # one season back
 *   node scripts/validate-history.ts 2        # two seasons back
 *   node scripts/validate-history.ts 2 worst  # ...under a single tie rule
 */
import {
  LEAGUE_ID,
  DEFAULT_CONFIG,
  computeWeekFor,
  computeStandings,
  getLeague,
  getMatchups,
  getTeamNames,
  getState,
  loadSeason,
  weekHasScoring,
  type RankTieRule,
  type SleeperMatchup,
  type TeamWeek,
  type VpConfig,
} from "../src/victory-points.ts";

const ALL_RULES: RankTieRule[] = ["best", "worst", "average"];

const seasonsBack = Number(process.argv[2] ?? 1);
const ruleArg = process.argv[3] as RankTieRule | undefined;
const rules = ruleArg ? [ruleArg] : ALL_RULES;

const pad = (s: string | number, w: number) => String(s).padStart(w);
const padEnd = (s: string | number, w: number) => String(s).padEnd(w);
const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const round2 = (n: number) => Math.round(n * 100) / 100;
const scoreOf = (m: SleeperMatchup) => round2(m.custom_points ?? m.points ?? 0);

/** Tier value for a 1-based rank, ignoring ties. */
const tierValue = (rank: number, c: VpConfig) =>
  rank <= c.topTierMax ? 2 : rank <= c.midTierMax ? 1 : 0;

/** Week 1 replaces head-to-head with a straight top-half/bottom-half split. */
const isOpeningWeek = (week: number, c: VpConfig) =>
  week === 1 && c.openingWeekTopHalf;
const topHalfValue = (rank: number, teams: number) =>
  rank <= Math.floor(teams / 2) ? 2 : 0;

async function reportSeason(leagueId: string) {
  const league = await getLeague(leagueId);
  const lastWeek = league.settings.playoff_week_start - 1;

  console.log(`\n${"=".repeat(74)}`);
  console.log(
    `${league.season} — ${league.name} (${leagueId}), regular season weeks 1-${lastWeek}`,
  );
  console.log("=".repeat(74));

  const weekNumbers = Array.from({ length: lastWeek }, (_, i) => i + 1);
  const [rawWeeks, names] = await Promise.all([
    Promise.all(
      weekNumbers.map((w) => getMatchups(leagueId, w).then((m) => [w, m] as const)),
    ),
    getTeamNames(leagueId),
  ]);

  const scored = rawWeeks.filter(([, m]) => weekHasScoring(m));
  console.log(
    `Weeks fetched: ${rawWeeks.length}, weeks with scoring: ${scored.length}`,
  );

  // ---- sanity checks on the raw payloads
  console.log("\n--- Data anomalies ---");
  let anomalies = 0;
  for (const [week, matchups] of rawWeeks) {
    const issues: string[] = [];
    if (matchups.length !== league.total_rosters) {
      issues.push(`${matchups.length} rosters (expected ${league.total_rosters})`);
    }
    const nullMatchup = matchups.filter((m) => m.matchup_id == null).length;
    if (nullMatchup) issues.push(`${nullMatchup} null matchup_id`);
    const custom = matchups.filter((m) => m.custom_points != null).length;
    if (custom) issues.push(`${custom} custom_points override`);
    const zero = matchups.filter((m) => scoreOf(m) === 0).length;
    if (zero) issues.push(`${zero} team(s) scored 0.00`);
    const sizes = new Map<number, number>();
    for (const m of matchups) {
      if (m.matchup_id == null) continue;
      sizes.set(m.matchup_id, (sizes.get(m.matchup_id) ?? 0) + 1);
    }
    const odd = [...sizes.entries()].filter(([, n]) => n !== 2);
    if (odd.length) issues.push(`matchup(s) not of size 2: ${JSON.stringify(odd)}`);
    if (issues.length) {
      console.log(`  week ${pad(week, 2)}: ${issues.join("; ")}`);
      anomalies++;
    }
  }
  if (!anomalies) console.log("  none");

  // ---- tie census: where the rank-tie rule actually bites
  console.log("\n--- Scoring ties ---");
  let ties = 0;
  let boundaryTies = 0;
  for (const [week, matchups] of scored) {
    const ordered = [...matchups].sort((a, b) => scoreOf(b) - scoreOf(a));
    let i = 0;
    while (i < ordered.length) {
      let j = i;
      while (j + 1 < ordered.length && scoreOf(ordered[j + 1]) === scoreOf(ordered[i])) j++;
      if (j > i) {
        ties++;
        const values = new Set<number>();
        for (let r = i + 1; r <= j + 1; r++) values.add(tierValue(r, DEFAULT_CONFIG));
        if (isOpeningWeek(week, DEFAULT_CONFIG)) {
          const halves = new Set<number>();
          for (let r = i + 1; r <= j + 1; r++)
            halves.add(topHalfValue(r, matchups.length));
          if (halves.size > 1) values.add(-1); // marks a top-half straddle too
        }
        const straddles = values.size > 1;
        if (straddles) boundaryTies++;
        const who = ordered
          .slice(i, j + 1)
          .map((m) => names.get(m.roster_id) ?? `Roster ${m.roster_id}`)
          .join(", ");
        console.log(
          `  week ${pad(week, 2)}: ${j - i + 1} teams at ${scoreOf(ordered[i]).toFixed(2)}, ` +
            `ranks ${i + 1}-${j + 1} — ${who}` +
            (straddles ? "   <-- STRADDLES A TIER BOUNDARY" : ""),
        );
      }
      i = j + 1;
    }
  }
  if (!ties) console.log("  none");
  console.log(
    boundaryTies
      ? `  => ${boundaryTies} tie(s) straddle a tier boundary: the rank-tie rule CHANGES this table.`
      : `  => no tie straddles a tier boundary: all three rank-tie rules give the SAME table.`,
  );

  // ---- standings under each rule
  const tables = new Map<RankTieRule, string>();
  for (const rule of rules) {
    const config: VpConfig = { ...DEFAULT_CONFIG, rankTieRule: rule };
    const weeks = new Map<number, TeamWeek[]>(
      scored.map(([w, m]) => [w, computeWeekFor(w, m as SleeperMatchup[], config)]),
    );
    const standings = computeStandings(weeks, config);

    const lines: string[] = [];
    lines.push(
      `${padEnd("#", 3)} ${padEnd("Team", 24)} ${pad("VP", 6)} ${pad("H2H", 5)} ${pad("Rank", 5)} ${pad("W-L-T", 8)} ${pad("PF", 9)} ${pad("Wk", 3)}`,
    );
    lines.push("-".repeat(72));
    standings.forEach((r, i) => {
      lines.push(
        `${padEnd(i + 1, 3)} ${padEnd(names.get(r.rosterId) ?? `Roster ${r.rosterId}`, 24)} ` +
          `${pad(num(r.victoryPoints), 6)} ${pad(num(r.h2hPoints), 5)} ${pad(num(r.rankPoints), 5)} ` +
          `${pad(`${r.wins}-${r.losses}-${r.ties}`, 8)} ${pad(r.pointsFor.toFixed(2), 9)} ${pad(r.weeksPlayed, 3)}`,
      );
    });
    const table = lines.join("\n");

    const identicalTo = [...tables.entries()].find(([, t]) => t === table)?.[0];
    tables.set(rule, table);

    console.log(`\n--- ${league.season} standings — rankTieRule: "${rule}" ---`);
    if (identicalTo) {
      console.log(`(identical to "${identicalTo}")`);
      continue;
    }
    console.log(table);

    // Per-week the league awards a fixed total regardless of results: H2H
    // gives 2 per matchup (2-0 or 1-1), rank gives topTierMax*2 + mid tier*1.
    const n = league.total_rosters;
    // Weeks 2+ award 2 per matchup; week 1 awards 2 to each of the top half.
    // Both come to the same pot for an even league, but derive it rather than
    // assume it.
    let perSeasonH2h = 0;
    let perSeasonGames = 0;
    for (const [w] of scored) {
      if (isOpeningWeek(w, config)) {
        perSeasonH2h += Math.floor(n / 2) * 2;
      } else {
        perSeasonH2h += n;
        perSeasonGames += n;
      }
    }
    const perWeekRank =
      config.topTierMax * 2 + (config.midTierMax - config.topTierMax);
    const sum = (f: (r: (typeof standings)[number]) => number) =>
      round2(standings.reduce((a, r) => a + f(r), 0));
    const check = (label: string, actual: number, expected: number) =>
      console.log(
        `  ${actual === expected ? "OK  " : "FAIL"} ${padEnd(label, 22)} ${num(actual)} (expected ${num(expected)})`,
      );

    console.log("Checksums:");
    check("teams", standings.length, n);
    check("H2H + top-half pts", sum((r) => r.h2hPoints), perSeasonH2h);
    check("rank points", sum((r) => r.rankPoints), scored.length * perWeekRank);
    check(
      "total VP",
      sum((r) => r.victoryPoints),
      perSeasonH2h + scored.length * perWeekRank,
    );
    check("wins = losses", sum((r) => r.wins), sum((r) => r.losses));
    check("games played", sum((r) => r.wins + r.losses + r.ties), perSeasonGames);
    check("weeks played", sum((r) => r.weeksPlayed), scored.length * n);
    check(
      "VP = H2H + rank",
      sum((r) => r.victoryPoints),
      sum((r) => r.h2hPoints + r.rankPoints),
    );
  }

  return league.previous_league_id;
}

async function main() {
  const [state, current] = await Promise.all([getState(), getLeague(LEAGUE_ID)]);
  console.log(`NFL state: ${state.season} week ${state.week} (${state.season_type})`);
  console.log(`Current league: ${current.name} — ${LEAGUE_ID} (${current.season})`);

  let id: string | null = current.previous_league_id;
  for (let i = 0; i < seasonsBack && id; i++) {
    id = await reportSeason(id);
  }

  // Cross-check: what loadSeason returns for the most recent completed season.
  const prevId = current.previous_league_id;
  if (prevId) {
    const viaLoadSeason = await loadSeason(prevId);
    console.log(
      `\nloadSeason("${prevId}") returned ${viaLoadSeason.size} week(s): ` +
        `[${[...viaLoadSeason.keys()].join(", ")}]`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
