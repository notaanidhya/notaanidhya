#!/usr/bin/env node
/**
 * generate-snake.mjs
 * Generates a snake animation SVG from a GitHub user's contribution
 * calendar, but only over the most recent N weeks (default 26 = half a year),
 * and at a configurable speed.
 *
 * Env vars:
 *   GITHUB_TOKEN   - required, needs read access to the user's contributions
 *   GITHUB_USER    - github username (default: repo owner via GITHUB_ACTOR)
 *   WEEKS_TO_SHOW  - number of weeks to include (default: 26)
 *   STEP_SECONDS   - time per cell-move, higher = slower snake (default: 0.25)
 *   DARK           - "1" for dark theme, unset/"0" for light
 *   OUT_FILE       - output path (default: dist/github-snake.svg)
 */

import fs from "fs";
import path from "path";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const USERNAME = process.env.GITHUB_USER || process.env.GITHUB_ACTOR;
const WEEKS_TO_SHOW = Number(process.env.WEEKS_TO_SHOW || 26);
const STEP_SECONDS = Number(process.env.STEP_SECONDS || 0.25);
const DARK = process.env.DARK === "1";
const OUT_FILE = process.env.OUT_FILE || "dist/github-snake.svg";

const CELL = 12;
const GAP = 3;
const PAD = 10;
const SNAKE_LENGTH = 4;

const COLORS_LIGHT = ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"];
const COLORS_DARK = ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"];
const BG = DARK ? "#0d1117" : "#ffffff";
const SNAKE_COLOR = "#ff5c5c";

if (!GITHUB_TOKEN || !USERNAME) {
  console.error("Missing GITHUB_TOKEN or GITHUB_USER/GITHUB_ACTOR");
  process.exit(1);
}

async function fetchCalendar() {
  const query = `
    query($login: String!) {
      user(login: $login) {
        contributionsCollection {
          contributionCalendar {
            weeks {
              contributionDays { contributionCount date weekday }
            }
          }
        }
      }
    }`;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${GITHUB_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables: { login: USERNAME } }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data.user.contributionsCollection.contributionCalendar.weeks;
}

function levelFor(count) {
  if (count === 0) return 0;
  if (count < 3) return 1;
  if (count < 6) return 2;
  if (count < 10) return 3;
  return 4;
}

function buildPath(grid) {
  // boustrophedon traversal: down col 0, up col 1, down col 2, ...
  const p = [];
  for (let c = 0; c < grid.length; c++) {
    const rows = [...Array(7).keys()];
    if (c % 2 === 1) rows.reverse();
    for (const r of rows) p.push({ c, r });
  }
  return p;
}

async function main() {
  const weeks = await fetchCalendar();
  const recentWeeks = weeks.slice(-WEEKS_TO_SHOW);

  const grid = recentWeeks.map((w) => {
    // GitHub can return partial weeks at the calendar edges, so days are
    // placed by their actual weekday index (0=Sun..6=Sat), not array order.
    const days = Array.from({ length: 7 }, () => ({ count: 0, level: 0 }));
    for (const d of w.contributionDays) {
      days[d.weekday] = { count: d.contributionCount, level: levelFor(d.contributionCount) };
    }
    return days;
  });

  const traversal = buildPath(grid);
  const colors = DARK ? COLORS_DARK : COLORS_LIGHT;
  const cols = grid.length;
  const width = PAD * 2 + cols * (CELL + GAP);
  const height = PAD * 2 + 7 * (CELL + GAP);
  const totalSteps = traversal.length;
  const totalDuration = totalSteps * STEP_SECONDS;

  let svg = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="background:${BG}">\n`;

  // draw + fade-out cells as the snake "eats" them
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < 7; r++) {
      const cell = grid[c][r];
      const x = PAD + c * (CELL + GAP);
      const y = PAD + r * (CELL + GAP);
      const idx = traversal.findIndex((p) => p.c === c && p.r === r);
      const eatTime = (idx * STEP_SECONDS).toFixed(2);
      const startColor = colors[cell.level];
      svg += `  <rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" fill="${startColor}">`;
      if (cell.level > 0) {
        svg += `<animate attributeName="fill" values="${startColor};${colors[0]}" dur="0.2s" begin="${eatTime}s; cycle.repeatEvent+${eatTime}s" fill="freeze"/>`;
      }
      svg += `</rect>\n`;
    }
  }

  // snake body segments
  for (let s = 0; s < SNAKE_LENGTH; s++) {
    const xs = [];
    const ys = [];
    const keyTimes = [];
    for (let i = 0; i < totalSteps; i++) {
      const p = traversal[Math.max(0, i - s)];
      xs.push(PAD + p.c * (CELL + GAP));
      ys.push(PAD + p.r * (CELL + GAP));
      keyTimes.push((i / (totalSteps - 1)).toFixed(4));
    }
    const opacity = (1 - s * 0.15).toFixed(2);
    const idAttr = s === 0 ? ` id="cycle"` : "";
    svg += `  <rect width="${CELL}" height="${CELL}" rx="3" fill="${SNAKE_COLOR}" opacity="${opacity}">
    <animate${idAttr} attributeName="x" values="${xs.join(";")}" keyTimes="${keyTimes.join(";")}" dur="${totalDuration.toFixed(2)}s" repeatCount="indefinite" calcMode="discrete"/>
    <animate attributeName="y" values="${ys.join(";")}" keyTimes="${keyTimes.join(";")}" dur="${totalDuration.toFixed(2)}s" repeatCount="indefinite" calcMode="discrete"/>
  </rect>\n`;
  }

  svg += `</svg>\n`;

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, svg);
  console.log(`Wrote ${OUT_FILE}: ${cols} weeks, step=${STEP_SECONDS}s, total cycle=${totalDuration.toFixed(1)}s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
