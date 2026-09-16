/**
 * Victory points for a 14-team Sleeper league.
 *
 * VP = head-to-head points + weekly scoring-rank points
 *   H2H:  win 2 / tie 1 / loss 0
 *   Rank: 1-4 -> 2, 5-9 -> 1, 10-14 -> 0
 *
 * Pure functions, no dependencies. Safe to run in the browser.
 */

export const LEAGUE_ID = "1355610407519133696";

// ---------------------------------------------------------------- types

/** Subset of the Sleeper /matchups/{week} response we actually use. */
export interface SleeperMatchup {
  roster_id: number;
  /** null for teams not in a bracket during playoff weeks. */
  matchup_id: number | null;
  /** null before a week has any scoring. */
  points: number | null;
  /** Set when the commissioner manually overrides a score. Wins over `points`. */
  custom_points: number | null;
}

export interface SleeperRoster {
  roster_id: number;
  owner_id: string | null;
}

export interface SleeperUser {
  user_id: string;
  display_name: string;
  metadata?: { team_name?: string | null } | null;
}

/**
 * How to resolve a scoring tie that straddles a tier boundary.
 *
 *   Two teams tie for 4th/5th place:
 *     "best"    -> both get 2   (tie rounds in the teams' favor)
 *     "worst"   -> both get 1   (tie rounds against)
 *     "average" -> both get 1.5 (fairest, but introduces half-points)
 *
 * >>> CONFIRM THIS WITH THE LEAGUE BEFORE WEEK 1 OF THE PLAYOFF RACE. <<<
 */
export type RankTieRule = "best" | "worst" | "average";

export interface VpConfig {
  /** Highest rank (inclusive) that earns 2 points. */
  topTierMax: number;
  /** Highest rank (inclusive) that earns 1 point. */
  midTierMax: number;
  rankTieRule: RankTieRule;
  /**
   * Week 1 has no head-to-head component in this league. Sleeper still
   * publishes a week-1 schedule, but the league ignores it: the top half of
   * the week's scorers earns 2 points and the bottom half 0, in place of
   * win/tie/loss. The scoring-rank component is unaffected.
   *
   * Set false to score week 1 like every other week.
   */
  openingWeekTopHalf: boolean;
}

export const DEFAULT_CONFIG: VpConfig = {
  topTierMax: 4,
  midTierMax: 9,
  rankTieRule: "best",
  openingWeekTopHalf: true,
};

export interface TeamWeek {
  rosterId: number;
  score: number;
  /** null in week 1, which is not played head to head. */
  opponentRosterId: number | null;
  /** "none" in week 1: no game is played, so no win or loss is recorded. */
  h2hResult: "win" | "loss" | "tie" | "none";
  /**
   * The first VP component: head-to-head points in weeks 2 onward, and the
   * top-half award in week 1. Not always a win/loss figure -- read it with
   * `h2hResult`.
   */
  h2hPoints: number;
  /** 1-based; tied teams all report the best slot in their tie block. */
  scoreRank: number;
  rankPoints: number;
  victoryPoints: number;
}

export interface StandingsRow {
  rosterId: number;
  victoryPoints: number;
  h2hPoints: number;
  rankPoints: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  weeksPlayed: number;
}

// ------------------------------------------------------------- internals

/**
 * Sleeper reports two decimals. Comparing raw floats for tie detection can
 * miss a tie that the app displays as identical, so normalize first.
 */
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** `custom_points` overrides `points` whenever the commissioner has set it. */
const scoreOf = (m: SleeperMatchup): number =>
  round2(m.custom_points ?? m.points ?? 0);

/** Points a given 0-based finishing slot is worth, ignoring ties. */
function valueForSlot(slotIndex: number, config: VpConfig): number {
  const rank = slotIndex + 1;
  if (rank <= config.topTierMax) return 2;
  if (rank <= config.midTierMax) return 1;
  return 0;
}

