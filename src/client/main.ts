/**
 * 클라이언트 부트스트랩. 지금은 초기 국면 렌더까지만 — 입력·대국 루프는 S1에서.
 * 색·문구는 코드에 하드코딩하지 않고 content/에서 가져온다 (비개발자가 소유하는 영역).
 */

import { createInitialState } from "../engine/rules";
import { BOARD_H, BOARD_W } from "../engine/types";
import theme from "../../content/theme.json";
import strings from "../../content/strings.json";

const canvas = document.getElementById("board") as HTMLCanvasElement; // html의 canvas 요소 가져오기
const ctx = canvas.getContext("2d")!; // canvas에 그릴 수 있는 context 요소 가져오기

const CELL = Math.floor(canvas.width / BOARD_W);

/**
 * ctx에는 다음과 같은 그리기 함수가 존재한다.
 *  - fillRect() : 채워진 사각형
 *  - strokeRect() : 사각형 테두리
 *  - arc() : 원 경로
 *  - fill() : 경로 내부 채우기
 *  - fillText() : 글자
 *
 * 이 함수들을 호출해서 브라우저가 Canvas 픽실 바꾸도록 한다.
 */

function render(): void {
  /**
   * Canvas에 그림을 그리는 함수
   *
   *  1. createInitialState() : 초기 게임 데이터 만드는 함수
   *    그림을 그리는 것이 아니라 게임 상태 데이터만 생성한다.
   *      => home 팀의 각 선수들은 어디 위치에 생성해줘야 하는가? 등등
   *
   *  2. 경기장 랜더링
   */

  // 1.
  const state = createInitialState();

  // 2.피치
  ctx.fillStyle = theme.board.grass;
  ctx.fillRect(0, 0, canvas.width, canvas.height); // 원하는 크기의 사각형을 Canvas에 그린 후 색칠

  // 그 위에 보드칸 그리기 위한 반복문 실행
  ctx.strokeStyle = theme.board.line;
  for (let x = 0; x <= BOARD_W; x++) {
    for (let y = 0; y <= BOARD_H; y++) {
      ctx.strokeRect(x * CELL, y * CELL, CELL, CELL);
    }
  }

  // 3. 기물

  // 게임 상태의 기물을 하나씩 읽어들이는 반복문
  for (const piece of state.pieces) {
    // 보드 좌표를 Canvas 픽셀 좌표로 변환
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

  // 4. 공
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
