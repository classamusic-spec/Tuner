import { STAGE_IDS } from '@tuner/shared';
import type { ResonanceFormId, StageId } from '@tuner/shared';
import type { DialogueLine } from '@tuner/game-core';

/**
 * The story bible, as data.
 *
 * Nothing in TUNER stops to explain itself. The premise is delivered in the
 * first ninety seconds of play and then never restated; everything else — who
 * built the World Chord, what the Keepers were, what Oru carried between the
 * terraces before an Amplifier grew into his chest — is *found*, in fragments,
 * by players who go looking. That is why the history lives here as collectible
 * prose rather than in cutscenes: the game never makes you sit through it, and
 * never withholds it either.
 *
 * Writing rules this file holds itself to:
 *
 * 1. **No exposition dumps.** A beat is one or two sentences. A memory fragment
 *    is a paragraph. If it needs more room than that, it is not written well
 *    enough yet.
 * 2. **Concrete over cosmic.** Not "the ancient harmony of creation" — a stone
 *    giant who slept standing up in the rain.
 * 3. **The enemy is not evil, it is deaf.** The Detuners are retuning the world
 *    to a pitch they can perceive. That is worse than malice and much sadder.
 * 4. **Restoration, not conquest.** Every arc in this file ends with something
 *    put back rather than something destroyed.
 */

// ---------------------------------------------------------------------------
// Premise
// ---------------------------------------------------------------------------

export interface WorldPremise {
  readonly logline: string;
  readonly setup: string;
  readonly inciting: string;
  readonly stakes: string;
  readonly turn: string;
  readonly resolution: string;
  readonly themes: readonly string[];
}

export const PREMISE: WorldPremise = {
  logline:
    'A young musician wakes to find the world tuned a semitone sharp, and walks it back one ' +
    'region at a time.',
  setup:
    'Everything that grew, orbited or drew breath grew into one pitch: 432 Hz, the World Chord. ' +
    'The Keepers did not invent it. They only kept it in tune, node by node, for eight hundred ' +
    'years, and taught their children to hear when it slipped.',
  inciting:
    'In a single morning the whole world is pushed to 440 Hz. Close enough to pass for music. ' +
    'Wrong enough that stone forgets what held it down, water forgets which way to fall, and ' +
    'every living thing starts quietly straining against itself.',
  stakes:
    'A retuned world does not explode. It comes apart politely, over years, with everything in ' +
    'it still trying to be what it was. The Sanctuary falls in the first hours. The rest of the ' +
    'world has longer, and no idea.',
  turn:
    'The Detuners are not conquerors. They are the Silent Choir — a people who cannot hear the ' +
    'true chord at all, retuning the universe to the one frequency they can. And the Commander ' +
    'who taught them how was a Keeper first.',
  resolution:
    'The Tuner does not defeat the Detuners. She gives them back a note they can hear that is ' +
    'also true, and the world is restrung around it — eight nodes, eight recovered forms, one ' +
    'chord, played by whoever is left standing at the Loom.',
  themes: [
    'Listening is an act, not a state.',
    'Restoration is harder and better than destruction.',
    'A world in tune is not uniform — it is many things ringing at once.',
    'Grief is a note held too long, not a wrong one.',
    'Nobody is unreachable. Some people just need the pitch met halfway.',
  ],
};

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

export type CharacterRole = 'protagonist' | 'guide' | 'tragic' | 'antagonist' | 'faction';

export interface CharacterProfile {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly role: CharacterRole;
  /** Art-direction brief. Silhouette first — this is what the modeller reads. */
  readonly appearance: string;
  /** How they speak. Everything they say in the game should pass this test. */
  readonly voice: string;
  readonly want: string;
  readonly wound: string;
  readonly arc: string;
  readonly firstAppearance: StageId;
}

export const CHARACTERS: Readonly<Record<string, CharacterProfile>> = {
  'the-tuner': {
    id: 'the-tuner',
    name: 'The Tuner',
    title: 'Last apprentice of the Fallen Sanctuary',
    role: 'protagonist',
    appearance:
      'Light build, quick on her feet, voluminous curly light-brown hair that moves a beat ' +
      'behind she does. Deep indigo tunic, a violet sash crossing the chest, a gold emblem of ' +
      'two interlocking rings at the shoulder, wrapped waist sash, an asymmetric layered ' +
      'skirt-wrap falling to one side, gold tassel-cluster at the hip, violet leggings, navy ' +
      'fingerless gloves, soft pointed violet boots. Readable hands and feet, expressive face, ' +
      'legible in silhouette at thumbnail size. Her accents shift colour with the equipped ' +
      'Resonance Form.',
    voice:
      'Short sentences. Notices sound before sight and says so. Deflects fear with practicality ' +
      'rather than jokes. Never gives a speech; her longest line in the game is nine words.',
    want: 'To put the world back the way it sounded when she woke up in it.',
    wound:
      'She was the apprentice who was never quite serious enough, and the person who thought so ' +
      'died in the first hour telling her she was ready.',
    arc:
      'From a girl copying an exercise to a Tuner who can hear a region she has never visited ' +
      'and know, from the interference alone, what is wrong with it.',
    firstAppearance: 'fallen-sanctuary',
  },

  'keeper-ovel': {
    id: 'keeper-ovel',
    name: 'Keeper Ovel',
    title: 'Keeper of the Fallen Sanctuary',
    role: 'guide',
    appearance:
      'Old, broad-shouldered, stooped; a long navy Keeper coat with gold ring-and-square ' +
      'embroidery worn thin at the elbows. From the moment the retuning starts, his outline is ' +
      'faintly doubled, like a struck bell photographed twice — the visual language for someone ' +
      'no longer entirely at one pitch.',
    voice:
      'Blunt, unsentimental, occasionally funny by accident. Instructs in imperatives. Refuses ' +
      'grand phrasing even when the moment calls for it, which is why the one time he uses it, ' +
      'it lands.',
    want: 'To hand the Auralith to someone who will still be here tomorrow.',
    wound:
      'He was at the Loom the day the First Conductor left, and he said nothing, because at the ' +
      'time the argument sounded reasonable.',
    arc:
      'Dies in the first region and stays in the game: the Sanctuary keeps his voice in its ' +
      'resonance, so his guidance is literally an echo the player is restoring as they go.',
    firstAppearance: 'fallen-sanctuary',
  },

  oru: {
    id: 'oru',
    name: 'Oru',
    title: 'The Fractured Colossus',
    role: 'tragic',
    appearance:
      'A walking terrace: mossed stone plates, a gold seam running from throat to waist, hands ' +
      'wide enough to carry a nursery bed. An Amplifier is now grown into that seam like a ' +
      'wound that has been packed with crystal, and it moves before he does.',
    voice:
      'Barely speaks. Two words at a time, spaced far apart, in a low sustained tone the audio ' +
      'engine renders as a held chord rather than a voice.',
    want: 'To finish carrying the seedlings up to the ninth terrace. He was two short.',
    wound:
      'He was the Garden. Being made into a weapon against it is not something he can process, ' +
      'so he simply keeps flinching from his own blows.',
    arc:
      "The first Commander fight, and the game's thesis statement: he is not killed, he is " +
      'freed, and the ninth terrace gets planted in the restored region behind him.',
    firstAppearance: 'fractured-garden',
  },

  'the-first-conductor': {
    id: 'the-first-conductor',
    name: 'Serren',
    title: 'The First Conductor',
    role: 'antagonist',
    appearance:
      'A Keeper coat, eight hundred years old, kept immaculate — navy, gold ring embroidery, ' +
      'entirely uncorrupted. No crystal, no violet core, no single luminous eye. She is the only ' +
      'figure in the Detuner ranks who still looks like a person, and that is the horror of her.',
    voice:
      'Warm. Patient. Genuinely pleased to meet the player. Argues the way a good teacher argues ' +
      'and is never once cruel, which makes disagreeing with her expensive.',
    want:
      'A universe at one fixed pitch, where nothing drifts, nothing decays, and nothing ever ' +
      'has to be tuned again — including the people who cannot hear it drifting.',
    wound:
      'She was the finest ear the Keepers ever had, and she was the first to go deaf. She spent ' +
      'sixty years tuning a chord she could no longer hear before she stopped pretending.',
    arc:
      'Not defeated by argument or by force. Defeated by being played *to* — the final sequence ' +
      'is the Tuner finding a chord that is true at 432 and still audible to someone who cannot ' +
      'hear it, which is the thing Serren decided was impossible.',
    firstAppearance: 'celestial-loom',
  },

  'the-silent-choir': {
    id: 'the-silent-choir',
    name: 'The Silent Choir',
    title: 'The people who cannot hear',
    role: 'faction',
    appearance:
      'Never seen whole. They arrive as their instruments: the Detuners, angular obsidian and ' +
      'violet crystal, each one with a single luminous eye because the Choir builds everything ' +
      'to see, having no use for ears. Their fleet reads on the lattice as a violet line ' +
      'entering from outside the diagram.',
    voice:
      'No voice. Everything they say arrives as amplitude — the loudest signal in the room is ' +
      'their sentence, and there is nothing under it.',
    want:
      'A frequency they can perceive, held everywhere, forever. They believe they are correcting ' +
      'an error in the universe, not committing one.',
    wound:
      'Their own world went quiet first, so long ago that no record of it survives. They are not ' +
      'invading. They are trying to stop being alone in the silence.',
    arc:
      'The reveal is not that they are monsters. It is that the retuning is an act of homesick ' +
      'people building a world they can finally hear, on top of one that was already singing.',
    firstAppearance: 'fallen-sanctuary',
  },
};

// ---------------------------------------------------------------------------
// Per-stage narrative beats
// ---------------------------------------------------------------------------

export type BeatPhase =
  'arrival' | 'discovery' | 'complication' | 'confrontation' | 'restoration' | 'departure';

export interface NarrativeBeat {
  readonly id: string;
  readonly phase: BeatPhase;
  /** One or two sentences. Delivered in play, never in a menu. */
  readonly text: string;
}

