/**
 * Regression check against the hand-kept Notion table for 2025, plus a report
 * of the weeks fragile enough that a late stat correction could move a team's
 * VP total.
 */
import {
  DEFAULT_CONFIG,
  computeStandings,
  computeWeekFor,
  getLeague,
  getMatchups,
  getTeamNames,
  type SleeperMatchup,
  type TeamWeek,
} from "../src/victory-points.ts";

const PREV_ID = "1206010340186275840";
const C = DEFAULT_CONFIG;

const pad = (s: string | number, w: number) => String(s).padStart(w);
const padEnd = (s: string | number, w: number) => String(s).padEnd(w);

/** The 2025 table as kept by hand in Notion, in its own row order. */
const NOTION: Array<{ team: string; vp: number; pf: number }> = [
  { team: "America's One Sith", vp: 45, pf: 2139.66 },
  { team: "Solo Falcons", vp: 41, pf: 2055.72 },
  { team: "🔫 Carth Onasi 🪬", vp: 41, pf: 2183.13 },
  { team: "Kessel Run n Gun", vp: 37, pf: 1995.42 },
  { team: "Death Star Records", vp: 32, pf: 1970.72 },
  { team: "Obi-Wan", vp: 32, pf: 1830.41 },
  { team: "Seattle Ewoks", vp: 30, pf: 1951.56 },
  { team: "Republic Rebels", vp: 28, pf: 1913.84 },
  { team: "Darth Jaworski", vp: 26, pf: 1840.43 },
  { team: "Return of the Lamardi", vp: 21, pf: 1757.22 },
  { team: "Tampa Bay Tauntauns", vp: 17, pf: 1636.94 },
  { team: "Jek Porkins", vp: 11, pf: 1343.26 },
  { team: "Coach Mino: A New Hope", vp: 10, pf: 1550.86 },
  { team: "Wookie Warriors", vp: 7, pf: 1304.55 },
];

async function main() {
  const league = await getLeague(PREV_ID);
  const lastWeek = league.settings.playoff_week_start - 1;

  const [raw, names] = await Promise.all([
    Promise.all(
      Array.from({ length: lastWeek }, (_, i) => i + 1).map((w) =>
        getMatchups(PREV_ID, w).then((m) => [w, m] as const),
      ),
    ),
    getTeamNames(PREV_ID),
  ]);
  const name = (id: number | null) =>
    id == null ? "—" : (names.get(id) ?? `Roster ${id}`);

  const weeks = new Map<number, TeamWeek[]>(
    raw.map(([w, m]) => [w, computeWeekFor(w, m as SleeperMatchup[], C)]),
  );
  const standings = computeStandings(weeks, C);
  const byName = new Map(
    standings.map((r) => [names.get(r.rosterId) ?? "", r]),
  );

  // --- 1. row-by-row diff
  console.log(`=== ${league.season} computed vs Notion ===`);
  console.log(
    `${padEnd("Team", 24)} ${pad("VP", 4)} ${pad("Notion", 7)}  ${pad("PF", 9)} ${pad("Notion", 9)}`,
  );
  console.log("-".repeat(60));

  let vpMatches = 0;
  let pfMatches = 0;
  for (const ref of NOTION) {
    const row = byName.get(ref.team);
    if (!row) {
      console.log(`${padEnd(ref.team, 24)}  no roster with this name`);
      continue;
    }
    const vpOk = row.victoryPoints === ref.vp;
    const pfOk = row.pointsFor === ref.pf;
    if (vpOk) vpMatches++;
    if (pfOk) pfMatches++;
    console.log(
      `${padEnd(ref.team, 24)} ${pad(row.victoryPoints, 4)} ${pad(vpOk ? "ok" : ref.vp, 7)}  ` +
        `${pad(row.pointsFor.toFixed(2), 9)} ${pad(pfOk ? "ok" : ref.pf.toFixed(2), 9)}`,
    );
  }
  console.log(
    `\nVP: ${vpMatches}/${NOTION.length} match   PF: ${pfMatches}/${NOTION.length} match`,
  );

  // --- 2. ordering diff (Notion's own row order vs the league's stated sort)
  const computedOrder = standings.map((r) => names.get(r.rosterId) ?? "");
  const notionOrder = NOTION.map((r) => r.team);
  const misordered = computedOrder
    .map((team, i) => ({ team, computed: i + 1, notion: notionOrder.indexOf(team) + 1 }))
    .filter((r) => r.computed !== r.notion);
  console.log(
    misordered.length
      ? `\nOrdering differences (sort is VP, then points for):\n` +
          misordered
            .map((r) => `  ${padEnd(r.team, 24)} computed #${r.computed}, Notion #${r.notion}`)
            .join("\n")
      : "\nRow order matches.",
  );

  // --- 3. what a late stat correction could still flip
  console.log("\n=== Fragile margins (under 2.00 points) ===");
  for (const [week, tws] of weeks) {
    const ordered = [...tws].sort((a, b) => b.score - a.score);
    const opening = week === 1 && C.openingWeekTopHalf;

    if (!opening) {
      const seen = new Set<number>();
      for (const tw of tws) {
        if (tw.opponentRosterId == null || seen.has(tw.rosterId)) continue;
        seen.add(tw.rosterId);
        seen.add(tw.opponentRosterId);
        const opp = tws.find((t) => t.rosterId === tw.opponentRosterId)!;
        const margin = Math.abs(tw.score - opp.score);
        if (margin >= 2) continue;
        const [win, lose] = tw.score >= opp.score ? [tw, opp] : [opp, tw];
        console.log(
          `  wk ${pad(week, 2)} h2h    ${padEnd(name(win.rosterId), 22)} over ` +
            `${padEnd(name(lose.rosterId), 22)} by ${margin.toFixed(2)}`,
        );
      }
    }

    const boundaries: Array<[string, number]> = [
      ["rank 4/5", C.topTierMax],
      ["rank 9/10", C.midTierMax],
    ];
    if (opening) boundaries.push(["top half 7/8", Math.floor(tws.length / 2)]);

    for (const [label, boundary] of boundaries) {
      const above = ordered[boundary - 1];
      const below = ordered[boundary];
      if (!above || !below) continue;
      const margin = above.score - below.score;
      if (margin >= 2) continue;
      console.log(
        `  wk ${pad(week, 2)} ${padEnd(label, 12)} ${padEnd(name(above.rosterId), 22)} over ` +
          `${padEnd(name(below.rosterId), 22)} by ${margin.toFixed(2)}`,
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
