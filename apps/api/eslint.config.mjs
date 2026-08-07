import { baseConfig } from '../../eslint.config.mjs';

/** @type {import('eslint').Linter.Config[]} */
export default [
  ...baseConfig,
  {
    files: ['src/**/*.ts'],
    rules: {
      // NestJS mengandalkan emitDecoratorMetadata: import class yang dipakai sebagai
      // tipe parameter constructor harus tetap import biasa, bukan `import type`.
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
];