export interface StageNarrative {
  readonly stageId: StageId;
  readonly title: string;
  /** The region in a single line, from the Tuner's point of view. */
  readonly premise: string;
  readonly beats: readonly NarrativeBeat[];
  /** Played on arrival, before control is returned. */
  readonly openingExchange: readonly DialogueLine[];
  /** Spoken over the retuning, once the Commander kneels. */
  readonly restorationLine: DialogueLine;
  /** Ovel's echo, filed in the Sanctuary archive after the region is restored. */
  readonly keeperNote: string;
  /** What the player carries out of here that is not a form. */
  readonly lesson: string;
}

export const STAGE_NARRATIVES: Readonly<Record<StageId, StageNarrative>> = {
  // -------------------------------------------------------------------------
  'fallen-sanctuary': {
    stageId: 'fallen-sanctuary',
    title: 'The Fallen Sanctuary',
    premise: 'The place that taught her to listen comes apart while she is standing in it.',
    beats: [
      {
        id: 'fs-wake',
        phase: 'arrival',
        text: 'She wakes because the room is wrong. Not louder. Sharper — half a step, everywhere at once.',
      },
      {
        id: 'fs-terraces',
        phase: 'discovery',
        text: 'The lower terraces are rising. Stone that has been held down for eight centuries has stopped agreeing to it.',
      },
      {
        id: 'fs-auralith',
        phase: 'discovery',
        text: 'Ovel opens the altar. Inside is a ring of harmonic strings that fits her forearm as if it had been measured for her, which it has.',
      },
      {
        id: 'fs-detuners',
        phase: 'complication',
        text: 'The first Whisperers come over the wall. She had assumed this was weather. It is not weather; every wrong note out here was placed.',
      },
      {
        id: 'fs-guardian',
        phase: 'confrontation',
        text: 'The Sanctuary Guardian has kept this hill in tune since before the walls existed. Its core is violet now, and it is broadcasting.',
      },
      {
        id: 'fs-restore',
        phase: 'restoration',
        text: 'She brings the Guardian down to pitch instead of down entirely. It kneels, cyan, and the hill stops shaking.',
      },
      {
        id: 'fs-ovel',
        phase: 'departure',
        text: 'Ovel is already fading when the dome relights. He tells her the Sanctuary keeps whatever it hears, and then it does.',
      },
      {
        id: 'fs-lattice',
        phase: 'departure',
        text: 'The lattice resolves overhead: every region the Keepers ever tuned, strung together like one instrument, with eight lines gone violet.',
      },
    ],
    openingExchange: [
      { speaker: 'Keeper Ovel', text: 'Wake. The stone is singing the wrong note.', seconds: 3 },
      {
        speaker: 'Tuner',
        text: "Everything's sharp. Like the room got nudged sideways.",
        seconds: 3.2,
      },
    ],
    restorationLine: {
      speaker: 'Tuner',
      text: "You're not broken. You're just held at the wrong pitch. Hold still.",
      seconds: 3.8,
    },
    keeperNote:
      'First entry in a Keeper archive in eight hundred years written by an apprentice. It reads, ' +
      'in full: "Guardian restored, not broken. Ovel would have said it took me long enough."',
    lesson: 'Cleansing is not killing. The game will hold to that for the next nine regions.',
  },

  // -------------------------------------------------------------------------
  'fractured-garden': {
    stageId: 'fractured-garden',
    title: 'The Fractured Garden',
    premise:
      'A friend of the world is being worn like a weapon, and she has to take the weapon off.',
    beats: [
      {
        id: 'fg-arrive',
        phase: 'arrival',
        text: 'Nine terraces of luminous root hang off the cliff, and the irrigation channels are dry for the first time in living memory.',
      },
      {
        id: 'fg-vines',
        phase: 'discovery',
        text: 'The violet vine is not growing over the roots. It is growing *along* them, using the Garden as cabling.',
      },
      {
        id: 'fg-handprints',
        phase: 'discovery',
        text: 'There are handprints in the terrace stone the size of doorways, worn smooth from a century of the same careful grip.',
      },
      {
        id: 'fg-bloom',
        phase: 'complication',
        text: 'The Virus Bloom has taken the seedbed. It is not defending anything — it is planting.',
      },
      {
        id: 'fg-oru',
        phase: 'confrontation',
        text: 'The colossus who made those handprints comes over the ridge with an Amplifier grown into his chest, and flinches from every blow he throws.',
      },
      {
        id: 'fg-restore',
        phase: 'restoration',
        text: "The Amplifier ruptures. She plays the Garden's own chord into the wound until his eyes come back cyan and he sits down in the wet earth.",
      },
      {
        id: 'fg-ninth',
        phase: 'departure',
        text: 'Water finds the channels again. Oru finishes carrying the last two seedlings to the ninth terrace, eight hundred years late.',
      },
    ],
    openingExchange: [
      {
        speaker: 'Tuner',
        text: 'The channels are dry. Somebody turned the water off.',
        seconds: 3,
      },
      {
        speaker: 'Keeper Ovel',
        text: 'Nobody turned it off. It forgot which way down was.',
        seconds: 3.4,
      },
    ],
    restorationLine: {
      speaker: 'Tuner',
      text: 'You never hit me once on purpose. I heard it. Sit down.',
      seconds: 3.6,
    },
    keeperNote:
      'Ovel, on the Garden, from an entry made long before any of this: "Oru counts. Nobody ' +
      'taught him to. He has known there are nine terraces since before there were nine."',
    lesson: 'The Detuners do not build soldiers. They take things that were already loved.',
  },

  // -------------------------------------------------------------------------
  'glass-meridian': {
    stageId: 'glass-meridian',
    title: 'The Glass Meridian',
    premise: 'A city of ten thousand different notes has been made to agree, and it is shattering.',
    beats: [
      {
        id: 'gm-arrive',
        phase: 'arrival',
        text: 'The spires are all ringing the same note. She has never heard the Meridian do anything but disagree with itself beautifully.',
      },
      {
        id: 'gm-sync',
        phase: 'discovery',
        text: 'Unison at this scale is not harmony. Every spire is reinforcing every other, and the glass is failing from the inside out.',
      },
      {
        id: 'gm-mirrors',
        phase: 'complication',
        text: 'Mirror Pylons return her own shots at her, on the beat, from angles she chose.',
      },
      {
        id: 'gm-sella',
        phase: 'confrontation',
        text: 'Sella fights entirely in reflections. Only one pane of her is really there, and it is never the one that just spoke.',
      },
      {
        id: 'gm-restore',
        phase: 'restoration',
        text: 'She stops trying to out-shoot the lattice and plays a chord it cannot fold flat. The unison breaks into ten thousand pieces of itself.',
      },
      {
        id: 'gm-depart',
        phase: 'departure',
        text: 'The Meridian is loud again, and none of it agrees. It sounds, for the first time in weeks, like a city.',
      },
    ],
    openingExchange: [
      { speaker: 'Tuner', text: "They're all singing the same note.", seconds: 2.4 },
      {
        speaker: 'Keeper Ovel',
        text: 'That is what they will call peace when they are done with us.',
        seconds: 4,
      },
    ],
    restorationLine: {
      speaker: 'Tuner',
      text: 'Disagree with me. Go on. Every one of you.',
      seconds: 3.2,
    },
    keeperNote:
      'Meridian tuning is a two-week job and the Keepers sent four people. Ovel\'s note: "Never ' +
      'tune a spire to its neighbour. Tune it to itself, then stand back and let them argue."',
    lesson: "Uniformity is the Choir's definition of harmony. It is not the game's.",
  },

  // -------------------------------------------------------------------------
  'tidal-archive': {
    stageId: 'tidal-archive',
    title: 'The Tidal Archive',
    premise:
      "Everything the world remembered is still playing, in the wrong order, in somebody else's voice.",
    beats: [
      {
        id: 'ta-arrive',
        phase: 'arrival',
        text: 'The Archive has taken on water for the first time since it was built. The coral machinery is still running, which is worse.',
      },
      {
        id: 'ta-playback',
        phase: 'discovery',
        text: 'A gallery plays her the sound of a market that has been gone for two centuries, and then plays her the last thirty seconds of her own footsteps.',
      },
      {
        id: 'ta-ovel',
        phase: 'discovery',
        text: 'One shelf holds a recording of Ovel, forty years younger, losing an argument about whether a chord can be too perfect.',
      },
      {
        id: 'ta-vess',
        phase: 'complication',
        text: 'Vess glides between the shelves swallowing whole decades. Her wings are printed with everything she has eaten.',
      },
      {
        id: 'ta-fight',
        phase: 'confrontation',
        text: 'The fight is haunted by the player: Vess replays their own last few seconds back at them, half a beat late.',
      },
      {
        id: 'ta-restore',
        phase: 'restoration',
        text: 'She stops fighting the echo and answers it — plays the phrase Vess stole, correctly, and the Archive files itself back into order.',
      },
      {
        id: 'ta-depart',
        phase: 'departure',
        text: 'The water drains. The recordings are legible again, including the argument, which Ovel still loses.',
      },
    ],
    openingExchange: [
      { speaker: 'Tuner', text: "It's still playing. All of it. At once.", seconds: 2.8 },
      {
        speaker: 'Keeper Ovel',
        text: 'Memory does not stop when it is damaged. It just stops being kind.',
        seconds: 4.2,
      },
    ],
    restorationLine: {
      speaker: 'Tuner',
      text: 'That was never yours. Here — this is how it went.',
      seconds: 3.4,
    },
    keeperNote:
      'The Archive was not built to preserve music. It was built so that a Keeper eight hundred ' +
      'years later could check whether the world had drifted, and by how much.',
    lesson: 'The past is not a weapon unless you let someone else hold it.',
  },

  // -------------------------------------------------------------------------
  'ember-observatory': {
    stageId: 'ember-observatory',
    title: 'The Ember Observatory',
    premise:
      'An instrument for watching the sky has been turned into one for setting fire to the ground.',
    beats: [
      {
        id: 'eo-arrive',
        phase: 'arrival',
        text: 'The orreries are turning at eight times their proper speed and the mountain under them has started to run.',
      },
      {
        id: 'eo-lens',
        phase: 'discovery',
        text: 'The great lens was ground over sixty years by people who never saw it finished. It is currently aimed at a valley.',
      },
      {
        id: 'eo-mirrors',
        phase: 'complication',
        text: 'Mirrors fold out of the walls without warning. The room rearranges to point the beam somewhere new.',
      },
      {
        id: 'eo-kaleth',
        phase: 'confrontation',
        text: 'Kaleth does not move at all. It has taken the lens for a head and lets the Observatory do the walking.',
      },
      {
        id: 'eo-restore',
        phase: 'restoration',
        text: 'She retunes the orrery drive instead of the Amplifier, and the whole room slows to the speed the sky actually moves at.',
      },
      {
        id: 'eo-depart',
        phase: 'departure',
        text: 'The lens comes up off the valley and finds the stars again. The lava crusts over in bands, like tree rings.',
      },
    ],
    openingExchange: [
      { speaker: 'Tuner', text: 'Everything up here is running fast.', seconds: 2.4 },
      {
        speaker: 'Keeper Ovel',
        text: 'Then everything up here is wearing out. Be quick and do not be hasty.',
        seconds: 4,
      },
    ],
    restorationLine: {
      speaker: 'Tuner',
      text: 'Somebody spent sixty years on this glass. Look up.',
      seconds: 3.4,
    },
    keeperNote:
      'The Observatory logged the World Chord against the sky every night for four hundred years. ' +
      'The last legible entry, in a hand going unsteady: "still 432. still 432. still 432."',
    lesson: 'The Detuners rarely build anything. They mostly point existing things the wrong way.',
  },

  // -------------------------------------------------------------------------
  'hollow-choir': {
    stageId: 'hollow-choir',
    title: 'The Hollow Choir',
    premise: 'A canyon that answered itself for a thousand years has been made to shout in unison.',
    beats: [
      {
        id: 'hc-arrive',
        phase: 'arrival',
        text: 'Every carved mouth in the canyon wall is open. They used to take turns.',
      },
      {
        id: 'hc-round',
        phase: 'discovery',
        text: 'The canyon was designed as a round: sing into the first mouth and the shape of the rock hands the phrase down the valley in twelve voices.',
      },
      {
        id: 'hc-seeds',
        phase: 'complication',
        text: 'Chorus Seeds drift down and take root in the mouths, and each one adds another copy of the same syllable.',
      },
      {
        id: 'hc-ombra',
        phase: 'confrontation',
        text: 'Ombra opens along its whole length into a row of singing mouths, each a beat behind the last, and attacks in musical forms gone wrong.',
      },
      {
        id: 'hc-restore',
        phase: 'restoration',
        text: 'She plays the round the way the canyon was cut for, and the shape of the rock does the rest.',
      },
      {
        id: 'hc-depart',
        phase: 'departure',
        text: 'Twelve voices, all different, none of them louder than the others. It takes four minutes for the last one to finish.',
      },
    ],
    openingExchange: [
      { speaker: 'Tuner', text: "They're all on the same beat. That's not a choir.", seconds: 3.2 },
      {
        speaker: 'Keeper Ovel',
        text: 'It is one voice with a lot of mouths. There is a difference and it matters.',
        seconds: 4.4,
      },
    ],
    restorationLine: {
      speaker: 'Tuner',
      text: 'One at a time. You remember how. Listen — like this.',
      seconds: 3.6,
    },
    keeperNote:
      'The canyon was not carved by Keepers. It was carved by whoever lived here first, and the ' +
      'Keepers only worked out, much later, what it had been carved to do.',
    lesson: 'Being heard is not the same as being loud, and the Choir has never learned it.',
  },

  // -------------------------------------------------------------------------
  'verdant-machine': {
    stageId: 'verdant-machine',
    title: 'The Verdant Machine',
    premise:
      'A forest and an engine spent centuries learning to share, and something has pulled them apart.',
    beats: [
      {
        id: 'vm-arrive',
        phase: 'arrival',
        text: 'The canopy is full of broadcast elements. Every branch has been retrained into an antenna, gently, over months.',
      },
      {
        id: 'vm-symbiosis',
        phase: 'discovery',
        text: 'The Keeper engine underneath was never meant to run alone. Roots were the coolant. Roots were always the coolant.',
      },
      {
        id: 'vm-sap',
        phase: 'complication',
        text: 'Violet sap is being pumped through pipes cut for water, at pressures the pipes were never asked to hold.',
      },
      {
        id: 'vm-thess',
        phase: 'confrontation',
        text: 'Thess is less a body than a braid, threaded through the root-cabling, wearing the machine as armour.',
      },
      {
        id: 'vm-restore',
        phase: 'restoration',
        text: 'She over-pressurises the parasite instead of the machine. Its heart surfaces for four seconds, and four seconds is enough.',
      },
      {
        id: 'vm-depart',
        phase: 'departure',
        text: 'Water in the pipes. Sap in the roots. The engine drops to a hum that the canopy answers, which is how it always sounded.',
      },
    ],
    openingExchange: [
      { speaker: 'Tuner', text: 'The trees are transmitting.', seconds: 2 },
      {
        speaker: 'Keeper Ovel',
        text: 'They have been for weeks. Somebody was very patient with them.',
        seconds: 3.8,
      },
    ],
    restorationLine: {
      speaker: 'Tuner',
      text: 'Let go of it. It was never yours to wear.',
      seconds: 3,
    },
    keeperNote:
      'It took the Keepers ninety years to convince the forest to accept the engine and one ' +
      'season for a parasite to convince it to become one. Ovel: "Trust is fast to spend."',
    lesson: 'The infection is patient. That is the frightening part, not the violet.',
  },

  // -------------------------------------------------------------------------
  'desert-of-lost-notes': {
    stageId: 'desert-of-lost-notes',
    title: 'The Desert of Lost Notes',
    premise: 'A place where sound has been eaten, and the only cues left are the ones you can see.',
    beats: [
      {
        id: 'dn-arrive',
        phase: 'arrival',
        text: 'She shouts, twice, to check. The second time she does not bother.',
      },
      {
        id: 'dn-field',
        phase: 'discovery',
        text: 'Under the dunes is an instrument-field: three thousand tuned pillars, buried and still, laid out in a pattern only readable from the ridge.',
      },
      {
        id: 'dn-null',
        phase: 'complication',
        text: 'Inside a null field the Auralith goes quiet and every warning in the game becomes a drawn shape on the ground.',
      },
      {
        id: 'dn-nul',
        phase: 'confrontation',
        text: 'Nul surfaces where the sand is thinnest: a ring of black teeth around a violet throat, and no sound at all.',
      },
      {
        id: 'dn-restore',
        phase: 'restoration',
        text: 'She waits out the quiet instead of filling it, and gives the pillars back a note they can pass along themselves.',
      },
      {
        id: 'dn-depart',
        phase: 'departure',
        text: 'The dune field rings when the wind crosses it. It is the loudest place in the world and nobody has heard it in a century.',
      },
    ],
    openingExchange: [
      { speaker: 'Tuner', text: '...', seconds: 2 },
      {
        speaker: 'Keeper Ovel',
        text: 'You will not hear me in there. Watch the ground. Everything it needs to tell you, it will draw.',
        seconds: 5,
      },
    ],
    restorationLine: {
      speaker: 'Tuner',
      text: 'You can stop swallowing now. There is enough.',
      seconds: 3.2,
    },
    keeperNote:
      'The instrument-field predates the Keepers by an unknown margin. Whoever buried it did so ' +
      'carefully, in order, as though they expected to come back for it.',
    lesson:
      'Every audio cue in TUNER has a drawn equivalent, and this region is where the game proves it.',
  },

  // -------------------------------------------------------------------------
  'orbital-dissonance': {
    stageId: 'orbital-dissonance',
    title: 'Orbital Dissonance',
    premise:
      'The false pitch is being held from outside the world, and the way up is the line they cut.',
    beats: [
      {
        id: 'od-line',
        phase: 'arrival',
        text: 'Seven restored nodes pull the severed line back together far enough to stand on. She climbs it.',
      },
      {
        id: 'od-arrays',
        phase: 'discovery',
        text: 'A ring of amplifier arrays in freefall, each one the size of the Sanctuary, all playing the same note down at the world.',
      },
      {
        id: 'od-gravity',
        phase: 'complication',
        text: 'Nothing up here has a floor for long. The arrays turn, and down turns with them.',
      },
      {
        id: 'od-choir',
        phase: 'confrontation',
        text: 'The Silent Choir answers directly for the first time — not as a creature, as volume, filling the ring until there is no room to think.',
      },
      {
        id: 'od-restore',
        phase: 'restoration',
        text: 'She does not silence the arrays. She retunes one, and lets seven restored nodes underneath pull the other fifteen into agreement.',
      },
      {
        id: 'od-loom',
        phase: 'departure',
        text: 'With the relay down, the last line resolves: one thread going somewhere the diagram has no coordinates for.',
      },
    ],
    openingExchange: [
      {
        speaker: 'Tuner',
        text: 'The whole sky is an instrument. And it only knows one note.',
        seconds: 4,
      },
      {
        speaker: 'Keeper Ovel',
        text: 'Then teach it a second one. That is all this has ever been.',
        seconds: 4,
      },
    ],
    restorationLine: {
      speaker: 'Tuner',
      text: 'Sixteen of you. Fine. Follow me.',
      seconds: 2.8,
    },
    keeperNote:
      'No Keeper ever went above the sky. The lattice always showed a line leaving the diagram, ' +
      'and eight hundred years of Keepers assumed it was a drafting error.',
    lesson: 'The forms are not keys. Every one of them is a way through, and none is the way.',
  },

  // -------------------------------------------------------------------------
  'celestial-loom': {
    stageId: 'celestial-loom',
    title: 'The Celestial Loom',
    premise:
      'The frame the World Chord was strung on, and the Keeper who has been standing at it alone.',
    beats: [
      {
        id: 'cl-arrive',
        phase: 'arrival',
        text: 'The Loom is not a throne room. It is a workshop, still tidy, with eight hundred years of tools laid out in order.',
      },
      {
        id: 'cl-serren',
        phase: 'discovery',
        text: 'Serren is wearing a Keeper coat. No crystal, no violet core. She offers to explain, and means it.',
      },
      {
        id: 'cl-argument',
        phase: 'discovery',
        text: 'She went deaf sixty years before she left, and kept tuning. Nobody noticed. That is the part she cannot forgive.',
      },
      {
        id: 'cl-choir',
        phase: 'complication',
        text: 'The Silent Choir did not recruit her. She heard them looking for a pitch and answered, because at last somebody was asking.',
      },
      {
        id: 'cl-fight',
        phase: 'confrontation',
        text: 'She fights with the whole Loom, unweaving the world thread by thread, and every thread she pulls is one the player has personally restrung.',
      },
      {
        id: 'cl-restore',
        phase: 'restoration',
        text: 'The Tuner stops arguing and plays: a chord true at 432 and loud enough in the body to be felt by someone who cannot hear it.',
      },
      {
        id: 'cl-end',
        phase: 'departure',
        text: 'Serren puts her hand flat on the frame, feels it, and says nothing at all. The world is restrung around a note the Choir can finally stand inside.',
      },
    ],
    openingExchange: [
      {
        speaker: 'The First Conductor',
        text: 'You came the whole way up. Good. I have wanted to talk to a Keeper for a very long time.',
        seconds: 5,
      },
      { speaker: 'Tuner', text: "I'm not a Keeper. I'm the last apprentice.", seconds: 3 },
    ],
    restorationLine: {
      speaker: 'Tuner',
      text: "You can't hear it. Put your hand on the frame.",
      seconds: 3.6,
    },
    keeperNote:
      'Ovel\'s final archived echo, played only after the Loom: "I was standing next to her when ' +
      'she said it. I thought she was tired. I have thought about it every day since."',
    lesson:
      'The ending is not a victory. It is the first tuning of a world with two kinds of listener in it.',
  },
};

