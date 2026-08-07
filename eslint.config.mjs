// Konfigurasi ESLint dasar (flat config) yang dipakai bersama oleh semua apps & packages.
// Tiap app punya eslint.config.mjs sendiri yang meng-import config ini lalu menambah
// aturan spesifik framework-nya (Next.js, Preact, NestJS).
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/** Folder yang tidak pernah di-lint di seluruh monorepo. */
export const ignores = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/coverage/**',
  '**/*.config.js',
  '**/next-env.d.ts',
];

/** @type {import('eslint').Linter.Config[]} */
export const baseConfig = [
  { ignores },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.es2023 },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'object-shorthand': 'warn',
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  // Prettier harus terakhir supaya mematikan rule yang bentrok dengan formatting.
  prettier,
];

export default baseConfig;
