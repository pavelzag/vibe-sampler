import type { Channel } from "./audio";
import { logInfo, logWarn } from "./logger";

export type MidiStatus = {
  supported: boolean;
  connectedInputs: string[];
  korgDetected: boolean;
};

export type MidiHandlers = {
  onTrigger: (channelId: number, velocity: number) => void;
  onLevel: (channelId: number, level: number) => void;
  onSendControl: (control: MidiControlMessage) => string[];
  onEnvelopeControl: (control: MidiControlMessage) => string[];
  onFxParamControl: (control: MidiControlMessage) => string[] | null;
  onTransportControl: (control: MidiControlMessage) => string[];
  onLevelControlDetected: (control: MidiControlMessage) => boolean;
  onMute: (channelId: number, muted: boolean) => void;
  onLearn: (message: MidiLearnMessage) => void;
  onActivity: (event: MidiActivity) => void;
  onClockPulse: (timestamp: number) => void;
  onClockTempo: (tempo: number) => void;
  onClockStart: () => void;
  onClockContinue: () => void;
  onClockStop: () => void;
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
  private smoothedClockTempo: number | null = null;
  private inputChannel: number | null = 1;
  private clockInputName: string | null = null;

  constructor(handlers: MidiHandlers, notifyStatus: (status: MidiStatus) => void) {
    this.handlers = handlers;
    this.notifyStatus = notifyStatus;
  }

  async connect(): Promise<void> {
    logInfo("MIDI connect requested", { supported: Boolean(navigator.requestMIDIAccess) });
    if (!navigator.requestMIDIAccess) {
      logWarn("Web MIDI API is not available");
      this.notifyStatus({ supported: false, connectedInputs: [], korgDetected: false });
      return;
    }

    this.access = await navigator.requestMIDIAccess();
    logInfo("MIDI access granted", { inputCount: this.access.inputs.size, outputCount: this.access.outputs.size });
    this.access.onstatechange = () => this.bindInputs();
    this.bindInputs();
  }

  setLearning(value: boolean): void {
    this.learning = value;
  }

  setInputChannel(channel: number | null): void {
    this.inputChannel = channel !== null && channel >= 1 && channel <= 16 ? channel : null;
  }

  disconnect(): void {
    if (!this.access) {
      return;
    }
    this.access.onstatechange = null;
    for (const input of this.access.inputs.values()) {
      input.onmidimessage = null;
    }
    this.access = null;
  }

  private bindInputs(): void {
    if (!this.access) {
      return;
    }

    const inputs = Array.from(this.access.inputs.values());
    logInfo("Binding MIDI inputs", {
      inputs: inputs.map((input) => ({
        id: input.id,
        name: input.name,
        state: input.state,
        connection: input.connection,
        manufacturer: input.manufacturer
      }))
    });

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
      let action = "Monitor";
      if (status === 0xf8) {
        if (this.clockInputName !== null && inputName !== this.clockInputName) {
          this.handlers.onActivity(describeRealtimeMessage(inputName, status, bytes, `Ignored clock from ${inputName}`));
          return;
        }
        const clockTimestamp = this.handleClock(event.timeStamp);
        this.handlers.onClockPulse(clockTimestamp);
        action = "Clock tempo";
      } else if (status === 0xfa) {
        this.clockInputName = inputName;
        this.resetClock();
        this.handlers.onClockStart();
        action = "Start sequencer";
      } else if (status === 0xfb) {
        this.clockInputName ??= inputName;
        if (inputName !== this.clockInputName) {
          this.handlers.onActivity(describeRealtimeMessage(inputName, status, bytes, `Ignored transport from ${inputName}`));
          return;
        }
        this.resetClock();
        this.handlers.onClockContinue();
        action = "Continue sequencer";
      } else if (status === 0xfc) {
        if (this.clockInputName !== null && inputName !== this.clockInputName) {
          this.handlers.onActivity(describeRealtimeMessage(inputName, status, bytes, `Ignored transport from ${inputName}`));
          return;
        }
        this.resetClock();
        this.handlers.onClockStop();
        action = "Stop sequencer";
      }
      this.handlers.onActivity(describeRealtimeMessage(inputName, status, bytes, action));
      return;
    }

    const command = status & 0xf0;
    const midiChannel = (status & 0x0f) + 1;
    const channels = this.handlers.getChannels();
    const activity = describeMidiMessage(inputName, command, midiChannel, data1, data2, bytes);

    if (status < 0xf0 && this.inputChannel !== null && midiChannel !== this.inputChannel) {
      activity.action = `Ignored (listening on Ch ${this.inputChannel})`;
      this.handlers.onActivity(activity);
      return;
    }

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
      if (data1 === 25 || data1 === 26) {
        const envelopeActions = this.handlers.onEnvelopeControl(control);
        activity.action = envelopeActions.join("; ");
        this.handlers.onActivity(activity);
        return;
      }
      if (data1 === 36) {
        const sendActions = this.handlers.onSendControl(control);
        activity.action = sendActions.join("; ");
        this.handlers.onActivity(activity);
        return;
      }
      const fxParamActions = this.handlers.onFxParamControl(control);
      if (fxParamActions) {
        activity.action = fxParamActions.join("; ");
        this.handlers.onActivity(activity);
        return;
      }
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

  private handleClock(timestamp: number): number {
    const previousTimestamp = this.clockTimestamps.at(-1);
    if (!Number.isFinite(timestamp) || timestamp <= (previousTimestamp ?? -1)) {
      timestamp = performance.now();
    }

    if (previousTimestamp !== undefined && timestamp - previousTimestamp > 1000) {
      this.resetClock();
    }

    this.clockTimestamps.push(timestamp);
    this.clockTimestamps = this.clockTimestamps.slice(-48);

    if (this.clockTimestamps.length < 12) {
      return timestamp;
    }

    const recentTimestamps = this.clockTimestamps.slice(-25);
    const sortedIntervals = recentTimestamps
      .slice(1)
      .map((value, index) => value - recentTimestamps[index])
      .filter((interval) => interval >= 60_000 / (600 * 24) && interval <= 60_000 / (10 * 24))
      .sort((left, right) => left - right);
    if (sortedIntervals.length < 8) {
      return timestamp;
    }

    const trimCount = Math.floor(sortedIntervals.length * 0.15);
    const stableIntervals = sortedIntervals.slice(trimCount, sortedIntervals.length - trimCount);
    const averagePulseMs = stableIntervals.reduce((sum, interval) => sum + interval, 0) / stableIntervals.length;
    const stableBpm = 60_000 / (averagePulseMs * 24);
    const shortTimestamps = this.clockTimestamps.slice(-7);
    const shortPulseMs = (shortTimestamps.at(-1)! - shortTimestamps[0]) / (shortTimestamps.length - 1);
    const shortBpm = 60_000 / (shortPulseMs * 24);
    const previousTempo = this.smoothedClockTempo;
    const tempoChanged = previousTempo !== null && Math.abs(shortBpm - previousTempo) > 2.5;
    const targetTempo = tempoChanged ? shortBpm : stableBpm;

    if (targetTempo >= 10 && targetTempo <= 600) {
      this.smoothedClockTempo = previousTempo === null
        ? targetTempo
        : previousTempo + (targetTempo - previousTempo) * (tempoChanged ? 0.35 : 0.08);
      this.handlers.onClockTempo(this.smoothedClockTempo);
    }

    return timestamp;
  }

  private resetClock(): void {
    this.clockTimestamps = [];
    this.smoothedClockTempo = null;
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

function describeRealtimeMessage(inputName: string, status: number, bytes: number[], action: string): MidiActivity {
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
    action,
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