// ---------------------------------------------------------------------------
// Keeper Memories — collectible history
// ---------------------------------------------------------------------------

export interface KeeperMemory {
  readonly id: string;
  readonly title: string;
  readonly stageId: StageId;
  /** Short original prose. One paragraph, no more. */
  readonly prose: string;
  /** Roughly when in the world's history this sits. Used to sort the archive. */
  readonly era: 'the-weaving' | 'the-keeping' | 'the-drift' | 'the-retuning';
  /** Voice on the page, for the archive's presentation layer. */
  readonly attribution: string;
}

export const KEEPER_MEMORIES: readonly KeeperMemory[] = [
  {
    id: 'mem-first-thread',
    title: 'The First Thread',
    stageId: 'fallen-sanctuary',
    era: 'the-weaving',
    attribution: 'Fragment, hand unknown',
    prose:
      'They did not compose the World Chord. They found it — a pitch already in the rock, the ' +
      'tide and the blood, all faintly agreeing, none of them quite in time. All the Loom ever ' +
      'did was hold the agreement still long enough for things to grow into it.',
  },
  {
    id: 'mem-what-a-sanctuary-is',
    title: 'What a Sanctuary Is',
    stageId: 'fallen-sanctuary',
    era: 'the-keeping',
    attribution: 'Keeper Ovel, teaching notes',
    prose:
      'A Sanctuary is not a temple and not a fort. It is a very good room. Build it true enough ' +
      'and a wrong note cannot hide in it; you will hear the drift in the walls a year before ' +
      'you would hear it outside. Everything else here — the dome, the gold, the terraces — is ' +
      'just what a very good room looks like after eight hundred years of people caring about it.',
  },
  {
    id: 'mem-nine-terraces',
    title: 'Nine Terraces',
    stageId: 'fractured-garden',
    era: 'the-keeping',
    attribution: 'Garden log, kept in tally marks',
    prose:
      'The colossus was here before the Garden was. We built the terraces around what he was ' +
      'already doing. He carries seedlings up in his hands, two at a time, and will not be ' +
      'hurried, and has never once dropped one. We stopped calling it work and started calling ' +
      'it Oru.',
  },
  {
    id: 'mem-standing-rain',
    title: 'He Slept Standing Up',
    stageId: 'fractured-garden',
    era: 'the-drift',
    attribution: 'Apprentice notebook, water-damaged',
    prose:
      'Asked Ovel why the colossus sleeps standing in the rain instead of under the arch. Ovel ' +
      'said: because the ninth terrace is not planted yet, and he does not consider the job ' +
      'finished, and he has been not-considering-it-finished for four hundred years. I asked if ' +
      'that was sad. He said it was the least sad thing on this hill.',
  },
  {
    id: 'mem-tuning-a-spire',
    title: 'Tuning a Spire',
    stageId: 'glass-meridian',
    era: 'the-keeping',
    attribution: 'Meridian field method, revision nine',
    prose:
      'Never tune a spire to its neighbour. Tune it to itself, then step back and let them find ' +
      'each other. A city that has been forced into agreement is a city that will break along ' +
      'every seam at once, and you will not hear it coming, because it will sound magnificent ' +
      'right up until it does not.',
  },
  {
    id: 'mem-the-glassmakers',
    title: 'Who Built the Meridian',
    stageId: 'glass-meridian',
    era: 'the-weaving',
    attribution: 'Fragment, hand unknown',
    prose:
      'The glassmakers were not Keepers and did not want to be. They said tuning a thing you ' +
      'made is vanity; the honest work is making a thing that will tell you the truth about ' +
      'itself. Ten thousand spires, each one a different key, each one honest. It is still the ' +
      'best argument anyone has made against us.',
  },
  {
    id: 'mem-why-we-recorded',
    title: 'Why We Recorded Everything',
    stageId: 'tidal-archive',
    era: 'the-keeping',
    attribution: 'Archive charter, first page',
    prose:
      'Not for beauty. For comparison. A world drifts slowly enough that no one lifetime can see ' +
      'it, so we keep the sound of a market, a river, a bell, and a child counting, and in three ' +
      'hundred years someone stands where we stood and plays them back and knows exactly how far ' +
      'we have fallen. This building is a ruler.',
  },
  {
    id: 'mem-too-perfect',
    title: 'The Argument About Perfection',
    stageId: 'tidal-archive',
    era: 'the-drift',
    attribution: 'Recording 4,118 — two voices, one young',
    prose:
      '"A chord cannot be too perfect." — "It can. A perfect chord has nowhere to go. You have ' +
      'built a room nobody can move in and called it peace." — "That is not what I said." — ' +
      '"It is what you will do." The younger voice is Ovel. He loses. The recording is filed ' +
      'under disagreements, minor.',
  },
  {
    id: 'mem-sixty-years-of-glass',
    title: 'Sixty Years of Glass',
    stageId: 'ember-observatory',
    era: 'the-keeping',
    attribution: 'Grinding-room roster',
    prose:
      'Eleven names, four generations, one lens. None of them saw it finished and every one of ' +
      'them knew that going in. The last entry is not a signature — it is a measurement, ' +
      'accurate to a hair, and then the word "closer" underlined twice.',
  },
  {
    id: 'mem-still-432',
    title: 'Still 432',
    stageId: 'ember-observatory',
    era: 'the-drift',
    attribution: 'Sky log, final legible page',
    prose:
      'Four hundred years of nightly entries, each one a number and a date. The hand goes ' +
      'unsteady near the end and the number never does: still 432, still 432, still 432. Then ' +
      'one morning entry, out of sequence, in a different pen: 440. And nothing after it.',
  },
  {
    id: 'mem-the-round',
    title: 'How the Canyon Was Cut',
    stageId: 'hollow-choir',
    era: 'the-weaving',
    attribution: 'Survey, Keeper hand, appended later',
    prose:
      'Twelve mouths, none of them at the same height, spaced so that a phrase sung into the ' +
      'first arrives at the twelfth exactly one bar late. Nobody wrote down why. We assume ' +
      'someone here wanted very badly to be answered and had no one to do it, so they taught the ' +
      'rock.',
  },
  {
    id: 'mem-taking-turns',
    title: 'Taking Turns',
    stageId: 'hollow-choir',
    era: 'the-keeping',
    attribution: 'Keeper Ovel, margin note',
    prose:
      'Apprentices always want to make the canyon louder. It cannot be made louder. It can only ' +
      'be made to take turns, and the whole difficulty of it — the entire difficulty, for a ' +
      'thousand years — has been getting people to wait through eleven other voices to hear ' +
      'their own come back.',
  },
  {
    id: 'mem-ninety-years',
    title: 'Ninety Years of Asking',
    stageId: 'verdant-machine',
    era: 'the-keeping',
    attribution: 'Engine commissioning record',
    prose:
      'The engine was ready in a season. The forest took ninety years. We could have cleared the ' +
      'ground in a week and we would have had a machine in a stump-field instead of a machine ' +
      'the canopy hums along with. Every Keeper who worked on it died before it ran. All of them ' +
      'signed off on the timeline anyway.',
  },
  {
    id: 'mem-roots-were-coolant',
    title: 'The Roots Were the Coolant',
    stageId: 'verdant-machine',
    era: 'the-drift',
    attribution: 'Maintenance annotation, undated',
    prose:
      'Whoever reads this next: the roots are not decoration and they are not in the way. They ' +
      'are the cooling system. If you ever find them cut, the machine is already dying and has ' +
      'been for longer than you have been standing there.',
  },
  {
    id: 'mem-three-thousand-pillars',
    title: 'Three Thousand Pillars',
    stageId: 'desert-of-lost-notes',
    era: 'the-weaving',
    attribution: 'Fragment, hand unknown, predates the Keepers',
    prose:
      'They buried the instrument-field on purpose, in order, tuned, each pillar wrapped. That ' +
      'is not what you do to something you are abandoning. That is what you do to something you ' +
      'intend to come back for, when whatever is coming has passed.',
  },
  {
    id: 'mem-what-silence-costs',
    title: 'What Silence Costs',
    stageId: 'desert-of-lost-notes',
    era: 'the-retuning',
    attribution: "Tuner's own field note",
    prose:
      'Third day in the null field. I have stopped talking to myself because it does not come ' +
      'back and hearing nothing where your own voice should be is worse than being alone. I ' +
      'draw the beat in the sand with my heel now. It works. I hate that it works.',
  },
  {
    id: 'mem-the-drafting-error',
    title: 'The Drafting Error',
    stageId: 'orbital-dissonance',
    era: 'the-keeping',
    attribution: 'Lattice annotation, copied forward for eight centuries',
    prose:
      'Every copy of the diagram shows a line leaving the figure at the top and going nowhere. ' +
      'Every generation has assumed the first copyist made a mistake and been too respectful to ' +
      'correct it. Nobody in eight hundred years thought to follow it.',
  },
  {
    id: 'mem-they-came-listening',
    title: 'They Came Listening',
    stageId: 'orbital-dissonance',
    era: 'the-retuning',
    attribution: 'Intercepted Choir signal, transcribed by amplitude',
    prose:
      'The signal is not a threat and not a demand. Read as pressure rather than sound it is a ' +
      'question, repeated, for a very long time, getting louder: is there anything here. Is ' +
      'there anything here. Is there anything here.',
  },
  {
    id: 'mem-the-loom-itself',
    title: 'What the Loom Actually Is',
    stageId: 'celestial-loom',
    era: 'the-weaving',
    attribution: 'Fragment, hand unknown',
    prose:
      'A frame and eight strings, and the entire art of it is that the strings are not tuned to ' +
      'each other. They are tuned to the things they hold: rock, tide, orbit, root, breath, ' +
      'memory, light, and one string nobody has ever been able to name. Pull any of them and the ' +
      'world leans.',
  },
  {
    id: 'mem-the-finest-ear',
    title: 'The Finest Ear We Ever Had',
    stageId: 'celestial-loom',
    era: 'the-drift',
    attribution: 'Keeper Ovel, unsent',
    prose:
      'Serren could hear a node drift from the next valley. We built our whole method on her ' +
      'corrections and we never once asked how she was. She told us, at the end, in one sentence ' +
      'at the Loom, and I thought she was tired. Sixty years. She kept tuning a chord she could ' +
      'not hear for sixty years, so that nobody would have to notice.',
  },
];

