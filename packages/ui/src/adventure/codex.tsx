import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from 'react';
import type { CodexEntryDef } from '@tuner/game-core';
import { Button, Panel } from '../components.js';
import { createTheme, type Theme } from '../theme.js';
import { useUIStore } from '../store.js';

/**
 * **The codex, the bestiary and the memories.**
 *
 * One browser rather than three screens: they are all the same act — reading
 * something the world wrote down — and splitting them would have meant three
 * navigation models for one verb.
 *
 * The important decision is that **locked entries are shown, not hidden**. A
 * category that reads "4 of 9 recorded" tells the player there is more in the
 * region and that finding it is possible; a category that silently shows four
 * entries tells them the region is finished. The locked rows carry the category's
 * glyph and their position, and nothing else — no title to spoil, no flag names,
 * no hint that reads as a checklist.
 */

export const CODEX_CATEGORIES = ['world', 'people', 'creatures', 'resonance', 'memory'] as const;
export type CodexCategory = (typeof CODEX_CATEGORIES)[number];

export const CATEGORY_LABELS: Readonly<Record<CodexCategory, string>> = {
  world: 'The World',
  people: 'People',
  creatures: 'Creatures',
  resonance: 'Resonance',
  memory: 'Memories',
};

export const CATEGORY_BLURBS: Readonly<Record<CodexCategory, string>> = {
  world: 'Places, and what they were before.',
  people: 'Who stayed.',
  creatures: 'What the infection made, and what it took over.',
  resonance: 'How the Auralith works, in the words of the people who built it.',
  memory: 'Fragments left in the ground by people who are not here to explain them.',
};

function useTheme(): Theme {
  const accessibility = useUIStore((s) => s.accessibility);
  return createTheme({
    highContrast: accessibility.highContrast,
    colourblindSafeIcons: accessibility.colourblindSafeIcons,
    textScale: accessibility.textScale,
    reducedMotion: accessibility.reducedMotion,
  });
}

const SCOPE = 'tuner-codex';

function FocusStyle({ theme, scope }: { theme: Theme; scope: string }): ReactElement {
  return (
    <style>{`.${scope} :focus-visible{outline:3px solid ${theme.colour.gold};outline-offset:2px}`}</style>
  );
}

/** A distinct silhouette per category, so the tabs read without colour. */
export function CategoryIcon({
  category,
  size = 22,
  colour,
  accent,
}: {
  category: CodexCategory;
  size?: number;
  colour: string;
  accent: string;
}): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable="false">
      {category === 'world' && (
        <>
          <circle cx={12} cy={12} r={9} fill="none" stroke={colour} strokeWidth={1.5} />
          <path d="M 3.4 9 L 20.6 9 M 3.4 15 L 20.6 15" stroke={accent} strokeWidth={1} />
          <ellipse cx={12} cy={12} rx={4} ry={9} fill="none" stroke={accent} strokeWidth={1} />
        </>
      )}
      {category === 'people' && (
        <>
          <circle cx={12} cy={7.5} r={3.6} fill="none" stroke={colour} strokeWidth={1.5} />
          <path d="M 4.5 20 A 7.5 7.5 0 0 1 19.5 20" fill="none" stroke={colour} strokeWidth={1.5} />
          <circle cx={12} cy={7.5} r={6.6} fill="none" stroke={accent} strokeWidth={0.7} opacity={0.7} />
        </>
      )}
      {category === 'creatures' && (
        <>
          <polygon points="12,3 20,9 17,20 7,20 4,9" fill="none" stroke={colour} strokeWidth={1.5} />
          <circle cx={9.4} cy={11} r={1.5} fill={accent} />
          <circle cx={14.6} cy={11} r={1.5} fill={accent} />
        </>
      )}
      {category === 'resonance' && (
        <>
          <circle cx={12} cy={12} r={3.2} fill={accent} opacity={0.85} />
          <circle cx={12} cy={12} r={6.6} fill="none" stroke={colour} strokeWidth={1.2} />
          <circle cx={12} cy={12} r={9.8} fill="none" stroke={colour} strokeWidth={0.8} opacity={0.6} />
        </>
      )}
      {category === 'memory' && (
        <>
          <path d="M 5 4 L 19 4 L 19 20 L 12 16.4 L 5 20 Z" fill="none" stroke={colour} strokeWidth={1.5} />
          <path d="M 8.5 9 L 15.5 9 M 8.5 12.2 L 13.5 12.2" stroke={accent} strokeWidth={1} />
        </>
      )}
    </svg>
  );
}

/** The mark on a locked row: a ring that has not closed. */
function UnknownGlyph({ size = 22, colour }: { size?: number; colour: string }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable="false">
      <path
        d="M 12 3.2 A 8.8 8.8 0 1 1 5.2 16.8"
        fill="none"
        stroke={colour}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeDasharray="3 3.5"
      />
      <circle cx={12} cy={12} r={1.6} fill={colour} opacity={0.55} />
    </svg>
  );
}

export interface CodexProgress {
  readonly category: CodexCategory;
  readonly unlocked: number;
  readonly total: number;
}

