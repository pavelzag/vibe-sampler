import { logInfo, logWarn } from "./logger";

export type Sample = {
  id: string;
  name: string;
  buffer: AudioBuffer;
  trimStart: number;
  trimEnd: number;
};

export type FxSendTarget = "distortion" | "reverb" | "delay" | "bitcrusher";

export type FxParams = {
  distortion: { drive: number; tone: number; level: number };
  reverb: { decay: number; damping: number; mix: number };
  delay: { time: number; feedback: number; mix: number };
  bitcrusher: { bits: number; rate: number; mix: number };
};

export function createDefaultFxParams(): FxParams {
  return {
    distortion: { drive: 0.24, tone: 0.75, level: 0.44 },
    reverb: { decay: 0.37, damping: 0.7, mix: 0.35 },
    delay: { time: 0.24, feedback: 0.31, mix: 0.42 },
    bitcrusher: { bits: 0.33, rate: 0.58, mix: 0.38 }
  };
}

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
  fxSends: Record<FxSendTarget, number>;
  envelope: {
    attack: number;
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
    fxSends: {
      distortion: 0,
      reverb: 0,
      delay: 0,
      bitcrusher: 0
    },
    envelope: {
      attack: 0,
      release: 0.34
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
  private channelFxSends: Record<FxSendTarget, GainNode[]>;
  private distortionInput: GainNode;
  private distortionShaper: WaveShaperNode;
  private distortionTone: BiquadFilterNode;
  private distortionOutput: GainNode;
  private reverbInput: GainNode;
  private reverbConvolver: ConvolverNode;
  private reverbDamping: BiquadFilterNode;
  private reverbOutput: GainNode;
  private reverbDecaySeconds = 2.4;
  private reverbRegenTimer: number | null = null;
  private reverbGenerationId = 0;
  private delayInput: GainNode;
  private delayNode: DelayNode;
  private delayFeedback: GainNode;
  private delayOutput: GainNode;
  private bitcrusherInput: GainNode;
  private bitcrusherOutput: GainNode;
  private bitcrusherNode: AudioWorkletNode | null = null;
  private bitcrusherSettings = { bits: 6, ratio: 8 };

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
    this.channelFxSends = {
      distortion: [],
      reverb: [],
      delay: [],
      bitcrusher: []
    };

    this.distortionInput = this.context.createGain();
    this.distortionShaper = this.context.createWaveShaper();
    this.distortionTone = this.context.createBiquadFilter();
    this.distortionOutput = this.context.createGain();
    this.distortionInput.gain.value = 2.8;
    this.distortionShaper.curve = createDistortionCurve(0.82) as Float32Array<ArrayBuffer>;
    this.distortionShaper.oversample = "4x";
    this.distortionTone.type = "lowpass";
    this.distortionTone.frequency.value = 5400;
    this.distortionOutput.gain.value = 0.35;
    this.distortionInput.connect(this.distortionShaper);
    this.distortionShaper.connect(this.distortionTone);
    this.distortionTone.connect(this.distortionOutput);
    this.distortionOutput.connect(this.master);

    this.reverbInput = this.context.createGain();
    this.reverbConvolver = this.context.createConvolver();
    this.reverbDamping = this.context.createBiquadFilter();
    this.reverbOutput = this.context.createGain();
    this.reverbConvolver.buffer = createImpulseResponse(this.context, 2.4, 2.2);
    this.reverbDamping.type = "lowpass";
    this.reverbDamping.frequency.value = 6000;
    this.reverbOutput.gain.value = 0.28;
    this.reverbInput.connect(this.reverbConvolver);
    this.reverbConvolver.connect(this.reverbDamping);
    this.reverbDamping.connect(this.reverbOutput);
    this.reverbOutput.connect(this.master);

    this.delayInput = this.context.createGain();
    this.delayNode = this.context.createDelay(2.0);
    this.delayFeedback = this.context.createGain();
    this.delayOutput = this.context.createGain();
    this.delayNode.delayTime.value = 0.26;
    this.delayFeedback.gain.value = 0.28;
    this.delayOutput.gain.value = 0.34;
    this.delayInput.connect(this.delayNode);
    this.delayNode.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delayNode);
    this.delayNode.connect(this.delayOutput);
    this.delayOutput.connect(this.master);

    this.bitcrusherInput = this.context.createGain();
    this.bitcrusherOutput = this.context.createGain();
    this.bitcrusherOutput.gain.value = 0.3;
    this.bitcrusherOutput.connect(this.master);
    void this.setupBitcrusherWorklet();

    for (let index = 0; index < 8; index += 1) {
      const gain = this.context.createGain();
      const panner = this.context.createStereoPanner();
      gain.connect(panner);
      panner.connect(this.master);
      this.channelGains.push(gain);
      this.channelPanners.push(panner);
      this.channelFxSends.distortion.push(this.createFxSend(this.distortionInput));
      this.channelFxSends.reverb.push(this.createFxSend(this.reverbInput));
      this.channelFxSends.delay.push(this.createFxSend(this.delayInput));
      this.channelFxSends.bitcrusher.push(this.createFxSend(this.bitcrusherInput));
    }
  }

  private async setupBitcrusherWorklet(): Promise<void> {
    const blob = new Blob([bitcrusherProcessorSource], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    try {
      await this.context.audioWorklet.addModule(url);
      const node = new AudioWorkletNode(this.context, "bitcrusher-processor");
      this.bitcrusherInput.connect(node);
      node.connect(this.bitcrusherOutput);
      this.bitcrusherNode = node;
      this.applyBitcrusherSettings();
    } catch (error) {
      logWarn("Bitcrusher worklet failed to load", error);
    } finally {
      URL.revokeObjectURL(url);
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

  private createFxSend(destination: AudioNode): GainNode {
    const send = this.context.createGain();
    send.gain.value = 0;
    send.connect(destination);
    return send;
  }

  setChannelFxSend(channel: number, target: FxSendTarget, amount: number): void {
    this.channelFxSends[target][channel].gain.setTargetAtTime(clamp(Number.isFinite(amount) ? amount : 0, 0, 1), this.context.currentTime, 0.01);
  }

  setMasterLevel(level: number): void {
    this.master.gain.setTargetAtTime(clamp(level, 0, 1), this.context.currentTime, 0.01);
  }

  setDistortionParams(params: FxParams["distortion"]): void {
    const now = this.context.currentTime;
    this.distortionInput.gain.setTargetAtTime(mapDistortionDrive(params.drive), now, 0.01);
    this.distortionTone.frequency.setTargetAtTime(mapDistortionTone(params.tone), now, 0.01);
    this.distortionOutput.gain.setTargetAtTime(mapFxMix(params.level), now, 0.01);
  }

  setReverbParams(params: FxParams["reverb"]): void {
    const now = this.context.currentTime;
    this.reverbDamping.frequency.setTargetAtTime(mapReverbDamping(params.damping), now, 0.01);
    this.reverbOutput.gain.setTargetAtTime(mapFxMix(params.mix), now, 0.01);
    const seconds = mapReverbDecay(params.decay);
    if (Math.abs(seconds - this.reverbDecaySeconds) > 0.01) {
      this.reverbDecaySeconds = seconds;
      const generationId = (this.reverbGenerationId += 1);
      if (this.reverbRegenTimer !== null) {
        window.clearTimeout(this.reverbRegenTimer);
      }
      this.reverbRegenTimer = window.setTimeout(() => {
        this.reverbRegenTimer = null;
        void createImpulseResponseAsync(
          this.context,
          this.reverbDecaySeconds,
          2.2,
          () => this.reverbGenerationId === generationId
        ).then((buffer) => {
          if (buffer && this.reverbGenerationId === generationId) {
            this.reverbConvolver.buffer = buffer;
          }
        });
      }, 120);
    }
  }

  setDelayParams(params: FxParams["delay"]): void {
    const now = this.context.currentTime;
    this.delayNode.delayTime.setTargetAtTime(mapDelayTime(params.time), now, 0.02);
    this.delayFeedback.gain.setTargetAtTime(mapDelayFeedback(params.feedback), now, 0.01);
    this.delayOutput.gain.setTargetAtTime(mapFxMix(params.mix), now, 0.01);
  }

  setBitcrusherParams(params: FxParams["bitcrusher"]): void {
    this.bitcrusherSettings = {
      bits: mapCrusherBits(params.bits),
      ratio: Math.max(1, Math.round(this.context.sampleRate / mapCrusherRate(params.rate)))
    };
    this.bitcrusherOutput.gain.setTargetAtTime(mapFxMix(params.mix), this.context.currentTime, 0.01);
    this.applyBitcrusherSettings();
  }

  private applyBitcrusherSettings(): void {
    if (!this.bitcrusherNode) {
      return;
    }
    const now = this.context.currentTime;
    this.bitcrusherNode.parameters.get("bits")?.setValueAtTime(this.bitcrusherSettings.bits, now);
    this.bitcrusherNode.parameters.get("ratio")?.setValueAtTime(this.bitcrusherSettings.ratio, now);
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
    envelopeGain.connect(this.channelFxSends.distortion[channel.id]);
    envelopeGain.connect(this.channelFxSends.reverb[channel.id]);
    envelopeGain.connect(this.channelFxSends.delay[channel.id]);
    envelopeGain.connect(this.channelFxSends.bitcrusher[channel.id]);
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

// envelope.attack is the ramp-up time and envelope.release is the absolute
// fade-out point, both in seconds from playback start. The two are independent;
// if release sits before attack the fade collapses to just after the peak.
export function getEnvelopeDuration(envelope: Channel["envelope"]): number {
  return Math.max(envelope.attack + 0.02, envelope.release);
}

function applyEnvelope(
  gain: AudioParam,
  envelope: Channel["envelope"],
  startTime: number,
  sampleDuration: number
): void {
  const attack = clamp(envelope.attack, 0, Math.max(0, sampleDuration - 0.02));
  const releaseEnd = clamp(Math.max(attack + 0.02, envelope.release), 0.02, sampleDuration);

  gain.cancelScheduledValues(startTime);
  gain.setValueAtTime(0, startTime);
  gain.linearRampToValueAtTime(1, startTime + attack);
  gain.linearRampToValueAtTime(0, startTime + releaseEnd);
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

function createDistortionCurve(amount: number): Float32Array {
  const samples = 1024;
  const curve = new Float32Array(samples);
  const k = Math.max(0.1, amount * 80);
  for (let index = 0; index < samples; index += 1) {
    const x = (index * 2) / samples - 1;
    curve[index] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

function createImpulseResponse(context: AudioContext, seconds = 2, decay = 2): AudioBuffer {
  const rate = context.sampleRate;
  const length = Math.max(1, Math.floor(rate * seconds));
  const buffer = context.createBuffer(2, length, rate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < length; index += 1) {
      const noise = Math.random() * 2 - 1;
      data[index] = noise * Math.pow(1 - index / length, decay);
    }
  }
  return buffer;
}

async function createImpulseResponseAsync(
  context: AudioContext,
  seconds: number,
  decay: number,
  isCurrent: () => boolean
): Promise<AudioBuffer | null> {
  const rate = context.sampleRate;
  const length = Math.max(1, Math.floor(rate * seconds));
  const buffer = context.createBuffer(2, length, rate);
  const chunkSize = 4096;

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let start = 0; start < length; start += chunkSize) {
      if (!isCurrent()) {
        return null;
      }
      const end = Math.min(length, start + chunkSize);
      for (let index = start; index < end; index += 1) {
        const noise = Math.random() * 2 - 1;
        data[index] = noise * Math.pow(1 - index / length, decay);
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
  }

  return buffer;
}

const bitcrusherProcessorSource = `
class BitcrusherProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "bits", defaultValue: 6, minValue: 1, maxValue: 16, automationRate: "k-rate" },
      { name: "ratio", defaultValue: 8, minValue: 1, maxValue: 96, automationRate: "k-rate" }
    ];
  }

  constructor() {
    super();
    this.phase = 0;
    this.lastSample = [0, 0];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    const channelCount = output.length;
    const bits = Math.max(1, Math.round(parameters.bits[0]));
    const ratio = Math.max(1, Math.round(parameters.ratio[0]));
    const step = 1 / Math.pow(2, bits - 1);

    for (let index = 0; index < output[0].length; index += 1) {
      if (this.phase === 0) {
        for (let channel = 0; channel < channelCount; channel += 1) {
          const inputChannel = input[channel] || input[0];
          const value = inputChannel ? inputChannel[index] : 0;
          this.lastSample[channel] = Math.round(value / step) * step;
        }
      }
      for (let channel = 0; channel < channelCount; channel += 1) {
        output[channel][index] = this.lastSample[channel] || 0;
      }
      this.phase = (this.phase + 1) % ratio;
    }

    return true;
  }
}

registerProcessor("bitcrusher-processor", BitcrusherProcessor);
`;

function mapDistortionDrive(value: number): number {
  return 0.5 + clamp(value, 0, 1) * 9.5;
}

function mapDistortionTone(value: number): number {
  return 500 * Math.pow(24, clamp(value, 0, 1));
}

function mapReverbDecay(value: number): number {
  return 0.3 + clamp(value, 0, 1) * 5.7;
}

function mapReverbDamping(value: number): number {
  return 800 * Math.pow(17.5, clamp(value, 0, 1));
}

function mapDelayTime(value: number): number {
  return 0.02 + clamp(value, 0, 1) * 0.98;
}

function mapDelayFeedback(value: number): number {
  return clamp(value, 0, 1) * 0.9;
}

function mapFxMix(value: number): number {
  return clamp(value, 0, 1) * 0.8;
}

function mapCrusherBits(value: number): number {
  return Math.round(1 + clamp(value, 0, 1) * 15);
}

function mapCrusherRate(value: number): number {
  return Math.round(1000 * Math.pow(22, clamp(value, 0, 1)));
}

function formatHz(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(1)} kHz` : `${Math.round(hz)} Hz`;
}

export function formatFxParamValue(target: FxSendTarget, param: string, value: number): string {
  if (target === "distortion") {
    if (param === "drive") {
      return `${mapDistortionDrive(value).toFixed(1)}x`;
    }
    if (param === "tone") {
      return formatHz(mapDistortionTone(value));
    }
  }
  if (target === "reverb") {
    if (param === "decay") {
      return `${mapReverbDecay(value).toFixed(1)} s`;
    }
    if (param === "damping") {
      return formatHz(mapReverbDamping(value));
    }
  }
  if (target === "delay") {
    if (param === "time") {
      return `${Math.round(mapDelayTime(value) * 1000)} ms`;
    }
    if (param === "feedback") {
      return `${Math.round(mapDelayFeedback(value) * 100)}%`;
    }
  }
  if (target === "bitcrusher") {
    if (param === "bits") {
      return `${mapCrusherBits(value)} bit`;
    }
    if (param === "rate") {
      return formatHz(mapCrusherRate(value));
    }
  }
  return `${Math.round(value * 100)}%`;
}

export function midiNoteName(note: number): string {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const octave = Math.floor(note / 12) - 1;
  return `${names[note % 12]}${octave}`;
}
