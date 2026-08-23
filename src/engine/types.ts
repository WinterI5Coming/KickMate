/**
 * KickMate 엔진이 공통으로 사용하는 데이터 계약.
 *
 * `Team`, `Piece`, `GameState` 같은 타입 선언은 TypeScript가 코드를 검사할 때만
 * 사용되고 JavaScript로 변환되면 사라진다. 반면 `BOARD_W`, `BOARD_H`는 실행 중에도
 * 클라이언트와 엔진이 실제 값으로 공유한다.
 *
 * 이 모듈은 브라우저 화면과 무관한 순수 데이터만 정의한다. DOM, Canvas, Worker,
 * 파일시스템 타입을 넣지 않아야 브라우저 엔진과 Node.js 셀프플레이가 같은 상태와
 * 행동 타입을 사용할 수 있다.
 */

/** 13×9 보드의 가로·세로 칸 수. 유효한 좌표는 x=0..12, y=0..8이다. */
export const BOARD_W = 13;
export const BOARD_H = 9;

/**
 * 경기의 두 팀.
 *
 * 일반 `string`이 아니라 문자열 리터럴 union이므로 `"home"`, `"away"` 외의
 * 문자열은 타입 검사에서 거부된다. home은 왼쪽에서 오른쪽으로, away는 반대로
 * 공격한다.
 */
export type Team = "home" | "away";

/**
 * 기물의 역할. 역할에 따른 실제 이동 규칙은 `rules.ts`가 구현한다.
 *
 * GK: 골키퍼, DF: 수비수, MF: 미드필더, FW: 공격수.
 */
export type Role = "GK" | "DF" | "MF" | "FW";

/**
 * 보드의 논리 좌표.
 *
 * `number` 타입은 좌표 범위를 강제하지 않으므로 `{x: 99, y: -1}`도 타입 자체는
 * 만족한다. 실제로 보드 안에 있는지는 `rules.ts`의 `inBounds()`와 테스트가 검증한다.
 * Canvas 픽셀 좌표가 아니라 13×9 보드의 칸 좌표라는 점에 주의한다.
 */
export interface Pos {
  /** 왼쪽에서 오른쪽으로 증가하는 열 좌표. 정상 범위는 0..BOARD_W-1이다. */
  x: number;
  /** 위에서 아래로 증가하는 행 좌표. 정상 범위는 0..BOARD_H-1이다. */
  y: number;
}

/**
 * 경기장 위 기물 한 개.
 *
 * `id`는 공 소유와 Move가 기물을 안정적으로 참조하는 식별자다. 현재 초기 상태는
 * home 0..5, away 6..11을 사용한다. 타입은 ID의 고유성이나 좌표 중복까지 검사하지
 * 않으며, 그 불변 조건은 상태 생성 함수와 테스트가 책임진다.
 */
export interface Piece {
  /** 경기 안에서 기물을 구분하는 고유 숫자 식별자. */
  id: number;
  /** 기물이 소속된 팀. */
  team: Team;
  /** 이동 규칙과 위치 평가에 사용되는 역할. */
  role: Role;
  /** 기물이 현재 차지한 보드 칸. */
  pos: Pos;
}

/**
 * 공이 존재할 수 있는 두 상태를 표현하는 판별 유니온.
 *
 * - `held`: `pieceId`의 기물이 공을 소유한다. 공의 위치는 그 기물의 `pos`다.
 * - `loose`: 소유자가 없으며 공 자체가 `pos`에 놓인다.
 *
 * 두 경우 모두 `kind`를 가지므로 `ball.kind === "held"`처럼 검사하면 TypeScript가
 * 나머지 속성을 자동으로 좁힌다. 이 구조는 소유자와 별도 좌표가 동시에 존재하는
 * 모순된 상태를 타입 단계에서 막는다.
 */
export type BallState =
  | { kind: "held"; pieceId: number }
  | { kind: "loose"; pos: Pos };

/**
 * 팀이 경기 시작 시 선택하는 전술.
 *
 * - balanced: 현행 기본 규칙 그대로 (패스 6칸, 영향권 20%)
 * - tikitaka: 짧고 안전한 패스와 MF 중심 연결
 * - counter: 전방 장거리 전개와 FW의 전진 대시
 * - gegenpress: 압박 대시와 강한 패스 차단
 *
 * 전술은 경기 중 변경되지 않으며 상태 전이는 이 값을 읽기만 한다.
 */
