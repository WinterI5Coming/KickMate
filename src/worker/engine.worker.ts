/// <reference lib="webworker" />
/**
 * 엔진을 Web Worker에서 돌리는 어댑터 — 탐색 중에도 UI가 얼지 않게.
 * 엔진 로직은 전부 src/engine/에 있고 여기는 메시지 중계만 한다.
 */

import { legalMoves } from "../engine/rules";
import { search } from "../engine/search";
import { evalLv1 } from "../engine/eval/lv1";
import type { WorkerRequest, WorkerResponse } from "./protocol";

const post = (msg: WorkerResponse) => self.postMessage(msg);

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    switch (req.type) {
      case "analyze":
        post({
          type: "analysis",
          requestId: req.requestId,
          result: search(req.state, { depth: req.depth, evalFn: evalLv1 }),
        });
        break;
      case "legalMoves":
        post({ type: "legalMoves", requestId: req.requestId, moves: legalMoves(req.state) });
        break;
    }
  } catch (err) {
    post({
      type: "error",
      requestId: req.requestId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
