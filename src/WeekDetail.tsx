import { useState } from "react";
import type { TeamWeek } from "./victory-points.ts";
import { formatScore, formatVp } from "./format.ts";

interface Props {
  weeks: Map<number, TeamWeek[]>;
  teamNames: Map<number, string>;
  /** Week 1 is scored as a top-half split rather than head to head. */
  openingWeekTopHalf: boolean;
}

const RESULT_LABEL: Record<TeamWeek["h2hResult"], string> = {
  win: "W",
  loss: "L",
  tie: "T",
  none: "—",
};

/**
 * Per-week breakdown, deliberately outside the screenshot card: it's the
 * "show your work" view for anyone who wants to check a number.
 */
export function WeekDetail({ weeks, teamNames, openingWeekTopHalf }: Props) {
  const weekNumbers = [...weeks.keys()].sort((a, b) => a - b);
  const [selected, setSelected] = useState(
    weekNumbers[weekNumbers.length - 1] ?? 0,
  );

  if (!weekNumbers.length) return null;

  const week =
    weeks.get(selected) ?? weeks.get(weekNumbers[weekNumbers.length - 1])!;
  const rows = [...week].sort(
    (a, b) => b.victoryPoints - a.victoryPoints || b.score - a.score,
  );
  const name = (id: number | null) =>
    id == null ? "—" : (teamNames.get(id) ?? `Roster ${id}`);

  // Week 1 has no games, so the opponent and win/loss columns carry nothing.
  const isOpening = openingWeekTopHalf && selected === 1;
  const half = Math.floor(week.length / 2);

  return (
    <section className="week-panel">
      <div className="week-head">
        <div>
          <h2 className="week-title">Week {selected}</h2>
          {isOpening && (
            <p className="week-note">
              No head-to-head in week 1 — the top {half} scorers earn 2 points,
              the bottom {week.length - half} earn 0.
            </p>
          )}
        </div>
        <div className="week-tabs">
          {weekNumbers.map((w) => (
            <button
              key={w}
              type="button"
              className={`week-tab${w === selected ? " active" : ""}`}
              onClick={() => setSelected(w)}
              aria-pressed={w === selected}
            >
              {w}
            </button>
          ))}
        </div>
      </div>

      <table className="week-table">
        <thead>
          <tr>
            <th>Team</th>
            <th className="num">Score</th>
            {!isOpening && <th>Opponent</th>}
            {!isOpening && <th className="num">Opp</th>}
            <th className="num">{isOpening ? "Split" : "Res"}</th>
            <th className="num">Rank</th>
            <th className="num">{isOpening ? "Half" : "H2H"}</th>
            <th className="num">Rk</th>
            <th className="num">VP</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((tw) => {
            const opp = week.find((t) => t.rosterId === tw.opponentRosterId);
            const topHalf = tw.h2hPoints > 0;
            return (
              <tr key={tw.rosterId}>
                <td className="team-cell">{name(tw.rosterId)}</td>
                <td className="num">{formatScore(tw.score)}</td>
                {!isOpening && (
                  <td className="opp-cell">{name(tw.opponentRosterId)}</td>
                )}
                {!isOpening && (
                  <td className="num">{opp ? formatScore(opp.score) : "—"}</td>
                )}
                <td className="num">
                  {isOpening ? (
                    <span className={`res ${topHalf ? "res-win" : "res-loss"}`}>
                      {topHalf ? `Top ${half}` : `Bottom ${week.length - half}`}
                    </span>
                  ) : (
                    <span className={`res res-${tw.h2hResult}`}>
                      {RESULT_LABEL[tw.h2hResult]}
                    </span>
                  )}
                </td>
                <td className="num">{tw.scoreRank}</td>
                <td className="num">{formatVp(tw.h2hPoints)}</td>
                <td className="num">{formatVp(tw.rankPoints)}</td>
                <td className="num vp-cell">{formatVp(tw.victoryPoints)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
