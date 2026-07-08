import type { Channel } from "./audio";

type Envelope = Channel["envelope"];

export type PatternPreset = {
  id: string;
  name: string;
  tempo: number;
  swing: number;
  steps: string[];
  envelopes: Envelope[];
};

const tight: Envelope = {
  attack: 0,
  peak: 0.9,
  decay: 0.04,
  sustain: 0.82,
  hold: 0.16,
  release: 0.03
};

const punchy: Envelope = {
  attack: 0,
  peak: 0.95,
  decay: 0.06,
  sustain: 0.7,
  hold: 0.22,
  release: 0.05
};

const airy: Envelope = {
  attack: 0.002,
  peak: 0.78,
  decay: 0.08,
  sustain: 0.68,
  hold: 0.34,
  release: 0.12
};

const clipped: Envelope = {
  attack: 0,
  peak: 0.86,
  decay: 0.025,
  sustain: 0.6,
  hold: 0.09,
  release: 0.025
};

const loose: Envelope = {
  attack: 0.006,
  peak: 0.82,
  decay: 0.1,
  sustain: 0.72,
  hold: 0.28,
  release: 0.1
};

const long: Envelope = {
  attack: 0.003,
  peak: 0.84,
  decay: 0.16,
  sustain: 0.72,
  hold: 0.5,
  release: 0.16
};

export const patternPresets: PatternPreset[] = [
  {
    id: "groovy-house",
    name: "Groovy House",
    tempo: 124,
    swing: 0.22,
    steps: [
      "x---x---x---x---",
      "----x-------x---",
      "--------x-------",
      "--x---x---x---x-",
      "------x-------x-",
      "----------x-----",
      "---x-------x----",
      "-------x--------"
    ],
    envelopes: [punchy, tight, clipped, airy, airy, loose, clipped, long]
  },
  {
    id: "classic-house",
    name: "Classic House",
    tempo: 122,
    swing: 0.16,
    steps: [
      "x---x---x---x---",
      "----x-------x---",
      "--------x-------",
      "--x---x---x---x-",
      "------x-------x-",
      "----------------",
      "---------------x",
      "----x-------x---"
    ],
    envelopes: [punchy, tight, clipped, airy, airy, tight, clipped, long]
  },
  {
    id: "deep-house",
    name: "Deep House",
    tempo: 118,
    swing: 0.2,
    steps: [
      "x---x---x---x---",
      "----x-------x---",
      "--------x-------",
      "--x---x---x---x-",
      "------x---------",
      "----------x-----",
      "---x--------x---",
      "----------------"
    ],
    envelopes: [loose, loose, clipped, airy, long, loose, clipped, long]
  },
  {
    id: "techno",
    name: "Techno",
    tempo: 132,
    swing: 0.06,
    steps: [
      "x---x---x---x---",
      "----x-------x---",
      "----------------",
      "--x---x---x---x-",
      "------x-------x-",
      "x-------x-------",
      "--------x-------",
      "----x-------x---"
    ],
    envelopes: [tight, clipped, clipped, clipped, clipped, tight, clipped, airy]
  },
  {
    id: "minimal-techno",
    name: "Minimal Techno",
    tempo: 128,
    swing: 0.04,
    steps: [
      "x---x---x---x---",
      "----x-------x---",
      "----------------",
      "--x---x---x---x-",
      "--------------x-",
      "----------------",
      "---x--------x---",
      "----------------"
    ],
    envelopes: [tight, clipped, clipped, clipped, airy, clipped, clipped, airy]
  },
  {
    id: "breakbeat",
    name: "Breakbeat",
    tempo: 132,
    swing: 0.12,
    steps: [
      "x-----x---x-----",
      "----x-------x---",
      "--------x---x---",
      "--x-x---x-x---x-",
      "------x-------x-",
      "----------x-----",
      "---x-------x----",
      "----------------"
    ],
    envelopes: [punchy, punchy, clipped, airy, airy, loose, clipped, long]
  },
  {
    id: "hip-hop",
    name: "Hip Hop",
    tempo: 92,
    swing: 0.28,
    steps: [
      "x------x--x-----",
      "----x-------x---",
      "--------x-------",
      "--x---x---x---x-",
      "------x-------x-",
      "----------------",
      "---x--------x---",
      "----------------"
    ],
    envelopes: [punchy, loose, clipped, airy, airy, loose, clipped, long]
  },
  {
    id: "boom-bap",
    name: "Boom Bap",
    tempo: 86,
    swing: 0.31,
    steps: [
      "x-------x--x----",
      "----x-------x---",
      "--------x-------",
      "--x---x---x---x-",
      "--------------x-",
      "----------------",
      "---x-------x----",
      "----------------"
    ],
    envelopes: [loose, punchy, clipped, clipped, airy, loose, clipped, airy]
  },
  {
    id: "garage-shuffle",
    name: "Garage Shuffle",
    tempo: 126,
    swing: 0.34,
    steps: [
      "x---x-----x-x---",
      "----x-------x---",
      "--------x-------",
      "--x--xx---x--xx-",
      "------x-------x-",
      "----------x-----",
      "---x--------x---",
      "----------------"
    ],
    envelopes: [punchy, tight, clipped, clipped, airy, loose, clipped, airy]
  },
  {
    id: "electro-funk",
    name: "Electro Funk",
    tempo: 116,
    swing: 0.18,
    steps: [
      "x-----x---x-x---",
      "----x-------x---",
      "--x-----x-------",
      "--x---x---x---x-",
      "------x-------x-",
      "x---------x-----",
      "---x-------x----",
      "--------x-------"
    ],
    envelopes: [punchy, tight, clipped, airy, airy, tight, clipped, long]
  }
];

export const defaultPatternId = "groovy-house";
export const patternStepCount = 32;

export function findPatternPreset(patternId: string): PatternPreset {
  return patternPresets.find((preset) => preset.id === patternId) ?? patternPresets[0];
}

export function applyPatternPreset(channels: Channel[], preset: PatternPreset): Channel[] {
  return channels.map((channel, index) => ({
    ...channel,
    steps: parseSteps(preset.steps[index] ?? ""),
    envelope: preset.envelopes[index] ?? channel.envelope
  }));
}

function parseSteps(pattern: string): boolean[] {
  const expandedPattern = pattern.length >= patternStepCount ? pattern : pattern.repeat(Math.ceil(patternStepCount / pattern.length));
  return Array.from({ length: patternStepCount }, (_, index) => expandedPattern[index]?.toLowerCase() === "x");
}
