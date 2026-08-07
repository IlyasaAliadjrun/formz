/** @type {import('jest').Config} */
export default {
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/test/**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    // Prisma 7 meng-generate client dalam bentuk TypeScript yang saling mengimpor
    // dengan ekstensi .js (gaya ESM). Resolver CommonJS milik Jest tidak bisa
    // memetakannya ke file .ts, jadi ekstensinya dilepas di sini.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  // Kode hasil generate Prisma tidak ikut dihitung coverage-nya.
  collectCoverageFrom: ['src/**/*.ts', '!src/generated/**', '!src/**/*.spec.ts'],
  coverageDirectory: 'coverage',
  clearMocks: true,
  testTimeout: 15_000,
};
