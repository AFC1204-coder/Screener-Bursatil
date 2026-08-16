// Config mínima: solo cazar errores reales (variables/funciones sin
// definir, referencias muertas tras un borrado a medias). No hay reglas de
// estilo — un linter que discute formato deja de leerse. Ver AGENTS.md.
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    // El repo tiene comentarios `eslint-disable(-next-line)` heredados de
    // una config anterior más grande (react-hooks/exhaustive-deps,
    // no-console...). Con esta config mínima esas reglas no existen, y
    // sin esto ESLint fallaría por comentarios de supresión que ya no
    // apuntan a nada — ruido ajeno al objetivo (no-undef).
    linterOptions: { reportUnusedDisableDirectives: "off" },
  },
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "coverage/**",
      "public/**",
    ],
  },
  {
    files: ["**/*.{js,jsx,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
      },
    },
    plugins: {
      // Solo registrado para que los comentarios `eslint-disable` heredados
      // (react-hooks/exhaustive-deps) resuelvan a una regla real; la regla
      // no se activa, no es parte del objetivo de esta config.
      "react-hooks": reactHooks,
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": "off",
    },
  },
];
