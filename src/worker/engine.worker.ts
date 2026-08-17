/// <reference lib="webworker" />
/**
 * 클라이언트의 메시지를 순수 엔진 함수 호출로 바꾸는 Web Worker 어댑터.
 *
 * 무거운 `search()`를 메인 스레드 밖에서 실행해 탐색 중에도 Canvas 렌더링과 사용자
 * 입력이 멈추지 않게 한다. 게임 규칙·평가·탐색은 모두 `src/engine/`에 있고, 이 파일은
 * `WorkerRequest`를 받아 해당 함수를 호출한 뒤 `WorkerResponse`로 결과를 돌려주기만 한다.
 *
 * 첫 줄의 triple-slash directive는 TypeScript가 이 파일에서 `self`, `onmessage`,
 * `postMessage` 같은 Web Worker 전용 전역 API의 타입을 사용하도록 지정한다.
 */

import { legalMoves } from "../engine/rules";
import { search } from "../engine/search";
import { evalLv1 } from "../engine/eval/lv1";
import type { WorkerRequest, WorkerResponse } from "./protocol";

/**
 * 클라이언트로 보내는 모든 메시지가 공용 `WorkerResponse` 프로토콜을 따르게 한다.
 * `self`는 DOM의 `window`가 아니라 현재 Worker 실행 환경을 나타내는 전역 객체다.
 */
const post = (msg: WorkerResponse) => self.postMessage(msg);

/**
 * 클라이언트가 보낸 요청 하나를 받아 엔진 작업을 실행하고 같은 requestId로 응답한다.
 *
 * `MessageEvent<WorkerRequest>`는 `e.data`의 정적 타입을 지정할 뿐, 실행 중 들어온 값을
 * 스키마로 검증하지는 않는다. 같은 프로젝트의 TypeScript 클라이언트가 `protocol.ts`의
 * 계약을 지켜 메시지를 보낸다는 전제다.
 */
self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    // 판별 필드 type을 검사하면 TypeScript가 각 요청에서 사용할 수 있는 필드를 좁힌다.
    switch (req.type) {
      case "analyze":
        // 평가 함수는 Worker 내부에서 Lv.1로 선택하고 클라이언트는 상태와 깊이만 전달한다.
        post({
          type: "analysis",
          requestId: req.requestId,
          result: search(req.state, { depth: req.depth, evalFn: evalLv1 }),
        });
        break;
      case "legalMoves":
        // 미래 탐색 없이 현재 상태에서 바로 선택할 수 있는 Move 목록만 계산한다.
        post({ type: "legalMoves", requestId: req.requestId, moves: legalMoves(req.state) });
        break;
    }
  } catch (err) {
    // JavaScript는 Error가 아닌 값도 throw할 수 있으므로 모든 경우를 문자열로 정규화한다.
    post({
      type: "error",
      // 성공 여부와 관계없이 요청 ID를 되돌려 클라이언트가 원래 작업과 연결할 수 있게 한다.
      requestId: req.requestId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
