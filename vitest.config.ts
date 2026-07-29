import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const pkg = (name: string): string => resolve(root, 'packages', name, 'src', 'index.ts');

export default defineConfig({
  resolve: {
    alias: {
      '@tuner/shared': pkg('shared'),
      '@tuner/physics': pkg('physics'),
      '@tuner/input': pkg('input'),
      '@tuner/audio': pkg('audio'),
      '@tuner/game-core': pkg('game-core'),
      '@tuner/game-content': pkg('game-content'),
      '@tuner/platform': pkg('platform'),
      '@tuner/persistence': pkg('persistence'),
      '@tuner/rendering': pkg('rendering'),
      '@tuner/ui': pkg('ui'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: [
      'packages/**/*.test.ts',
      'packages/**/*.test.tsx',
      'tests/unit/**/*.test.ts',
      'tests/integration/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts', '**/types.ts'],
    },
  },
});