// ---------------------------------------------------------------------------
// Lost Motifs — collectible music
// ---------------------------------------------------------------------------

/**
 * A recovered phrase, expressed as harmonic degrees.
 *
 * `degrees` indexes `HARMONIC_RATIOS` (0 = Root … 7 = Octave), so Composition
 * Mode can play a motif directly through the same synthesis path the puzzles
 * and the Auralith use. These are real playable material, not flavour strings.
 */
export interface LostMotif {
  readonly id: string;
  readonly name: string;
  readonly stageId: StageId;
  /** Harmonic degrees, in order. Valid range is 0 … HARMONIC_RATIOS.length - 1. */
  readonly degrees: readonly number[];
  /** Suggested tempo when the motif is played back unedited. */
  readonly bpm: number;
  /** One line of where it came from. Shown on the Composition Mode card. */
  readonly note: string;
}

export const LOST_MOTIFS: readonly LostMotif[] = [
  {
    id: 'motif-morning-round',
    name: 'The Morning Round',
    stageId: 'fallen-sanctuary',
    degrees: [0, 2, 4, 2, 0, 4, 7],
    bpm: 104,
    note: 'What the Sanctuary bells did at first light, every day, for eight hundred years.',
  },
  {
    id: 'motif-apprentice-exercise',
    name: "An Apprentice's Exercise",
    stageId: 'fallen-sanctuary',
    degrees: [0, 1, 2, 3, 4, 3, 2, 1],
    bpm: 88,
    note: 'The first thing anyone here was taught. Deliberately boring. Deliberately correct.',
  },
  {
    id: 'motif-carrying-song',
    name: 'The Carrying Song',
    stageId: 'fractured-garden',
    degrees: [0, 4, 2, 5, 4, 2, 0],
    bpm: 72,
    note: 'Slow enough to climb nine terraces to. Oru is thought to have set the tempo himself.',
  },
  {
    id: 'motif-channel-water',
    name: 'Water Finding the Channel',
    stageId: 'fractured-garden',
    degrees: [7, 5, 4, 2, 1, 0, 1, 2],
    bpm: 96,
    note: 'Transcribed from the irrigation runs. The Garden wrote it; someone only wrote it down.',
  },
  {
    id: 'motif-ten-thousand-keys',
    name: 'Ten Thousand Keys',
    stageId: 'glass-meridian',
    degrees: [0, 3, 6, 2, 5, 1, 4, 7],
    bpm: 132,
    note: 'A Meridian street tune. No two blocks play it in the same key and that is the point.',
  },
  {
    id: 'motif-honest-glass',
    name: 'Honest Glass',
    stageId: 'glass-meridian',
    degrees: [2, 4, 7, 4, 2, 0],
    bpm: 118,
    note: 'The tone a finished spire is supposed to give back when you knock on it once.',
  },
  {
    id: 'motif-market-at-tide',
    name: 'The Market at Low Tide',
    stageId: 'tidal-archive',
    degrees: [0, 2, 3, 5, 3, 2, 0, 5],
    bpm: 108,
    note: 'Recording 812. A market that has been underwater for two hundred years.',
  },
  {
    id: 'motif-counting-child',
    name: 'A Child Counting',
    stageId: 'tidal-archive',
    degrees: [0, 1, 2, 3, 4, 5, 6, 7],
    bpm: 76,
    note: 'Kept as a reference tone. The Archive has played it back every day since it was made.',
  },
  {
    id: 'motif-sky-log',
    name: 'The Sky Log',
    stageId: 'ember-observatory',
    degrees: [0, 7, 0, 7, 4, 7, 0],
    bpm: 60,
    note: 'One phrase per night, four hundred years, unchanged. It is a shape of stubbornness.',
  },
  {
    id: 'motif-grinding-room',
    name: 'The Grinding Room',
    stageId: 'ember-observatory',
    degrees: [1, 3, 5, 3, 1, 3, 5, 6],
    bpm: 124,
    note: 'Four generations sang it to keep the wheel steady. Every verse is one hair of glass.',
  },
  {
    id: 'motif-twelve-mouths',
    name: 'Twelve Mouths',
    stageId: 'hollow-choir',
    degrees: [0, 4, 2, 7, 5, 4, 2, 0],
    bpm: 92,
    note: 'The round the canyon was cut for. Sing it into the first mouth and walk.',
  },
  {
    id: 'motif-answer-me',
    name: 'Answer Me',
    stageId: 'hollow-choir',
    degrees: [5, 4, 5, 4, 2, 0],
    bpm: 84,
    note: 'Two bars, sung alone, waiting. The oldest phrase anyone has found in the canyon.',
  },
  {
    id: 'motif-ninety-year-hum',
    name: 'The Ninety-Year Hum',
    stageId: 'verdant-machine',
    degrees: [0, 0, 1, 0, 4, 0],
    bpm: 68,
    note: 'What the engine settles into when the canopy agrees with it. Almost too low to notice.',
  },
  {
    id: 'motif-canopy-answer',
    name: 'What the Canopy Answers',
    stageId: 'verdant-machine',
    degrees: [4, 5, 7, 5, 4, 2, 1],
    bpm: 100,
    note: 'Not composed. Measured, over eleven summers, and found to be the same every time.',
  },
  {
    id: 'motif-buried-field',
    name: 'The Buried Field',
    stageId: 'desert-of-lost-notes',
    degrees: [0, 3, 7, 3, 0],
    bpm: 56,
    note: 'Five pillars, struck in order from the ridge. The rest of the field answers on its own.',
  },
  {
    id: 'motif-heel-in-sand',
    name: 'Heel in the Sand',
    stageId: 'desert-of-lost-notes',
    degrees: [0, 0, 4, 0, 0, 4, 0, 7],
    bpm: 112,
    note: 'A beat kept by foot inside the null field, where nothing else could be kept at all.',
  },
  {
    id: 'motif-cut-line',
    name: 'The Cut Line',
    stageId: 'orbital-dissonance',
    degrees: [7, 6, 5, 4, 3, 2, 1, 0],
    bpm: 140,
    note: 'What a severed frequency line sounds like coming back together, transcribed on the way up.',
  },
  {
    id: 'motif-sixteen-arrays',
    name: 'Sixteen Arrays',
    stageId: 'orbital-dissonance',
    degrees: [0, 0, 0, 2, 0, 0, 4, 0],
    bpm: 128,
    note: 'The relay only knows one note. This is that note, arranged into something worth keeping.',
  },
  {
    id: 'motif-eighth-string',
    name: 'The Eighth String',
    stageId: 'celestial-loom',
    degrees: [0, 2, 4, 7, 4, 2, 0, 0],
    bpm: 80,
    note: 'The string on the Loom nobody has been able to name. It answers to this and nothing else.',
  },
  {
    id: 'motif-hand-on-the-frame',
    name: 'A Hand on the Frame',
    stageId: 'celestial-loom',
    degrees: [0, 4, 7, 4, 0, 4, 7],
    bpm: 66,
    note: 'Low, wide, and felt more than heard. Written for someone who cannot hear it.',
  },
];

