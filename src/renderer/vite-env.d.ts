/// <reference types="vite/client" />

interface Window {
  vibeSampler: {
    appName: string;
    getIsWindowMaximized: () => Promise<boolean>;
    onWindowMaximizedStateChange: (callback: (isMaximized: boolean) => void) => () => void;
    getCloudSampleOnboarding: () => Promise<CloudSampleOnboarding>;
    declineCloudSamples: () => Promise<void>;
    importCloudSamples: () => Promise<UserSoundBank[]>;
    listUserBanks: () => Promise<{ root: string; banks: UserSoundBank[] }>;
    createUserBank: (name: string) => Promise<UserSoundBank>;
    loadUserBank: (bankId: string) => Promise<UserSoundBankLoaded>;
    saveUserSample: (input: SaveUserSampleInput) => Promise<UserSoundBank>;
    setUserSamplePitch: (input: { bankId: string; slot: number; pitchSemitones: number }) => Promise<UserSoundBank>;
    setUserSampleEdit: (input: SetUserSampleEditInput) => Promise<UserSoundBank>;
  };
}

type CloudSampleOnboarding = {
  shouldPrompt: boolean;
  banks: Array<{ name: string; sampleCount: number }>;
};

type LibraryPitch = { frequency: number; note: string; cents: number } | null;
type UserSoundBankSample = {
  slot: number;
  name: string;
  fileName: string;
  detectedPitch: LibraryPitch;
  pitchSemitones: number;
  trimStart?: number;
  trimEnd?: number;
  envelope?: SampleEnvelopeValues;
};
type UserSoundBank = { id: string; name: string; samples: UserSoundBankSample[] };
type UserSoundBankLoaded = Omit<UserSoundBank, "samples"> & {
  samples: Array<UserSoundBankSample & { data: Uint8Array }>;
};
type SaveUserSampleInput = {
  bankId: string;
  slot: number;
  name: string;
  wavData: Uint8Array;
  detectedPitch: LibraryPitch;
  pitchSemitones: number;
  trimStart?: number;
  trimEnd?: number;
  envelope?: SampleEnvelopeValues;
};
type SampleEnvelopeValues = {
  attack: number;
  release: number;
  attackLevel?: number;
  releaseLevel?: number;
};
type SetUserSampleEditInput = {
  bankId: string;
  slot: number;
  trimStart: number;
  trimEnd: number;
  envelope: SampleEnvelopeValues;
};

interface Navigator {
  requestMIDIAccess?: (options?: { sysex?: boolean }) => Promise<MIDIAccess>;
}

interface MIDIAccess extends EventTarget {
  inputs: Map<string, MIDIInput>;
  outputs: Map<string, MIDIOutput>;
  onstatechange: ((event: MIDIConnectionEvent) => void) | null;
}

interface MIDIConnectionEvent extends Event {
  port: MIDIPort;
}

interface MIDIPort extends EventTarget {
  id: string;
  manufacturer?: string;
  name?: string;
  type: "input" | "output";
  version?: string;
  state: "connected" | "disconnected";
  connection: "open" | "closed" | "pending";
}

interface MIDIInput extends MIDIPort {
  type: "input";
  onmidimessage: ((event: MIDIMessageEvent) => void) | null;
}

interface MIDIOutput extends MIDIPort {
  type: "output";
  send: (data: number[], timestamp?: number) => void;
}

interface MIDIMessageEvent extends Event {
  data: Uint8Array;
}
