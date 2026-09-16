# Sleeper Victory Points Tracker

Static standings page for a 14-team dynasty league on Sleeper, using the
league's custom victory-point system that Sleeper doesn't support natively.

Everything is computed client-side from Sleeper's public read-only API on page
load — no backend, no cron, no database, no keys. That means the table is never
stale and it self-heals when Sleeper applies stat corrections on Tuesdays and
Wednesdays.

## Scoring

Each team earns 0–4 victory points per week from two independent components:

| Head-to-head | VP |     | Weekly scoring rank | VP |
| ------------ | -- | --- | ------------------- | -- |
| Win          | 2  |     | 1–4                 | 2  |
| Tie          | 1  |     | 5–9                 | 1  |
| Loss         | 0  |     | 10–14               | 0  |

Standings sort by total victory points, then by total points scored.

**Week 1 is different.** The league doesn't play week 1 head to head. Sleeper
publishes a week-1 schedule anyway and it is deliberately ignored: the top 7
scorers earn 2 points and the bottom 7 earn 0, in place of win/tie/loss. The
scoring-rank component applies as usual, so week 1 still awards 0–4 VP. No win
or loss is recorded for week 1, so season W-L-T records cover weeks 2–14.

Controlled by `openingWeekTopHalf` in `DEFAULT_CONFIG`. Score a week with
`computeWeekFor(week, matchups, config)`, which applies the rule where it
belongs, rather than calling `computeWeek` directly.

**Rank tie rule: `"best"`.** If a scoring tie straddles a tier boundary — two
teams tied for 4th/5th — both get the higher tier's points. Configured in
`DEFAULT_CONFIG` in `src/victory-points.ts`.

**In-progress weeks are excluded.** Only weeks that have finished are counted,
so a Sunday-afternoon screenshot never shows partial numbers. The card says
which week is in progress and uncounted.

## Running it

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # static files in dist/
```

`dist/` is plain static output with relative asset paths, so it deploys to
GitHub Pages or Netlify with no further configuration.

## Layout

| File | Role |
| ---- | ---- |
| `src/victory-points.ts` | Scoring logic and Sleeper API wrappers. Pure, dependency-free. |
| `src/season.ts` | Composes the above into one snapshot; owns the completed-weeks policy. |
| `src/StandingsTable.tsx` | The screenshot target. |
| `src/WeekDetail.tsx` | Per-week breakdown — score, opponent, result, rank, VP. |
| `src/table-image.ts` | Draws the card to canvas for "Copy as image". |

The page is built to be screenshotted into the league group chat: fixed 760px
card, dark ground, oversized tabular figures, nothing sticky or floating. The
**Copy as image** button renders the table to a 2× PNG and writes it to the
clipboard, so there's no cropping step. It's drawn directly on a canvas rather
than through an HTML-to-canvas library because team names contain emoji, which
SVG/foreignObject rasterizers drop. Browsers without clipboard image support
(Firefox) download the PNG instead.

## Validation scripts

```sh
npm run validate      # full standings for the previous season, all three tie rules
npm run validate 2    # walk two seasons back
npm run diff-notion   # where the computed table diverges from the Notion one
```

`validate-history.ts` walks back through `previous_league_id`, prints each
season's table, and runs checksums: every week awards 14 points from its first
component (7 matchups × 2, or 7 top-half awards × 2 in week 1) and 13 rank
points, wins must equal losses, and games played must cover every counted week
except week 1.

### What validation found (2025 and 2024)

Both seasons pass every checksum, and **all 14 victory-point totals match the
2025 Notion table exactly.**

Getting there is what surfaced the week-1 rule. Scoring week 1 head to head
like any other week matched Notion on only 10 of 14 teams, with four teams off
by exactly ±2: Kessel Run n Gun and Jek Porkins lost their week-1 games but
finished 6th and 7th in scoring, while Darth Jaworski and Coach Mino won theirs
but finished 8th and 10th. Those four are precisely the teams whose week-1
head-to-head result disagrees with their top-7 standing. Applying the top-half
rule takes the match to 14/14.

Two differences from Notion remain, both on Notion's side:

- **Four points-for typos**, each a single wrong digit: Death Star Records
  (1970.72 vs 1970.52), Seattle Ewoks (1951.56 vs 1951.66), Darth Jaworski
  (1840.43 vs 1840.33), Jek Porkins (1343.26 vs 1343.22). Sleeper's own roster
  records agree with the computed figures to the cent.
- **One sort error.** Solo Falcons and Carth Onasi both finished on 41 VP;
  Carth has more points for, so Carth places 2nd.

Across 2025 and 2024 there was exactly one scoring tie — week 13 of 2025, where
Kessel Run n Gun and Death Star Records both scored 149.92 for ranks 3/4. It
sits inside the top tier, so all three rank-tie rules produce identical tables
for both seasons. The rule only ever matters prospectively.

## Non-goals

No Notion integration, no `/players/nfl` (5MB, unused), no backend or scheduled
job, no auth or writes, no component library. Page load is ~18 API calls,
against a documented ceiling of ~1000/minute.
