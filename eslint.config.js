import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-types/**',
      '**/build/**',
      '**/coverage/**',
      '**/*.tsbuildinfo',
      'apps/desktop/src-tauri/target/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
    },
  },
  {
    files: ['packages/ui/**/*.tsx', 'packages/rendering/**/*.tsx', 'apps/web/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // The simulation package must stay portable. These imports are the ones
    // that would quietly tie it to a single platform.
    files: ['packages/game-core/**/*.ts', 'packages/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'three', message: '@tuner/game-core must not depend on Three.js.' },
            { name: 'react', message: '@tuner/game-core must not depend on React.' },
            { name: 'react-dom', message: '@tuner/game-core must not depend on React DOM.' },
            { name: 'react-native', message: '@tuner/game-core must not depend on React Native.' },
            { name: 'tone', message: '@tuner/game-core must not depend on a concrete audio engine.' },
            { name: '@tuner/rendering', message: 'Simulation must not depend on rendering.' },
            { name: '@tuner/ui', message: 'Simulation must not depend on UI.' },
          ],
        },
      ],
    },
  },
  {
    // Metro's config must be CommonJS — it is loaded by Metro, not by Vite.
    files: ['apps/mobile/metro.config.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-require-imports': 'off', 'no-undef': 'off' },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
);
