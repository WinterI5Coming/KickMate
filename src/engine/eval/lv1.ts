/**
 * Lv.1 수제 평가 함수 — 바닥이자 보험.
 * Lv.2(셀프플레이 학습, ONNX)가 실패해도 이 함수로 제품이 성립해야 한다.
 * TODO(S1): 프로토타입 평가 항목 이식 — 전진도, 슛 코스, 스틸 위협, 루즈볼 접근성.
 */

import type { EvalFn } from "../types";

export const evalLv1: EvalFn = (state, perspective) => {
  void state;
  void perspective;
  throw new Error("evalLv1: not implemented yet (S1)");
};
