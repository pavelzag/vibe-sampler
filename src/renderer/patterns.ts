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
  release: 0.23
};

const punchy: Envelope = {
  attack: 0,
  release: 0.33
};

const airy: Envelope = {
  attack: 0.002,
  release: 0.54
};

const clipped: Envelope = {
  attack: 0,
  release: 0.14
};

const loose: Envelope = {
  attack: 0.006,
  release: 0.48
};

const long: Envelope = {
  attack: 0.003,
  release: 0.82
};

const houseEnvelopes: Envelope[] = [punchy, tight, clipped, airy, airy, loose, clipped, long];
const technoEnvelopes: Envelope[] = [tight, clipped, clipped, clipped, airy, tight, clipped, airy];

export const patternPresets: PatternPreset[] = [
  {
    id: "groovy-house",
    name: "Groovy House",
    tempo: 124,
    swing: 0,
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
    id: "chicago-warehouse",
    name: "Chicago Warehouse",
    tempo: 123,
    swing: 0.18,
    steps: [
      "x---x---x---x---",
      "----------------",
      "----x-------x---",
      "x-x-x-x-x-x-x-x-",
      "--x---x---x---x-",
      "----------x-----",
      "---x-------x----",
      "----------------"
    ],
    envelopes: houseEnvelopes
  },
  {
    id: "jackin-house",
    name: "Jackin House",
    tempo: 126,
    swing: 0.22,
    steps: [
      "x---x---x---x-x-",
      "----x-------x---",
      "------------x---",
      "--x-xx--x-x-xx--",
      "------x-------x-",
      "x---------x-----",
      "---x--------x---",
      "----------------"
    ],
    envelopes: houseEnvelopes
  },
  {
    id: "acid-house-909",
    name: "Acid House 909",
    tempo: 125,
    swing: 0.08,
    steps: [
      "x---x---x---x---",
      "----x-------x---",
      "--------x-------",
      "x-x-x-x-x-x-x-x-",
      "--x---x---x---x-",
      "----------------",
      "---x--x----x--x-",
      "------------x---"
    ],
    envelopes: houseEnvelopes
  },
  {
    id: "french-filter-house",
    name: "French Filter House",
    tempo: 126,
    swing: 0.12,
    steps: [
      "x---x---x---x---",
      "----x-------x---",
      "----x-------x---",
      "--x---x---x---x-",
      "------x-------x-",
      "x-------x-------",
      "-----------x----",
      "--------x-------"
    ],
    envelopes: [punchy, tight, airy, airy, long, loose, clipped, long]
  },
  {
    id: "deep-organ-house",
    name: "Deep Organ House",
    tempo: 120,
    swing: 0.19,
    steps: [
      "x---x---x---x---",
      "----x-------x---",
      "----------------",
      "--x---x---x---x-",
      "------x-------x-",
      "----------x-----",
      "---x---------x--",
      "----------------"
    ],
    envelopes: [loose, loose, clipped, airy, long, loose, clipped, long]
  },
  {
    id: "disco-house",
    name: "Disco House",
    tempo: 124,
    swing: 0.14,
    steps: [
      "x---x---x---x---",
      "----x-------x---",
      "----x-------x---",
      "x-x-x-x-x-x-x-x-",
      "--x---x---x---x-",
      "----------x-----",
      "---x---x---x---x",
      "x-------x-------"
    ],
    envelopes: [punchy, tight, airy, airy, long, loose, clipped, long]
  },
  {
    id: "microhouse-dust",
    name: "Microhouse Dust",
    tempo: 122,
    swing: 0.27,
    steps: [
      "x-----x-x---x---",
      "----x-------x---",
      "----------------",
      "--x--x--x-x--x--",
      "------x---------",
      "---------x------",
      "---x-------x--x-",
      "---------------x"
    ],
    envelopes: [tight, tight, clipped, clipped, airy, clipped, clipped, airy]
  },
  {
    id: "detroit-machine",
    name: "Detroit Machine",
    tempo: 132,
    swing: 0.03,
    steps: [
      "x---x---x---x---",
      "----x-------x---",
      "----------------",
      "x-x-x-x-x-x-x-x-",
      "------x-------x-",
      "x------x--x-----",
      "---x------x--x--",
      "--------x-------"
    ],
    envelopes: technoEnvelopes
  },
  {
    id: "warehouse-techno",
    name: "Warehouse Techno",
    tempo: 136,
    swing: 0,
    steps: [
      "x---x---x---x---",
      "----x-------x---",
      "--------x-------",
      "xxxxxxxxxxxxxxxx",
      "------x-------x-",
      "x-------x-------",
      "---x-------x----",
      "----------------"
    ],
    envelopes: technoEnvelopes
  },
  {
    id: "hypnotic-techno",
    name: "Hypnotic Techno",
    tempo: 134,
    swing: 0.02,
    steps: [
      "x---x---x---x---",
      "------------x---",
      "----x-----------",
      "x-xxx-xxx-xxx-xx",
      "------x-------x-",
      "--x------x------",
      "-----x-------x--",
      "----------------"
    ],
    envelopes: technoEnvelopes
  },
  {
    id: "dub-techno",
    name: "Dub Techno",
    tempo: 124,
    swing: 0.06,
    steps: [
      "x---x---x---x---",
      "----x-------x---",
      "----------------",
      "--x---x---x---x-",
      "------x-------x-",
      "----------x-----",
      "---x---------x--",
      "--------x-------"
    ],
    envelopes: [loose, clipped, clipped, airy, long, loose, clipped, long]
  },
  {
    id: "peak-time-techno",
    name: "Peak-Time Techno",
    tempo: 138,
    swing: 0,
    steps: [
      "x---x---x---x---",
      "----x-------x---",
      "----x-------x---",
      "xxxxxxxxxxxxxxxx",
      "--x---x---x---x-",
      "x---------x-----",
      "---x---x---x---x",
      "--------x-------"
    ],
    envelopes: technoEnvelopes
  },
  {
    id: "industrial-techno",
    name: "Industrial Techno",
    tempo: 142,
    swing: 0,
    steps: [
      "x---x---x---x---",
      "----x-------x---",
      "--------x-------",
      "x-xxxxxxxxxxxxxx",
      "------x-------x-",
      "x--x----x--x----",
      "---x--x----x--x-",
      "------------x---"
    ],
    envelopes: [tight, clipped, clipped, clipped, clipped, tight, clipped, airy]
  },
  {
    id: "hardgroove-techno",
    name: "Hardgroove Techno",
    tempo: 138,
    swing: 0.12,
    steps: [
      "x---x---x---x---",
      "----x-------x---",
      "----------------",
      "x-x-xxx-x-x-xxx-",
      "------x-------x-",
      "--x---x---x---x-",
      "---x--x----x--x-",
      "--------x-------"
    ],
    envelopes: technoEnvelopes
  },
  {
    id: "acid-techno",
    name: "Acid Techno",
    tempo: 140,
    swing: 0.04,
    steps: [
      "x---x---x---x---",
      "----x-------x---",
      "------------x---",
      "x-x-x-xxx-x-x-xx",
      "------x-------x-",
      "x-------x--x----",
      "---x-------x----",
      "--------x-------"
    ],
    envelopes: technoEnvelopes
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
