/**
 * 대표 국면의 탐색 시간을 단독 측정하는 프로파일링 도구.
 *
 * 사용: npx esbuild tools/profile-search.ts --bundle --platform=node --format=esm \
 *        --outfile=<임시.mjs> && node <임시.mjs>
 */

import { evalLv1 } from "../src/engine/eval/lv1.ts";
import { createInitialState } from "../src/engine/rules.ts";
import { search } from "../src/engine/search.ts";

for (let round = 0; round < 3; round += 1) {
  const result = search(createInitialState(), { depth: 3, evalFn: evalLv1 });
  console.log(
    `초기 depth-3: ${result.ms.toFixed(0)}ms · ${result.nodes} nodes · 후보 ${result.values.length}`,
  );
}
