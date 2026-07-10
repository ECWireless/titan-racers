import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextVitals,
  ...nextTypescript,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "out/**",
      "playwright-report/**",
      "public/vendor/**",
      "test-results/**",
      "next-env.d.ts",
      "*.tsbuildinfo",
    ],
  },
];

export default eslintConfig;
