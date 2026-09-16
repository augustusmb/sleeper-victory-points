import type { StandingsRow } from "./victory-points.ts";
import { formatPf, formatVp } from "./format.ts";

interface Props {
  standings: StandingsRow[];
  teamNames: Map<number, string>;
}

/**
 * The screenshot target. Sorted by victory points, then total points for —
 * `computeStandings` already applies that order.
 */
export function StandingsTable({ standings, teamNames }: Props) {
  const maxVp = Math.max(1, ...standings.map((r) => r.victoryPoints));

  return (
    <table className="standings">
      <thead>
        <tr>
          <th className="col-rank th-num">#</th>
          <th className="col-team">Team</th>
          <th className="col-vp th-num">VP</th>
          <th className="col-bar" aria-hidden="true" />
          <th className="col-pf th-num">Total PF</th>
        </tr>
      </thead>
      <tbody>
        {standings.map((row, i) => (
          <tr key={row.rosterId}>
            <td className="col-rank">
              <div className="cell rank">{i + 1}</div>
            </td>
            <td className="col-team">
              <div className="cell team">
                {teamNames.get(row.rosterId) ?? `Roster ${row.rosterId}`}
              </div>
            </td>
            <td className="col-vp">
              <div className="cell vp">{formatVp(row.victoryPoints)}</div>
            </td>
            <td className="col-bar">
              <div className="cell">
                <div className="bar">
                  <div
                    className="bar-fill"
                    style={{
                      width: `${Math.max((row.victoryPoints / maxVp) * 100, row.victoryPoints > 0 ? 4 : 0)}%`,
                    }}
                  />
                </div>
              </div>
            </td>
            <td className="col-pf">
              <div className="cell pf">{formatPf(row.pointsFor)}</div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
