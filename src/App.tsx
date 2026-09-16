import { useCallback, useEffect, useState } from "react";
import { LEAGUE_ID, DEFAULT_CONFIG } from "./victory-points.ts";
import { loadSnapshot, type SeasonSnapshot } from "./season.ts";
import { StandingsTable } from "./StandingsTable.tsx";
import { WeekDetail } from "./WeekDetail.tsx";
import { copyStandingsImage, type CopyOutcome } from "./table-image.ts";
import { formatPf, formatVp } from "./format.ts";

type Status =
  | { state: "loading" }
  | { state: "ready"; data: SeasonSnapshot }
  | { state: "error"; error: Error };

/** Card footnotes, also baked into the copied PNG. */
function footnotes(data: SeasonSnapshot): string[] {
  const { config } = data;
  const notes = [
    `VP = head-to-head (win 2 / tie 1 / loss 0) + weekly scoring rank ` +
      `(1–${config.topTierMax}: 2, ${config.topTierMax + 1}–${config.midTierMax}: 1, ` +
      `${config.midTierMax + 1}+: 0). Sorted by VP, then total points for.`,
  ];

  if (config.openingWeekTopHalf && data.weeks.has(1)) {
    const teams = data.weeks.get(1)!.length;
    const half = Math.floor(teams / 2);
    notes.push(
      `Week 1 has no head-to-head: the top ${half} scorers earn 2 and the ` +
        `bottom ${teams - half} earn 0. Scoring rank applies as usual.`,
    );
  }

  notes.push(
    data.inProgressWeek
      ? `Completed weeks only — week ${data.inProgressWeek} is in progress and not counted.`
      : `Final — all ${data.finalWeek} regular-season weeks counted.`,
  );
  return notes;
}

const cardTitle = (data: SeasonSnapshot) => `${data.leagueName} ${data.season}`;

function subtitle(data: SeasonSnapshot): string {
  if (!data.throughWeek) return "Victory point standings · no completed weeks yet";
  return (
    `Victory point standings · through week ${data.throughWeek} ` +
    `of ${data.finalWeek}`
  );
}

export default function App() {
  const [status, setStatus] = useState<Status>({ state: "loading" });
  const [copyState, setCopyState] = useState<CopyOutcome | "error" | null>(null);
  const [copying, setCopying] = useState(false);

  const load = useCallback(() => {
    setStatus({ state: "loading" });
    loadSnapshot(LEAGUE_ID, DEFAULT_CONFIG).then(
      (data) => setStatus({ state: "ready", data }),
      (error: unknown) =>
        setStatus({
          state: "error",
          error: error instanceof Error ? error : new Error(String(error)),
        }),
    );
  }, []);

  useEffect(load, [load]);

  const onCopy = useCallback(async () => {
    if (status.state !== "ready") return;
    const { data } = status;
    const maxVp = Math.max(1, ...data.standings.map((r) => r.victoryPoints));
    setCopying(true);
    try {
      const outcome = await copyStandingsImage(
        {
          title: cardTitle(data),
          subtitle: subtitle(data),
          rows: data.standings.map((row, i) => ({
            rank: i + 1,
            team: data.teamNames.get(row.rosterId) ?? `Roster ${row.rosterId}`,
            vp: formatVp(row.victoryPoints),
            pf: formatPf(row.pointsFor),
            barPct: row.victoryPoints / maxVp,
          })),
          footnotes: footnotes(data),
        },
        `vp-standings-${data.season}-week-${data.throughWeek}.png`,
      );
      setCopyState(outcome);
    } catch {
      setCopyState("error");
    } finally {
      setCopying(false);
      setTimeout(() => setCopyState(null), 3000);
    }
  }, [status]);

  if (status.state === "loading") return <LoadingState />;
  if (status.state === "error")
    return <ErrorState error={status.error} onRetry={load} />;

  const { data } = status;

  return (
    <div className="page">
      <div className="card">
        <header className="card-head">
          <h1 className="title">{cardTitle(data)}</h1>
          <p className="subtitle">{subtitle(data)}</p>
        </header>

        {data.standings.length ? (
          <StandingsTable
            standings={data.standings}
            teamNames={data.teamNames}
          />
        ) : (
          <p className="empty">
            No completed weeks yet this season. Standings appear once week 1
            finishes.
          </p>
        )}

        <footer className="card-foot">
          {footnotes(data).map((note) => (
            <div key={note}>{note}</div>
          ))}
        </footer>
      </div>

      <div className="controls">
        <button
          type="button"
          className="btn"
          onClick={onCopy}
          disabled={copying || !data.standings.length}
        >
          {copying ? "Rendering…" : "Copy as image"}
        </button>
        <button type="button" className="btn" onClick={load}>
          Refresh
        </button>
        <span className="controls-note">
          {copyState === "copied" && "PNG copied to clipboard."}
          {copyState === "downloaded" &&
            "Clipboard images unsupported here — PNG downloaded instead."}
          {copyState === "error" && "Couldn't render the image."}
          {copyState === null &&
            "Live from the Sleeper API. Self-heals when stat corrections land."}
        </span>
      </div>

      <WeekDetail
        weeks={data.weeks}
        teamNames={data.teamNames}
        openingWeekTopHalf={data.config.openingWeekTopHalf}
      />
    </div>
  );
}

function LoadingState() {
  return (
    <div className="page">
      <div className="card" aria-busy="true" aria-label="Loading standings">
        <header className="card-head">
          <div className="skeleton-line" style={{ width: 380, height: 28 }} />
          <div
            className="skeleton-line"
            style={{ width: 240, height: 14, marginTop: 12 }}
          />
        </header>
        {Array.from({ length: 14 }, (_, i) => (
          <div className="skeleton-row" key={i}>
            <div className="skeleton-line" style={{ width: 22 }} />
            <div className="skeleton-line" style={{ flex: 1, maxWidth: 220 }} />
            <div className="skeleton-line" style={{ width: 46, height: 20 }} />
            <div className="skeleton-line" style={{ width: 150, height: 8 }} />
            <div className="skeleton-line" style={{ width: 84 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function ErrorState({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <div className="page">
      <div className="error">
        <h2>Couldn't reach Sleeper</h2>
        <p>
          The standings are computed in your browser from Sleeper's public API,
          so this page shows nothing when that API is unreachable. Nothing is
          cached — try again in a moment.
        </p>
        <p>
          <code>{error.message}</code>
        </p>
        <p>
          <button type="button" className="btn" onClick={onRetry}>
            Try again
          </button>
        </p>
      </div>
    </div>
  );
}
