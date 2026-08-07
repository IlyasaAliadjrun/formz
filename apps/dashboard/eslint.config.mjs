import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import { baseConfig } from '../../eslint.config.mjs';

/** @type {import('eslint').Linter.Config[]} */
const config = [
  ...baseConfig,
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: ['.next/**', 'next-env.d.ts'],
  },
];

export default config;