/** Per-category counts, for the tab strip and the header line. */
export function codexProgress(
  entries: readonly CodexEntryDef[],
  unlocked: readonly string[],
): readonly CodexProgress[] {
  return CODEX_CATEGORIES.map((category) => {
    const inCategory = entries.filter((entry) => entry.category === category);
    return {
      category,
      unlocked: inCategory.filter((entry) => unlocked.includes(entry.id)).length,
      total: inCategory.length,
    };
  });
}

export interface CodexScreenProps {
  readonly entries: readonly CodexEntryDef[];
  /** `AdventureState.unlockedCodex`. Everything else reads as unrecorded. */
  readonly unlocked: readonly string[];
  readonly onClose?: () => void;
  readonly initialCategory?: CodexCategory;
  /** Region name for the header, when the codex is opened from a zone. */
  readonly regionName?: string;
}

export function CodexScreen({
  entries,
  unlocked,
  onClose,
  initialCategory = 'world',
  regionName,
}: CodexScreenProps): ReactElement {
  const theme = useTheme();
  const [category, setCategory] = useState<CodexCategory>(initialCategory);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const tabRefs = useRef(new Map<CodexCategory, HTMLButtonElement>());

  const progress = useMemo(() => codexProgress(entries, unlocked), [entries, unlocked]);
  const rows = useMemo(
    () => entries.filter((entry) => entry.category === category),
    [entries, category],
  );

  const isUnlocked = useCallback(
    (entry: CodexEntryDef) => entry.unlockedByFlag === undefined || unlocked.includes(entry.id),
    [unlocked],
  );

  /**
   * The open entry is *derived*, not synchronised.
   *
   * Opening a category should land on its first readable entry rather than a
   * blank pane, and the obvious way to do that — an effect that writes the
   * selection whenever the category changes — has two faults: the first paint is
   * empty, and the host hands us a freshly-built `unlocked` array every frame, so
   * the effect would fire again and again and stamp on whatever the player had
   * just chosen. Computing it here has neither problem.
   */
  const selected =
    rows.find((entry) => entry.id === selectedId) ??
    rows.find((entry) => isUnlocked(entry)) ??
    rows[0] ??
    null;
  const selectedUnlocked = selected !== null && isUnlocked(selected);

  const onTabKey = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      const index = CODEX_CATEGORIES.indexOf(category);
      let next: CodexCategory | undefined;
      if (event.key === 'ArrowRight') next = CODEX_CATEGORIES[(index + 1) % CODEX_CATEGORIES.length];
      if (event.key === 'ArrowLeft') {
        next = CODEX_CATEGORIES[(index - 1 + CODEX_CATEGORIES.length) % CODEX_CATEGORIES.length];
      }
      if (event.key === 'Home') next = CODEX_CATEGORIES[0];
      if (event.key === 'End') next = CODEX_CATEGORIES[CODEX_CATEGORIES.length - 1];
      if (!next) return;
      event.preventDefault();
      setCategory(next);
      tabRefs.current.get(next)?.focus();
    },
    [category],
  );

  const totalUnlocked = progress.reduce((sum, row) => sum + row.unlocked, 0);
  const totalEntries = progress.reduce((sum, row) => sum + row.total, 0);

  return (
    <div
      className={SCOPE}
      data-testid="codex-screen"
      style={{
        position: 'absolute',
        inset: 0,
        overflowY: 'auto',
        background: theme.colour.background,
        padding: theme.space(2),
      }}
    >
      <FocusStyle theme={theme} scope={SCOPE} />
      <Panel theme={theme} style={{ width: 'min(58rem, 100%)', margin: '0 auto' }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: theme.space(2),
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: theme.font.title, color: theme.colour.gold, letterSpacing: '0.16em' }}>
              Codex
            </h2>
            <p style={{ margin: 0, fontSize: theme.font.tiny, color: theme.colour.textDim }}>
              {regionName ? `${regionName} · ` : ''}
              {totalUnlocked} of {totalEntries} recorded
            </p>
          </div>
          {onClose && (
            <Button
              theme={theme}
              variant="ghost"
              testId="codex-close"
              style={{ width: 'auto', marginBottom: 0 }}
              onClick={onClose}
            >
              Close
            </Button>
          )}
        </div>

        {/* Tabs */}
        <div
          role="tablist"
          aria-label="Codex categories"
          style={{ display: 'flex', flexWrap: 'wrap', gap: theme.space(0.75), marginTop: theme.space(2) }}
        >
          {progress.map((row) => {
            const active = row.category === category;
            return (
              <button
                key={row.category}
                ref={(element) => {
                  if (element) tabRefs.current.set(row.category, element);
                  else tabRefs.current.delete(row.category);
                }}
                type="button"
                role="tab"
                id={`codex-tab-${row.category}`}
                aria-selected={active}
                aria-controls={`codex-panel-${row.category}`}
                tabIndex={active ? 0 : -1}
                data-testid={`codex-tab-${row.category}`}
                onClick={() => setCategory(row.category)}
                onKeyDown={onTabKey}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: theme.space(0.75),
                  font: 'inherit',
                  fontSize: theme.font.small,
                  minHeight: 44,
                  padding: `0 ${theme.space(1.5)}`,
                  background: active ? theme.colour.panelRaised : 'transparent',
                  color: active ? theme.colour.gold : theme.colour.textDim,
                  border: `${active ? 2 : 1}px solid ${active ? theme.colour.outline : 'rgba(245,196,81,0.25)'}`,
                  borderRadius: theme.radius.md,
                  cursor: 'pointer',
                }}
              >
                <CategoryIcon
                  category={row.category}
                  colour={active ? theme.colour.gold : theme.colour.textDim}
                  accent={theme.colour.resonance}
                />
                {CATEGORY_LABELS[row.category]}
                <span style={{ fontSize: theme.font.tiny, opacity: 0.8 }}>
                  {row.unlocked}/{row.total}
                </span>
              </button>
            );
          })}
        </div>

        <div
          role="tabpanel"
          id={`codex-panel-${category}`}
          aria-labelledby={`codex-tab-${category}`}
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: theme.space(2),
            marginTop: theme.space(2),
          }}
        >
          {/* List */}
          <div style={{ flex: '1 1 16rem', minWidth: '14rem' }}>
            <p style={{ margin: `0 0 ${theme.space(1)}`, fontSize: theme.font.tiny, color: theme.colour.textDim }}>
              {CATEGORY_BLURBS[category]}
            </p>
            <ul
              role="listbox"
              aria-label={`${CATEGORY_LABELS[category]} entries`}
              style={{ listStyle: 'none', margin: 0, padding: 0 }}
            >
              {rows.map((entry, index) => {
                const open = isUnlocked(entry);
                const active = entry.id === selected?.id;
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      data-testid={`codex-entry-${entry.id}`}
                      onClick={() => setSelectedId(entry.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: theme.space(1),
                        width: '100%',
                        minHeight: 44,
                        font: 'inherit',
                        fontSize: theme.font.small,
                        textAlign: 'left',
                        padding: theme.space(1),
                        marginBottom: theme.space(0.5),
                        background: active ? theme.colour.panelRaised : 'transparent',
                        color: open ? theme.colour.text : theme.colour.textDim,
                        border: `1px solid ${active ? theme.colour.outline : 'rgba(245,196,81,0.18)'}`,
                        borderRadius: theme.radius.sm,
                        cursor: 'pointer',
                      }}
                    >
                      {open ? (
                        <CategoryIcon
                          category={category}
                          size={18}
                          colour={theme.colour.gold}
                          accent={theme.colour.resonance}
                        />
                      ) : (
                        <UnknownGlyph size={18} colour={theme.colour.textDim} />
                      )}
                      <span style={{ flex: 1, minWidth: 0 }}>
                        {open ? entry.title : 'Unrecorded'}
                      </span>
                      <span style={{ fontSize: theme.font.tiny, opacity: 0.7 }}>
                        {String(index + 1).padStart(2, '0')}
                      </span>
                    </button>
                  </li>
                );
              })}
              {rows.length === 0 && (
                <li style={{ fontSize: theme.font.small, color: theme.colour.textDim }}>
                  Nothing in this category yet.
                </li>
              )}
            </ul>
          </div>

          {/* Reading pane */}
          <div
            data-testid="codex-reader"
            style={{
              flex: '2 1 22rem',
              minWidth: '16rem',
              padding: theme.space(2),
              background: theme.colour.panelRaised,
              border: '1px solid rgba(245,196,81,0.25)',
              borderRadius: theme.radius.md,
            }}
          >
            {selected === null ? (
              <p style={{ margin: 0, fontSize: theme.font.small, color: theme.colour.textDim }}>
                Choose an entry.
              </p>
            ) : selectedUnlocked ? (
              <>
                <h3
                  style={{
                    margin: 0,
                    fontSize: theme.font.title,
                    color: theme.colour.gold,
                    letterSpacing: '0.06em',
                  }}
                >
                  {selected.title}
                </h3>
                <p
                  style={{
                    margin: `${theme.space(0.5)} 0 ${theme.space(2)}`,
                    fontSize: theme.font.tiny,
                    letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                    color: theme.colour.textDim,
                  }}
                >
                  {CATEGORY_LABELS[selected.category]}
                </p>
                <p
                  data-testid="codex-body"
                  style={{ margin: 0, fontSize: theme.font.body, lineHeight: 1.7, color: theme.colour.text }}
                >
                  {selected.body}
                </p>
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: theme.space(3) }}>
                <UnknownGlyph size={56} colour={theme.colour.textDim} />
                <h3
                  style={{
                    margin: `${theme.space(1.5)} 0 ${theme.space(1)}`,
                    fontSize: theme.font.title,
                    color: theme.colour.textDim,
                    letterSpacing: '0.1em',
                  }}
                >
                  Unrecorded
                </h3>
                <p style={{ margin: 0, fontSize: theme.font.small, color: theme.colour.textDim, lineHeight: 1.7 }}>
                  Something belongs here. It is written down when you find the place, the person or
                  the creature it is about — not before.
                </p>
              </div>
            )}
          </div>
        </div>
      </Panel>
    </div>
  );
}
