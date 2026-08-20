// Flat ESLint config. `eslint-config-expo` brings the React, React Hooks,
// import and TypeScript rules that match this SDK; `eslint-config-prettier`
// switches off everything that would fight the formatter.
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier/flat');
const queryPlugin = require('@tanstack/eslint-plugin-query');

module.exports = defineConfig([
  expoConfig,
  queryPlugin.configs['flat/recommended'],
  prettierConfig,
  {
    ignores: [
      'dist/*',
      'coverage/*',
      '.expo/*',
      'android/*',
      'ios/*',
      // Generated from the database; not ours to lint.
      'src/types/database.types.ts',
    ],
  },
  {
    rules: {
      // console.* is routed through src/lib/logger so that production builds
      // can drop or redirect it in one place.
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@supabase/supabase-js',
              importNames: ['createClient'],
              message:
                'Import the configured client from @/lib/supabase instead of creating a second one.',
            },
          ],
        },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    // Tests and tooling may log freely.
    files: [
      '**/*.test.ts',
      '**/*.test.tsx',
      'jest.setup.ts',
      'metro.config.js',
      'eslint.config.js',
    ],
    rules: { 'no-console': 'off' },
  },
  {
    // The single place allowed to construct the Supabase client. The rule above
    // exists to stop a second one appearing anywhere else.
    files: ['src/lib/supabase/client.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
]);