// ---------------------------------------------------------------------------
// Codex — the world, as the player learns it
// ---------------------------------------------------------------------------

export type CodexCategory = 'world' | 'craft' | 'keepers' | 'detuners' | 'collection';

export interface CodexEntry {
  readonly id: string;
  readonly title: string;
  readonly category: CodexCategory;
  /** Two or three sentences. The codex is a reference, not a novel. */
  readonly body: string;
  /** Player-facing description of how the entry is earned. */
  readonly unlock: string;
  readonly related: readonly string[];
}

export const CODEX_ENTRIES: Readonly<Record<string, CodexEntry>> = {
  'world-chord': {
    id: 'world-chord',
    title: 'The World Chord',
    category: 'world',
    body:
      '432 Hz, and every just ratio above it. Not a law imposed on the world but an agreement the ' +
      'world arrived at — rock, tide, orbit and blood all settling on the same beat over a very ' +
      'long time. Everything alive grew into it, which is why moving it hurts everything at once.',
    unlock: 'Held from the first minute of play.',
    related: ['the-detune', 'celestial-loom-entry', 'harmonic-degrees'],
  },
  'the-detune': {
    id: 'the-detune',
    title: 'The Detune',
    category: 'world',
    body:
      'The forced shift to 440 Hz. It is close enough to the true chord to sound like music and ' +
      'far enough to make every structure, root and heartbeat work slightly against itself. ' +
      'Nothing collapses immediately. That is the design.',
    unlock: 'Held from the first minute of play.',
    related: ['world-chord', 'silent-choir-entry', 'infection'],
  },
  infection: {
    id: 'infection',
    title: 'Infection',
    category: 'world',
    body:
      'How far a region has been dragged from true, from 0 to 1. It is one number, and every ' +
      'system reads it: sky, fog, materials, enemy density, the score. When a Commander falls, ' +
      'the number drops and the whole region changes at once rather than in pieces.',
    unlock: 'Restore any region.',
    related: ['the-detune', 'restoration'],
  },
  restoration: {
    id: 'restoration',
    title: 'Restoration',
    category: 'craft',
    body:
      'A region is not cleared, it is retuned: the closing sequence of every Commander fight is ' +
      "the player playing the region's own chord back into it. Violet drains to green, then to " +
      "the region's true colour. Nothing that was infected is destroyed by it.",
    unlock: 'Complete the Fallen Sanctuary.',
    related: ['cleansing', 'infection', 'frequency-cores'],
  },
  cleansing: {
    id: 'cleansing',
    title: 'Cleansing, Not Killing',
    category: 'craft',
    body:
      'Detuners are machines of the Choir and are broken. Infected wildlife and guardians are ' +
      'neither: they are cleansed, dissolving violet into green, and afterwards they turn up ' +
      "alive on the Sanctuary's recovered terrace. The distinction is enforced in the data.",
    unlock: 'Cleanse an infected creature.',
    related: ['restoration', 'recovered-wildlife'],
  },
  auralith: {
    id: 'auralith',
    title: 'The Auralith',
    category: 'craft',
    body:
      'A floating resonator ring that orbits the forearm, strung across its opening with luminous ' +
      'harmonic strings and framed by rotating geometric plates. It listens before it answers — ' +
      'it can sample a frequency it is struck by and give it back corrected. It is not a weapon ' +
      'that happens to sing; it is an instrument that happens to be dangerous.',
    unlock: 'Recover the Auralith in the Fallen Sanctuary.',
    related: ['resonance-forms', 'resonance-counter', 'harmonic-degrees'],
  },
  'resonance-forms': {
    id: 'resonance-forms',
    title: 'Resonance Forms',
    category: 'craft',
    body:
      "A Frequency Core taken from a Commander teaches the Auralith to wear that Commander's " +
      'note. The ring visibly reconfigures for each one. Every form serves combat and at least ' +
      'one of movement, platforming, puzzles or discovery — none of them is only a weapon, and ' +
      'none of them is ever required to finish a region.',
    unlock: 'Recover any Frequency Core.',
    related: ['auralith', 'frequency-cores', 'world-lattice-entry'],
  },
  'frequency-cores': {
    id: 'frequency-cores',
    title: 'Frequency Cores',
    category: 'detuners',
    body:
      'Each Commander carries one, and each Core holds a note taken from the world it was set ' +
      'over. Recovering a Core is not looting a corpse — the note goes back into the region and ' +
      'the Auralith only learns the shape of it.',
    unlock: 'Defeat any Commander.',
    related: ['resonance-forms', 'commanders'],
  },
  'resonance-counter': {
    id: 'resonance-counter',
    title: 'The Resonance Counter',
    category: 'craft',
    body:
      'Meet an incoming frequency with the same one and it inverts: the shot comes apart, or ' +
      'turns around. The window is short and the tell is always drawn as well as sounded. It is ' +
      'the single most useful thing the base Auralith does, and it never stops being useful.',
    unlock: 'Land a counter.',
    related: ['auralith', 'coherence'],
  },
  coherence: {
    id: 'coherence',
    title: 'Coherence',
    category: 'craft',
    body:
      'Not health — how well the Tuner is holding her own pitch. It falls when she is struck by ' +
      'the false frequency and returns when she plays true: counters, restored resonators, ' +
      'cleansed creatures. At low Coherence the world audibly and visibly drifts sharp.',
    unlock: 'Held from the first minute of play.',
    related: ['resonance-counter', 'the-detune'],
  },
  'harmonic-degrees': {
    id: 'harmonic-degrees',
    title: 'The Eight Degrees',
    category: 'craft',
    body:
      'Root, Second, Third, Fourth, Fifth, Sixth, Seventh, Octave — the just ratios above the ' +
      'World Chord. Puzzle resonators, form tones and every recovered motif are written in them, ' +
      'and the accessibility layer names and draws each degree so no puzzle is ever ear-only.',
    unlock: 'Solve a resonator puzzle.',
    related: ['world-chord', 'lost-motifs-entry'],
  },
  keepers: {
    id: 'keepers',
    title: 'The Keepers',
    category: 'keepers',
    body:
      'Not priests and not soldiers. A trade: walk to a node, listen, correct it, write down the ' +
      'number, walk to the next one. Eight hundred years of extremely patient people, and by the ' +
      'morning of the retuning there were two of them left.',
    unlock: 'Held from the first minute of play.',
    related: ['harmonic-sanctuary-entry', 'world-lattice-entry', 'first-conductor-entry'],
  },
  'harmonic-sanctuary-entry': {
    id: 'harmonic-sanctuary-entry',
    title: 'The Harmonic Sanctuary',
    category: 'keepers',
    body:
      'A room built so true that a wrong note cannot hide in it — which is what makes it a good ' +
      'workshop, a good archive and, once it is relit, a good home. It keeps whatever it hears, ' +
      'including the people who spoke in it.',
    unlock: 'Restore the Fallen Sanctuary.',
    related: ['keepers', 'sanctuary-seeds'],
  },
  'world-lattice-entry': {
    id: 'world-lattice-entry',
    title: 'The World Lattice',
    category: 'keepers',
    body:
      "The Keepers' map, which shows tuning rather than terrain: every region as a node on one " +
      'strung instrument, joined by the frequency lines they walked between them. A violet line ' +
      'means a node has been taken. A gold one means somebody has been back.',
    unlock: 'Restore the Fallen Sanctuary.',
    related: ['keepers', 'commanders'],
  },
  'sanctuary-seeds': {
    id: 'sanctuary-seeds',
    title: 'Sanctuary Seeds',
    category: 'collection',
    body:
      'Cuttings, spores, filaments and machine-slips carried out of restored regions. Planted in ' +
      'the Sanctuary they bring back one piece of it at a time — a terrace, a water course, a ' +
      'roof. The hub is rebuilt out of the world, not bought.',
    unlock: 'Find a Sanctuary Seed.',
    related: ['harmonic-sanctuary-entry', 'recovered-wildlife'],
  },
  'keeper-memories-entry': {
    id: 'keeper-memories-entry',
    title: 'Keeper Memories',
    category: 'collection',
    body:
      "Fragments of the Keepers' own record, scattered through the regions they worked in: " +
      'teaching notes, tallies, arguments, one unsent letter. The game never stops to explain ' +
      'its history. This is where the history is.',
    unlock: 'Find a Keeper Memory.',
    related: ['keepers', 'first-conductor-entry'],
  },
  'lost-motifs-entry': {
    id: 'lost-motifs-entry',
    title: 'Lost Motifs',
    category: 'collection',
    body:
      'Phrases the world used to play and has stopped: a street tune, a work song, four hundred ' +
      'years of one nightly figure. Recovered motifs become real material in Composition Mode, ' +
      'playable and editable, in the same harmonic degrees the puzzles are written in.',
    unlock: 'Find a Lost Motif.',
    related: ['harmonic-degrees', 'harmonic-sanctuary-entry'],
  },
  'recovered-wildlife': {
    id: 'recovered-wildlife',
    title: 'Recovered Wildlife',
    category: 'collection',
    body:
      'Every creature cleansed rather than destroyed is alive somewhere. They gather on the ' +
      'Sanctuary terrace as the regions come back, and the terrace fills up at exactly the rate ' +
      'the player chooses mercy.',
    unlock: 'Cleanse an infected creature.',
    related: ['cleansing', 'sanctuary-seeds'],
  },
  detuners: {
    id: 'detuners',
    title: 'The Detuners',
    category: 'detuners',
    body:
      'Angular obsidian-and-violet crystal, a violet core, and a single luminous eye — the Choir ' +
      'builds everything to see, having no use for ears. Six families: Whisperers, Drifters, ' +
      'Fractures, Amplifiers, Conductors, and the elite beasts grown out of whatever a region ' +
      'already had.',
    unlock: 'Meet a Detuner.',
    related: ['silent-choir-entry', 'commanders'],
  },
  commanders: {
    id: 'commanders',
    title: 'The Commanders',
    category: 'detuners',
    body:
      'Eight, each set over one node of the lattice, each carrying a Frequency Core. Seven hold ' +
      'ground. The eighth stands at the Loom and does not consider herself a Commander at all.',
    unlock: 'See the World Lattice.',
    related: ['frequency-cores', 'first-conductor-entry', 'world-lattice-entry'],
  },
  'silent-choir-entry': {
    id: 'silent-choir-entry',
    title: 'The Silent Choir',
    category: 'detuners',
    body:
      'The people behind the retuning, who have never once been seen. They cannot hear the true ' +
      'chord — their own world went quiet so long ago that no record of it survives — and they ' +
      'are retuning the universe to the single frequency they can perceive. They believe they ' +
      'are correcting an error.',
    unlock: 'Reach Orbital Dissonance.',
    related: ['detuners', 'first-conductor-entry', 'the-detune'],
  },
  'first-conductor-entry': {
    id: 'first-conductor-entry',
    title: 'The First Conductor',
    category: 'detuners',
    body:
      'Serren: the finest ear the Keepers ever had, and the first of them to go deaf. She kept ' +
      'tuning for sixty years so that nobody would have to notice, and then she heard the Choir ' +
      'asking whether anything was out here, and she answered.',
    unlock: 'Reach the Celestial Loom.',
    related: ['keepers', 'silent-choir-entry', 'celestial-loom-entry'],
  },
  'celestial-loom-entry': {
    id: 'celestial-loom-entry',
    title: 'The Celestial Loom',
    category: 'world',
    body:
      'A frame and eight strings, tuned not to each other but to the things they hold: rock, ' +
      'tide, orbit, root, breath, memory, light, and one string nobody has been able to name. It ' +
      'is a workshop, not a throne room, and it is still tidy.',
    unlock: 'Reach the Celestial Loom.',
    related: ['world-chord', 'first-conductor-entry'],
  },
};

