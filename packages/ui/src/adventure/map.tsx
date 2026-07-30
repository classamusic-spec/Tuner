import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from 'react';
import { DETUNED_HZ, WORLD_CHORD_HZ } from '@tuner/shared';
import type { MapMarkerDef, MapMarkerKind } from '@tuner/game-core';
import { Button, Panel, TuningRing } from '../components.js';
import { createTheme, type Theme } from '../theme.js';
import { useUIStore } from '../store.js';

/**
 * **The region map.**
 *
 * This is a *record*, not a route. Every marker on it is here because the player
 * went there — `MapMarkerDef.discoveredByTriggerId` is how most of them arrive —
 * and there is deliberately no waypoint, no compass arrow and no "next
 * objective" pin. The map answers "where have I been, and what did I leave
 * unfinished", which is the question an explorer actually asks.
 *
 * It is drawn as a celestial-topographic diagram rather than a satellite view:
 * frequency contours running across the region, sacred geometry struck through
 * the middle of what you have found, the fragments the region has broken into,
 * and constellation lines joining the places you know. Every line of it is
 * generated from the marker data, so a region nobody has explored draws as
 * almost nothing — which is the honest picture.
 *
 * Everything is deterministic: fragment outlines come from a hash of the marker
 * id, never from `Math.random`, so the map a player learns is the same map every
 * time they open it.
 */

const BASE_W = 1000;
const BASE_H = 700;
const PAD = 90;
const MIN_SPAN = 90;
const MIN_ZOOM = 0.55;
const MAX_ZOOM = 4;

function useTheme(): Theme {
  const accessibility = useUIStore((s) => s.accessibility);
  return createTheme({
    highContrast: accessibility.highContrast,
    colourblindSafeIcons: accessibility.colourblindSafeIcons,
    textScale: accessibility.textScale,
    reducedMotion: accessibility.reducedMotion,
  });
}

const SCOPE = 'tuner-map';

function FocusStyle({ theme, scope }: { theme: Theme; scope: string }): ReactElement {
  return (
    <style>{`.${scope} :focus-visible{outline:3px solid ${theme.colour.gold};outline-offset:2px}`}</style>
  );
}

// ---------------------------------------------------------------------------
// Deterministic noise
// ---------------------------------------------------------------------------

/** FNV-1a over a string, in [0, 1). No `Math.random` anywhere on this screen. */
function hash01(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 100000) / 100000;
}

// ---------------------------------------------------------------------------
// Marker icons
// ---------------------------------------------------------------------------

export const MARKER_KIND_LABELS: Readonly<Record<MapMarkerKind, string>> = {
  temple: 'Temple',
  shrine: 'Shrine',
  village: 'Settlement',
  camp: 'Camp',
  cave: 'Cave',
  tower: 'Frequency mast',
  'crash-site': 'Impact site',
  guardian: 'Guardian ring',
  sanctuary: 'Way home',
};

/**
 * One icon per marker kind, each a distinct silhouette.
 *
 * Shape carries the meaning on its own, so colour-blind-safe mode has nothing to
 * add here and the map stays readable in high contrast or printed in one ink.
 */
