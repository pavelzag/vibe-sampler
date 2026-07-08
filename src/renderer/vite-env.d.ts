/// <reference types="vite/client" />

interface Window {
  vibeSampler: {
    appName: string;
  };
}

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
