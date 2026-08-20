// jest-expo resolves packages through the `react-native` export condition,
// which hands us lucide's ESM build (.mjs). Jest does not transform .mjs from
// node_modules, so the icon package is pointed at its CommonJS entry instead —
// resolved rather than hardcoded, so it survives a change of package manager.
const lucideCommonJs = require.resolve('lucide-react-native');

/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^lucide-react-native$': lucideCommonJs,
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|lucide-react-native))',
  ],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/types/database.types.ts', '!src/**/*.d.ts'],
  testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/src/**/*.test.tsx'],
  clearMocks: true,
};
