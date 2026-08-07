/**
 * @file eslint.config.mjs
 * @brief Flat ESLint config — correctness rules only, formatting left to Prettier.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * Scope is deliberately narrow. `tsc --strict` already covers types, so the
 * rules kept here are the ones a type checker cannot see: floating promises,
 * unhandled awaits, React hook dependencies, and — the one that encodes a
 * project invariant rather than a general good practice — the no-Electron rule
 * for `electron/services/`.
 *
 * `eslint-config-prettier` is last so no stylistic rule can fight the
 * formatter; if a rule is about whitespace, Prettier owns it.
 */

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'dist-cli/**',
      'dist-electron/**',
      'release/**',
      'build/**',
      'promo/**',
      'scripts/fixtures/**',
      'eslint.config.mjs',
      // Plain-JS dev utilities, outside the typechecked projects.
      '**/*.mjs',
      '**/*.cjs',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // An unused parameter is usually a signature being honoured, an unused
      // local almost never is — so allow the first and flag the second.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // The pollers and IPC handlers are full of deliberate fire-and-forget
      // calls; they are marked with `void`, and this rule is what makes the
      // ones that AREN'T marked visible.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { arguments: false, attributes: false } },
      ],
      // Template literals over snapshot values are everywhere and harmless.
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },

  // Renderer: hook rules matter, Node globals do not.
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,

      /**
       * Three React-Compiler-era rules are WARN, not off and not error.
       *
       * They flag real patterns — a `setState` in an effect to mirror a prop
       * into a draft, the virtualizer reading its own ref during render,
       * `Date.now()` inside a `useMemo` — none of which are wrong today, and
       * all of which need the component restructured rather than patched.
       * There are no renderer tests yet (see docs/comparative-review.md §4.2),
       * so silently rewriting fifteen call sites would trade a lint warning
       * for an unverified behaviour change.
       *
       * Warn keeps them counted and visible instead of disabled and forgotten.
       * Promote to error once the components they touch have tests.
       */
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/purity': 'warn',
    },
  },

  /**
   * The rule that keeps `npm run smoke`, the CLI and every service unit test
   * possible: nothing under `electron/services/` may import Electron at
   * runtime. A service that needs an Electron API takes it INJECTED — see
   * `deepseek-key.ts` receiving a `KeyCrypto` that main backs with
   * `safeStorage`. Type-only imports erase at build time, so they are allowed.
   */
  {
    files: ['electron/services/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'electron',
              message:
                'electron/services must stay pure Node (smoke + CLI + unit tests depend on it). ' +
                'Inject the Electron API instead, or use `import type`.',
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },

  // Tests and build scripts: looser, and they legitimately poke at internals.
  {
    files: ['**/__tests__/**/*.ts', 'scripts/**/*.ts'],
    rules: {
      // Build scripts lazily `require()` optional dev-only tooling on purpose,
      // so the bundle never pulls it in.
      '@typescript-eslint/no-require-imports': 'off',
      // A `fetch` stub has to be promise-returning to be a valid stub, whether
      // or not its body happens to await anything.
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
    },
  },

  prettier,
);
