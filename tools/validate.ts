/**
 * content/ 검증기 — 비개발자 안전망의 핵심.
 * JSON을 고친 뒤 `npm run validate`(또는 `npm run check`)가 초록이면 머지해도 안전하다.
 * TODO(S3): 룰 이식 후 퍼즐 자동 검산 추가 — 엔진 탐색으로 "정말 N턴 안에 골이 가능한가" 확인.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { BOARD_H, BOARD_W } from "../src/engine/types.ts";

const CONTENT_DIR = join(import.meta.dirname, "..", "content");
const ROLES = ["GK", "DF", "MF", "FW"] as const;
const TEAMS = ["home", "away"] as const;
const BOARD_COLORS = [
  "grass",
  "line",
  "ball",
  "pieceText",
  "selected",
  "moveTarget",
  "passTarget",
  "shootTarget",
  "stealTarget",
  "lastMove",
] as const;
const MATCH_STRINGS = [
  "goal",
  "save",
  "steal",
  "turnLimit",
  "start",
  "newGame",
  "move",
  "pass",
  "shoot",
  "ready",
  "humanTurn",
  "botThinking",
  "botRetry",
  "homeWin",
  "awayWin",
  "draw",
  "selectOwn",
  "cannotSteal",
  "invalidShot",
  "fatalError",
] as const;

const errors: string[] = [];
const fail = (file: string, msg: string) => errors.push(`${file}: ${msg}`);

function loadJson(relPath: string): any {
  const full = join(CONTENT_DIR, relPath);
  try {
    return JSON.parse(readFileSync(full, "utf-8"));
  } catch (e) {
    fail(relPath, `JSON 파싱 실패 — ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

// --- theme.json ---
const theme = loadJson("theme.json");
if (theme) {
  const isColor = (v: unknown) => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
  for (const key of BOARD_COLORS) {
    if (!isColor(theme.board?.[key])) fail("theme.json", `board.${key}가 #rrggbb 색이 아님`);
  }
  for (const key of TEAMS) {
    if (!isColor(theme.team?.[key])) fail("theme.json", `team.${key}가 #rrggbb 색이 아님`);
  }
}

// --- strings.json ---
const strings = loadJson("strings.json");
if (strings) {
  const walk = (obj: any, path: string) => {
    for (const [k, v] of Object.entries(obj)) {
      if (k === "$comment") continue;
      if (typeof v === "object" && v !== null) walk(v, `${path}${k}.`);
      else if (typeof v !== "string" || v.trim() === "")
        fail("strings.json", `${path}${k}가 비어 있거나 문자열이 아님`);
    }
  };
  walk(strings, "");
  for (const section of ["app", "judgement", "match"]) {
    if (!strings[section]) fail("strings.json", `필수 섹션 ${section} 없음`);
  }
  for (const key of MATCH_STRINGS) {
    if (typeof strings.match?.[key] !== "string" || strings.match[key].trim() === "") {
      fail("strings.json", `match.${key}가 비어 있거나 문자열이 아님`);
    }
  }
}

// --- pieces.json ---
const pieces = loadJson("pieces.json");
if (pieces) {
  for (const role of ROLES) {
    const spec = pieces.roles?.[role];
    if (!spec) fail("pieces.json", `역할 ${role} 정의 없음`);
    else {
      if (!["box", "line", "omni", "knight"].includes(spec.move?.pattern))
        fail("pieces.json", `${role}.move.pattern이 box|line|omni|knight가 아님`);
      if (!Number.isInteger(spec.move?.range) || spec.move.range < 1)
        fail("pieces.json", `${role}.move.range는 1 이상 정수여야 함`);
    }
  }
  if (!Number.isInteger(pieces.rules?.maxTurns) || pieces.rules.maxTurns < 2)
    fail("pieces.json", "rules.maxTurns는 2 이상 정수여야 함");
}

// --- puzzles/*.json ---
const puzzleDir = join(CONTENT_DIR, "puzzles");
for (const file of readdirSync(puzzleDir).filter((f) => f.endsWith(".json"))) {
  const rel = `puzzles/${file}`;
  const pack = loadJson(rel);
  if (!pack) continue;
  if (typeof pack.pack !== "string" || !pack.pack) fail(rel, "pack 이름 없음");
  if (!Array.isArray(pack.puzzles) || pack.puzzles.length === 0) {
    fail(rel, "puzzles 배열이 비어 있음");
    continue;
  }
  const seenIds = new Set<string>();
  for (const pz of pack.puzzles) {
    const where = `퍼즐 ${pz.id ?? "(id 없음)"}`;
    if (typeof pz.id !== "string" || !pz.id) fail(rel, `${where}: id 필요`);
    else if (seenIds.has(pz.id)) fail(rel, `${where}: id 중복`);
    else seenIds.add(pz.id);
    if (!Number.isInteger(pz.goalInTurns) || pz.goalInTurns < 1)
      fail(rel, `${where}: goalInTurns는 1 이상 정수`);
    if (!TEAMS.includes(pz.sideToMove)) fail(rel, `${where}: sideToMove는 home|away`);
    const ps = pz.setup?.pieces;
    if (!Array.isArray(ps) || ps.length === 0) {
      fail(rel, `${where}: setup.pieces 필요`);
      continue;
    }
    const seenCells = new Set<string>();
    for (const p of ps) {
      if (!TEAMS.includes(p.team)) fail(rel, `${where}: team은 home|away`);
      if (!ROLES.includes(p.role)) fail(rel, `${where}: role은 GK|DF|MF|FW`);
      if (!Number.isInteger(p.x) || p.x < 0 || p.x >= BOARD_W || !Number.isInteger(p.y) || p.y < 0 || p.y >= BOARD_H)
        fail(rel, `${where}: (${p.x},${p.y})가 보드(${BOARD_W}×${BOARD_H}) 밖`);
      const cell = `${p.x},${p.y}`;
      if (seenCells.has(cell)) fail(rel, `${where}: (${cell}) 칸에 기물 중복`);
      seenCells.add(cell);
    }
    const held = pz.setup?.ball?.heldBy;
    const loose = pz.setup?.ball?.pos;
    if (held) {
      if (!ps.some((p: any) => p.team === held.team && p.role === held.role))
        fail(rel, `${where}: ball.heldBy(${held.team} ${held.role})에 해당하는 기물이 setup에 없음`);
    } else if (!loose) {
      fail(rel, `${where}: ball은 heldBy 또는 pos 중 하나 필요`);
    }
  }
}

if (errors.length > 0) {
  console.error(`✗ content 검증 실패 (${errors.length}건)\n`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log("✓ content 검증 통과");
