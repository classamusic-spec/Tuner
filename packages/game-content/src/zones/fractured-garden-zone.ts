import type { Vec3 } from '@tuner/shared';
import type {
  CodexEntryDef,
  DialogueTree,
  MapMarkerDef,
  MotifCardDef,
  NpcDef,
  QuestDef,
  ShrineDef,
  TempleDef,
  ZoneDef,
} from '@tuner/game-core';

/**
 * **The Fractured Garden — the adventure layer.**
 *
 * `FRACTURED_GARDEN` (in `../stages/fractured-garden.js`) is the *place*: nine
 * terraces of luminous root, three seals, a mini-boss in the seedbed and a
 * colossus with an Amplifier grown into his chest. It is authored, tested and
 * finished, and nothing in this file changes a single coordinate of it.
 *
 * This file is who is *in* it, and why anyone would walk down there.
 *
 * ---------------------------------------------------------------------------
 * Rules this file holds itself to
 * ---------------------------------------------------------------------------
 *
 * 1. **Every id here points at something that already exists.** Quest steps
 *    reference the stage's real trigger, puzzle, pickup and boss ids; the flags
 *    the dialogue waits on are flags the stage runtime actually sets. The test
 *    file re-derives all of that from `FRACTURED_GARDEN`, `BOSSES` and
 *    `ENEMY_ARCHETYPES` rather than trusting the prose.
 *
 *    The four flag sources worth knowing, because half the pacing hangs off
 *    them: a trigger with a `setFlag` action; a puzzle reward (`setFlag`
 *    directly, `door-open:<doorId>` for `openDoor`, `platforms:<puzzleId>` for
 *    `spawnPlatforms`, `revealed:<contentId>` for `revealSecret`); the
 *    adventure runtime's own `marker:<id>`, `motif:<id>` and `ability:<id>`;
 *    and a quest's `setsFlagOnComplete`. Sava reacting to the root bridge
 *    growing is `platforms:puz-root-bridge-sequence` — not a new flag invented
 *    for the conversation.
 *
 * 2. **People are people, not quest terminals.** Sava was here before the
 *    infection and has kept one seedbed alive by carrying water to it by hand.
 *    Her first conversation is about what she has lost and how she knows it is
 *    lost — nobody explains 432 Hz to the player, because a woman who waters
 *    nine beds and now waters one does not talk like a manual.
 *
 * 3. **The map is a record, not a route.** Most markers are
 *    `discoveredByTriggerId`: they appear because the player went there. The
 *    only proximity markers are the four shrines, which have to be stood in
 *    front of to exist at all.
 *
 * 4. **Muted-completable.** Every beat of dialogue is subtitled text first (the
 *    dialogue runtime publishes `ui:subtitle` per beat), every quest step
 *    publishes an objective line, and the two conversations that carry
 *    mechanical information — Renn on the pylons, the Auralith on Tarn's pitch —
 *    say the visual tell out loud: the shot goes *gold*, the pitch is *held
 *    flat*. Nothing in this file is a sound cue with no text behind it.
 *
 * 5. **Echo Pulse is the reason to come back.** Oru awards `echo`. Three things
 *    in the authored stage are impossible without it, and `q-echo-return`
 *    collects exactly those three, gated on the `ability:echo` flag the grant
 *    itself sets. It cannot be finished on a first visit, and the test proves
 *    that rather than asserting it in a comment.
 */

