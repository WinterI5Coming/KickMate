import ts from "typescript";

// 테스트 변환을 현재 프로세스에서 수행해 제한된 CI/샌드박스에서도 자식 프로세스 없이 검증한다.
export default {
  esbuild: false,
  plugins: [
    {
      name: "typescript-in-process",
      enforce: "pre",
      transform(code, id) {
        if (!id.endsWith(".ts")) return null;
        return {
          code: ts.transpileModule(code, {
            compilerOptions: {
              module: ts.ModuleKind.ESNext,
              target: ts.ScriptTarget.ES2022,
              sourceMap: true,
            },
            fileName: id,
          }).outputText,
          map: null,
        };
      },
    },
  ],
  resolve: {
    preserveSymlinks: true,
  },
  test: {
    pool: "threads",
  },
};
