import type { CSSProperties, ReactElement } from 'react';
import { DIFFICULTY_PROFILES, DIFFICULTY_IDS, GRAPHICS_TIERS } from '@tuner/shared';
import type { StageResult, WorldState } from '@tuner/game-core';
import { Button, Panel, Slider, Toggle, TuningRing, TunerEmblem } from './components.js';
import { createTheme, type Theme } from './theme.js';
import { useUIStore } from './store.js';

/**
 * Screens and the HUD.
 *
 * The exploration HUD is deliberately minimal: during play the player should be
 * looking at the world, not at the corners. Coherence, the equipped form and the
 * charge ring are all that stay on screen; everything else appears when it is
 * relevant and leaves when it is not.
 */

function useTheme(): Theme {
  const accessibility = useUIStore((s) => s.accessibility);
  return createTheme({
    highContrast: accessibility.highContrast,
    colourblindSafeIcons: accessibility.colourblindSafeIcons,
    textScale: accessibility.textScale,
    reducedMotion: accessibility.reducedMotion,
  });
}

const overlay: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '1.5rem',
};

// ---------------------------------------------------------------------------
// Title
// ---------------------------------------------------------------------------

export function TitleScreen({ onNewJourney }: { onNewJourney: () => void }): ReactElement {
  const theme = useTheme();
  const navigate = useUIStore((s) => s.navigate);

  return (
    <div style={{ ...overlay, background: `radial-gradient(circle at 50% 40%, ${theme.colour.panel} 0%, ${theme.colour.background} 72%)` }}>
      <div style={{ width: 'min(30rem, 100%)', textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: theme.space(2) }}>
          <TunerEmblem size={104} theme={theme} />
        </div>
        <h1
          style={{
            margin: 0,
            fontSize: theme.font.display,
            fontWeight: 300,
            letterSpacing: '0.4em',
            textIndent: '0.4em',
            color: theme.colour.gold,
          }}
        >
          TUNER
        </h1>
        <p
          style={{
            margin: `${theme.space(1)} 0 ${theme.space(5)}`,
            fontSize: theme.font.small,
            letterSpacing: '0.3em',
            textIndent: '0.3em',
            textTransform: 'uppercase',
            color: theme.colour.textDim,
          }}
        >
          Resonance Breaker
        </p>

        <Button theme={theme} variant="primary" testId="title-new-journey" onClick={onNewJourney} autoFocus>
          New Journey
        </Button>
        <Button theme={theme} testId="title-continue" onClick={() => navigate('saveSlots')}>
          Continue
        </Button>
        <Button theme={theme} testId="title-settings" onClick={() => navigate('settings')}>
          Settings
        </Button>
        <Button theme={theme} testId="title-accessibility" onClick={() => navigate('accessibility')}>
          Accessibility
        </Button>
        <Button theme={theme} variant="ghost" testId="title-credits" onClick={() => navigate('credits')}>
          Credits
        </Button>

        <p style={{ marginTop: theme.space(4), fontSize: theme.font.tiny, color: theme.colour.textDim }}>
          The natural rhythm of the universe is 432&nbsp;Hz. Something is pulling it to 440.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pause
// ---------------------------------------------------------------------------

export function PauseScreen({
  onResume,
  onRestartCheckpoint,
  onQuit,
}: {
  onResume: () => void;
  onRestartCheckpoint: () => void;
  onQuit: () => void;
}): ReactElement {
  const theme = useTheme();
  const navigate = useUIStore((s) => s.navigate);

  return (
    <div style={{ ...overlay, background: 'rgba(4,6,20,0.72)', backdropFilter: 'blur(2px)' }}>
      <Panel theme={theme} testId="pause-menu" style={{ width: 'min(24rem, 100%)' }}>
        <h2 style={{ marginTop: 0, fontSize: theme.font.title, color: theme.colour.gold, letterSpacing: '0.18em' }}>
          Paused
        </h2>
        <Button theme={theme} variant="primary" testId="pause-resume" onClick={onResume} autoFocus>
          Resume
        </Button>
        <Button theme={theme} testId="pause-restart" onClick={onRestartCheckpoint}>
          Restart from Checkpoint
        </Button>
        <Button theme={theme} testId="pause-settings" onClick={() => navigate('settings')}>
          Settings
        </Button>
        <Button theme={theme} testId="pause-accessibility" onClick={() => navigate('accessibility')}>
          Accessibility
        </Button>
        <Button theme={theme} variant="ghost" testId="pause-quit" onClick={onQuit}>
          Return to Title
        </Button>
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings and accessibility
// ---------------------------------------------------------------------------

export function SettingsScreen(): ReactElement {
  const theme = useTheme();
  const store = useUIStore();

  return (
    <div style={{ ...overlay, background: theme.colour.background, overflowY: 'auto', alignItems: 'flex-start' }}>
      <Panel theme={theme} style={{ width: 'min(34rem, 100%)', margin: 'auto' }}>
        <h2 style={{ marginTop: 0, fontSize: theme.font.title, color: theme.colour.gold }}>Settings</h2>

        <h3 style={{ fontSize: theme.font.small, color: theme.colour.textDim, letterSpacing: '0.2em' }}>
          DIFFICULTY
        </h3>
        {DIFFICULTY_IDS.map((id) => {
          const profile = DIFFICULTY_PROFILES[id];
          return (
            <Button
              key={id}
              theme={theme}
              variant={store.difficulty === id ? 'primary' : 'default'}
              testId={`difficulty-${id}`}
              onClick={() => store.setDifficulty(id)}
            >
              {profile.label}
              <span style={{ display: 'block', fontSize: theme.font.tiny, color: theme.colour.textDim }}>
                {profile.description}
              </span>
            </Button>
          );
        })}
        <p style={{ fontSize: theme.font.tiny, color: theme.colour.textDim }}>
          Difficulty changes incoming damage, attack cadence, counter timing, recovery and
          checkpoint generosity. It does <strong>not</strong> change enemy health — a longer fight
          is not a harder one.
        </p>

        <h3 style={{ fontSize: theme.font.small, color: theme.colour.textDim, letterSpacing: '0.2em' }}>
          GRAPHICS
        </h3>
        {GRAPHICS_TIERS.map((tier) => (
          <Button
            key={tier}
            theme={theme}
            variant={store.graphicsTier === tier ? 'primary' : 'default'}
            testId={`graphics-${tier}`}
            onClick={() => store.setGraphicsTier(tier)}
          >
            {tier[0]?.toUpperCase()}
            {tier.slice(1)}
          </Button>
        ))}

        <h3 style={{ fontSize: theme.font.small, color: theme.colour.textDim, letterSpacing: '0.2em' }}>
          AUDIO
        </h3>
        {(['master', 'music', 'sfx', 'ui', 'voice', 'ambience'] as const).map((bus) => (
          <Slider
            key={bus}
            theme={theme}
            testId={`audio-${bus}`}
            label={bus[0]?.toUpperCase() + bus.slice(1)}
            value={store.audioLevels[bus]}
            onChange={(value) => store.setAudioLevel(bus, value)}
          />
        ))}

        <h3 style={{ fontSize: theme.font.small, color: theme.colour.textDim, letterSpacing: '0.2em' }}>
          INPUT
        </h3>
        <Slider
          theme={theme}
          testId="input-sensitivity"
          label="Look sensitivity"
          value={store.inputSettings.lookSensitivityX ?? 1}
          min={0.2}
          max={2}
          onChange={(value) => store.setInputSetting('lookSensitivityX', value)}
        />
        <Slider
          theme={theme}
          testId="input-deadzone"
          label="Stick dead zone"
          value={store.inputSettings.stickDeadzone ?? 0.18}
          min={0}
          max={0.5}
          onChange={(value) => store.setInputSetting('stickDeadzone', value)}
        />
        <Toggle
          theme={theme}
          testId="input-invert-y"
          label="Invert look (vertical)"
          value={store.inputSettings.invertLookY === true}
          onChange={(value) => store.setInputSetting('invertLookY', value)}
        />
        <Toggle
          theme={theme}
          testId="input-left-handed"
          label="Left-handed touch layout"
          description="Mirrors the entire on-screen control surface."
          value={store.inputSettings.leftHandedTouch === true}
          onChange={(value) => store.setInputSetting('leftHandedTouch', value)}
        />
        <Slider
          theme={theme}
          testId="input-touch-scale"
          label="Touch control size"
          value={store.inputSettings.touchScale ?? 1}
          min={0.7}
          max={1.6}
          onChange={(value) => store.setInputSetting('touchScale', value)}
        />

        <BackButton theme={theme} />
      </Panel>
    </div>
  );
}

export function AccessibilityScreen(): ReactElement {
  const theme = useTheme();
  const store = useUIStore();
  const a11y = store.accessibility;

  return (
    <div style={{ ...overlay, background: theme.colour.background, overflowY: 'auto', alignItems: 'flex-start' }}>
      <Panel theme={theme} style={{ width: 'min(34rem, 100%)', margin: 'auto' }}>
        <h2 style={{ marginTop: 0, fontSize: theme.font.title, color: theme.colour.gold }}>
          Accessibility
        </h2>
        <p style={{ fontSize: theme.font.tiny, color: theme.colour.textDim }}>
          Every gameplay-critical sound in TUNER also has a visual equivalent. The critical path
          is completable with the sound off.
        </p>

        <Toggle
          theme={theme}
          testId="a11y-reduced-motion"
          label="Reduced camera motion"
          description="Disables the speed field-of-view boost, removes screen shake and softens camera turns."
          value={a11y.reducedMotion === true}
          onChange={(v) => store.setAccessibility('reducedMotion', v)}
        />
        <Toggle
          theme={theme}
          testId="a11y-reduced-flashing"
          label="Reduced flashing"
          value={a11y.reducedFlashing === true}
          onChange={(v) => store.setAccessibility('reducedFlashing', v)}
        />
        <Toggle
          theme={theme}
          testId="a11y-reduced-particles"
          label="Reduced particles"
          value={a11y.reducedParticles === true}
          onChange={(v) => store.setAccessibility('reducedParticles', v)}
        />
        <Toggle
          theme={theme}
          testId="a11y-high-contrast"
          label="High contrast"
          value={a11y.highContrast === true}
          onChange={(v) => store.setAccessibility('highContrast', v)}
        />
        <Toggle
          theme={theme}
          testId="a11y-colourblind"
          label="Colour-blind-safe icons"
          description="Adds a distinct shape to every colour-coded indicator."
          value={a11y.colourblindSafeIcons === true}
          onChange={(v) => store.setAccessibility('colourblindSafeIcons', v)}
        />
        <Toggle
          theme={theme}
          testId="a11y-rhythm-cues"
          label="Visual rhythm indicators"
          description="Draws a beat pulse for every rhythm-based hazard. On by default."
          value={a11y.visualRhythmCues !== false}
          onChange={(v) => store.setAccessibility('visualRhythmCues', v)}
        />
        <Toggle
          theme={theme}
          testId="a11y-attack-timing"
          label="Visual attack timing"
          description="Draws a filling ring under every telegraphing attack. On by default."
          value={a11y.visualAttackTiming !== false}
          onChange={(v) => store.setAccessibility('visualAttackTiming', v)}
        />
        <Toggle
          theme={theme}
          testId="a11y-subtitles"
          label="Subtitles"
          value={a11y.subtitles !== false}
          onChange={(v) => store.setAccessibility('subtitles', v)}
        />
        <Toggle
          theme={theme}
          testId="a11y-fall-recovery"
          label="Fall recovery"
          description="A fall returns you to safe ground at no cost to Coherence."
          value={a11y.fallRecovery === true}
          onChange={(v) => store.setAccessibility('fallRecovery', v)}
        />
        <Toggle
          theme={theme}
          testId="a11y-generous-checkpoints"
          label="Generous checkpoints"
          value={a11y.generousCheckpoints === true}
          onChange={(v) => store.setAccessibility('generousCheckpoints', v)}
        />
        <Toggle
          theme={theme}
          testId="a11y-haptics"
          label="Haptics"
          value={a11y.haptics !== false}
          onChange={(v) => store.setAccessibility('haptics', v)}
        />

        <Slider
          theme={theme}
          testId="a11y-text-scale"
          label="Text size"
          value={a11y.textScale ?? 1}
          min={0.8}
          max={2}
          onChange={(v) => store.setAccessibility('textScale', v)}
        />
        <Slider
          theme={theme}
          testId="a11y-shake"
          label="Screen shake"
          value={a11y.screenShakeScale ?? 1}
          onChange={(v) => store.setAccessibility('screenShakeScale', v)}
        />
        <Slider
          theme={theme}
          testId="a11y-aim-assist"
          label="Aim assist"
          value={a11y.aimAssist ?? 0.35}
          onChange={(v) => store.setAccessibility('aimAssist', v)}
        />
        <Slider
          theme={theme}
          testId="a11y-lock-assist"
          label="Lock-on assist"
          value={a11y.lockOnAssist ?? 0.5}
          onChange={(v) => store.setAccessibility('lockOnAssist', v)}
        />
        <Slider
          theme={theme}
          testId="a11y-landing-assist"
          label="Platforming assistance"
          value={a11y.landingAssist ?? 0}
          onChange={(v) => store.setAccessibility('landingAssist', v)}
        />
        <Slider
          theme={theme}
          testId="a11y-coyote"
          label="Extra coyote time"
          value={a11y.extraCoyoteSeconds ?? 0}
          min={0}
          max={0.25}
          step={0.01}
          onChange={(v) => store.setAccessibility('extraCoyoteSeconds', v)}
        />

        <p
          style={{
            marginTop: theme.space(2),
            padding: theme.space(1.5),
            border: `1px dashed ${theme.colour.outline}`,
            borderRadius: theme.radius.md,
            fontSize: theme.font.body,
            color: theme.colour.text,
          }}
        >
          Sample text at the current size and contrast.
        </p>

        <BackButton theme={theme} />
      </Panel>
    </div>
  );
}

function BackButton({ theme }: { theme: Theme }): ReactElement {
  const back = useUIStore((s) => s.back);
  return (
    <Button theme={theme} variant="ghost" testId="screen-back" onClick={back}>
      Back
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Credits and results
// ---------------------------------------------------------------------------

export function CreditsScreen(): ReactElement {
  const theme = useTheme();
  return (
    <div style={{ ...overlay, background: theme.colour.background, overflowY: 'auto' }}>
      <Panel theme={theme} style={{ width: 'min(30rem, 100%)', margin: 'auto', textAlign: 'center' }}>
        <TunerEmblem size={72} theme={theme} />
        <h2 style={{ fontSize: theme.font.title, color: theme.colour.gold }}>TUNER</h2>
        <p style={{ fontSize: theme.font.small, color: theme.colour.textDim }}>Resonance Breaker</p>
        <p style={{ fontSize: theme.font.tiny, color: theme.colour.textDim, lineHeight: 1.8 }}>
          Every character, creature, ability, region, mechanism, sound and line of story in this
          game is original to it.
          <br />
          <br />
          Built with TypeScript, Three.js and React.
          <br />
          The score is synthesised, not sampled — which is how it can retune itself from 440&nbsp;Hz
          back to 432.
        </p>
        <BackButton theme={theme} />
      </Panel>
    </div>
  );
}

export function ResultsScreen({ onContinue }: { onContinue: () => void }): ReactElement {
  const theme = useTheme();
  const result = useUIStore((s) => s.result);

  if (!result) {
    return (
      <div style={overlay}>
        <Panel theme={theme}>
          <p>No result to show.</p>
          <Button theme={theme} onClick={onContinue}>
            Continue
          </Button>
        </Panel>
      </div>
    );
  }

  return (
    <div style={{ ...overlay, background: 'rgba(4,6,20,0.86)', overflowY: 'auto' }}>
      <Panel theme={theme} testId="results-screen" style={{ width: 'min(32rem, 100%)', margin: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: theme.space(3) }}>
          <TuningRing
            theme={theme}
            progress={1}
            size={96}
            colour={theme.colour.gold}
            label={result.rank}
            sublabel="RANK"
            token="sacred"
            testId="results-rank"
          />
          <div>
            <h2 style={{ margin: 0, fontSize: theme.font.title, color: theme.colour.gold }}>
              Region Restored
            </h2>
            <p style={{ margin: 0, fontSize: theme.font.small, color: theme.colour.textDim }}>
              {result.stageId} · {result.score} points
            </p>
          </div>
        </div>

        <table style={{ width: '100%', marginTop: theme.space(3), borderCollapse: 'collapse' }}>
          <tbody>
            {result.breakdown.map((row) => (
              <tr key={row.label}>
                <td style={{ padding: theme.space(1), fontSize: theme.font.small }}>{row.label}</td>
                <td
                  style={{
                    padding: theme.space(1),
                    fontSize: theme.font.small,
                    color: theme.colour.textDim,
                  }}
                >
                  {row.value}
                </td>
                <td
                  style={{
                    padding: theme.space(1),
                    fontSize: theme.font.small,
                    textAlign: 'right',
                    color: theme.colour.resonance,
                  }}
                >
                  {row.points}/{row.maxPoints}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {result.formAwarded && result.formAwarded !== 'base' && (
          <p
            style={{
              marginTop: theme.space(2),
              padding: theme.space(1.5),
              border: `1px solid ${theme.colour.restore}`,
              borderRadius: theme.radius.md,
              fontSize: theme.font.small,
              color: theme.colour.restore,
            }}
          >
            Frequency Core recovered — the Auralith has learned a new form.
          </p>
        )}

        <Button theme={theme} variant="primary" testId="results-continue" onClick={onContinue} autoFocus>
          Return to the Sanctuary
        </Button>
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

export function HUD({ world }: { world: WorldState }): ReactElement {
  const theme = useTheme();
  const notifications = useUIStore((s) => s.notifications);
  const subtitle = useUIStore((s) => s.subtitle);
  const showSubtitles = useUIStore((s) => s.accessibility.subtitles) !== false;
  const reducedFlashing = useUIStore((s) => s.accessibility.reducedFlashing) === true;

  const player = world.player;
  const coherence = player.maxCoherence > 0 ? player.coherence / player.maxCoherence : 0;
  const low = coherence < 0.3;

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {/*
        Low Coherence degrades the presentation, never the controls. It has to
        feel urgent while still letting the player fight their way back — and it
        must not cover information they need to do that.
      */}
      {low && (
        <div
          data-testid="hud-low-coherence"
          style={{
            position: 'absolute',
            inset: 0,
            boxShadow: `inset 0 0 ${reducedFlashing ? 60 : 90}px ${theme.colour.infection}`,
            opacity: reducedFlashing ? 0.35 : 0.55,
          }}
        />
      )}

      <div
        style={{
          position: 'absolute',
          left: theme.space(3),
          bottom: theme.space(3),
          display: 'flex',
          alignItems: 'flex-end',
          gap: theme.space(2),
        }}
      >
        <TuningRing
          theme={theme}
          testId="hud-coherence"
          progress={coherence}
          size={92}
          colour={low ? theme.colour.alarm : theme.colour.resonance}
          label={`${Math.round(player.coherence)}`}
          sublabel="COHERENCE"
          token={low ? 'alarm' : 'resonance'}
        />

        <div data-testid="hud-form" style={{ paddingBottom: theme.space(1) }}>
          <TuningRing
            theme={theme}
            progress={player.charge.tier / 3}
            size={62}
            thickness={5}
            colour={theme.colour.gold}
            label={player.charge.tier > 0 ? `${player.charge.tier}` : ''}
            token="sacred"
          />
          <span
            style={{
              display: 'block',
              marginTop: theme.space(0.5),
              fontSize: theme.font.tiny,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: theme.colour.text,
            }}
          >
            {player.form}
          </span>
        </div>
      </div>

      {/* Boss bar, with phase pips so escalation is legible before it arrives. */}
      {world.boss && !world.boss.defeated && (
        <div
          data-testid="hud-boss"
          style={{
            position: 'absolute',
            top: theme.space(3),
            left: '50%',
            transform: 'translateX(-50%)',
            width: 'min(28rem, 70vw)',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: theme.font.small, color: theme.colour.gold, letterSpacing: '0.2em' }}>
            {world.boss.displayName}
          </div>
          <div
            style={{
              height: 10,
              marginTop: theme.space(0.5),
              border: `1px solid ${theme.colour.outline}`,
              borderRadius: 5,
              overflow: 'hidden',
              background: 'rgba(0,0,0,0.4)',
            }}
          >
            <div
              style={{
                width: `${Math.max(0, Math.min(1, world.boss.health / Math.max(1, world.boss.maxHealth))) * 100}%`,
                height: '100%',
                background: world.boss.vulnerable ? theme.colour.gold : theme.colour.infection,
              }}
            />
          </div>
          <div style={{ marginTop: theme.space(0.5), fontSize: theme.font.tiny, color: theme.colour.textDim }}>
            {world.boss.restoring
              ? `Retuning ${Math.round(world.boss.restorationProgress * 100)}%`
              : `Phase ${world.boss.phase.index + 1}`}
          </div>
        </div>
      )}

      {/* Objective */}
      {world.stage.objective && (
        <div
          data-testid="hud-objective"
          style={{
            position: 'absolute',
            top: theme.space(3),
            left: theme.space(3),
            fontSize: theme.font.small,
            color: theme.colour.textDim,
            maxWidth: '18rem',
          }}
        >
          {world.stage.objective}
        </div>
      )}

      {/* Notifications */}
      <div
        style={{
          position: 'absolute',
          right: theme.space(3),
          top: theme.space(3),
          display: 'flex',
          flexDirection: 'column',
          gap: theme.space(1),
          alignItems: 'flex-end',
        }}
      >
        {notifications.map((n) => (
          <div
            key={n.id}
            style={{
              background: 'rgba(11,16,48,0.85)',
              border: `1px solid ${theme.colour.outline}`,
              borderRadius: theme.radius.md,
              padding: `${theme.space(1)} ${theme.space(2)}`,
              fontSize: theme.font.small,
              color: theme.colour.text,
              maxWidth: '22rem',
            }}
          >
            {n.text}
          </div>
        ))}
      </div>

      {/* Subtitles — always text, never audio alone. */}
      {showSubtitles && subtitle && (
        <div
          data-testid="hud-subtitle"
          style={{
            position: 'absolute',
            bottom: theme.space(3),
            left: '50%',
            transform: 'translateX(-50%)',
            maxWidth: 'min(40rem, 80vw)',
            textAlign: 'center',
            background: 'rgba(4,6,20,0.8)',
            borderRadius: theme.radius.md,
            padding: `${theme.space(1)} ${theme.space(2.5)}`,
            fontSize: theme.font.body,
            color: theme.colour.text,
          }}
        >
          <span style={{ color: theme.colour.gold, letterSpacing: '0.14em' }}>
            {subtitle.speaker}
          </span>
          <br />
          {subtitle.text}
        </div>
      )}
    </div>
  );
}

/** Boot screen shown while the renderer and content load. */
export function BootScreen({ status }: { status: string }): ReactElement {
  const theme = useTheme();
  return (
    <div style={{ ...overlay, flexDirection: 'column', gap: theme.space(2), background: theme.colour.background }}>
      <TunerEmblem size={84} theme={theme} />
      <p style={{ margin: 0, fontSize: theme.font.small, color: theme.colour.textDim, letterSpacing: '0.2em' }}>
        {status}
      </p>
    </div>
  );
}

export type { StageResult };
