/**
 * 클라이언트 부트스트랩. 지금은 초기 국면 렌더까지만 — 입력·대국 루프는 S1에서.
 * 색·문구는 코드에 하드코딩하지 않고 content/에서 가져온다 (비개발자가 소유하는 영역).
 */

import { createInitialState } from "../engine/rules";
import { BOARD_H, BOARD_W } from "../engine/types";
import theme from "../../content/theme.json";
import strings from "../../content/strings.json";

const canvas = document.getElementById("board") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

const CELL = Math.floor(canvas.width / BOARD_W);

function render(): void {
  const state = createInitialState();

  // 피치
  ctx.fillStyle = theme.board.grass;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = theme.board.line;
  for (let x = 0; x <= BOARD_W; x++) {
    for (let y = 0; y <= BOARD_H; y++) {
      ctx.strokeRect(x * CELL, y * CELL, CELL, CELL);
    }
  }

  // 기물
  for (const piece of state.pieces) {
    const cx = piece.pos.x * CELL + CELL / 2;
    const cy = piece.pos.y * CELL + CELL / 2;
    ctx.fillStyle = piece.team === "home" ? theme.team.home : theme.team.away;
    ctx.beginPath();
    ctx.arc(cx, cy, CELL * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = theme.board.pieceText;
    ctx.font = `bold ${Math.floor(CELL * 0.28)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(piece.role, cx, cy);
  }

  // 공
  if (state.ball.kind === "loose") {
    const bx = state.ball.pos.x * CELL + CELL / 2;
    const by = state.ball.pos.y * CELL + CELL / 2;
    ctx.fillStyle = theme.board.ball;
    ctx.beginPath();
    ctx.arc(bx, by, CELL * 0.15, 0, Math.PI * 2);
    ctx.fill();
  }

  document.title = strings.app.title;
}

render();
