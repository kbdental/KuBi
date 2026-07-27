import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', 'node_modules/.prisma/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      // Phase 0.5 §18: an injectable clock, everywhere. Roughly half of KuBi's
      // behaviour is time-triggered and is untestable if `new Date()` is called
      // directly. Enforced by lint rather than by code review.
      // NOTE: deliberately NOT no-restricted-globals on `Date` — `x instanceof Date`
      // and `Date` as a type are legitimate. Only the two clock-READING forms below
      // are forbidden, which is what actually makes behaviour untestable.
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date']",
          message: 'Do not call `new Date()`. Inject the Clock port (Phase 0.5 §18) so time-triggered behaviour is testable.',
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'Do not call `Date.now()`. Inject the Clock port (Phase 0.5 §18).',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // The clock rule cannot apply to the clock itself, nor to test fixtures and
    // one-off scripts that are not part of the runtime.
    files: ['apps/api/src/shared/clock.ts', 'tests/**/*.ts', 'scripts/**/*.ts', 'prisma/seed/**/*.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
);
