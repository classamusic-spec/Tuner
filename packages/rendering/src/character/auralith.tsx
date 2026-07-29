import { useMemo, useRef, type ReactElement } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PALETTE, type ResonanceFormId } from '@tuner/shared';

/**
 * The Auralith.
 *
 * An original sacred instrument: a floating circular resonator ring that orbits
 * the forearm, strung with luminous harmonic strings across its opening, framed
 * by rotating geometric plates. It reads as something *played*, not something
 * aimed — it is deliberately not a cannon, and nothing about its silhouette
 * points forward.
 *
 * It has two jobs beyond looking right:
 *
 * 1. **Reconfigure per form.** Plate count, ring proportions and string count
 *    all change, so the player can see which frequency they are holding.
 * 2. **Show charge.** The strings brighten and the plates spin faster as each
 *    tier lands. This is the visual half of the charge cue's accessibility
 *    pairing — charge state must be readable with the sound off.
 */

export interface AuralithProps {
  readonly form: ResonanceFormId;
  readonly chargeTier: number;
  readonly charging: boolean;
  readonly accent: string;
}

/** Per-form silhouette: how many plates, how many strings, ring proportions. */
interface Silhouette {
  readonly plates: number;
  readonly strings: number;
  readonly radius: number;
  readonly thickness: number;
  /** Plates sit at this fraction of the ring radius. */
  readonly plateOrbit: number;
  readonly plateSize: readonly [number, number, number];
  /** Baseline plate rotation speed, radians per second. */
  readonly spin: number;
}

const SILHOUETTES: Readonly<Record<ResonanceFormId, Silhouette>> = {
  base: { plates: 3, strings: 5, radius: 0.14, thickness: 0.018, plateOrbit: 1.35, plateSize: [0.05, 0.05, 0.012], spin: 0.5 },
  echo: { plates: 6, strings: 5, radius: 0.145, thickness: 0.017, plateOrbit: 1.45, plateSize: [0.042, 0.042, 0.01], spin: 0.75 },
  prism: { plates: 8, strings: 3, radius: 0.135, thickness: 0.02, plateOrbit: 1.3, plateSize: [0.055, 0.03, 0.03], spin: 1.1 },
  tidal: { plates: 4, strings: 7, radius: 0.155, thickness: 0.022, plateOrbit: 1.25, plateSize: [0.07, 0.03, 0.012], spin: 0.35 },
  ember: { plates: 3, strings: 4, radius: 0.13, thickness: 0.026, plateOrbit: 1.5, plateSize: [0.06, 0.06, 0.016], spin: 0.9 },
  choir: { plates: 7, strings: 9, radius: 0.15, thickness: 0.015, plateOrbit: 1.4, plateSize: [0.035, 0.05, 0.01], spin: 0.65 },
  bloom: { plates: 5, strings: 6, radius: 0.148, thickness: 0.02, plateOrbit: 1.2, plateSize: [0.048, 0.038, 0.014], spin: 0.3 },
  silence: { plates: 2, strings: 2, radius: 0.125, thickness: 0.014, plateOrbit: 1.6, plateSize: [0.04, 0.075, 0.009], spin: 0.15 },
  celestial: { plates: 9, strings: 8, radius: 0.16, thickness: 0.019, plateOrbit: 1.5, plateSize: [0.045, 0.045, 0.012], spin: 1.35 },
};

export function Auralith(props: AuralithProps): ReactElement {
  const ringRef = useRef<THREE.Group>(null);
  const platesRef = useRef<THREE.Group>(null);
  const silhouette = SILHOUETTES[props.form];

  const mats = useMemo(
    () => ({
      frame: new THREE.MeshLambertMaterial({ color: new THREE.Color(PALETTE.gold) }),
      plate: new THREE.MeshLambertMaterial({ color: new THREE.Color(PALETTE.goldDim) }),
      string: new THREE.MeshBasicMaterial({
        color: new THREE.Color(props.accent),
        transparent: true,
        opacity: 0.85,
      }),
      core: new THREE.MeshBasicMaterial({
        color: new THREE.Color(props.accent),
        transparent: true,
        opacity: 0.4,
      }),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  mats.string.color.set(props.accent);
  mats.core.color.set(props.accent);

  useFrame((_, delta) => {
    const step = Math.min(delta, 0.1);

    // Charge drives both brightness and spin, so the tier is legible from the
    // instrument itself rather than only from the HUD.
    const chargeBoost = props.charging ? 1 + props.chargeTier * 1.4 : 1;
    const glow = props.charging ? Math.min(1, 0.55 + props.chargeTier * 0.22) : 0.8;
    mats.string.opacity = glow;
    mats.core.opacity = props.charging ? 0.25 + props.chargeTier * 0.2 : 0.18;

    if (platesRef.current) {
      platesRef.current.rotation.z += silhouette.spin * chargeBoost * step;
    }
    if (ringRef.current) {
      // A slow counter-rotation so the whole instrument reads as alive even at
      // rest — it is an instrument, not a prop bolted to an arm.
      ringRef.current.rotation.y += 0.35 * step;
    }
  });

  const stringPositions = useMemo(() => {
    const out: number[] = [];
    const count = silhouette.strings;
    for (let i = 0; i < count; i++) {
      // Evenly spaced chords across the ring's opening.
      out.push(((i + 1) / (count + 1)) * 2 - 1);
    }
    return out;
  }, [silhouette.strings]);

  const platePositions = useMemo(() => {
    const out: [number, number][] = [];
    for (let i = 0; i < silhouette.plates; i++) {
      const angle = (i / silhouette.plates) * Math.PI * 2;
      out.push([angle, silhouette.radius * silhouette.plateOrbit]);
    }
    return out;
  }, [silhouette.plates, silhouette.radius, silhouette.plateOrbit]);

  return (
    <group ref={ringRef} name="auralith">
      {/* The resonator ring itself. */}
      <mesh material={mats.frame} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[silhouette.radius, silhouette.thickness, 6, 20]} />
      </mesh>

      {/* Harmonic strings across the opening. */}
      <group rotation={[Math.PI / 2, 0, 0]}>
        {stringPositions.map((offset, i) => {
          const halfSpan = Math.sqrt(Math.max(0, 1 - offset * offset)) * silhouette.radius;
          return (
            <mesh
              key={i}
              material={mats.string}
              position={[offset * silhouette.radius, 0, 0]}
              rotation={[0, 0, Math.PI / 2]}
            >
              <cylinderGeometry args={[0.0035, 0.0035, halfSpan * 2, 4]} />
            </mesh>
          );
        })}
      </group>

      {/* A soft core so the instrument reads against dark geometry. */}
      <mesh material={mats.core}>
        <sphereGeometry args={[silhouette.radius * 0.55, 8, 6]} />
      </mesh>

      {/* Rotating geometric plates framing the ring. */}
      <group ref={platesRef} rotation={[Math.PI / 2, 0, 0]}>
        {platePositions.map(([angle, orbit], i) => (
          <mesh
            key={i}
            material={mats.plate}
            position={[Math.cos(angle) * orbit, Math.sin(angle) * orbit, 0]}
            rotation={[0, 0, angle]}
          >
            <boxGeometry args={silhouette.plateSize as unknown as [number, number, number]} />
          </mesh>
        ))}
      </group>
    </group>
  );
}
