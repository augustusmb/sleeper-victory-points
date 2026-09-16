/**
 * App-level loader: composes the primitives in victory-points.ts into exactly
 * what the standings page renders.
 *
 * This is where the "completed weeks only" policy lives. victory-points.ts
 * stays a pure scoring module; the question of which weeks *count* is a
 * presentation decision, so it belongs here.
 */
import {
  DEFAULT_CONFIG,
  computeStandings,
  computeWeekFor,
  getLeague,
  getMatchups,
  getState,
  getTeamNames,
  weekHasScoring,
  type StandingsRow,
  type TeamWeek,
  type VpConfig,
} from "./victory-points.ts";

export interface SeasonSnapshot {
  leagueId: string;
  leagueName: string;
  season: string;
  /** roster_id -> display name. */
  teamNames: Map<number, string>;
  /** Completed regular-season weeks only, keyed by week number. */
  weeks: Map<number, TeamWeek[]>;
  standings: StandingsRow[];
  /** Highest completed week counted, or 0 when none have finished. */
  throughWeek: number;
  /** Last week of the regular season (playoff_week_start - 1). */
  finalWeek: number;
  /** The week currently being played and deliberately excluded, if any. */
  inProgressWeek: number | null;
  isCurrentSeason: boolean;
  config: VpConfig;
}

/**
 * How many regular-season weeks have actually finished.
 *
 * `state.week` is the week the NFL is playing right now, so every week before
 * it is done. It only bounds the season in progress — a past season in the
 * dynasty chain is complete end to end.
 */
function completedThrough(
  stateWeek: number,
  stateSeason: string,
  leagueSeason: string,
  finalWeek: number,
): number {
  if (leagueSeason !== stateSeason) return finalWeek;
  return Math.max(0, Math.min(stateWeek - 1, finalWeek));
}

export async function loadSnapshot(
  leagueId: string,
  config: VpConfig = DEFAULT_CONFIG,
): Promise<SeasonSnapshot> {
  const [state, league] = await Promise.all([getState(), getLeague(leagueId)]);

  const finalWeek = league.settings.playoff_week_start - 1;
  const isCurrentSeason = league.season === state.season;
  const through = completedThrough(
    state.week,
    state.season,
    league.season,
    finalWeek,
  );

  const weekNumbers = Array.from({ length: through }, (_, i) => i + 1);
  const [raw, teamNames] = await Promise.all([
    Promise.all(
      weekNumbers.map((w) => getMatchups(leagueId, w).then((m) => [w, m] as const)),
    ),
    getTeamNames(leagueId),
  ]);

  const weeks = new Map<number, TeamWeek[]>();
  for (const [week, matchups] of raw) {
    // A finished week with no scoring means Sleeper has no data for it; count
    // it as absent rather than recording a league-wide 0.00 tie.
    if (!weekHasScoring(matchups)) continue;
    weeks.set(week, computeWeekFor(week, matchups, config));
  }

  const counted = [...weeks.keys()];
  const inProgressWeek =
    isCurrentSeason && state.week <= finalWeek ? state.week : null;

  return {
    leagueId,
    leagueName: league.name,
    season: league.season,
    teamNames,
    weeks,
    standings: computeStandings(weeks, config),
    throughWeek: counted.length ? Math.max(...counted) : 0,
    finalWeek,
    inProgressWeek,
    isCurrentSeason,
    config,
  };
}
