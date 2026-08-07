import globals from 'globals';
import { baseConfig } from '../../eslint.config.mjs';

/** @type {import('eslint').Linter.Config[]} */
export default [
  ...baseConfig,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
];