// ---------------------------------------------------------------------------
// Bestiary — field observations
// ---------------------------------------------------------------------------

export type DetunerFamily =
  'whisperer' | 'drifter' | 'fracture' | 'amplifier' | 'conductor' | 'elite' | 'native';

export type BestiaryClassification =
  /** Built by the Choir. Broken, not cleansed. */
  | 'detuner'
  /** Of this world, caught in the infection. Cleansed, never killed. */
  | 'corrupted-native'
  /** Holds a node and a Frequency Core. */
  | 'commander';

export interface BestiaryEntry {
  /** Matches an `ENEMY_ARCHETYPES` key or a `BOSSES` key exactly. */
  readonly id: string;
  readonly displayName: string;
  readonly family: DetunerFamily;
  readonly classification: BestiaryClassification;
  readonly firstSeen: StageId;
  /** 1 (nuisance) to 5 (region-defining). Presentation only. */
  readonly threat: number;
  /** A Keeper's field note. Observed, not explained. */
  readonly observation: string;
  /** The visual tell. Always drawn, never audio-only. */
  readonly tell: string;
  /** What actually works, phrased as advice rather than a solution. */
  readonly counterplay: string;
  /** Forms that make the encounter more interesting. Never required. */
  readonly notableForms: readonly ResonanceFormId[];
}

