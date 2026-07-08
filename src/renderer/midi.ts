import type { Channel } from "./audio";

export type MidiStatus = {
  supported: boolean;
  connectedInputs: string[];
  korgDetected: boolean;
};

export type MidiHandlers = {
  onTrigger: (channelId: number, velocity: number) => void;
  onLevel: (channelId: number, level: number) => void;
  onTransportControl: (control: MidiControlMessage) => string[];
  onLevelControlDetected: (control: MidiControlMessage) => boolean;
  onMute: (channelId: number, muted: boolean) => void;
  onLearn: (message: MidiLearnMessage) => void;
  onActivity: (event: MidiActivity) => void;
  onClockTempo: (tempo: number) => void;
  getChannels: () => Channel[];
};

export type MidiLearnMessage =
  | { type: "note"; note: number; velocity: number }
  | { type: "cc"; controller: number; value: number };

export type MidiControlMessage = {
  key: string;
  label: string;
  value: number;
};

export type MidiActivity = {
  id: string;
  time: string;
  inputName: string;
  channel: number;
  kind: string;
  data1: number;
  data2: number;
  label: string;
  action: string;
  raw: string;
};

export class MidiManager {
  private access: MIDIAccess | null = null;
  private handlers: MidiHandlers;
  private learning = false;
  private notifyStatus: (status: MidiStatus) => void;
  private nrpnByChannel = new Map<number, { msb: number | null; lsb: number | null }>();
  private clockTimestamps: number[] = [];

  constructor(handlers: MidiHandlers, notifyStatus: (status: MidiStatus) => void) {
    this.handlers = handlers;
    this.notifyStatus = notifyStatus;
  }

  async connect(): Promise<void> {
    if (!navigator.requestMIDIAccess) {
      this.notifyStatus({ supported: false, connectedInputs: [], korgDetected: false });
      return;
    }

    this.access = await navigator.requestMIDIAccess();
    this.access.onstatechange = () => this.bindInputs();
    this.bindInputs();
  }

  setLearning(value: boolean): void {
    this.learning = value;
  }

  private bindInputs(): void {
    if (!this.access) {
      return;
    }

    const inputs = Array.from(this.access.inputs.values());
    for (const input of inputs) {
      input.onmidimessage = (event) => this.handleMessage(event, input.name || input.id);
    }

    const connectedInputs = inputs
      .filter((input) => input.state === "connected")
      .map((input) => input.name || input.id);
    this.notifyStatus({
      supported: true,
      connectedInputs,
      korgDetected: connectedInputs.some((name) => {
        const normalized = name.toLowerCase();
        return normalized.includes("minilogue") || normalized.includes("monologue") || normalized.includes("korg");
      })
    });
  }

  private handleMessage(event: MIDIMessageEvent, inputName = "MIDI input"): void {
    if (!event.data) {
      return;
    }

    const bytes = Array.from(event.data);
    const [status, data1 = 0, data2 = 0] = bytes;
    if (status === undefined) {
      return;
    }

    if (status >= 0xf8) {
      if (status === 0xf8) {
        this.handleClock(event.timeStamp);
      }
      this.handlers.onActivity(describeRealtimeMessage(inputName, status, bytes));
      return;
    }

    const command = status & 0xf0;
    const midiChannel = (status & 0x0f) + 1;
    const channels = this.handlers.getChannels();
    const activity = describeMidiMessage(inputName, command, midiChannel, data1, data2, bytes);

    if (command === 0x90 && data2 > 0) {
      const message: MidiLearnMessage = { type: "note", note: data1, velocity: data2 };
      if (this.learning) {
        this.handlers.onLearn(message);
        this.handlers.onActivity(activity);
        return;
      }
      const muteChannel = channels.find((item) => item.muteNote === data1);
      if (muteChannel) {
        this.handlers.onMute(muteChannel.id, true);
        activity.action = `Mute ${muteChannel.name}`;
        this.handlers.onActivity(activity);
        return;
      }
      const channel = findTriggerChannel(channels, data1);
      if (channel) {
        this.handlers.onTrigger(channel.id, data2 / 127);
        activity.action = `Trigger ${channel.name}`;
      } else {
        activity.action = "No trigger match";
      }
      this.handlers.onActivity(activity);
      return;
    }

    if (command === 0x80 || (command === 0x90 && data2 === 0)) {
      const muteChannel = channels.find((item) => item.muteNote === data1);
      if (muteChannel) {
        this.handlers.onMute(muteChannel.id, false);
        activity.action = `Unmute ${muteChannel.name}`;
      } else {
        activity.action = "No trigger match";
      }
      this.handlers.onActivity(activity);
      return;
    }

    if (command === 0xb0) {
      const message: MidiLearnMessage = { type: "cc", controller: data1, value: data2 };
      if (this.learning) {
        this.handlers.onLearn(message);
        this.handlers.onActivity(activity);
        return;
      }
      const muteChannel = channels.find((item) => item.muteCc === data1);
      if (muteChannel) {
        this.handlers.onMute(muteChannel.id, data2 > 0);
        activity.action = `${data2 > 0 ? "Mute" : "Unmute"} ${muteChannel.name}`;
        this.handlers.onActivity(activity);
        return;
      }
      const control = createCcControl(data1, data2);
      const transportActions = this.handlers.onTransportControl(control);
      const channel = channels.find((item) => item.levelControlKey === control.key || item.levelCc === data1);
      if (channel) {
        this.handlers.onLevel(channel.id, control.value);
        activity.action = [...transportActions, `Level ${channel.name}`].filter(Boolean).join("; ");
      } else if (this.handleNrpn(midiChannel, data1, data2, activity)) {
        this.handlers.onActivity(activity);
        return;
      } else if (this.handlers.onLevelControlDetected(control)) {
        activity.action = `Use ${control.label}`;
        this.handlers.onActivity(activity);
        return;
      }
      this.handlers.onActivity(activity);
      return;
    }

    this.handlers.onActivity(activity);
  }

