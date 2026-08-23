/**
 * 셀프플레이 하네스 — Node 헤드리스로 봇 vs 봇을 실행해 전술 밸런스를 실측한다.
 *
 * 엔진과 판정이 결정론적이므로 같은 매치업은 언제나 같은 경기가 된다. 따라서 표본은
 * "여러 판"이 아니라 서로 다른 매치업의 전수 실행이다. 기본 실행은 4개 전술의
 * 홈·어웨이 순서쌍 16개 매치업을 실제 브라우저 봇과 같은 깊이로 완주한다.
 *
 * 사용: node --experimental-strip-types tools/selfplay.ts [--depth 3]
 */

import { evalLv1 } from "../src/engine/eval/lv1.ts";
import { applyMove, createInitialState, gameResult } from "../src/engine/rules.ts";
import { search } from "../src/engine/search.ts";
import type { GameState, TeamStyle } from "../src/engine/types.ts";

const STYLES: TeamStyle[] = ["balanced", "tikitaka", "counter", "gegenpress"];

const depthArgIndex = process.argv.indexOf("--depth");
const DEPTH = depthArgIndex >= 0 ? Number(process.argv[depthArgIndex + 1]) : 3;
if (!Number.isInteger(DEPTH) || DEPTH < 1 || DEPTH > 4) {
  console.error(`잘못된 깊이입니다: ${process.argv[depthArgIndex + 1]}`);
  process.exit(1);
}

const maxTurnsArgIndex = process.argv.indexOf("--max-turns");
const MAX_TURNS =
  maxTurnsArgIndex >= 0 ? Number(process.argv[maxTurnsArgIndex + 1]) : null;
if (MAX_TURNS !== null && (!Number.isInteger(MAX_TURNS) || MAX_TURNS < 12 || MAX_TURNS > 400)) {
  console.error(`잘못된 수 한도입니다: ${process.argv[maxTurnsArgIndex + 1]}`);
  process.exit(1);
}

interface MatchRecord {
  home: TeamStyle;
  away: TeamStyle;
  score: { home: number; away: number };
  plies: number;
  winner: "home" | "away" | "draw";
  /** 3골 선취(scoreLimit)로 끝났는지, 수 한도(turnLimit)로 끝났는지. */
  reason: "scoreLimit" | "turnLimit";
  ms: number;
}

/** 한 매치업을 양 팀 모두 depth 탐색 봇으로 완주한다. */
function playMatch(home: TeamStyle, away: TeamStyle): MatchRecord {
  const startedAt = Date.now();
  let state: GameState = createInitialState({ home, away });
  if (MAX_TURNS !== null) state = { ...state, maxTurns: MAX_TURNS };
  let plies = 0;

  while (gameResult(state) === null) {
    const result = search(state, { depth: DEPTH, evalFn: evalLv1 });
    if (!result.best) break;
    state = applyMove(state, result.best);
    plies += 1;
    // endTurn은 turn을 늘리지 않으므로 무한 루프 방지용 상한을 따로 둔다.
    if (plies > 400) break;
  }

  const outcome = gameResult(state);
  return {
    home,
    away,
    score: { ...state.score },
    plies,
    winner:
      outcome?.kind === "win" ? outcome.winner : outcome?.kind === "draw" ? "draw" : "draw",
    reason: outcome?.reason ?? "turnLimit",
    ms: Date.now() - startedAt,
  };
}

const records: MatchRecord[] = [];
console.log(
  `셀프플레이: 전술 ${STYLES.length}종 × 홈·어웨이 = 16개 매치업, 깊이 ${DEPTH}` +
    (MAX_TURNS !== null ? `, 수 한도 ${MAX_TURNS}` : ""),
);
for (const home of STYLES) {
  for (const away of STYLES) {
    const record = playMatch(home, away);
    records.push(record);
    console.log(
      `HOME ${record.home.padEnd(10)} vs AWAY ${record.away.padEnd(10)} → ` +
        `${record.score.home}:${record.score.away} (${record.winner}, ${record.plies}수, ` +
        `${record.reason === "scoreLimit" ? "3골 선취" : "수 한도"}, ${(record.ms / 1000).toFixed(1)}s)`,
    );
  }
}

// 전술별 집계: 각 전술은 홈 4판 + 어웨이 4판 = 8판에 출전한다.
console.log("\n=== 전술별 집계 (8판 기준) ===");
for (const style of STYLES) {
  let wins = 0;
  let draws = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;
  for (const record of records) {
    if (record.home === style) {
      if (record.winner === "home") wins += 1;
      if (record.winner === "draw") draws += 1;
      goalsFor += record.score.home;
      goalsAgainst += record.score.away;
    }
    if (record.away === style) {
      if (record.winner === "away") wins += 1;
      if (record.winner === "draw") draws += 1;
      goalsFor += record.score.away;
      goalsAgainst += record.score.home;
    }
  }
  const played = 8;
  const winRate = ((wins + draws * 0.5) / played) * 100;
  console.log(
    `${style.padEnd(10)} ${wins}승 ${draws}무 ${played - wins - draws}패 · ` +
      `승률(무=0.5) ${winRate.toFixed(0)}% · 득 ${goalsFor} 실 ${goalsAgainst}`,
  );
}

const homeWins = records.filter((record) => record.winner === "home").length;
const awayWins = records.filter((record) => record.winner === "away").length;
const draws = records.filter((record) => record.winner === "draw").length;
const totalGoals = records.reduce(
  (sum, record) => sum + record.score.home + record.score.away,
  0,
);
console.log("\n=== 전체 ===");
console.log(`홈 ${homeWins}승 / 어웨이 ${awayWins}승 / 무 ${draws} (선공 밸런스)`);
console.log(
  `3골 선취 종료 ${records.filter((record) => record.reason === "scoreLimit").length} / ${records.length}`,
);
console.log(
  `평균 골 ${(totalGoals / records.length).toFixed(2)} · 평균 수 ${(
    records.reduce((sum, record) => sum + record.plies, 0) / records.length
  ).toFixed(1)}`,
);
