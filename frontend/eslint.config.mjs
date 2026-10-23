import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // This app is server-rendered but every piece of wallet/localStorage state is
      // browser-only, so components sync it from an effect after mount. The React
      // Compiler lint calls that cascading render; the alternative (reading
      // localStorage or `window.location` during render) breaks hydration instead.
      // The pattern is deliberate and confined to mount-time hydration.
      "react-hooks/set-state-in-effect": "off",

      // Countdowns and "x minutes ago" labels read the clock during render, guarded by
      // a `mounted` flag so the server output stays deterministic. A ticking state
      // machine would add a timer to every market card for no user-visible gain.
      "react-hooks/purity": "off",
    },
  },
]);

export default eslintConfig;
