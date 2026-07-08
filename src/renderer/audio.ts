import { logInfo, logWarn } from "./logger";

export type Sample = {
  id: string;
  name: string;
  buffer: AudioBuffer;
  trimStart: number;
  trimEnd: number;
};

export type Channel = {
  id: number;
  name: string;
  note: number;
  levelCc: number | null;
  levelControlKey: string | null;
  levelControlLabel: string | null;
  levelControlName: string;
  levelCcLearned: boolean;
  muteCc: number | null;
  muteNote: number | null;
  muteControlName: string;
  level: number;
  pan: number;
  envelope: {
    attack: number;
    peak: number;
    decay: number;
    sustain: number;
    hold: number;
    release: number;
  };
  muted: boolean;
  sample: Sample | null;
  steps: boolean[];
};

export function createChannels(): Channel[] {
  const names = ["Kick", "Snare", "Clap", "Hat", "Open Hat", "Tom", "Rim", "Ride"];
  const triggerNotes = [52, 55, 59, 62, 66, 69, 72, 76];
  const levelControls = [
    { name: "VCO2 pitch", cc: 35 },
    { name: "VCO2 shape", cc: 37 },
    { name: "Mixer VCO1", cc: 39 },
    { name: "Mixer VCO2", cc: 40 },
    { name: "Filter Cutoff", cc: 43 },
    { name: "Resonance Cutoff", cc: 44 },
    { name: "EG Decay", cc: 17 },
    { name: "LFO Rate", cc: 24 }
  ];
  return names.map((name, index) => ({
    id: index,
    name,
    note: triggerNotes[index],
    levelCc: levelControls[index].cc,
    levelControlKey: `cc:${levelControls[index].cc}`,
    levelControlLabel: `CC ${levelControls[index].cc}`,
    levelControlName: levelControls[index].name,
    levelCcLearned: false,
    muteCc: null,
    muteNote: null,
    muteControlName: "Unassigned",
    level: 1,
    pan: 0,
    envelope: {
      attack: 0,
      peak: 0.85,
      decay: 0.05,
      sustain: 1,
      hold: 0.25,
      release: 0.04
    },
    muted: false,
    sample: null,
    steps: createHousePattern()
  }));
}

export function createHousePattern(): boolean[] {
  return Array.from({ length: 32 }, () => true);
}

export class SamplerEngine {
  private context: AudioContext;
  private master: GainNode;
  private channelGains: GainNode[];
  private channelPanners: StereoPannerNode[];

  constructor() {
    logInfo("Initializing AudioContext", { latencyHint: 0.003 });
    this.context = new AudioContext({ latencyHint: 0.003 });
    logInfo("AudioContext initialized", {
      state: this.context.state,
      sampleRate: this.context.sampleRate,
      baseLatency: this.context.baseLatency
    });
    this.master = this.context.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.context.destination);
    this.channelGains = [];
    this.channelPanners = [];