function resolveTie(values: number[], rule: RankTieRule): number {
  if (values.length === 1) return values[0];
  if (rule === "best") return Math.max(...values);
  if (rule === "worst") return Math.min(...values);
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Award points by weekly scoring order, resolving tie blocks together.
 *
 * `slotValue` maps a 0-based finishing slot to its points, which is the only
 * thing separating the two score-based components: the rank tiers award 2/1/0
 * at ranks 4 and 9, while week 1's top-half award is 2/0 split down the
 * middle. Sharing this means a tie across either boundary resolves under the
 * league's single `rankTieRule`.
 */
function awardByScore(
  matchups: SleeperMatchup[],
  scores: Map<number, number>,
  rule: RankTieRule,
  slotValue: (slotIndex: number) => number,
): { points: Map<number, number>; rank: Map<number, number> } {
  const ordered = [...matchups].sort(
    (x, y) => scores.get(y.roster_id)! - scores.get(x.roster_id)!,
  );

  const points = new Map<number, number>();
  const rank = new Map<number, number>();

  let i = 0;
  while (i < ordered.length) {
    let j = i;
    while (
      j + 1 < ordered.length &&
      scores.get(ordered[j + 1].roster_id)! === scores.get(ordered[i].roster_id)!
    ) {
      j++;
    }

    const slotValues: number[] = [];
    for (let slot = i; slot <= j; slot++) slotValues.push(slotValue(slot));
    const awarded = resolveTie(slotValues, rule);

    for (let k = i; k <= j; k++) {
      points.set(ordered[k].roster_id, awarded);
      rank.set(ordered[k].roster_id, i + 1); // best slot in the block
    }

    i = j + 1;
  }

  return { points, rank };
}

// ------------------------------------------------------------ public API

/**
 * True once any team has scored. Use this to skip weeks that haven't started
 * rather than recording a 14-way 0.00 tie.
 */
export function weekHasScoring(matchups: SleeperMatchup[]): boolean {
  return matchups.some((m) => scoreOf(m) > 0);
}

/** Compute every team's victory points for a single week. */
export function computeWeek(
  matchups: SleeperMatchup[],
  config: VpConfig = DEFAULT_CONFIG,
): TeamWeek[] {
  const scores = new Map<number, number>(
    matchups.map((m) => [m.roster_id, scoreOf(m)]),
  );

  // --- head to head: the two teams sharing a matchup_id play each other.
  const byMatchup = new Map<number, SleeperMatchup[]>();
  for (const m of matchups) {
    if (m.matchup_id == null) continue; // bye / outside the bracket
    const bucket = byMatchup.get(m.matchup_id) ?? [];
    bucket.push(m);
    byMatchup.set(m.matchup_id, bucket);
  }

  const h2h = new Map<
    number,
    { points: number; result: TeamWeek["h2hResult"]; opponent: number | null }
  >();

  for (const m of matchups) {
    h2h.set(m.roster_id, { points: 0, result: "none", opponent: null });
  }

  for (const pair of byMatchup.values()) {
    if (pair.length !== 2) continue; // malformed; leave both as "none"
    const [a, b] = pair;
    const sa = scores.get(a.roster_id)!;
    const sb = scores.get(b.roster_id)!;

    const assign = (self: number, opp: number, mine: number, theirs: number) => {
      const result: TeamWeek["h2hResult"] =
        mine > theirs ? "win" : mine < theirs ? "loss" : "tie";
      h2h.set(self, {
        points: result === "win" ? 2 : result === "tie" ? 1 : 0,
        result,
        opponent: opp,
      });
    };

    assign(a.roster_id, b.roster_id, sa, sb);
    assign(b.roster_id, a.roster_id, sb, sa);
  }

  // --- scoring rank across the whole league, tie blocks resolved together.
  const { points: rankPoints, rank } = awardByScore(
    matchups,
    scores,
    config.rankTieRule,
    (slot) => valueForSlot(slot, config),
  );

  return matchups.map((m) => {
    const head = h2h.get(m.roster_id)!;
    const rp = rankPoints.get(m.roster_id)!;
    return {
      rosterId: m.roster_id,
      score: scores.get(m.roster_id)!,
      opponentRosterId: head.opponent,
      h2hResult: head.result,
      h2hPoints: head.points,
      scoreRank: rank.get(m.roster_id)!,
      rankPoints: rp,
      victoryPoints: head.points + rp,
    };
  });
}

/**
 * Score week 1, which this league does not play head to head.
 *
 * The top half of the week's scorers earns 2 points and the bottom half 0,
 * replacing win/tie/loss. Sleeper does publish a week-1 schedule and it is
 * deliberately ignored here.
 *
 * Because no game counts, `h2hResult` is "none" and `opponentRosterId` is
 * null, so season W-L-T records only reflect weeks 2 onward.
 */
export function computeOpeningWeek(
  matchups: SleeperMatchup[],
  config: VpConfig = DEFAULT_CONFIG,
): TeamWeek[] {
  const base = computeWeek(matchups, config);
  const scores = new Map<number, number>(
    matchups.map((m) => [m.roster_id, scoreOf(m)]),
  );

  // Two-tier version of the ordinary ranking, so a tie straddling the
  // top-half boundary resolves under the same rankTieRule as everything else.
  const half = Math.floor(matchups.length / 2);
  const { points } = awardByScore(matchups, scores, config.rankTieRule, (slot) =>
    slot < half ? 2 : 0,
  );

  return base.map((tw) => {
    const awarded = points.get(tw.rosterId)!;
    return {
      ...tw,
      opponentRosterId: null,
      h2hResult: "none",
      h2hPoints: awarded,
      victoryPoints: awarded + tw.rankPoints,
    };
  });
}

/**
 * Score a week by its number, applying the opening-week rule where it applies.
 * Prefer this over calling `computeWeek` directly.
 */
export function computeWeekFor(
  week: number,
  matchups: SleeperMatchup[],
  config: VpConfig = DEFAULT_CONFIG,
): TeamWeek[] {
  return week === 1 && config.openingWeekTopHalf
    ? computeOpeningWeek(matchups, config)
    : computeWeek(matchups, config);
}

/** Roll weekly results into season standings, sorted best to worst. */
export function computeStandings(
  weeks: Map<number, TeamWeek[]>,
  // Unused: the weeks handed in are already scored. Kept for call-site
  // symmetry with computeWeek/loadSeason.
  _config: VpConfig = DEFAULT_CONFIG,
): StandingsRow[] {
  const rows = new Map<number, StandingsRow>();

  for (const teamWeeks of weeks.values()) {
    for (const tw of teamWeeks) {
      const row =
        rows.get(tw.rosterId) ??
        {
          rosterId: tw.rosterId,
          victoryPoints: 0,
          h2hPoints: 0,
          rankPoints: 0,
          wins: 0,
          losses: 0,
          ties: 0,
          pointsFor: 0,
          weeksPlayed: 0,
        };

      row.victoryPoints += tw.victoryPoints;
      row.h2hPoints += tw.h2hPoints;
      row.rankPoints += tw.rankPoints;
      row.pointsFor = round2(row.pointsFor + tw.score);
      row.weeksPlayed += 1;
      if (tw.h2hResult === "win") row.wins += 1;
      else if (tw.h2hResult === "loss") row.losses += 1;
      else if (tw.h2hResult === "tie") row.ties += 1;

      rows.set(tw.rosterId, row);
    }
  }

  return [...rows.values()].sort(
    (a, b) => b.victoryPoints - a.victoryPoints || b.pointsFor - a.pointsFor,
  );
}

// -------------------------------------------------------------- fetching

const api = async <T,>(path: string): Promise<T> => {
  const res = await fetch(`https://api.sleeper.app/v1${path}`);
  if (!res.ok) throw new Error(`Sleeper ${path} -> ${res.status}`);
  return res.json() as Promise<T>;
};

export const getState = () =>
  api<{ week: number; season: string; season_type: string }>("/state/nfl");

export const getLeague = (leagueId: string) =>
  api<{
    name: string;
    /** "2025", "2026", ... — compare against `getState().season`. */
    season: string;
    total_rosters: number;
    previous_league_id: string | null;
    settings: { playoff_week_start: number };
  }>(`/league/${leagueId}`);

export const getMatchups = (leagueId: string, week: number) =>
  api<SleeperMatchup[]>(`/league/${leagueId}/matchups/${week}`);

/** roster_id -> display team name, for rendering. */
export async function getTeamNames(
  leagueId: string,
): Promise<Map<number, string>> {
  const [rosters, users] = await Promise.all([
    api<SleeperRoster[]>(`/league/${leagueId}/rosters`),
    api<SleeperUser[]>(`/league/${leagueId}/users`),
  ]);

  const byUser = new Map(users.map((u) => [u.user_id, u]));
  return new Map(
    rosters.map((r) => {
      const u = r.owner_id ? byUser.get(r.owner_id) : undefined;
      const name =
        u?.metadata?.team_name?.trim() || u?.display_name || `Roster ${r.roster_id}`;
      return [r.roster_id, name];
    }),
  );
}

/**
 * Pull every completed regular-season week.
 *
 * Stops at `playoff_week_start` because matchup_id goes null for teams outside
 * the bracket, which would silently corrupt the head-to-head pairing.
 */
export async function loadSeason(
  leagueId: string,
  config: VpConfig = DEFAULT_CONFIG,
): Promise<Map<number, TeamWeek[]>> {
  const [state, league] = await Promise.all([getState(), getLeague(leagueId)]);

  // `state.week` tracks the live NFL week, so it only bounds the season that is
  // currently being played. A finished season (a previous link in the dynasty
  // chain) has every regular-season week available regardless of today's date.
  const finalWeek = league.settings.playoff_week_start - 1;
  const lastWeek =
    league.season === state.season ? Math.min(state.week, finalWeek) : finalWeek;
  const weekNumbers = Array.from({ length: Math.max(lastWeek, 0) }, (_, i) => i + 1);

  const raw = await Promise.all(
    weekNumbers.map((w) => getMatchups(leagueId, w).then((m) => [w, m] as const)),
  );

  const out = new Map<number, TeamWeek[]>();
  for (const [week, matchups] of raw) {
    if (!weekHasScoring(matchups)) continue; // in progress or not started
    out.set(week, computeWeekFor(week, matchups, config));
  }
  return out;
}