export function MarkerIcon({
  kind,
  size = 26,
  colour,
  accent,
}: {
  kind: MapMarkerKind;
  size?: number;
  colour: string;
  accent: string;
}): ReactElement {
  const s = 24;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${s} ${s}`} aria-hidden focusable="false">
      {kind === 'temple' && (
        <>
          <circle cx={12} cy={5.5} r={3} fill="none" stroke={accent} strokeWidth={1.4} />
          <path d="M 3 20 L 6 12 L 18 12 L 21 20 Z" fill="none" stroke={colour} strokeWidth={1.6} />
          <line x1={12} y1={12} x2={12} y2={20} stroke={colour} strokeWidth={1.2} />
        </>
      )}
      {kind === 'shrine' && (
        <>
          <circle cx={12} cy={9} r={5.5} fill="none" stroke={accent} strokeWidth={1.6} />
          <path d="M 6 20 L 18 20 L 16 16 L 8 16 Z" fill="none" stroke={colour} strokeWidth={1.4} />
        </>
      )}
      {kind === 'village' && (
        <>
          <path d="M 2 15 L 6 10 L 10 15" fill="none" stroke={colour} strokeWidth={1.5} />
          <path d="M 8 19 L 12 13 L 16 19" fill="none" stroke={colour} strokeWidth={1.5} />
          <path d="M 14 15 L 18 10 L 22 15" fill="none" stroke={colour} strokeWidth={1.5} />
        </>
      )}
      {kind === 'camp' && (
        <>
          <path d="M 4 19 L 12 6 L 20 19 Z" fill="none" stroke={colour} strokeWidth={1.5} />
          <circle cx={12} cy={15} r={2} fill={accent} />
        </>
      )}
      {kind === 'cave' && (
        <>
          <path d="M 3 20 L 3 14 A 9 9 0 0 1 21 14 L 21 20" fill="none" stroke={colour} strokeWidth={1.6} />
          <path d="M 9 20 L 9 16 A 3 3 0 0 1 15 16 L 15 20" fill={accent} opacity={0.7} />
        </>
      )}
      {kind === 'tower' && (
        <>
          <line x1={12} y1={3} x2={12} y2={21} stroke={colour} strokeWidth={1.8} />
          <path d="M 7 8 A 6 6 0 0 0 17 8" fill="none" stroke={accent} strokeWidth={1.2} />
          <path d="M 5 13 A 8 8 0 0 0 19 13" fill="none" stroke={accent} strokeWidth={1} opacity={0.7} />
        </>
      )}
      {kind === 'crash-site' && (
        <>
          <ellipse cx={12} cy={16} rx={9} ry={4} fill="none" stroke={colour} strokeWidth={1.4} />
          <path d="M 12 3 L 13.6 9.5 L 19 8 L 14.5 12.5 L 12 14 L 9.5 12.5 L 5 8 L 10.4 9.5 Z" fill={accent} opacity={0.85} />
        </>
      )}
      {kind === 'guardian' && (
        <>
          <circle cx={12} cy={12} r={9.5} fill="none" stroke={colour} strokeWidth={1.6} />
          <polygon
            points="12,5 18,8.5 18,15.5 12,19 6,15.5 6,8.5"
            fill="none"
            stroke={accent}
            strokeWidth={1.3}
          />
        </>
      )}
      {kind === 'sanctuary' && (
        <>
          <circle cx={9.5} cy={12} r={6} fill="none" stroke={colour} strokeWidth={1.6} />
          <circle cx={14.5} cy={12} r={6} fill="none" stroke={accent} strokeWidth={1.6} />
        </>
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

export interface MapProjection {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  /** World-space extent the map was fitted to, for the scale bar. */
  readonly spanX: number;
  readonly spanZ: number;
}

/**
 * Fits the discovered world into the base diagram.
 *
 * World `x` runs left–right and world `z` runs into the screen, so a top-down map
 * is `(x, z)` with `z` growing downward. Uniform scale, always — a stretched map
 * is a lying map.
 */
export function fitProjection(
  points: readonly { readonly x: number; readonly z: number }[],
): MapProjection {
  if (points.length === 0) {
    return { scale: 1, offsetX: BASE_W / 2, offsetY: BASE_H / 2, spanX: MIN_SPAN, spanZ: MIN_SPAN };
  }
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }
  const spanX = Math.max(MIN_SPAN, maxX - minX);
  const spanZ = Math.max(MIN_SPAN, maxZ - minZ);
  const scale = Math.min((BASE_W - PAD * 2) / spanX, (BASE_H - PAD * 2) / spanZ);
  const midX = (minX + maxX) / 2;
  const midZ = (minZ + maxZ) / 2;
  return {
    scale,
    offsetX: BASE_W / 2 - midX * scale,
    offsetY: BASE_H / 2 - midZ * scale,
    spanX,
    spanZ,
  };
}

export function projectPoint(
  projection: MapProjection,
  x: number,
  z: number,
): { readonly x: number; readonly y: number } {
  return { x: x * projection.scale + projection.offsetX, y: z * projection.scale + projection.offsetY };
}

/** Nearest-neighbour chain through the discovered places. Deterministic. */
export function constellationLinks(
  points: readonly { readonly id: string; readonly x: number; readonly y: number }[],
): readonly { readonly from: string; readonly to: string }[] {
  if (points.length < 2) return [];
  const remaining = [...points];
  const first = remaining.shift();
  if (!first) return [];
  const links: { from: string; to: string }[] = [];
  let current = first;
  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < remaining.length; i += 1) {
      const candidate = remaining[i];
      if (!candidate) continue;
      const distance = (candidate.x - current.x) ** 2 + (candidate.y - current.y) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
    const next = remaining.splice(bestIndex, 1)[0];
    if (!next) break;
    links.push({ from: current.id, to: next.id });
    current = next;
  }
  return links;
}

/** The broken ground under a discovered place, shaped by a hash of its id. */
function fragmentPath(id: string, cx: number, cy: number, radius: number): string {
  const seed = hash01(id);
  const vertices = 6 + Math.floor(seed * 3);
  const points: string[] = [];
  for (let i = 0; i < vertices; i += 1) {
    const wobble = hash01(`${id}:${i}`);
    const angle = (i / vertices) * Math.PI * 2 + seed * Math.PI;
    const r = radius * (0.62 + wobble * 0.58);
    points.push(`${(cx + Math.cos(angle) * r).toFixed(1)},${(cy + Math.sin(angle) * r * 0.72).toFixed(1)}`);
  }
  return `M ${points.join(' L ')} Z`;
}

/** Frequency contour: a sine that stays smooth when restored and frays when not. */
function contourPath(row: number, infection: number, phase: number): string {
  const y = (row + 0.5) * (BASE_H / 9);
  const amplitude = 5 + infection * 26;
  const waves = 3 + Math.round(infection * 4);
  const points: string[] = [];
  for (let i = 0; i <= 60; i += 1) {
    const t = i / 60;
    const x = t * BASE_W;
    const fray = infection * 5 * Math.sin(t * Math.PI * 2 * (waves * 2.7) + phase * 3);
    const offset = Math.sin(t * Math.PI * 2 * waves + phase) * amplitude + fray;
    points.push(`${x.toFixed(1)},${(y + offset).toFixed(1)}`);
  }
  return `M ${points.join(' L ')}`;
}

export interface MapControls {
  pan(dx: number, dy: number): void;
  zoomBy(factor: number): void;
  recentre(): void;
}

export interface RegionMapProps {
  readonly regionName: string;
  /** Every marker authored for the region; undiscovered ones are not drawn. */
  readonly markers: readonly MapMarkerDef[];
  /** `AdventureState.discoveredMarkers`. */
  readonly discovered: readonly string[];
  readonly player: { readonly x: number; readonly z: number; readonly yaw: number };
  /** `StageRuntimeState.infection`, in [0, 1]. */
  readonly infection: number;
  readonly onClose?: () => void;
  readonly onSelectMarker?: (marker: MapMarkerDef) => void;
  /** Lets the host drive pan and zoom from a stick or the shoulder buttons. */
  readonly onRegisterControls?: (controls: MapControls | null) => void;
}

export function RegionMap({
  regionName,
  markers,
  discovered,
  player,
  infection,
  onClose,
  onSelectMarker,
  onRegisterControls,
}: RegionMapProps): ReactElement {
  const theme = useTheme();
  const [view, setView] = useState({ zoom: 1, panX: 0, panY: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ distance: number; zoom: number } | null>(null);

  const visible = useMemo(
    () => markers.filter((marker) => discovered.includes(marker.id)),
    [markers, discovered],
  );

  const projection = useMemo(
    () =>
      fitProjection([
        ...visible.map((marker) => ({ x: marker.position.x, z: marker.position.z })),
        { x: player.x, z: player.z },
      ]),
    [visible, player.x, player.z],
  );

  const placed = useMemo(
    () =>
      visible.map((marker) => ({
        marker,
        base: projectPoint(projection, marker.position.x, marker.position.z),
      })),
    [visible, projection],
  );

  const links = useMemo(
    () => constellationLinks(placed.map(({ marker, base }) => ({ id: marker.id, x: base.x, y: base.y }))),
    [placed],
  );

  const toScreen = useCallback(
    (point: { x: number; y: number }) => ({
      x: BASE_W / 2 + (point.x - BASE_W / 2) * view.zoom + view.panX,
      y: BASE_H / 2 + (point.y - BASE_H / 2) * view.zoom + view.panY,
    }),
    [view],
  );

  const pan = useCallback((dx: number, dy: number) => {
    setView((v) => ({
      ...v,
      panX: Math.max(-BASE_W, Math.min(BASE_W, v.panX + dx)),
      panY: Math.max(-BASE_H, Math.min(BASE_H, v.panY + dy)),
    }));
  }, []);

  const zoomBy = useCallback((factor: number) => {
    setView((v) => ({ ...v, zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom * factor)) }));
  }, []);

  const recentre = useCallback(() => setView({ zoom: 1, panX: 0, panY: 0 }), []);

  const controls = useMemo<MapControls>(() => ({ pan, zoomBy, recentre }), [pan, zoomBy, recentre]);

  // Held in a ref so an inline `onRegisterControls={...}` from the host does not
  // register and unregister on every render.
  const registerRef = useRef(onRegisterControls);
  registerRef.current = onRegisterControls;
  useEffect(() => {
    const register = registerRef.current;
    register?.(controls);
    return () => register?.(null);
  }, [controls]);

  // --- Drag and pinch ------------------------------------------------------

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const previous = pointers.current.get(event.pointerId);
      if (!previous) return;
      const current = { x: event.clientX, y: event.clientY };
      pointers.current.set(event.pointerId, current);

      const active = [...pointers.current.values()];
      if (active.length >= 2) {
        const [a, b] = active;
        if (!a || !b) return;
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        const start = pinchStart.current;
        if (!start) {
          pinchStart.current = { distance, zoom: view.zoom };
          return;
        }
        if (start.distance > 8) {
          const factor = distance / start.distance;
          setView((v) => ({
            ...v,
            zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, start.zoom * factor)),
          }));
        }
        return;
      }

      const rect = event.currentTarget.getBoundingClientRect();
      const scaleX = rect.width > 0 ? BASE_W / rect.width : 1;
      const scaleY = rect.height > 0 ? BASE_H / rect.height : 1;
      pan((current.x - previous.x) * scaleX, (current.y - previous.y) * scaleY);
    },
    [pan, view.zoom],
  );

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
  }, []);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const step = 60;
      switch (event.key) {
        case 'ArrowLeft':
          pan(step, 0);
          break;
        case 'ArrowRight':
          pan(-step, 0);
          break;
        case 'ArrowUp':
          pan(0, step);
          break;
        case 'ArrowDown':
          pan(0, -step);
          break;
        case '+':
        case '=':
          zoomBy(1.2);
          break;
        case '-':
        case '_':
          zoomBy(1 / 1.2);
          break;
        case 'Home':
        case '0':
          recentre();
          break;
        default:
          return;
      }
      event.preventDefault();
    },
    [pan, zoomBy, recentre],
  );

  const clampedInfection = Math.max(0, Math.min(1, infection));
  const regionHz = WORLD_CHORD_HZ + (DETUNED_HZ - WORLD_CHORD_HZ) * clampedInfection;
  const infectedColour = theme.colour.infection;
  const restoredColour = theme.colour.resonance;
  const playerScreen = toScreen(projectPoint(projection, player.x, player.z));

  return (
    <div
      className={SCOPE}
      data-testid="region-map"
      style={{
        position: 'absolute',
        inset: 0,
        overflowY: 'auto',
        background: theme.colour.background,
        padding: theme.space(2),
      }}
    >
      <FocusStyle theme={theme} scope={SCOPE} />
      <Panel theme={theme} style={{ width: 'min(60rem, 100%)', margin: '0 auto' }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: theme.space(2),
            justifyContent: 'space-between',
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: theme.font.title, color: theme.colour.gold, letterSpacing: '0.16em' }}>
              {regionName}
            </h2>
            <p style={{ margin: 0, fontSize: theme.font.tiny, color: theme.colour.textDim }}>
              {visible.length} of {markers.length} places recorded · this map only remembers where
              you have stood
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: theme.space(2) }}>
            <TuningRing
              theme={theme}
              testId="map-infection"
              progress={1 - clampedInfection}
              size={74}
              colour={clampedInfection > 0.5 ? infectedColour : restoredColour}
              label={`${regionHz.toFixed(1)}`}
              sublabel="HZ"
              token={clampedInfection > 0.5 ? 'infection' : 'resonance'}
            />
            {onClose && (
              <Button
                theme={theme}
                variant="ghost"
                testId="map-close"
                style={{ width: 'auto', marginBottom: 0 }}
                onClick={onClose}
              >
                Close
              </Button>
            )}
          </div>
        </div>

        {/* The diagram. Fixed 10:7 box so the SVG units and the HTML overlay
            share one coordinate space exactly. */}
        <div
          role="application"
          tabIndex={0}
          aria-label={`${regionName} map. Arrow keys pan, plus and minus zoom, Home recentres.`}
          data-testid="map-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
          style={{
            position: 'relative',
            marginTop: theme.space(2),
            width: '100%',
            aspectRatio: '10 / 7',
            maxHeight: '62vh',
            background: `radial-gradient(circle at 50% 45%, ${theme.colour.panelRaised} 0%, ${theme.colour.background} 78%)`,
            border: `1px solid ${theme.colour.outline}`,
            borderRadius: theme.radius.md,
            overflow: 'hidden',
            touchAction: 'none',
            cursor: 'grab',
          }}
        >
          <svg
            width="100%"
            height="100%"
            viewBox={`0 0 ${BASE_W} ${BASE_H}`}
            preserveAspectRatio="none"
            aria-hidden
            focusable="false"
            style={{ position: 'absolute', inset: 0 }}
          >
            <g
              transform={`translate(${(BASE_W / 2) * (1 - view.zoom) + view.panX} ${
                (BASE_H / 2) * (1 - view.zoom) + view.panY
              }) scale(${view.zoom})`}
            >
              {/* Frequency contours — smooth at 432, frayed toward 440. */}
              {Array.from({ length: 9 }, (_, row) => (
                <path
                  key={`contour-${row}`}
                  d={contourPath(row, clampedInfection, row * 0.7)}
                  fill="none"
                  stroke={row % 2 === 0 ? restoredColour : infectedColour}
                  strokeWidth={0.9}
                  opacity={row % 2 === 0 ? 0.3 - clampedInfection * 0.14 : 0.1 + clampedInfection * 0.3}
                />
              ))}

              {/* Sacred geometry through the middle of what has been found. */}
              <g opacity={0.5}>
                <circle cx={BASE_W / 2} cy={BASE_H / 2} r={250} fill="none" stroke={theme.colour.gold} strokeWidth={0.7} opacity={0.35} />
                <circle cx={BASE_W / 2} cy={BASE_H / 2} r={160} fill="none" stroke={theme.colour.gold} strokeWidth={0.7} opacity={0.5} />
                <circle cx={BASE_W / 2 - 80} cy={BASE_H / 2} r={160} fill="none" stroke={theme.colour.gold} strokeWidth={0.5} opacity={0.28} />
                <circle cx={BASE_W / 2 + 80} cy={BASE_H / 2} r={160} fill="none" stroke={theme.colour.gold} strokeWidth={0.5} opacity={0.28} />
                <polygon
                  points={Array.from({ length: 6 }, (_, i) => {
                    const angle = (i / 6) * Math.PI * 2 - Math.PI / 2;
                    return `${BASE_W / 2 + Math.cos(angle) * 250},${BASE_H / 2 + Math.sin(angle) * 250}`;
                  }).join(' ')}
                  fill="none"
                  stroke={theme.colour.gold}
                  strokeWidth={0.6}
                  opacity={0.3}
                />
              </g>

              {/* The ground each place sits on: the region in fragments. */}
              {placed.map(({ marker, base }) => (
                <path
                  key={`fragment-${marker.id}`}
                  d={fragmentPath(marker.id, base.x, base.y, 52 + hash01(marker.kind) * 26)}
                  fill={theme.colour.panelRaised}
                  stroke={theme.colour.gold}
                  strokeWidth={0.8}
                  opacity={0.55}
                />
              ))}

              {/* Constellation links between the places you know. */}
              {links.map((link) => {
                const from = placed.find((entry) => entry.marker.id === link.from);
                const to = placed.find((entry) => entry.marker.id === link.to);
                if (!from || !to) return null;
                return (
                  <line
                    key={`${link.from}->${link.to}`}
                    x1={from.base.x}
                    y1={from.base.y}
                    x2={to.base.x}
                    y2={to.base.y}
                    stroke={restoredColour}
                    strokeWidth={0.9}
                    strokeDasharray="5 7"
                    opacity={0.5}
                  />
                );
              })}
            </g>
          </svg>

          {/* Markers live in the HTML layer: real buttons, real focus rings,
              real touch targets, and a constant size at every zoom level. */}
          {placed.map(({ marker, base }) => {
            const screen = toScreen(base);
            const offMap =
              screen.x < 0 || screen.x > BASE_W || screen.y < 0 || screen.y > BASE_H;
            const left = Math.max(2, Math.min(98, (screen.x / BASE_W) * 100));
            const top = Math.max(3, Math.min(97, (screen.y / BASE_H) * 100));
            return (
              <button
                key={marker.id}
                type="button"
                data-testid={`map-marker-${marker.id}`}
                onClick={() => onSelectMarker?.(marker)}
                aria-label={`${marker.label}, ${MARKER_KIND_LABELS[marker.kind]}`}
                style={{
                  position: 'absolute',
                  left: `${left}%`,
                  top: `${top}%`,
                  transform: 'translate(-50%, -50%)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 2,
                  minWidth: 44,
                  minHeight: 44,
                  padding: 2,
                  background: 'transparent',
                  border: '1px solid transparent',
                  borderRadius: theme.radius.sm,
                  color: theme.colour.text,
                  font: 'inherit',
                  cursor: 'pointer',
                  opacity: offMap ? 0.4 : 1,
                }}
              >
                <MarkerIcon
                  kind={marker.kind}
                  colour={theme.colour.gold}
                  accent={marker.kind === 'guardian' ? theme.colour.infection : theme.colour.resonance}
                />
                <span
                  style={{
                    fontSize: theme.font.tiny,
                    whiteSpace: 'nowrap',
                    padding: '0 3px',
                    borderRadius: 3,
                    background: 'rgba(4,6,20,0.72)',
                    color: theme.colour.text,
                  }}
                >
                  {marker.label}
                  {/* Colour-blind-safe mode names the kind in words as well as
                      drawing its silhouette — belt and braces, and it costs a line. */}
                  {theme.showShapes && (
                    <span style={{ display: 'block', color: theme.colour.textDim }}>
                      {MARKER_KIND_LABELS[marker.kind]}
                    </span>
                  )}
                </span>
              </button>
            );
          })}

          {/* The player: position and facing, nothing else. No route. */}
          <div
            data-testid="map-player"
            aria-hidden
            style={{
              position: 'absolute',
              left: `${Math.max(0, Math.min(100, (playerScreen.x / BASE_W) * 100))}%`,
              top: `${Math.max(0, Math.min(100, (playerScreen.y / BASE_H) * 100))}%`,
              transform: 'translate(-50%, -50%)',
              pointerEvents: 'none',
            }}
          >
            <svg width={40} height={40} viewBox="0 0 40 40" focusable="false">
              <circle cx={20} cy={20} r={13} fill="none" stroke={theme.colour.resonance} strokeWidth={1} opacity={0.5} />
              <g transform={`rotate(${(player.yaw * 180) / Math.PI} 20 20)`}>
                <polygon points="20,6 26,24 20,20 14,24" fill={theme.colour.resonance} stroke={theme.colour.background} strokeWidth={0.8} />
              </g>
            </svg>
          </div>

          {visible.length === 0 && (
            <p
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: 0,
                fontSize: theme.font.small,
                color: theme.colour.textDim,
                textAlign: 'center',
                pointerEvents: 'none',
              }}
            >
              Nothing recorded yet. Walk, and the region will draw itself.
            </p>
          )}
        </div>

        {/* Controls that do not depend on a pointer. */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: theme.space(1),
            marginTop: theme.space(1.5),
          }}
        >
          <MapButton theme={theme} testId="map-zoom-out" label="−" title="Zoom out" onClick={() => zoomBy(1 / 1.25)} />
          <span style={{ fontSize: theme.font.tiny, color: theme.colour.textDim, minWidth: '3.5rem', textAlign: 'center' }}>
            {view.zoom.toFixed(2)}×
          </span>
          <MapButton theme={theme} testId="map-zoom-in" label="+" title="Zoom in" onClick={() => zoomBy(1.25)} />
          <MapButton theme={theme} testId="map-recentre" label="Recentre" title="Recentre the map" onClick={recentre} />
          <span style={{ fontSize: theme.font.tiny, color: theme.colour.textDim, marginLeft: 'auto' }}>
            Drag or pinch to move. Arrow keys and the left stick work too.
          </span>
        </div>

        {/* Legend. Shape first, so it reads without colour. */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: theme.space(1.5),
            marginTop: theme.space(2),
            paddingTop: theme.space(1.5),
            borderTop: '1px solid rgba(245,196,81,0.2)',
          }}
        >
          {(Object.keys(MARKER_KIND_LABELS) as MapMarkerKind[]).map((kind) => (
            <span
              key={kind}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: theme.font.tiny,
                color: theme.colour.textDim,
              }}
            >
              <MarkerIcon kind={kind} size={18} colour={theme.colour.gold} accent={theme.colour.resonance} />
              {MARKER_KIND_LABELS[kind]}
            </span>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function MapButton({
  theme,
  label,
  title,
  onClick,
  testId,
}: {
  theme: Theme;
  label: string;
  title: string;
  onClick: () => void;
  testId?: string;
}): ReactElement {
  return (
    <button
      type="button"
      data-testid={testId}
      title={title}
      aria-label={title}
      onClick={onClick}
      style={{
        font: 'inherit',
        fontSize: theme.font.small,
        minHeight: 40,
        minWidth: 44,
        padding: `0 ${theme.space(1.5)}`,
        background: theme.colour.panelRaised,
        color: theme.colour.text,
        border: `1px solid ${theme.colour.outline}`,
        borderRadius: theme.radius.sm,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}