    for (let index = 0; index < 8; index += 1) {
      const gain = this.context.createGain();
      const panner = this.context.createStereoPanner();
      gain.connect(panner);
      panner.connect(this.master);
      this.channelGains.push(gain);
      this.channelPanners.push(panner);
    }
  }

  get audioContext(): AudioContext {
    return this.context;
  }

  async resume(): Promise<void> {
    if (this.context.state !== "running") {
      logInfo("Resuming AudioContext", { state: this.context.state });
      await this.context.resume();
      logInfo("AudioContext resumed", { state: this.context.state });
    }
  }

  resumeSoon(): void {
    if (this.context.state !== "running") {
      void this.context.resume().catch((error) => {
        logWarn("Deferred AudioContext resume failed", error);
      });
    }
  }

  isRunning(): boolean {
    return this.context.state === "running";
  }

  getLatencyMs(): number {
    const outputLatency = "outputLatency" in this.context ? this.context.outputLatency : 0;
    return (this.context.baseLatency + outputLatency) * 1000;
  }

  setChannelLevel(channel: number, level: number): void {
    this.channelGains[channel].gain.setTargetAtTime(level, this.context.currentTime, 0.01);
  }

  setChannelPan(channel: number, pan: number): void {
    this.channelPanners[channel].pan.setTargetAtTime(pan, this.context.currentTime, 0.01);
  }

  setMasterLevel(level: number): void {
    this.master.gain.setTargetAtTime(clamp(level, 0, 1), this.context.currentTime, 0.01);
  }

  playMetronome(accent = false, when = this.context.currentTime): void {
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    const click = this.context.createBufferSource();
    const clickGain = this.context.createGain();
    const clickBuffer = this.context.createBuffer(1, Math.floor(this.context.sampleRate * 0.012), this.context.sampleRate);
    const clickData = clickBuffer.getChannelData(0);
    for (let index = 0; index < clickData.length; index += 1) {
      clickData[index] = (Math.random() * 2 - 1) * (1 - index / clickData.length);
    }
    click.buffer = clickBuffer;
    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(accent ? 2100 : 1500, when);
    oscillator.frequency.exponentialRampToValueAtTime(accent ? 1300 : 950, when + 0.022);
    filter.type = "bandpass";
    filter.frequency.value = accent ? 2400 : 1800;
    filter.Q.value = 5;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.42 : 0.26, when + 0.0015);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.045);
    clickGain.gain.setValueAtTime(accent ? 0.32 : 0.2, when);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.014);
    oscillator.connect(gain);
    gain.connect(filter);
    click.connect(clickGain);
    clickGain.connect(filter);
    filter.connect(this.master);
    oscillator.start(when);
    oscillator.stop(when + 0.055);
    click.start(when);
    click.stop(when + 0.016);
  }

  play(channel: Channel, velocity = 1, when = this.context.currentTime): boolean {
    if (!channel.sample || channel.muted) {
      return false;
    }

    const duration = channel.sample.trimEnd - channel.sample.trimStart;
    if (duration <= 0.01) {
      return false;
    }

    const envelopeDuration = getEnvelopeDuration(channel.envelope);
    const playbackDuration = Math.min(duration, envelopeDuration);
    if (playbackDuration <= 0.01) {
      return false;
    }

    const source = this.context.createBufferSource();
    const velocityGain = this.context.createGain();
    const envelopeGain = this.context.createGain();
    source.buffer = channel.sample.buffer;
    velocityGain.gain.value = clamp(velocity, 0, 1);
    applyEnvelope(envelopeGain.gain, channel.envelope, when, playbackDuration);
    source.connect(velocityGain);
    velocityGain.connect(envelopeGain);
    envelopeGain.connect(this.channelGains[channel.id]);
    source.start(when, channel.sample.trimStart, playbackDuration);
    return true;
  }

  async decode(blob: Blob, name: string): Promise<Sample> {
    logInfo("Decoding audio blob", { name, size: blob.size, type: blob.type });
    const data = await blob.arrayBuffer();
    const buffer = await this.context.decodeAudioData(data.slice(0));
    logInfo("Audio blob decoded", {
      name,
      duration: buffer.duration,
      sampleRate: buffer.sampleRate,
      channels: buffer.numberOfChannels
    });
    return {
      id: crypto.randomUUID(),
      name,
      buffer,
      trimStart: 0,
      trimEnd: buffer.duration
    };
  }

  normalize(sample: Sample): Sample {
    const buffer = cloneBuffer(this.context, sample.buffer);
    let peak = 0;

    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (const value of data) {
        peak = Math.max(peak, Math.abs(value));
      }
    }

    if (peak > 0) {
      const scale = 0.96 / peak;
      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        const data = buffer.getChannelData(channel);
        for (let index = 0; index < data.length; index += 1) {
          data[index] *= scale;
        }
      }
    }

    return { ...sample, id: crypto.randomUUID(), buffer };
  }

  reverse(sample: Sample): Sample {
    const buffer = cloneBuffer(this.context, sample.buffer);
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      buffer.getChannelData(channel).reverse();
    }
    return { ...sample, id: crypto.randomUUID(), buffer };
  }

  renderWaveform(sample: Sample, width = 220): number[] {
    const data = sample.buffer.getChannelData(0);
    const bucketSize = Math.max(1, Math.floor(data.length / width));
    const points: number[] = [];

    for (let x = 0; x < width; x += 1) {
      let peak = 0;
      const start = x * bucketSize;
      const end = Math.min(data.length, start + bucketSize);
      for (let index = start; index < end; index += 1) {
        peak = Math.max(peak, Math.abs(data[index]));
      }
      points.push(peak);
    }

    return points;
  }
}

export function getEnvelopeDuration(envelope: Channel["envelope"]): number {
  return envelope.attack + envelope.decay + envelope.hold + envelope.release;
}

function applyEnvelope(
  gain: AudioParam,
  envelope: Channel["envelope"],
  startTime: number,
  sampleDuration: number
): void {
  const attack = clamp(envelope.attack, 0, sampleDuration);
  const peak = clamp(envelope.peak, 0, 1);
  const decay = clamp(envelope.decay, 0, sampleDuration);
  const sustain = clamp(envelope.sustain, 0, 1);
  const hold = clamp(envelope.hold, 0, sampleDuration);
  const release = clamp(envelope.release, 0, sampleDuration);
  const attackEnd = startTime + attack;
  const decayEnd = attackEnd + decay;
  const releaseStart = decayEnd + hold;
  const releaseEnd = releaseStart + release;

  gain.cancelScheduledValues(startTime);
  gain.setValueAtTime(0, startTime);
  gain.linearRampToValueAtTime(peak, attackEnd);
  gain.linearRampToValueAtTime(sustain, decayEnd);
  gain.setValueAtTime(sustain, releaseStart);
  gain.linearRampToValueAtTime(0, releaseEnd);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function cloneBuffer(context: AudioContext, source: AudioBuffer): AudioBuffer {
  const buffer = context.createBuffer(source.numberOfChannels, source.length, source.sampleRate);
  for (let channel = 0; channel < source.numberOfChannels; channel += 1) {
    buffer.copyToChannel(source.getChannelData(channel), channel);
  }
  return buffer;
}

export function midiNoteName(note: number): string {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const octave = Math.floor(note / 12) - 1;
  return `${names[note % 12]}${octave}`;
}
