import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The portability guard.
 *
 * `@tuner/game-core` and `@tuner/shared` carry every rule of the game, and they
 * must stay runnable on web, mobile, desktop and in a bare Node test. A single
 * stray `import * as THREE from 'three'` would quietly end that, and it would
 * not fail any other test — the web build would keep working, and the breakage
 * would only surface when someone tried to run the simulation somewhere else.
 *
 * So the boundary is asserted here as well as in lint. Lint can be disabled per
 * line; this cannot.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

const FORBIDDEN_IN_SIMULATION = [
  'three',
  'react',
  'react-dom',
  'react-native',
  'tone',
  '@react-three/fiber',
  '@react-three/drei',
  'zustand',
  '@tuner/rendering',
  '@tuner/ui',
  '@tuner/persistence',
  '@tuner/platform',
];

/** Browser and Node globals that a portable simulation must not reach for. */
const FORBIDDEN_GLOBALS = [
  'document',
  'window',
  'navigator',
  'localStorage',
  'sessionStorage',
  'requestAnimationFrame',
  'HTMLCanvasElement',
  'AudioContext',
];

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, acc);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

/** Extracts every module specifier from static imports, exports and dynamic imports. */
function extractImports(source: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /(?:^|\n)\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*export\s[^;]*?from\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      const specifier = match[1];
      if (specifier) specifiers.push(specifier);
    }
  }
  return specifiers;
}

/** Strips comments and string literals so keyword scans do not match prose. */
function stripCommentsAndStrings(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

const simulationPackages = ['game-core', 'shared'];

describe('portability of the simulation packages', () => {
  const files = simulationPackages.flatMap((pkg) =>
    collectSourceFiles(resolve(repoRoot, 'packages', pkg, 'src')),
  );

  it('finds simulation source files to check', () => {
    // A guard that silently checks nothing is worse than no guard at all.
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(simulationPackages)(
    '@tuner/%s imports no renderer, UI framework or platform package',
    (pkg) => {
      const pkgFiles = collectSourceFiles(resolve(repoRoot, 'packages', pkg, 'src'));
      const violations: string[] = [];

      for (const file of pkgFiles) {
        const source = readFileSync(file, 'utf8');
        for (const specifier of extractImports(source)) {
          const bare = specifier.startsWith('@')
            ? specifier.split('/').slice(0, 2).join('/')
            : (specifier.split('/')[0] ?? specifier);
          if (FORBIDDEN_IN_SIMULATION.includes(bare)) {
            violations.push(`${file.replace(repoRoot + '/', '')} imports "${specifier}"`);
          }
        }
      }

      expect(violations).toEqual([]);
    },
  );

  it('the simulation reaches for no browser or host globals', () => {
    const violations: string[] = [];

    for (const file of files) {
      const source = stripCommentsAndStrings(readFileSync(file, 'utf8'));
      for (const global of FORBIDDEN_GLOBALS) {
        // Word boundary, and not preceded by a dot (so `foo.window` is fine).
        const pattern = new RegExp(`(^|[^.\\w$])${global}\\b`, 'm');
        if (pattern.test(source)) {
          violations.push(`${file.replace(repoRoot + '/', '')} references "${global}"`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('the simulation never uses Math.random — determinism depends on ctx.rng', () => {
    const violations: string[] = [];
    for (const file of files) {
      const source = stripCommentsAndStrings(readFileSync(file, 'utf8'));
      if (/\bMath\s*\.\s*random\b/.test(source)) {
        violations.push(file.replace(repoRoot + '/', ''));
      }
    }
    expect(violations).toEqual([]);
  });

  it('the simulation never reads wall-clock time — steps are fixed', () => {
    const violations: string[] = [];
    for (const file of files) {
      const source = stripCommentsAndStrings(readFileSync(file, 'utf8'));
      if (/\bDate\s*\.\s*now\b/.test(source) || /\bnew\s+Date\b/.test(source)) {
        violations.push(file.replace(repoRoot + '/', ''));
      }
      if (/\bperformance\s*\.\s*now\b/.test(source)) {
        violations.push(`${file.replace(repoRoot + '/', '')} (performance.now)`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('relative imports carry explicit .js extensions', () => {
    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const specifier of extractImports(source)) {
        if (!specifier.startsWith('.')) continue;
        if (!specifier.endsWith('.js') && !specifier.endsWith('.json')) {
          violations.push(`${file.replace(repoRoot + '/', '')} imports "${specifier}"`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('portability of the interface packages', () => {
  it('@tuner/physics depends on no concrete physics engine', () => {
    const files = collectSourceFiles(resolve(repoRoot, 'packages', 'physics', 'src'));
    const banned = ['@dimforge/rapier3d', 'cannon-es', 'ammo.js', 'three', 'react'];
    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const specifier of extractImports(source)) {
        const bare = specifier.startsWith('@')
          ? specifier.split('/').slice(0, 2).join('/')
          : (specifier.split('/')[0] ?? specifier);
        if (banned.includes(bare)) {
          violations.push(`${file.replace(repoRoot + '/', '')} imports "${specifier}"`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('@tuner/ui does not reach into the renderer', () => {
    const files = collectSourceFiles(resolve(repoRoot, 'packages', 'ui', 'src'));
    const banned = ['three', '@tuner/rendering', '@react-three/fiber', '@react-three/drei'];
    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const specifier of extractImports(source)) {
        const bare = specifier.startsWith('@')
          ? specifier.split('/').slice(0, 2).join('/')
          : (specifier.split('/')[0] ?? specifier);
        if (banned.includes(bare)) {
          violations.push(`${file.replace(repoRoot + '/', '')} imports "${specifier}"`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