export type TeamStyle = "balanced" | "tikitaka" | "counter" | "gegenpress";

/** 공을 잃은 팀의 다음 행동 하나를 막는 스틸 회수 유예를 기록한다. */
export interface StealProtection {
  pieceId: number;
  blockedTeam: Team;
  blockedActionsRemaining: 1;
}

/**
 * 특정 시점의 경기 전체를 재현하는 상태.
 *
 * 엔진 함수는 이 객체를 기준으로 합법 수를 만들고 다음 상태를 계산한다. 특히
 * `applyMove()`는 입력 GameState를 직접 변경하지 않고 복제한 새 GameState를
 * 반환해야 한다. 이 불변성 덕분에 탐색기가 하나의 상태에서 여러 후보 수를 안전하게
 * 비교할 수 있다.
 */
export interface GameState {
  /**
   * 지금까지 완료된 팀 턴 수(수).
   * 0부터 시작하며 팀 턴이 끝날 때(팀 교대·조기 종료·득점)마다 하나씩 증가한다.
   */
  turn: number;
  /** 이 값에 도달하면 더 이상 합법 수를 만들지 않는다. 한 수는 팀 턴 하나이며 기본값은 40수다. */
  maxTurns: number;
  /** 현재 3행동 팀 턴을 수행하는 팀. */
  activeTeam: Team;
  /** 현재 팀 턴에 아직 사용할 수 있는 행동 수. */
  actionsRemaining: number;
  /** 현재 팀 턴에서 각 기물이 사용한 행동 수. */
  actionCountByPiece: Record<number, number>;
  /** 버티기 후 한 번의 이동을 허용받은 기물 ID. */
  heldFirmPieceId: number | null;
  /** 양 팀이 경기 시작 시 선택한 전술. 경기 중 바뀌지 않는다. */
  teamStyles: Record<Team, TeamStyle>;
  /** 경기 중인 12개 기물. 각 팀은 GK 1명, DF 2명, MF 2명, FW 1명으로 구성된다. */
  pieces: Piece[];
  /** 현재 공의 소유 또는 루즈볼 위치. */
  ball: BallState;
  /** 직접 소유권을 얻은 기물의 1행동 스틸 보호 상태. */
  stealProtection: StealProtection | null;
  /** 양 팀의 누적 득점. 정상 경기에서는 0 이상의 정수다. */
  score: { home: number; away: number };
}

/**
 * 현재 `GameState`에서 계산한 경기 종료 결과.
 *
 * `kind`를 먼저 검사하면 TypeScript가 승리 결과에서만 `winner`를 사용할 수 있게
 * 타입을 좁힌다. 결과는 `GameState`에 저장하지 않고 룰 함수가 계산하므로 점수·턴과
 * 종료 정보가 서로 어긋나는 중복 상태를 만들지 않는다.
 */
export type GameResult =
  | { kind: "win"; winner: Team; reason: "scoreLimit" | "turnLimit" }
  | { kind: "draw"; reason: "turnLimit" };

/**
 * 한 ply에 적용할 수 있는 행동의 판별 유니온.
 *
 * 모든 행동은 `kind`와 실행 기물의 `pieceId`를 가진다. `kind`를 검사하면 해당
 * 행동에만 존재하는 `to`, `targetPieceId`, `goalRow`를 안전하게 사용할 수 있다.
 * 이 타입은 행동의 모양만 보장하며 실제 합법 여부는 `legalMoves()`가 결정한다.
 */
export type Move =
  /** 기물을 빈 목적지 칸으로 이동한다. */
  | { kind: "move"; pieceId: number; to: Pos }
  /** 공 소유자가 선택한 아군 기물에게 패스한다. */
  | { kind: "pass"; pieceId: number; targetPieceId: number }
  /** 공 소유자가 상대 골문의 위·가운데·아래 행 중 하나를 직접 겨냥한다. */
  | { kind: "shoot"; pieceId: number; goalRow: 3 | 4 | 5 }
  /** 인접한 상대 공 소유자에게서 공을 빼앗는다. */
  | { kind: "steal"; pieceId: number; targetPieceId: number }
  /** 압박받은 공 소유자가 다음 이동 한 번을 허용받는다. */
  | { kind: "hold"; pieceId: number }
  /** 남은 행동을 버리고 상대 팀 턴으로 넘긴다. */
  | { kind: "endTurn" };