/** Terse Vec3 literal — this file is half coordinates, like the stage it sits on. */
function v(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

// ---------------------------------------------------------------------------
// The people
// ---------------------------------------------------------------------------

/**
 * Four survivors and one freed guardian.
 *
 * Positions are on authored surfaces, checked against the stage's geometry:
 * Sava on the top of `geo-terrace-c` (y −1.9), Renn on `geo-upper-terrace`
 * (y 12.9), Tarn on `geo-hollow-floor` (y −2.9) and Oru on
 * `geo-commander-floor` (y 0) once the region holds its chord again.
 *
 * Tarn is authored twice on purpose. `npc-tarn-quiet` is hidden by the flag
 * `npc-tarn` requires, so exactly one of them is ever present: the man humming
 * at 440 Hz, or the man who has stopped. That is what `requiresFlag` and
 * `hiddenByFlag` are for, and it means the change is visible in the model key
 * rather than only in the text.
 */
const NPCS: readonly NpcDef[] = [
  {
    id: 'npc-sava',
    displayName: 'Sava',
    appearance: 'survivor-gardener',
    /** Standing in the one bed on the third terrace that still answers. */
    position: v(-6, -1.9, -41),
    yaw: 1.5708,
    /**
     * Her idle routine is the job: channel, bed, channel. Two litres a trip,
     * eleven trips a day, at 1.1 m/s because she is sixty-one and carrying
     * water. When the player talks to her she stops and faces them; when they
     * leave she picks the loop back up.
     */
    routine: {
      kind: 'patrol',
      points: [v(-6, -1.9, -42), v(-6, -1.9, -36), v(1, -1.9, -36.5)],
      speed: 1.1,
    },
    /** Priority order: the most specific eligible tree wins. */
    dialogue: [
      'dlg-sava-seed-thanks',
      'dlg-sava-first-seal',
      'dlg-sava-seed-request',
      'dlg-sava-seals',
      'dlg-sava-first-meeting',
      'dlg-sava-idle',
    ],
    restoredAppearance: 'survivor-gardener-restored',
    restoredDialogue: ['dlg-sava-restored', 'dlg-sava-restored-idle'],
  },

  {
    id: 'npc-renn',
    displayName: 'Renn',
    appearance: 'survivor-watcher',
    /** A tarp and a cold fire on the upper terrace, under the root arch. */
    position: v(-42, 12.9, -74),
    yaw: 1.2,
    routine: { kind: 'work', facing: 1.2 },
    dialogue: ['dlg-renn-pylons', 'dlg-renn-phrases', 'dlg-renn-camp', 'dlg-renn-idle'],
    restoredAppearance: 'survivor-watcher-restored',
    restoredDialogue: ['dlg-renn-restored', 'dlg-renn-restored-idle'],
  },

  {
    id: 'npc-tarn-quiet',
    displayName: 'Tarn',
    appearance: 'survivor-detuned',
    /** In the hollow, by the seam in the west wall, where the Whisperers
     *  walk past him because he sounds like them. */
    position: v(-10, -2.9, -58),
    yaw: 3,
    routine: { kind: 'idle' },
    dialogue: ['dlg-tarn-quiet', 'dlg-tarn-still-quiet'],
    hiddenByFlag: 'tarn-cleansed',
    /** If the player never does his quest, the region's own chord does it for
     *  them. Restoration is not allowed to leave him humming. */
    restoredAppearance: 'survivor-listener-restored',
    restoredDialogue: ['dlg-tarn-restored', 'dlg-tarn-restored-idle'],
  },
  {
    id: 'npc-tarn',
    displayName: 'Tarn',
    appearance: 'survivor-listener',
    position: v(-9.5, -2.9, -57.5),
    yaw: 2.4,
    routine: { kind: 'work', facing: 2.4 },
    dialogue: ['dlg-tarn-thanks', 'dlg-tarn-idle'],
    requiresFlag: 'tarn-cleansed',
    restoredAppearance: 'survivor-listener-restored',
    restoredDialogue: ['dlg-tarn-restored', 'dlg-tarn-restored-idle'],
  },

  {
    id: 'npc-oru-freed',
    displayName: 'Oru',
    appearance: 'oru-freed',
    /** Kneeling in his own ring, planting, once the Core is out of him. */
    position: v(4, 0, -170),
    yaw: 3.1416,
    routine: { kind: 'work', facing: 3.1416 },
    dialogue: ['dlg-oru-ninth-terrace', 'dlg-oru-idle'],
    requiresFlag: 'garden-core-recovered',
  },
];

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------

/**
 * Twenty-two trees.
 *
 * Gating convention: `requiresFlag` is the setup, `consumedByFlag` retires a
 * beat once it has been heard, and `setsFlagOnComplete` is usually the same
 * flag as the `consumedByFlag` — a tree that closes itself. Only three trees
 * take the camera (`cinematic`): meeting Sava, Tarn coming back, and Oru in the
 * dirt afterwards. Everything else leaves the player in control of the view,
 * because a gardener's aside is not a story beat.
 */
const DIALOGUE: readonly DialogueTree[] = [
  // --- Sava --------------------------------------------------------------

  /**
   * First meeting. The premise arrives sideways: she does not explain the
   * detune, she explains that she cannot do her job any more, and the player
   * works out why from the fact that she can hear it and hates that she can.
   */
  {
    id: 'dlg-sava-first-meeting',
    cinematic: true,
    consumedByFlag: 'sava-met',
    setsFlagOnComplete: 'sava-met',
    /** Idempotent — the host starts `main` quests on region entry, and this is
     *  the in-world entry point if it did not. */
    startsQuest: 'q-garden-first-breath',
    beats: [
      {
        speaker: 'Sava',
        text: 'Careful of the channel. It is dry, but it is still a channel.',
        emote: 'guarded',
        seconds: 3.4,
      },
      {
        speaker: 'Sava',
        text: 'You are the first thing to come down those steps that was not violet.',
        emote: 'tired',
        seconds: 3.8,
      },
      { speaker: 'Kesh', text: 'You have been here the whole time?', seconds: 2.2 },
      {
        speaker: 'Sava',
        text: 'I water nine beds by hand. There were nine terraces. There is one bed.',
        emote: 'quiet',
        seconds: 4.2,
      },
      {
        speaker: 'Sava',
        text: 'Everything I know how to do needs water that falls the right way down.',
        emote: 'quiet',
        seconds: 4,
      },
      { speaker: 'Kesh', text: 'And it does not.', seconds: 1.8 },
      {
        speaker: 'Sava',
        text: 'It falls flat. I can hear the difference and I hate that I can.',
        emote: 'tired',
        seconds: 3.8,
      },
      {
        speaker: 'Auralith',
        text: 'She is not wrong. The whole region is eight cycles sharp. Every channel in it is measuring the wrong down.',
        emote: 'scan',
        seconds: 4.4,
      },
      {
        speaker: 'Sava',
        text: 'Take the terraces slowly. They remember more weight than they can hold.',
        emote: 'warning',
        seconds: 4,
      },
    ],
    choices: [
      { text: 'I will bring the water back.', goTo: null, setsFlag: 'sava-promised' },
      { text: 'Is anyone else still here?', goTo: null },
    ],
  },

  /** The temple hint. She names all three seals in the order the Keepers
   *  taught them, which is also the order the route reaches them in. */
  {
    id: 'dlg-sava-seals',
    requiresFlag: 'sava-met',
    consumedByFlag: 'sava-seals-heard',
    setsFlagOnComplete: 'sava-seals-heard',
    beats: [
      {
        speaker: 'Sava',
        text: 'You want the low temple, then. The First Breath, under the spire.',
        emote: 'quiet',
        seconds: 3.6,
      },
      {
        speaker: 'Sava',
        text: 'It will not open for you. It opens for three seals, and the Keepers put them wherever the water went.',
        seconds: 4.4,
      },
      { speaker: 'Kesh', text: 'Three.', seconds: 1.4 },
      {
        speaker: 'Sava',
        text: 'The root bridge over the chasm. The gate across the cascade basin. The pair up in the canopy.',
        seconds: 4.6,
      },
      {
        speaker: 'Auralith',
        text: 'A sequence, then two at once, then a sustain. Three different asks. That is a teaching order, not a lock.',
        emote: 'scan',
        seconds: 4.6,
      },
      {
        speaker: 'Sava',
        text: 'It was both. They taught children on that door.',
        emote: 'wry',
        seconds: 3.2,
      },
    ],
  },

  /** Her own ask, and she says plainly that it is hers. */
  {
    id: 'dlg-sava-seed-request',
    requiresFlag: 'sava-seals-heard',
    consumedByFlag: 'sava-seed-asked',
    setsFlagOnComplete: 'sava-seed-asked',
    startsQuest: 'q-sava-seed-vault',
    beats: [
      {
        speaker: 'Sava',
        text: "One more thing, and it is mine, not the world's.",
        emote: 'quiet',
        seconds: 3.4,
      },
      {
        speaker: 'Sava',
        text: 'There is a Keeper vault off the high terrace walk. Seed trays. Locked with two notes.',
        seconds: 4.2,
      },
      {
        speaker: 'Sava',
        text: 'I got as far as the spore vents. Twice. I am sixty-one and I got as far as the vents.',
        emote: 'flat',
        seconds: 4.4,
      },
      { speaker: 'Kesh', text: 'Which two notes?', seconds: 1.8 },
      {
        speaker: 'Sava',
        text: 'Second, then Sixth. Bring back whatever is still alive in there and I will plant the ninth bed myself.',
        emote: 'warm',
        seconds: 4.8,
      },
    ],
  },

  /**
   * Reaction after the first seal. Gated on `platforms:puz-root-bridge-sequence`
   * — the flag the stage runtime sets when a `spawnPlatforms` reward fires — so
   * she is reacting to the bridge existing, not to a quest counter.
   */
  {
    id: 'dlg-sava-first-seal',
    requiresFlag: 'platforms:puz-root-bridge-sequence',
    consumedByFlag: 'sava-first-seal-heard',
    setsFlagOnComplete: 'sava-first-seal-heard',
    beats: [
      {
        speaker: 'Sava',
        text: 'The bridge grew. I felt it come up through the stone from here.',
        emote: 'surprised',
        seconds: 3.8,
      },
      {
        speaker: 'Sava',
        text: 'Eight hundred years that thing was an argument between two banks.',
        emote: 'wry',
        seconds: 3.8,
      },
      { speaker: 'Kesh', text: 'One seal.', seconds: 1.4 },
      {
        speaker: 'Sava',
        text: 'One seal, and my hands are shaking. Go and do the other two before I get used to hoping.',
        emote: 'urgent',
        seconds: 4.6,
      },
    ],
  },

  /** After the Seed Vault. Two trays out of eleven, and she takes it. */
  {
    id: 'dlg-sava-seed-thanks',
    requiresFlag: 'sava-seed-recovered',
    consumedByFlag: 'sava-seed-thanked',
    setsFlagOnComplete: 'sava-seed-thanked',
    beats: [
      { speaker: 'Sava', text: 'Two trays alive. Out of eleven.', emote: 'quiet', seconds: 3 },
      {
        speaker: 'Sava',
        text: 'Two is not a disappointment. Two is a garden, given time and a level channel.',
        emote: 'warm',
        seconds: 4.4,
      },
      {
        speaker: 'Sava',
        text: 'So go and make the water fall properly, so I am not lying to them.',
        seconds: 4,
      },
    ],
  },

  /** Ambient fallback. Never consumed, so she always has something to say. */
  {
    id: 'dlg-sava-idle',
    beats: [
      { speaker: 'Sava', text: 'Still here. Still watering.', emote: 'tired', seconds: 2.6 },
      {
        speaker: 'Sava',
        text: 'Go on. The garden is not going to tune itself.',
        emote: 'wry',
        seconds: 3,
      },
    ],
  },

  /** After restoration. The callback pays off the promise choice from the
   *  first conversation, for players who made it. */
  {
    id: 'dlg-sava-restored',
    cinematic: true,
    consumedByFlag: 'sava-restored-heard',
    setsFlagOnComplete: 'sava-restored-heard',
    beats: [
      {
        speaker: 'Sava',
        text: 'Listen to it. Listen to the third terrace.',
        emote: 'awed',
        seconds: 3.4,
      },
      {
        speaker: 'Sava',
        text: 'That is the sound of water arguing with a stone and losing on purpose.',
        emote: 'warm',
        seconds: 4.2,
      },
      { speaker: 'Kesh', text: 'It is loud.', seconds: 1.6 },
      {
        speaker: 'Sava',
        text: 'It was always loud. I had forgotten it was supposed to be.',
        emote: 'quiet',
        seconds: 4,
      },
      {
        speaker: 'Sava',
        text: 'Nine beds to dig and no excuse left. Move.',
        emote: 'warm',
        seconds: 3.4,
      },
    ],
    choices: [
      { text: 'I said I would.', goTo: null, requiresFlag: 'sava-promised' },
      { text: 'Where will you start?', goTo: null },
    ],
  },
  {
    id: 'dlg-sava-restored-idle',
    beats: [
      {
        speaker: 'Sava',
        text: 'Third terrace is planted. Come and see it when you have finished the rest of the world.',
        emote: 'warm',
        seconds: 4.4,
      },
    ],
  },

  // --- Renn --------------------------------------------------------------

  /** A man who has survived eleven days by counting. */
  {
    id: 'dlg-renn-camp',
    consumedByFlag: 'renn-met',
    setsFlagOnComplete: 'renn-met',
    beats: [
      {
        speaker: 'Renn',
        text: 'Stop. Stand behind the arch and count to four.',
        emote: 'urgent',
        seconds: 2.8,
      },
      { speaker: 'Renn', text: '…Right. Now you can come in.', seconds: 2.4 },
      {
        speaker: 'Renn',
        text: 'The pylons sweep this terrace every four beats. I have counted for eleven days and it has been four beats for eleven days.',
        seconds: 5,
      },
      { speaker: 'Kesh', text: 'You live up here?', seconds: 1.8 },
      {
        speaker: 'Renn',
        text: 'I sleep up here. Living is what I did on the sixth terrace.',
        emote: 'flat',
        seconds: 3.8,
      },
      {
        speaker: 'Renn',
        text: 'There is tea. It is terrible. It is hot.',
        emote: 'wry',
        seconds: 3,
      },
    ],
  },

  /** The pylon warning. Mechanical information, said in text, with the visual
   *  tell named: the shot goes gold before it lands. */
  {
    id: 'dlg-renn-pylons',
    requiresFlag: 'renn-met',
    consumedByFlag: 'renn-pylons-heard',
    setsFlagOnComplete: 'renn-pylons-heard',
    beats: [
      {
        speaker: 'Renn',
        text: 'You are going across the swings. Two masts, one each side, both in range of every root.',
        seconds: 4.4,
      },
      {
        speaker: 'Renn',
        text: 'Do not run at them. Their shot goes gold just before it lands. Meet it and it goes home.',
        seconds: 4.6,
      },
      {
        speaker: 'Auralith',
        text: 'Confirmed. The counter window is the gold. Watch for it — the tone is only the confirmation.',
        emote: 'scan',
        seconds: 4.4,
      },
      {
        speaker: 'Renn',
        text: 'And wait for the root to come to you. Everything out there arrives if you let it.',
        emote: 'quiet',
        seconds: 4.4,
      },
    ],
  },

  /** His collection: phrases he can still remember. Starts the motif quest. */
  {
    id: 'dlg-renn-phrases',
    requiresFlag: 'renn-met',
    consumedByFlag: 'renn-phrases-heard',
    setsFlagOnComplete: 'renn-phrases-heard',
    startsQuest: 'q-garden-motifs',
    beats: [
      {
        speaker: 'Renn',
        text: 'While you are down there. I have been writing down every phrase this place still makes.',
        seconds: 4.4,
      },
      {
        speaker: 'Renn',
        text: "Four of them I only have half of. The bridge one. The canopy pair. Oru's walking rhythm. And whatever it is Sava hums.",
        seconds: 5.2,
      },
      { speaker: 'Kesh', text: 'Why write them down?', seconds: 1.8 },
      {
        speaker: 'Renn',
        text: 'Because a thing nobody remembers the sound of is gone twice.',
        emote: 'flat',
        seconds: 4,
      },
      {
        speaker: 'Auralith',
        text: 'Recovered phrases go into Composition Mode as playable material. Bring them back and they are real.',
        emote: 'bright',
        seconds: 4.4,
      },
    ],
  },

  {
    id: 'dlg-renn-idle',
    beats: [
      { speaker: 'Renn', text: 'Four beats. Still four beats.', emote: 'flat', seconds: 2.8 },
    ],
  },

  {
    id: 'dlg-renn-restored',
    consumedByFlag: 'renn-restored-heard',
    setsFlagOnComplete: 'renn-restored-heard',
    beats: [
      {
        speaker: 'Renn',
        text: 'The masts are quiet and I do not know what to count.',
        emote: 'quiet',
        seconds: 3.6,
      },
      { speaker: 'Kesh', text: 'Try the water.', seconds: 1.6 },
      {
        speaker: 'Renn',
        text: 'I am going down to the sixth terrace. It is going to be bad and I am going anyway.',
        emote: 'resolved',
        seconds: 4.6,
      },
    ],
  },
  {
    id: 'dlg-renn-restored-idle',
    beats: [
      {
        speaker: 'Renn',
        text: 'Sixth terrace. Then the seventh. I have a list.',
        emote: 'warm',
        seconds: 3.2,
      },
    ],
  },

  // --- Tarn --------------------------------------------------------------

  /**
   * He does not answer. Everything the player needs is carried by the
   * Auralith's reading and by parenthesised description, so a muted player gets
   * the whole scene: he is humming, it is flat, and the Whisperers ignore him.
   */
  {
    id: 'dlg-tarn-quiet',
    consumedByFlag: 'tarn-heard',
    setsFlagOnComplete: 'tarn-heard',
    startsQuest: 'q-quiet-neighbour',
    beats: [
      {
        speaker: 'Tarn',
        text: '(He does not look up. He is humming, and it is not quite a note.)',
        emote: 'absent',
        seconds: 4.2,
      },
      {
        speaker: 'Auralith',
        text: 'Four hundred and forty, held flat, for a long time. He is not injured. He is tuned.',
        emote: 'scan',
        seconds: 4.4,
      },
      { speaker: 'Kesh', text: 'Can he hear me at all?', seconds: 2 },
      {
        speaker: 'Auralith',
        text: 'Something in there can. The Whisperers walk past him because he sounds like them.',
        emote: 'grave',
        seconds: 4.4,
      },
      {
        speaker: 'Auralith',
        text: 'Clear the note out of this hollow, and find what he put in the wall. Then try him again.',
        seconds: 4.6,
      },
    ],
  },
  {
    id: 'dlg-tarn-still-quiet',
    beats: [
      {
        speaker: 'Tarn',
        text: '(Still humming. The pitch has not moved.)',
        emote: 'absent',
        seconds: 3.4,
      },
      {
        speaker: 'Auralith',
        text: 'Nothing has changed for him yet.',
        emote: 'grave',
        seconds: 2.6,
      },
    ],
  },

  {
    id: 'dlg-tarn-thanks',
    cinematic: true,
    requiresFlag: 'tarn-cleansed',
    consumedByFlag: 'tarn-thanked',
    setsFlagOnComplete: 'tarn-thanked',
    beats: [
      {
        speaker: 'Tarn',
        text: '…the wall. I put them in the wall.',
        emote: 'dazed',
        seconds: 3.4,
      },
      { speaker: 'Kesh', text: 'I found them.', seconds: 1.6 },
      {
        speaker: 'Tarn',
        text: 'I remember deciding to. I do not remember the eleven days after deciding to.',
        seconds: 4.6,
      },
      { speaker: 'Tarn', text: 'Was I singing?', emote: 'dazed', seconds: 2 },
      { speaker: 'Kesh', text: 'You were holding a note.', seconds: 2.2 },
      { speaker: 'Tarn', text: 'Whose?', seconds: 1.4 },
      { speaker: 'Auralith', text: 'Not yours. It is gone now.', emote: 'grave', seconds: 2.8 },
    ],
  },
  {
    id: 'dlg-tarn-idle',
    beats: [
      {
        speaker: 'Tarn',
        text: 'I can hear the cascade from here. It is still wrong. But I can hear it.',
        emote: 'quiet',
        seconds: 4.2,
      },
    ],
  },

  {
    id: 'dlg-tarn-restored',
    consumedByFlag: 'tarn-restored-heard',
    setsFlagOnComplete: 'tarn-restored-heard',
    beats: [
      {
        speaker: 'Tarn',
        text: 'It landed. The water — listen — it landed properly.',
        emote: 'awed',
        seconds: 3.8,
      },
      {
        speaker: 'Tarn',
        text: 'I am going to sit here a while and listen to it do that.',
        emote: 'warm',
        seconds: 3.8,
      },
    ],
  },
  {
    id: 'dlg-tarn-restored-idle',
    beats: [
      {
        speaker: 'Tarn',
        text: 'Eleven days. And it is the water I missed.',
        emote: 'quiet',
        seconds: 3.4,
      },
    ],
  },

  // --- Oru, afterwards ---------------------------------------------------

  /**
   * The guardian was freed, not killed, and this is where the game says so out
   * loud. It also starts `q-echo-return`: he is the one who knows what the
   * basin has been trying to finish saying, and the player now has the form
   * that can hold a note after leaving it.
   */
  {
    id: 'dlg-oru-ninth-terrace',
    cinematic: true,
    consumedByFlag: 'oru-spoken',
    setsFlagOnComplete: 'oru-spoken',
    startsQuest: 'q-echo-return',
    beats: [
      {
        speaker: 'Oru',
        text: 'Nine terraces. I counted them before there were nine.',
        emote: 'warm',
        seconds: 4,
      },
      { speaker: 'Oru', text: 'You did not finish me.', seconds: 2.6 },
      {
        speaker: 'Kesh',
        text: 'You were not the thing that needed finishing.',
        seconds: 3,
      },
      {
        speaker: 'Oru',
        text: 'It sang out of my own chest. I heard it with my own ears and I could not stop it.',
        emote: 'grave',
        seconds: 4.8,
      },
      {
        speaker: 'Oru',
        text: 'There are two seedlings in my hand from that morning. They are still alive.',
        emote: 'warm',
        seconds: 4.4,
      },
      {
        speaker: 'Oru',
        text: 'Go back to the basin before you leave. Three stones down there have been trying to finish a sentence for eight hundred years.',
        seconds: 5.2,
      },
      {
        speaker: 'Auralith',
        text: 'Echo Pulse will hold them. A struck note keeps ringing after you have left it.',
        emote: 'bright',
        seconds: 4.2,
      },
      {
        speaker: 'Oru',
        text: 'Come back and see the ninth terrace. Bring the loud one.',
        emote: 'warm',
        seconds: 3.6,
      },
      { speaker: 'Auralith', text: 'I am a precision instrument.', emote: 'dry', seconds: 2.4 },
    ],
  },
  {
    id: 'dlg-oru-idle',
    beats: [{ speaker: 'Oru', text: 'Slowly. Ninth terrace. Slowly.', emote: 'warm', seconds: 3 }],
  },
];

// ---------------------------------------------------------------------------
// Quests
// ---------------------------------------------------------------------------

/**
 * Five: the region's spine and four reasons to leave it.
 *
 * Two authoring rules the test enforces.
 *
 * **Ordering.** The main quest's required steps run in route order — the quest
 * runtime only evaluates the first incomplete required step of a `main` quest,
 * so a player who trips a later condition early does not skip the story between
 * them. `hintPosition` is what proves it: every required step's hint resolves to
 * a stage checkpoint, and those checkpoints' `order` values never go backwards.
 *
 * **Completability.** A `cleanse` step never asks for more enemies than the
 * stage spawns *ungated* — `enm-hound-side-b` and `enm-whisperer-hollow-c` are
 * `minDifficulty: 'standard'`, so an Explorer player has one hound and two
 * Whisperers, and the counts here are one and two.
 */
const QUESTS: readonly QuestDef[] = [
  /**
   * The spine of the vertical slice. Nine steps: arrive, meet somebody, three
   * seals with the seedbed in the middle of them, the temple door, the
   * guardian, the chord.
   *
   * Meeting Sava is `optional` on purpose. She is standing on the third terrace
   * in plain sight, but a required conversation would let a player who ran past
   * her strand the whole main quest behind an NPC, and the HUD would spend the
   * next fifteen minutes telling them to go back up the hill.
   */
  {
    id: 'q-garden-first-breath',
    title: 'The Temple of the First Breath',
    summary:
      'The Fractured Garden is holding 440 Hz and something at the bottom of it is being made ' +
      'to sing. Wake the three Keeper seals, open the low temple, and get the Garden its own ' +
      'chord back.',
    region: 'fractured-garden',
    main: true,
    rewardsAbility: 'echo',
    setsFlagOnComplete: 'garden-restored',
    steps: [
      {
        id: 'qs-first-breath-arrive',
        objective: 'Look out over the Fractured Garden.',
        condition: { kind: 'reachArea', triggerId: 'trg-opening-vista' },
        hintPosition: v(0, 0.4, -4),
      },
      {
        id: 'qs-first-breath-meet-sava',
        objective: 'Optional: speak to the woman working the third terrace.',
        condition: { kind: 'talkTo', npcId: 'npc-sava' },
        optional: true,
        hintPosition: v(-6, -1.9, -40),
      },
      {
        id: 'qs-first-breath-seal-one',
        objective: 'First seal: wake the root bridge across the chasm.',
        condition: { kind: 'solvePuzzle', puzzleId: 'puz-root-bridge-sequence' },
        hintPosition: v(0, -2.9, -67),
      },
      {
        id: 'qs-first-breath-seal-two',
        objective: 'Second seal: sound both banks of the cascade basin at once.',
        condition: { kind: 'solvePuzzle', puzzleId: 'puz-cascade-gate-simultaneous' },
        hintPosition: v(-20, -2.9, -90),
      },
      {
        id: 'qs-first-breath-seedbed',
        objective: 'Cleanse whatever is growing in the seedbed.',
        condition: { kind: 'defeatBoss', bossId: 'virus-bloom' },
        hintPosition: v(22, 0.4, -108),
      },
      {
        id: 'qs-first-breath-seal-three',
        objective: 'Third seal: hold the canopy pair open together.',
        condition: { kind: 'solvePuzzle', puzzleId: 'puz-canopy-sustain' },
        hintPosition: v(-11, 10, -129),
      },
      {
        id: 'qs-first-breath-open-temple',
        objective: 'Clear the approach gallery and open the Temple of the First Breath.',
        condition: { kind: 'flag', flag: 'garden-approach-cleared' },
        hintPosition: v(-1, 0.4, -193),
      },
      {
        id: 'qs-first-breath-free-oru',
        objective: 'Free Oru. The Amplifier is the enemy, not the colossus carrying it.',
        condition: { kind: 'defeatBoss', bossId: 'oru-fractured-colossus' },
        hintPosition: v(0, 0.4, -160),
      },
      {
        id: 'qs-first-breath-garden-chord',
        objective: 'Recover the Frequency Core and play the Garden Chord back into the region.',
        condition: { kind: 'flag', flag: 'garden-core-recovered' },
        hintPosition: v(0, 1.2, -160),
      },
    ],
  },

  /** Sava's own errand: the Keeper seed vault on the optional high walk. */
  {
    id: 'q-sava-seed-vault',
    title: 'Two Trays Out of Eleven',
    summary:
      'Sava has kept one bed alive by carrying water to it by hand. There is a Keeper seed vault ' +
      'on the high terrace walk that she cannot reach any more, and she wants whatever is still ' +
      'alive inside it.',
    region: 'fractured-garden',
    setsFlagOnComplete: 'sava-seed-recovered',
    steps: [
      {
        id: 'qs-seed-vault-walk',
        objective: 'Find the terrace walk north-west of the upper terrace.',
        condition: { kind: 'reachArea', triggerId: 'trg-side-route-hint' },
        hintPosition: v(-46, 14, -75),
      },
      {
        id: 'qs-seed-vault-hound',
        objective: 'Cleanse the bramble hound on the walk. It was garden wildlife once.',
        condition: { kind: 'cleanse', archetype: 'bramble-hound', count: 1 },
        hintPosition: v(-53, 14.2, -56),
      },
      {
        id: 'qs-seed-vault-lock',
        objective: 'Second, then Sixth: open the Seed Vault.',
        condition: { kind: 'solvePuzzle', puzzleId: 'puz-vault-sequence' },
        hintPosition: v(-53, 15, -50),
      },
      {
        id: 'qs-seed-vault-recover',
        objective: 'Take what is still alive from the vault plinth.',
        condition: { kind: 'collect', contentId: 'pick-secret-coherence-grotto', count: 1 },
        hintPosition: v(-53, 14.4, -38),
      },
      {
        id: 'qs-seed-vault-shards',
        objective: 'Optional: clear the shard trays either side of the plinth.',
        condition: { kind: 'collect', contentId: 'pick-shard-vault', count: 2 },
        optional: true,
        hintPosition: v(-53, 14.4, -36),
      },
    ],
  },

  /**
   * The return visit, and the one quest in the region that cannot be finished
   * on a first run.
   *
   * Step one is the `ability:echo` flag the adventure runtime sets when an
   * ability is granted, so the gate is the ability itself rather than a
   * bookkeeping flag. Everything after it is authored in the stage as
   * `requiresForm: 'echo'`: the three basin resonators are 15.2 m apart with a
   * 1.1 s hold, and the canopy rail is three broken lengths of dead root.
   */
  {
    id: 'q-echo-return',
    title: 'What the Basin Was Saying',
    summary:
      'Three stones in the cascade basin cannot be held lit at once by anyone who has to walk ' +
      'between them. Come back with a note that keeps ringing after you leave it.',
    region: 'fractured-garden',
    setsFlagOnComplete: 'garden-echo-answers',
    steps: [
      {
        id: 'qs-echo-return-ability',
        objective: 'Return to the Garden carrying Echo Pulse.',
        condition: { kind: 'flag', flag: 'ability:echo' },
        hintPosition: v(-26, -2.3, -90),
      },
      {
        id: 'qs-echo-return-basin',
        objective: 'Hold all three basin stones lit at the same time.',
        condition: { kind: 'solvePuzzle', puzzleId: 'puz-cascade-echo' },
        hintPosition: v(-26, -1.4, -87),
      },
      {
        id: 'qs-echo-return-motif',
        objective: 'Take the phrase the basin was holding.',
        condition: { kind: 'collect', contentId: 'pick-secret-lost-motif', count: 1 },
        hintPosition: v(-26, -2.3, -90),
      },
      {
        id: 'qs-echo-return-memory',
        objective: 'Bridge the dead root above the upper terrace and reach the alcove.',
        condition: { kind: 'collect', contentId: 'pick-secret-keeper-memory', count: 1 },
        hintPosition: v(-8, 22.3, -62),
      },
    ],
  },

  /** The neighbour who went quiet. Cleansing is not a special verb here — it is
   *  taking the note out of the room and giving him back what he hid. */
  {
    id: 'q-quiet-neighbour',
    title: 'The Man in the Hollow',
    summary:
      'Someone is standing in the Whisperer hollow humming at 440 Hz, and the Detuners walk ' +
      'past him because he sounds like them.',
    region: 'fractured-garden',
    setsFlagOnComplete: 'tarn-cleansed',
    steps: [
      {
        id: 'qs-quiet-listen',
        objective: 'Try to talk to the man in the hollow.',
        condition: { kind: 'talkTo', npcId: 'npc-tarn-quiet' },
        hintPosition: v(-10, -2.9, -58),
      },
      {
        id: 'qs-quiet-clear',
        objective: 'Cleanse the Whisperers holding the note he is copying.',
        condition: { kind: 'cleanse', archetype: 'whisperer', count: 2 },
        hintPosition: v(0, -2.9, -53),
      },
      {
        id: 'qs-quiet-cache',
        objective: 'Find what he hid in the hollow wall.',
        condition: { kind: 'collect', contentId: 'pick-secret-shard-cache', count: 1 },
        hintPosition: v(-9, -0.2, -59),
      },
    ],
  },

  /**
   * Renn's list. Every step is a `motif:<id>` flag, which the adventure runtime
   * sets the moment a card's `foundAt` resolves — so the quest is genuinely
   * "collect four phrases" rather than a re-implementation of collection.
   */
  {
    id: 'q-garden-motifs',
    title: 'Phrases the Garden Kept',
    summary:
      'Renn has been writing down every phrase this place still makes, and he only has half of ' +
      'four of them. A thing nobody remembers the sound of is gone twice.',
    region: 'fractured-garden',
    setsFlagOnComplete: 'garden-motifs-kept',
    steps: [
      {
        id: 'qs-motifs-sava',
        objective: 'Learn what Sava hums while she works.',
        condition: { kind: 'flag', flag: 'motif:mot-garden-what-sava-hums' },
        hintPosition: v(-6, -1.9, -40),
      },
      {
        id: 'qs-motifs-bridge',
        objective: "Learn the root bridge's three notes.",
        condition: { kind: 'flag', flag: 'motif:mot-garden-root-bridge' },
        hintPosition: v(0, -2.9, -67),
      },
      {
        id: 'qs-motifs-carrying',
        objective: 'Recover the walking rhythm from the upper terrace.',
        condition: { kind: 'flag', flag: 'motif:mot-garden-carrying-step' },
        hintPosition: v(-38, 13.3, -73),
      },
      {
        id: 'qs-motifs-canopy',
        objective: 'Learn the canopy pair.',
        condition: { kind: 'flag', flag: 'motif:mot-garden-canopy-pair' },
        hintPosition: v(-11, 10.5, -130),
      },
      {
        id: 'qs-motifs-unfinished',
        objective: 'Optional: find the line the Keepers left unfinished.',
        condition: { kind: 'flag', flag: 'motif:mot-garden-unfinished-line' },
        optional: true,
        hintPosition: v(9, 13.5, -75),
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// The temple
// ---------------------------------------------------------------------------

/**
 * The Temple of the First Breath — reference only.
 *
 * **Its rooms are authored in the temples module, not here.** This entry exists
 * so the zone knows which temple belongs to the region, which ability it
 * teaches, which guardian holds it and what the region's restoration chord is;
 * the room list, its beat curve and the per-room puzzle ids are the temples
 * module's business and are merged in there. `rooms` is deliberately empty
 * rather than guessed at, so nothing in this file can contradict it.
 *
 * `restorationChord` is the Garden Chord: Root, Third, Fifth, Octave — the
 * chord played into the Amplifier's wound in `cut-frequency-core`, and the
 * shape the composition shrine on the canopy terrace listens for.
 */
const TEMPLE_OF_THE_FIRST_BREATH: TempleDef = {
  id: 'temple-of-the-first-breath',
  displayName: 'The Temple of the First Breath',
  region: 'fractured-garden',
  teaches: 'echo',
  rooms: [],
  miniBossId: 'virus-bloom',
  guardianId: 'oru-fractured-colossus',
  restorationChord: [0, 2, 4, 7],
};

// ---------------------------------------------------------------------------
// Shrines
// ---------------------------------------------------------------------------

/**
 * Four optional shrines, none of them on the critical path.
 *
 * Two of them are the stage's own puzzles seen from the other side — the basin
 * echo stones and the gallery memory — because a shrine that duplicates
 * existing geometry is a reason to look at that geometry again, not new work
 * for the physics.
 *
 * `shr-canopy-answer` takes a *composition*: there is no fixed answer, it
 * listens for whatever the player has built out of their motif cards and
 * answers if the phrase resolves onto the Garden Chord. That is the one place
 * in the region where the world asks the player to write rather than solve.
 */
const SHRINES: readonly ShrineDef[] = [
  {
    id: 'shr-fallen-ring',
    displayName: 'Shrine of the Fallen Ring',
    region: 'fractured-garden',
    /** Inside the fallen resonator ring on the overlook plaza (top y 0). */
    position: v(-12, 0.6, -6),
    shape: { kind: 'sphere', radius: 1.8 },
    rewardContentId: 'mot-garden-dry-channel',
  },
  {
    id: 'shr-still-basin',
    displayName: 'Shrine of the Still Basin',
    region: 'fractured-garden',
    /** Standing in the cascade basin among the three echo stones (floor y −2.9). */
    position: v(-24, -2.3, -92.5),
    shape: { kind: 'box', halfExtents: v(1.2, 1.2, 1.2) },
    puzzleId: 'puz-cascade-echo',
    rewardContentId: 'pick-secret-lost-motif',
  },
  {
    id: 'shr-canopy-answer',
    displayName: 'Shrine of the Unfinished Line',
    region: 'fractured-garden',
    /** East end of the canopy terrace (top y 12.9), in sight of the descent rail. */
    position: v(9, 13.5, -75),
    shape: { kind: 'sphere', radius: 2 },
    acceptsComposition: true,
    rewardContentId: 'mot-garden-unfinished-line',
  },
  {
    id: 'shr-gallery-step',
    displayName: 'Shrine of the Ninth Step',
    region: 'fractured-garden',
    /** In the approach gallery under the gold arches (floor y 0). */
    position: v(4, 0.6, -191),
    shape: { kind: 'sphere', radius: 1.6 },
    rewardContentId: 'pick-keeper-memory-gallery',
  },
];

// ---------------------------------------------------------------------------
// Map markers
// ---------------------------------------------------------------------------

/**
 * Twelve markers. Eight are `discoveredByTriggerId` — they exist on the map
 * because the player was standing there when a stage trigger fired, so the map
 * fills in behind them rather than telling them where to go. The four
 * exceptions are the shrines, discovered by proximity, which is the same rule
 * stated differently: you have to have found the shrine.
 */
const MARKERS: readonly MapMarkerDef[] = [
  {
    id: 'mk-temple-first-breath',
    kind: 'temple',
    region: 'fractured-garden',
    position: v(0, 2, -187),
    label: 'Temple of the First Breath',
    discoveredByTriggerId: 'trg-cut-commander-approach',
  },
  {
    id: 'mk-guardian-oru',
    kind: 'guardian',
    region: 'fractured-garden',
    position: v(0, 0, -160),
    label: "Oru's Ring",
    /** The west-flank vista where the fog opens and he is directly below. */
    discoveredByTriggerId: 'trg-highline-vista',
  },
  {
    id: 'mk-village-terrace-beds',
    kind: 'village',
    region: 'fractured-garden',
    position: v(-6, -1.9, -40),
    label: 'The Terrace Beds',
    discoveredByTriggerId: 'trg-tut-dash',
  },
  {
    id: 'mk-camp-upper-terrace',
    kind: 'camp',
    region: 'fractured-garden',
    position: v(-42, 12.9, -74),
    label: "Renn's Camp",
    discoveredByTriggerId: 'trg-side-route-hint',
  },
  {
    id: 'mk-cave-cascade-grotto',
    kind: 'cave',
    region: 'fractured-garden',
    position: v(-48, 8, -81),
    label: 'The Grotto Behind the Cascade',
    discoveredByTriggerId: 'trg-tut-water-lift',
  },
  {
    id: 'mk-tower-west-mast',
    kind: 'tower',
    region: 'fractured-garden',
    position: v(-22, 14, -66),
    label: 'Frequency Mast, West Pillar',
    discoveredByTriggerId: 'trg-vineway-fire',
  },
  {
    id: 'mk-crash-site-seedbed',
    kind: 'crash-site',
    region: 'fractured-garden',
    position: v(22, 0, -100),
    label: 'The Impact Furrow',
    discoveredByTriggerId: 'trg-cut-virus-bloom',
  },
  {
    id: 'mk-sanctuary-return',
    kind: 'sanctuary',
    region: 'fractured-garden',
    /** The regrown Keeper stair out of the arena's south rim. */
    position: v(0, 2.4, -97),
    label: "The Keepers' Stair Home",
    discoveredByTriggerId: 'trg-obj-return',
  },

  // --- Shrines: proximity, not triggers ----------------------------------
  {
    id: 'mk-shrine-fallen-ring',
    kind: 'shrine',
    region: 'fractured-garden',
    position: v(-12, 0.6, -6),
    label: 'Shrine of the Fallen Ring',
  },
  {
    id: 'mk-shrine-still-basin',
    kind: 'shrine',
    region: 'fractured-garden',
    position: v(-24, -2.3, -92.5),
    label: 'Shrine of the Still Basin',
  },
  {
    id: 'mk-shrine-canopy-answer',
    kind: 'shrine',
    region: 'fractured-garden',
    position: v(9, 13.5, -75),
    label: 'Shrine of the Unfinished Line',
  },
  {
    id: 'mk-shrine-gallery-step',
    kind: 'shrine',
    region: 'fractured-garden',
    position: v(4, 0.6, -191),
    label: 'Shrine of the Ninth Step',
  },
];

// ---------------------------------------------------------------------------
// Codex
// ---------------------------------------------------------------------------

/**
 * Twelve entries across all five categories.
 *
 * Short on purpose — a codex entry is a paragraph the player reads standing up.
 * Every `unlockedByFlag` is a flag something in the region actually sets, so no
 * entry can be stranded: marker discovery, a puzzle reward, a conversation, the
 * ability grant, or the Core coming out of Oru's chest.
 */
const CODEX: readonly CodexEntryDef[] = [
  {
    id: 'cdx-nine-terraces',
    category: 'world',
    title: 'The Nine Terraces',
    body:
      'It was not a garden that happened to be on a cliff. The cliff was chosen because water ' +
      'falling nine times makes nine different sounds, and the Keepers wanted all nine at once. ' +
      'The terraces are tuned to each other. So is the order they were planted in.',
    unlockedByFlag: 'marker:mk-village-terrace-beds',
  },
  {
    id: 'cdx-taught-water',
    category: 'world',
    title: 'How Water Was Taught to Fall',
    body:
      'Every channel here is cut to a depth, not a gradient. Water finds the pitch of the stone ' +
      'and follows it down. Detune the stone by eight cycles and the water does not stop — it ' +
      'simply stops agreeing about which way down is, and pools, and goes still, and rots.',
    unlockedByFlag: 'door-open:door-cascade-gate',
  },
  {
    id: 'cdx-impact-furrow',
    category: 'world',
    title: 'The Impact Furrow',
    body:
      'Something came down into the seedbed hard enough to leave a trench forty metres long. ' +
      'There is no wreck at the end of it. Whatever arrived was carried out of the crater by ' +
      'something else, and the only thing growing in the furrow now is the Bloom.',
    unlockedByFlag: 'marker:mk-crash-site-seedbed',
  },

  {
    id: 'cdx-sava',
    category: 'people',
    title: 'Sava, Who Waters by Hand',
    body:
      'Sixty-one years old, third terrace, eleven trips a day with two litres a trip. She has ' +
      'kept one bed alive since the morning the water went wrong. She can hear the detune ' +
      'without an instrument and describes this as the worst thing that has happened to her.',
    unlockedByFlag: 'sava-met',
  },
  {
    id: 'cdx-oru-before',
    category: 'people',
    title: 'Oru, Before',
    body:
      "He was the garden's hands. Four hundred years of carrying seedlings up terraces too " +
      'narrow for anything else his size, at a pace slow enough to sing to, and the handprints ' +
      'worn into the stone are all on the safe side of the path. Nobody built him as a weapon. ' +
      'The Amplifier was driven into the seam of his chest afterwards, and it moves before he ' +
      'does — which is why he flinches from his own blows.',
    unlockedByFlag: 'marker:mk-guardian-oru',
  },
  {
    id: 'cdx-quiet-ones',
    category: 'people',
    title: 'The Quiet Ones',
    body:
      'Long exposure does not injure people. It tunes them. They stop speaking, hold one flat ' +
      'note, and the Detuners stop registering them as anything but scenery. Take the note out ' +
      'of the room and they come back, missing the time and nothing else. That is the mercy in ' +
      'it, and it is not much of one.',
    unlockedByFlag: 'tarn-heard',
  },

  {
    id: 'cdx-whisperer-field-note',
    category: 'creatures',
    title: 'Field Note: Whisperer',
    body:
      'Waist-high, four-legged, no eyes anywhere on it. It stops dead every few seconds and ' +
      'tilts its whole body toward sound — that pause is it listening, and it is the only warning ' +
      'you get before it lunges. It cannot hear 432 Hz at all. It walks straight past anything ' +
      'holding the true chord, which is worse than being hunted by something that could.',
  },
  {
    id: 'cdx-garden-guardian',
    category: 'creatures',
    title: 'Field Note: The Basin Guardian',
    body:
      'It stands between you and the seedbed plinth and it does not advance. Detuner signal ' +
      'wrapped around a Garden signature that is still intact underneath — it is not attacking, ' +
      'it is refusing to move, which is exactly what it was made to do. Cleanse it. Killing it ' +
      'works and costs you the thing it was standing on.',
    unlockedByFlag: 'marker:mk-shrine-still-basin',
  },

  {
    id: 'cdx-three-seals',
    category: 'resonance',
    title: 'The Three Seals',
    body:
      'A sequence, then two notes at once, then a sustain. The Keepers did not lock the low ' +
      'temple against thieves; they locked it against people who had not learned to play yet. ' +
      'Every seal is an exam, in order, and passing all three is the same as being ready.',
    unlockedByFlag: 'sava-seals-heard',
  },
  {
    id: 'cdx-eight-cycles-sharp',
    category: 'resonance',
    title: 'Eight Cycles Sharp',
    body:
      'Four hundred and forty against four hundred and thirty-two. Close enough that most people ' +
      'only notice they are tired. The masts on the pillars are not weapons first — they are ' +
      'tuning forks, holding the region at the wrong pitch, and everything alive inside the field ' +
      'spends the day quietly straining to match them.',
    unlockedByFlag: 'marker:mk-tower-west-mast',
  },
  {
    id: 'cdx-echo-pulse',
    category: 'resonance',
    title: 'Echo Pulse',
    body:
      'A struck note keeps ringing after the striker has left it. Trivial to describe and it ' +
      'changes what a room is: three stones too far apart to hold together become one chord, and ' +
      'a dead root in three broken lengths becomes a line you can ride. Oru had it the whole ' +
      'time. He carried it up nine terraces and never once used it on anything.',
    unlockedByFlag: 'ability:echo',
  },

  {
    id: 'cdx-hands-on-the-stone',
    category: 'memory',
    title: 'Hands on the Stone',
    body:
      'A Keeper memory, recovered in the approach gallery. "He will not step on the seedlings, ' +
      'so we cut the path too narrow for him and he learned to walk it sideways. Sixty years. ' +
      'Not one crushed. I have stopped calling him the machine in front of the apprentices."',
    unlockedByFlag: 'motif:mot-garden-hands-on-the-stone',
  },
  {
    id: 'cdx-ninth-terrace',
    category: 'memory',
    title: 'The Ninth Terrace',
    body:
      'It was never finished. Eight terraces planted, the ninth cut and dug and standing empty, ' +
      'and a colossus who had two seedlings in his hand on the morning the world went sharp. He ' +
      'still has them. They are still alive. He has been counting to nine for eight hundred ' +
      'years and getting eight.',
    unlockedByFlag: 'garden-core-recovered',
  },
];

// ---------------------------------------------------------------------------
// Motif cards
// ---------------------------------------------------------------------------

/**
 * Nine cards: two rhythm, two bass, two harmony, three melody — enough that
 * Composition Mode has a whole layered arrangement's worth of Garden material
 * rather than a handful of ornaments.
 *
 * `steps` are harmonic degrees indexing `HARMONIC_RATIOS` (0 = Root … 7 =
 * Octave) with `null` for a rest, so every card is playable through the same
 * synthesis path the puzzles and the Auralith use.
 *
 * `foundAt` names wherever the card lives — a stage pickup's content id, a
 * trigger the player walked through, or a flag. That is why the cards can hide
 * behind things the region already has: Sava's hum comes from talking to her,
 * the bridge phrase from the bridge growing, the vent rhythm from walking the
 * optional side route while it is firing at you.
 */
const MOTIFS: readonly MotifCardDef[] = [
  // --- Rhythm ------------------------------------------------------------
  {
    id: 'mot-garden-dry-channel',
    name: 'Dry Channel',
    region: 'fractured-garden',
    layer: 'rhythm',
    /** A channel with nothing in it: knuckles on stone and a lot of nothing. */
    steps: [0, null, 0, 0, null, 0, null, null],
    stepsPerBar: 8,
    foundAt: 'marker:mk-shrine-fallen-ring',
  },
  {
    id: 'mot-garden-vent-count',
    name: 'Four Beats, Two Venting',
    region: 'fractured-garden',
    layer: 'rhythm',
    /** Transcribed off the spore vents on the side route — the rolling wave the
     *  player walks with rather than sprints through. */
    steps: [0, null, null, 0, 0, null, null, 0],
    stepsPerBar: 8,
    foundAt: 'trg-vault-guard',
  },

  // --- Bass --------------------------------------------------------------
  {
    id: 'mot-garden-carrying-step',
    name: 'The Carrying Step',
    region: 'fractured-garden',
    layer: 'bass',
    /** The bass Oru walked to. Slow enough to climb nine terraces on, and the
     *  spine the Carrying Song was written over. */
    steps: [0, null, 4, null, 0, null, 2, null],
    stepsPerBar: 8,
    foundAt: 'pick-motif-upper-terrace',
  },
  {
    id: 'mot-garden-stone-under-water',
    name: 'Stone Under Water',
    region: 'fractured-garden',
    layer: 'bass',
    /** What the great cascade lands on, heard from the dry side of it. */
    steps: [0, null, null, null, 3, null, null, null],
    stepsPerBar: 8,
    foundAt: 'marker:mk-cave-cascade-grotto',
  },

  // --- Harmony -----------------------------------------------------------
  {
    id: 'mot-garden-root-bridge',
    name: 'Root, Fifth, Octave',
    region: 'fractured-garden',
    layer: 'harmony',
    /** The first seal, kept as a card. Found when the bridge grows. */
    steps: [0, 4, 7, 4],
    stepsPerBar: 4,
    foundAt: 'platforms:puz-root-bridge-sequence',
  },
  {
    id: 'mot-garden-canopy-pair',
    name: 'The Canopy Pair',
    region: 'fractured-garden',
    layer: 'harmony',
    /** Third against Sixth, held. The sustain the canopy roots answer on. */
    steps: [2, 5, null, 5, 2, null, 4, null],
    stepsPerBar: 8,
    foundAt: 'garden-canopy-open',
  },

  // --- Melody ------------------------------------------------------------
  {
    id: 'mot-garden-what-sava-hums',
    name: 'What Sava Hums',
    region: 'fractured-garden',
    layer: 'melody',
    /** She does it without noticing, on the walk back to the channel. */
    steps: [4, 2, 0, 2, 4, 5, 4, null],
    stepsPerBar: 8,
    foundAt: 'sava-met',
  },
  {
    id: 'mot-garden-hands-on-the-stone',
    name: 'Hands on the Stone',
    region: 'fractured-garden',
    layer: 'melody',
    /** Lifted off the Keeper memory in the approach gallery. Descending, patient,
     *  and it ends on the root because he always did get there. */
    steps: [7, 5, 4, 2, 0, null],
    stepsPerBar: 6,
    foundAt: 'pick-keeper-memory-gallery',
  },
  {
    id: 'mot-garden-unfinished-line',
    name: 'The Unfinished Line',
    region: 'fractured-garden',
    layer: 'melody',
    /** Three notes and three rests, cut into the canopy shrine and never
     *  finished. `shr-canopy-answer` accepts whatever the player finishes it
     *  with, which is the point of handing the card over half-empty. */
    steps: [0, 2, 4, null, null, null],
    stepsPerBar: 6,
    foundAt: 'marker:mk-shrine-canopy-answer',
  },
];

// ---------------------------------------------------------------------------
// The zone
// ---------------------------------------------------------------------------

/**
 * `connections` mirrors the World Lattice's edges out of the Garden — back to
 * the Fallen Sanctuary, across to the Glass Meridian and the Verdant Machine,
 * and down the water line to the Tidal Archive.
 */
export const FRACTURED_GARDEN_ZONE: ZoneDef = {
  id: 'fractured-garden',
  displayName: 'The Fractured Garden',
  stageId: 'fractured-garden',
  npcs: NPCS,
  dialogue: DIALOGUE,
  quests: QUESTS,
  temples: [TEMPLE_OF_THE_FIRST_BREATH],
  shrines: SHRINES,
  markers: MARKERS,
  codex: CODEX,
  motifs: MOTIFS,
  connections: ['fallen-sanctuary', 'glass-meridian', 'verdant-machine', 'tidal-archive'],
};