  private handleNrpn(channel: number, controller: number, value: number, activity: MidiActivity): boolean {
    let state = this.nrpnByChannel.get(channel);
    if (!state) {
      state = { msb: null, lsb: null };
      this.nrpnByChannel.set(channel, state);
    }

    if (controller === 99) {
      state.msb = value;
      activity.kind = "NRPN";
      activity.label = `NRPN MSB ${value}`;
      activity.action = "NRPN select";
      return true;
    }

    if (controller === 98) {
      state.lsb = value;
      activity.kind = "NRPN";
      activity.label = `NRPN LSB ${value}`;
      activity.action = "NRPN select";
      return true;
    }

    if ((controller === 6 || controller === 38) && state.msb !== null && state.lsb !== null) {
      const precision = controller === 6 ? "MSB" : "LSB";
      const control = createNrpnControl(state.msb, state.lsb, value, precision);
      activity.kind = "NRPN";
      activity.label = `${control.label} value ${value}`;
      activity.action = `Use ${control.label}`;
      return this.handlers.onLevelControlDetected(control);
    }

    return false;
  }

  private handleClock(timestamp: number): void {
    this.clockTimestamps.push(timestamp);
    this.clockTimestamps = this.clockTimestamps.slice(-24);

    if (this.clockTimestamps.length < 12) {
      return;
    }

    const first = this.clockTimestamps[0];
    const last = this.clockTimestamps[this.clockTimestamps.length - 1];
    const averagePulseMs = (last - first) / (this.clockTimestamps.length - 1);
    if (averagePulseMs <= 0) {
      return;
    }

    const bpm = 60_000 / (averagePulseMs * 24);
    if (bpm >= 40 && bpm <= 260) {
      this.handlers.onClockTempo(bpm);
    }
  }
}

function describeMidiMessage(
  inputName: string,
  command: number,
  channel: number,
  data1: number,
  data2: number,
  bytes: number[]
): MidiActivity {
  let kind = "Other";
  let label = `${data1} ${data2}`;

  if (command === 0x90 && data2 > 0) {
    kind = "Note on";
    label = `${midiNoteName(data1)} velocity ${data2}`;
  } else if (command === 0x80 || (command === 0x90 && data2 === 0)) {
    kind = "Note off";
    label = midiNoteName(data1);
  } else if (command === 0xb0) {
    kind = "Control change";
    label = `CC ${data1} value ${data2}`;
  } else if (command === 0xe0) {
    kind = "Pitch bend";
    label = `${(data2 << 7) + data1 - 8192}`;
  }

  return {
    id: crypto.randomUUID(),
    time: new Date().toLocaleTimeString(),
    inputName,
    channel,
    kind,
      data1,
      data2,
      label,
      action: "Monitor",
      raw: formatRawBytes(bytes)
    };
}

function describeRealtimeMessage(inputName: string, status: number, bytes: number[]): MidiActivity {
  const names: Record<number, string> = {
    0xf8: "Timing clock",
    0xfa: "Start",
    0xfb: "Continue",
    0xfc: "Stop",
    0xfe: "Active sensing",
    0xff: "Reset"
  };

  return {
    id: crypto.randomUUID(),
    time: new Date().toLocaleTimeString(),
    inputName,
    channel: 0,
    kind: "Realtime",
    data1: status,
    data2: 0,
    label: names[status] ?? `Status ${status}`,
    action: status === 0xf8 ? "Clock tempo" : "Monitor",
    raw: formatRawBytes(bytes)
  };
}

function findTriggerChannel(channels: Channel[], note: number): Channel | undefined {
  const exact = channels.find((item) => item.note === note);
  if (exact) {
    return exact;
  }

  // Korg's E-to-E keyboard can appear one octave lower depending on octave/transpose settings.
  return channels.find((item) => item.note === note + 12);
}

function createCcControl(controller: number, value: number): MidiControlMessage {
  return {
    key: `cc:${controller}`,
    label: `CC ${controller}`,
    value: value / 127
  };
}

function createNrpnControl(msb: number, lsb: number, value: number, precision: "MSB" | "LSB"): MidiControlMessage {
  return {
    key: `nrpn:${msb}:${lsb}`,
    label: `NRPN ${msb}:${lsb} ${precision}`,
    value: value / 127
  };
}

function formatRawBytes(bytes: number[]): string {
  return bytes.map((byte) => byte.toString(16).toUpperCase().padStart(2, "0")).join(" ");
}

function midiNoteName(note: number): string {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const octave = Math.floor(note / 12) - 1;
  return `${names[note % 12]}${octave} (${note})`;
}