/**
 * `Move`를 적용하기 전에 계산한 사용자 안내 및 상태 전이용 판정 결과.
 *
 * 패스와 슛은 동일한 공 경로를 사용한다. 경로 위 기물이 공을 먼저 만나면 선택한
 * 대상과 실제 수신자·차단자가 달라질 수 있으므로 그 결과를 명시적으로 보존한다.
 * `applyMove()`도 이 값을 사용해 화면의 예고와 실제 결과가 어긋나지 않게 한다.
 */
/** 슛의 첫 상대 접촉과 그에 따른 결정론적 공 상태를 설명한다. */
export interface ShootPreview {
  kind: "shoot";
  path: Pos[];
  goalRow: 3 | 4 | 5;
  /** 모든 개입이 성공했을 때 첫 개입자가 만드는 기하 결과. 확률 판정의 대표 차단 결과다. */
  outcome: "goal" | "goalkeeperSave" | "fieldRebound" | "fieldPossession";
  blockerPieceId: number | null;
  reboundPos: Pos | null;
  /** 경로 위·인접 개입을 모두 뚫고 득점할 확률. 0..1이며 개입이 없으면 1이다. */
  goalChance: number;
}

export type MovePreview =
  | { kind: "move"; destination: Pos; picksUpLooseBall: boolean }
  | {
      kind: "pass";
      path: Pos[];
      targetPieceId: number;
      receiverPieceId: number;
      reachesTarget: boolean;
      /** 영향권 인터셉트를 모두 피해 첫 접촉 수신자에게 닿을 확률. 0..1이다. */
      arrivalChance: number;
    }
  | ShootPreview
  | {
      kind: "steal";
      targetPieceId: number;
      protectedAfter: true;
      /** 시도 선수의 역할에 따른 스틸 성공 확률. 0..1이다. */
      successChance: number;
    }
  | { kind: "hold" }
  | { kind: "endTurn" };

/**
 * 하나의 Move가 만들 수 있는 결과 상태와 그 확률.
 *
 * 확률은 0 초과 1 이하이며 같은 Move의 모든 결과 확률 합은 1이다. 결정론적 행동은
 * 확률 1의 결과 하나만 갖는다. 탐색은 이 분포의 기대값으로 수를 평가하고, 실제 경기는
 * 상태·수 해시 시드로 이 중 하나를 결정적으로 선택한다.
 */
export interface MoveOutcome {
  probability: number;
  state: GameState;
  /** 결과를 사람이 구분할 수 있는 짧은 표식. 판정 로그와 테스트에 사용한다. */
  tag:
    | "deterministic"
    | "goal"
    | "goalkeeperSave"
    | "fieldRebound"
    | "fieldPossession"
    | "zoneIntercept"
    | "received"
    | "offTarget"
    | "stealSuccess"
    | "stealFailed";
}

/**
 * 한 국면을 특정 팀 관점의 숫자로 바꾸는 평가 함수 계약.
 *
 * 양수는 `perspective` 팀에게 유리하고 음수는 불리하다는 뜻이다. 현재 `evalLv1`이
 * 이 계약을 구현한다. 탐색기는 구체적인 평가 방식 대신 이 타입을 입력받으므로
 * 나중에 Lv.2나 학습 기반 평가 함수로 교체할 수 있다.
 */
export type EvalFn = (state: GameState, perspective: Team) => number;

/**
 * `search()`가 루트 탐색을 마친 뒤 반환하는 분석 결과.
 *
 * 봇은 `best`를 사용해 수를 선택하고, 분석 UI는 `values`에서 사용자의 수와 최선
 * 수의 점수 차이를 계산해 좋은 수·실수·블런더 등을 판정할 수 있다.
 */
export interface SearchResult {
  /** 가장 높은 평가를 받은 수. 종료 상태처럼 후보가 없으면 null이다. */
  best: Move | null;
  /** 현재 루트 차례 팀 관점에서 본 최선 후보의 평가 점수. */
  score: number;
  /** 고정 루트 관점 minimax가 방문한 하위 상태 수. 탐색 성능을 관찰하는 지표다. */
  nodes: number;
  /** 호출자가 요청했고 실제 탐색 결과에 기록된 ply 깊이. */
  depth: number;
  /** 탐색에 걸린 밀리초. 실행 환경에 따라 달라지며 결정론 비교 대상이 아니다. */
  ms: number;
  /** 블런더 판정을 위해 보존하는 모든 루트 후보와 각각의 평가 점수. */
  values: Array<{ move: Move; score: number }>;
}