export const BESTIARY_ENTRIES: Readonly<Record<string, BestiaryEntry>> = {
  // --- Whisperers ----------------------------------------------------------
  whisperer: {
    id: 'whisperer',
    displayName: 'Whisperer',
    family: 'whisperer',
    classification: 'detuner',
    firstSeen: 'fallen-sanctuary',
    threat: 1,
    observation:
      'Fist-sized, four folded legs, one eye. It moves in short arcs and stops dead to listen, ' +
      'which is the only reason anyone has ever seen one before it moved again.',
    tell: 'The legs gather under the body and the eye narrows to a slit half a second before it lunges.',
    counterplay: 'Three pulses. Or wait for the gather and step once to the side.',
    notableForms: ['base'],
  },
  'whisperer-swarm': {
    id: 'whisperer-swarm',
    displayName: 'Swarm Whisperer',
    family: 'whisperer',
    classification: 'detuner',
    firstSeen: 'fractured-garden',
    threat: 2,
    observation:
      'Smaller and never alone. They do not coordinate so much as arrive at the same conclusion ' +
      'at the same time, which from the receiving end is indistinguishable.',
    tell: 'The whole group stops at once. Whatever they do next, they do together.',
    counterplay:
      'Do not fight them one at a time. Anything with area beats anything with aim here.',
    notableForms: ['choir', 'ember'],
  },

  // --- Drifters ------------------------------------------------------------
  'spore-drifter': {
    id: 'spore-drifter',
    displayName: 'Spore Drifter',
    family: 'drifter',
    classification: 'detuner',
    firstSeen: 'fallen-sanctuary',
    threat: 2,
    observation:
      'A dart with a violet sac slung underneath. It does not aim at you; it aims at where you ' +
      'will have to walk, and then leaves.',
    tell: 'The sac swells and the flight path flattens out into a straight run before the drop.',
    counterplay: 'Kill it early or move somewhere it has not already been.',
    notableForms: ['prism'],
  },
  'glass-drifter': {
    id: 'glass-drifter',
    displayName: 'Glass Drifter',
    family: 'drifter',
    classification: 'detuner',
    firstSeen: 'glass-meridian',
    threat: 3,
    observation:
      'Nearly invisible against the spires until it turns edge-on and catches the light. Fast, ' +
      'brittle, and entirely willing to fly through something it cannot survive.',
    tell: 'It rolls flat to face you, and the whole body flashes once as it commits to the pass.',
    counterplay: 'Meet the pass, do not chase it. Countering a Glass Drifter mid-run is free.',
    notableForms: ['prism', 'echo'],
  },
  'sanctum-moth': {
    id: 'sanctum-moth',
    displayName: 'Sanctum Moth',
    family: 'native',
    classification: 'corrupted-native',
    firstSeen: 'fallen-sanctuary',
    threat: 1,
    observation:
      'They lived in the Sanctuary dome and ate the dust off the gold. Infected, they still ' +
      'circle the same beams. They are not attacking anyone; they are patrolling a room that is ' +
      'no longer there.',
    tell: 'The wing edges are violet at the tips and pale gold at the root. That gold is the whole moth, still.',
    counterplay: 'Cleanse it. Nothing about a moth needed breaking.',
    notableForms: ['bloom'],
  },

  // --- Fractures -----------------------------------------------------------
  'root-fracture': {
    id: 'root-fracture',
    displayName: 'Root Fracture',
    family: 'fracture',
    classification: 'detuner',
    firstSeen: 'fractured-garden',
    threat: 3,
    observation:
      'A brute grown around a length of Garden root, using it as a spine. It hits like the ' +
      'terrace it came from and turns approximately as fast.',
    tell: 'Plating opens along the chest before every swing, and the core underneath goes bright.',
    counterplay: 'The armour yields to a charged shot or a clean counter, not to volume.',
    notableForms: ['ember', 'silence'],
  },
  'stone-fracture': {
    id: 'stone-fracture',
    displayName: 'Stone Fracture',
    family: 'fracture',
    classification: 'detuner',
    firstSeen: 'fallen-sanctuary',
    threat: 3,
    observation:
      'Sanctuary masonry, reassembled wrong, walking. Several of the blocks still have Keeper ' +
      'ring-and-square carving on them, upside down.',
    tell: 'It plants a foot and the shoulder plate lifts. Everything it does starts from that plant.',
    counterplay: 'Charge tier two breaks the plate. After that it is an ordinary slow thing.',
    notableForms: ['ember', 'echo'],
  },

  // --- Amplifiers ----------------------------------------------------------
  'amplifier-pylon': {
    id: 'amplifier-pylon',
    displayName: 'Amplifier Pylon',
    family: 'amplifier',
    classification: 'detuner',
    firstSeen: 'fallen-sanctuary',
    threat: 2,
    observation:
      'A squat pylon with a rotating emitter, bolted wherever the signal is weakest. It does not ' +
      'chase, does not flee, and will still be broadcasting when everything around it is gone.',
    tell: 'The emitter ring stops rotating and locks. It only ever fires from a stop.',
    counterplay: 'Break the lock or break the line of sight. Both are equally correct.',
    notableForms: ['prism', 'silence'],
  },
  'twin-amplifier': {
    id: 'twin-amplifier',
    displayName: 'Twin Amplifier',
    family: 'amplifier',
    classification: 'detuner',
    firstSeen: 'fractured-garden',
    threat: 3,
    observation:
      'Two emitters on one base, deliberately out of phase, so that the gap in one is covered by ' +
      'the other. Somebody thought about this.',
    tell: 'The emitters swap which one is glowing. The swap is the window.',
    counterplay: 'Play the gap, not the pylon. Or take the base out from underneath both.',
    notableForms: ['echo', 'tidal'],
  },
  'mirror-pylon': {
    id: 'mirror-pylon',
    displayName: 'Mirror Pylon',
    family: 'amplifier',
    classification: 'detuner',
    firstSeen: 'glass-meridian',
    threat: 4,
    observation:
      'It does not generate anything. It returns what it is given, on the beat, from the angle ' +
      'you chose — which means every shot you take near one is a decision about where you would ' +
      'like to be shot from.',
    tell: 'The face tilts to your firing line a beat before the return.',
    counterplay: 'Counter your own reflection, or move so the angle it picks is somewhere useful.',
    notableForms: ['prism', 'echo'],
  },

  // --- Pursuers ------------------------------------------------------------
  'thorn-pursuer': {
    id: 'thorn-pursuer',
    displayName: 'Thorn Pursuer',
    family: 'whisperer',
    classification: 'detuner',
    firstSeen: 'fractured-garden',
    threat: 3,
    observation:
      'Long-limbed and single-minded. It commits to a line and cannot correct once it is ' +
      'running, which is the only mercy in its whole design.',
    tell: 'It rears, points, and holds for a beat. Wherever it is pointing is where it is going.',
    counterplay: 'Let it commit, then be elsewhere. It will take a moment to be embarrassed.',
    notableForms: ['tidal', 'silence'],
  },
  'bramble-hound': {
    id: 'bramble-hound',
    displayName: 'Bramble Hound',
    family: 'native',
    classification: 'corrupted-native',
    firstSeen: 'verdant-machine',
    threat: 3,
    observation:
      'The forest keeps hounds. They are not friendly and never were, but they used to run the ' +
      'boundary and stop. This one has forgotten where the boundary was.',
    tell: 'It circles left before every lunge. All of them circle left; nobody knows why.',
    counterplay: 'Cleanse it and it will go back to running the boundary. It will not thank you.',
    notableForms: ['bloom'],
  },

  // --- Spawners ------------------------------------------------------------
  'bloom-spawner': {
    id: 'bloom-spawner',
    displayName: 'Bloom Spawner',
    family: 'amplifier',
    classification: 'detuner',
    firstSeen: 'fractured-garden',
    threat: 4,
    observation:
      'A seated pod that opens on a cycle and puts out Whisperers, indefinitely, with no ' +
      'apparent limit and no interest in defending itself.',
    tell: 'The petals unlock one plate at a time. Count them: the last plate is the release.',
    counterplay: 'It is a maths problem, not a fight. Close the pod before the arithmetic turns.',
    notableForms: ['ember', 'choir'],
  },
  'chorus-seed': {
    id: 'chorus-seed',
    displayName: 'Chorus Seed',
    family: 'drifter',
    classification: 'detuner',
    firstSeen: 'hollow-choir',
    threat: 4,
    observation:
      'Drifts down into a carved mouth and takes root, and from then on that mouth sings the ' +
      "Choir's syllable instead of its own. Left alone for an afternoon a canyon changes voice.",
    tell: 'It is silent while drifting and starts to glow the instant it finds a mouth to enter.',
    counterplay:
      'Take them in the air. On the ground they stop being an enemy and start being terrain.',
    notableForms: ['silence', 'prism'],
  },

  // --- Hazards -------------------------------------------------------------
  'drifting-mine': {
    id: 'drifting-mine',
    displayName: 'Drifting Mine',
    family: 'drifter',
    classification: 'detuner',
    firstSeen: 'glass-meridian',
    threat: 2,
    observation:
      'No eye, no core, no behaviour to speak of. It goes where the air goes and detonates when ' +
      'something arrives. It is the only Detuner that has never noticed anybody.',
    tell: 'The shell rings audibly and pulses visibly at a fixed interval — the pulse is the fuse.',
    counterplay: 'Shoot it from range, or push it somewhere it will do you a favour.',
    notableForms: ['prism', 'tidal'],
  },
  'dissonance-bloom': {
    id: 'dissonance-bloom',
    displayName: 'Dissonance Bloom',
    family: 'native',
    classification: 'corrupted-native',
    firstSeen: 'fractured-garden',
    threat: 2,
    observation:
      'A flower. It was a flower before any of this and it will be one afterwards. Infected, it ' +
      'exhales a detuned field over about a metre and cannot move away from anything.',
    tell: 'The petals close before the exhale and open into the field.',
    counterplay: 'Cleanse it in passing. Breaking it is possible and pointless.',
    notableForms: ['bloom', 'tidal'],
  },

  // --- Mimics --------------------------------------------------------------
  'frequency-mimic': {
    id: 'frequency-mimic',
    displayName: 'Frequency Mimic',
    family: 'conductor',
    classification: 'detuner',
    firstSeen: 'tidal-archive',
    threat: 4,
    observation:
      'It samples whatever form the Auralith is wearing and wears it back, badly — half a beat ' +
      'late and a fraction sharp. Fighting one is an unflattering lesson in your own habits.',
    tell: 'A copied form always reads a shade violet where the real one reads clean.',
    counterplay: 'Change form and it has to re-sample. That gap is the entire fight.',
    notableForms: ['echo', 'silence'],
  },
  'false-shard': {
    id: 'false-shard',
    displayName: 'False Shard',
    family: 'whisperer',
    classification: 'detuner',
    firstSeen: 'desert-of-lost-notes',
    threat: 2,
    observation:
      'Shaped like a resonance shard, sited like a reward, patient as furniture. Somebody in the ' +
      'Choir understands what a collectible looks like, which is an unsettling thing to know.',
    tell: 'A real shard turns slowly and rings. A False Shard is perfectly still and perfectly quiet.',
    counterplay: 'Resonance Sight names it from across the room. So does a moment of suspicion.',
    notableForms: ['base'],
  },

  // --- Conductors and elites ----------------------------------------------
  'conductor-elite': {
    id: 'conductor-elite',
    displayName: 'Conductor',
    family: 'conductor',
    classification: 'detuner',
    firstSeen: 'glass-meridian',
    threat: 5,
    observation:
      'Robed, tall, crystal-topped stave. The only Detuners that give orders. Everything else in ' +
      'the room gets faster and more organised the moment one arrives, and slower the moment it ' +
      'stops.',
    tell: 'It raises the stave to conduct, and every unit it commands flashes once in time with it.',
    counterplay:
      'Take the Conductor and you take the room. Take the room first and you take a long time.',
    notableForms: ['silence', 'choir'],
  },
  'infected-garden-guardian': {
    id: 'infected-garden-guardian',
    displayName: 'Infected Garden Guardian',
    family: 'native',
    classification: 'corrupted-native',
    firstSeen: 'fractured-garden',
    threat: 5,
    observation:
      "One of the Garden's own protectors, grown huge on infected sap. It still positions itself " +
      'between you and the seedbeds. It is still, in every way that matters, doing its job.',
    tell: 'It shields the terrace behind it before every attack — watch what it is standing in front of.',
    counterplay: 'Cleanse it. It has not made a single hostile decision this entire time.',
    notableForms: ['bloom', 'tidal'],
  },

  // --- Mini-bosses ---------------------------------------------------------
  'sanctuary-guardian': {
    id: 'sanctuary-guardian',
    displayName: 'Vault Warden',
    family: 'native',
    classification: 'corrupted-native',
    firstSeen: 'fallen-sanctuary',
    threat: 4,
    observation:
      'It has held this hill in tune since before there were walls on it. Its core has gone ' +
      'violet, so it is no longer guarding anything — it is broadcasting, from the best-built ' +
      'room in the world.',
    tell: 'The halo of plates around it locks into a shape, and the shape is the attack, drawn on the floor.',
    counterplay: 'Do not break it. Bring it down to pitch: play the sequence into the open core.',
    notableForms: ['base'],
  },
  'virus-bloom': {
    id: 'virus-bloom',
    displayName: 'Virus Bloom',
    family: 'elite',
    classification: 'detuner',
    firstSeen: 'fractured-garden',
    threat: 4,
    observation:
      'Not a guard. A gardener. It sits in the seedbed putting out infected growth on a slow ' +
      'cycle and only defends itself when the planting is interrupted.',
    tell: 'The corolla flares wide before the volley and folds shut before the slam.',
    counterplay: 'Interrupt the planting. Everything it does after that is reactive and readable.',
    notableForms: ['ember', 'silence'],
  },

  // --- Commanders ----------------------------------------------------------
  'oru-fractured-colossus': {
    id: 'oru-fractured-colossus',
    displayName: 'Oru',
    family: 'elite',
    classification: 'commander',
    firstSeen: 'fractured-garden',
    threat: 5,
    observation:
      'He carried seedlings up nine terraces for four hundred years. An Amplifier is grown into ' +
      'the seam of his chest now and it moves before he does. He flinches from his own blows and ' +
      'never once finishes a downed opponent.',
    tell: 'The Amplifier lights before he swings. His eyes stay cyan under the violet the whole fight.',
    counterplay:
      "Hit the Amplifier, not him. When it ruptures, play the Garden's chord into the wound.",
    notableForms: ['base', 'ember'],
  },
  'the-prism-conductor': {
    id: 'the-prism-conductor',
    displayName: 'Sella',
    family: 'conductor',
    classification: 'commander',
    firstSeen: 'glass-meridian',
    threat: 5,
    observation:
      'Stacked panes of smoked glass with a violet seam through every one, and a staff that ' +
      'takes a single beam and gives back a lattice. She fights in geometry. Only one pane is ' +
      'really her, and it is never the one that just spoke.',
    tell: 'The true pane is the one that does not refract — it stays a flat colour when the others split.',
    counterplay: 'Stop out-shooting the lattice and play something it cannot fold flat.',
    notableForms: ['ember', 'echo'],
  },
  'the-mnemonic-ray': {
    id: 'the-mnemonic-ray',
    displayName: 'Vess',
    family: 'elite',
    classification: 'commander',
    firstSeen: 'tidal-archive',
    threat: 5,
    observation:
      'Vast and flat, gliding between the shelves, wings printed edge to edge with everything ' +
      'she has swallowed. The infection replays it out of order, so the fight is haunted by the ' +
      "player's own last few seconds.",
    tell: 'Anything she is about to reuse prints on the wing first, at half brightness.',
    counterplay: 'Do not fight the echo, answer it. Playing the stolen phrase correctly opens her.',
    notableForms: ['ember', 'choir'],
  },
  'the-red-amplifier': {
    id: 'the-red-amplifier',
    displayName: 'Kaleth',
    family: 'amplifier',
    classification: 'commander',
    firstSeen: 'ember-observatory',
    threat: 5,
    observation:
      "A siege-scale Amplifier that has taken the Observatory's great lens for a head. It never " +
      'moves. The room moves: mirrors fold out of the walls to carry its beam somewhere new.',
    tell: 'Everything glows before it burns, and the glow shows the whole path the beam will take.',
    counterplay: 'Fight the room. Retune the orrery drive and the beam has nowhere useful to go.',
    notableForms: ['tidal', 'prism'],
  },
  'the-many-mouthed-conductor': {
    id: 'the-many-mouthed-conductor',
    displayName: 'Ombra',
    family: 'conductor',
    classification: 'commander',
    firstSeen: 'hollow-choir',
    threat: 5,
    observation:
      'The largest Conductor the Choir has grown: a hooded column of black plate whose robe ' +
      'opens along its whole length into a row of singing mouths, each one a beat behind the ' +
      'last. Every attack is a musical form gone wrong.',
    tell: 'Mouths light in the order they will fire. The pattern is always drawn before it is sung.',
    counterplay: 'Read it as a round, because it is one. Answer on the beat it leaves open.',
    notableForms: ['silence', 'echo'],
  },
  'the-root-parasite': {
    id: 'the-root-parasite',
    displayName: 'Thess',
    family: 'elite',
    classification: 'commander',
    firstSeen: 'verdant-machine',
    threat: 5,
    observation:
      "Less a body than a braid, threaded through the Verdant Machine's root-cabling, wearing " +
      'the machine as armour and pumping violet sap through pipes cut for water.',
    tell: 'Pressure builds visibly in the pipes. When they go bright, the heart is about to surface.',
    counterplay:
      'Over-pressurise it rather than the machine. Four seconds of exposed heart is plenty.',
    notableForms: ['ember', 'silence'],
  },
  'the-sound-eater': {
    id: 'the-sound-eater',
    displayName: 'Nul',
    family: 'elite',
    classification: 'commander',
    firstSeen: 'desert-of-lost-notes',
    threat: 5,
    observation:
      'A mouth in the dune line and very little else: a sunken ring of black teeth around a ' +
      'violet throat, surfacing where the sand is thinnest. Inside its null field the Auralith ' +
      'goes quiet and every cue in the game becomes a drawn shape.',
    tell: 'Sand runs inward before it surfaces. In the null field, the ground carries every warning.',
    counterplay:
      'Wait out the quiet instead of filling it. It cannot swallow a note it has not been given.',
    notableForms: ['choir', 'echo'],
  },
};

// ---------------------------------------------------------------------------
// Convenience lookups
// ---------------------------------------------------------------------------

/** Memories found in a given region, in archive order. */
export function getKeeperMemoriesForStage(stageId: StageId): readonly KeeperMemory[] {
  return KEEPER_MEMORIES.filter((memory) => memory.stageId === stageId);
}

/** Motifs recoverable in a given region. */
export function getLostMotifsForStage(stageId: StageId): readonly LostMotif[] {
  return LOST_MOTIFS.filter((motif) => motif.stageId === stageId);
}

/** Narrative for a region. Every `StageId` has one, so this never returns null. */
export function getStageNarrative(stageId: StageId): StageNarrative {
  return STAGE_NARRATIVES[stageId];
}

/** Every stage, in canonical order, with its narrative attached. */
export function getNarrativeRunOrder(): readonly StageNarrative[] {
  return STAGE_IDS.map((id) => STAGE_NARRATIVES[id]);
}
