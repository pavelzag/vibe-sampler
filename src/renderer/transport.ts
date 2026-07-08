import type { Channel, SamplerEngine } from "./audio";

export type TransportMode = "idle" | "playback" | "armed" | "countIn" | "recording";

type ScheduledStep = {
  step: number;
  time: number;
};

type TransportOptions = {
  engine: SamplerEngine;
  getChannels: () => Channel[];
  getTempo: () => number;
  getSwing: () => number;
  getStepCount: () => number;
  onStep: (step: number, mode: TransportMode) => void;
  onChannelPulse: (channelId: number) => void;
  onModeChange: (mode: TransportMode) => void;
  onMessage: (message: string) => void;
};

export class TransportScheduler {
  private engine: SamplerEngine;
  private getChannels: () => Channel[];
  private getTempo: () => number;
  private getSwing: () => number;
  private getStepCount: () => number;
  private onStep: (step: number, mode: TransportMode) => void;
  private onChannelPulse: (channelId: number) => void;
  private onModeChange: (mode: TransportMode) => void;
  private onMessage: (message: string) => void;
  private mode: TransportMode = "idle";
  private timer: number | null = null;
  private nextStep = 0;
  private nextStepTime = 0;
  private countInSteps = 0;
  private scheduledSteps: ScheduledStep[] = [];
  private suppressedHits = new Map<string, number>();
  private modeChangeId = 0;
  private readonly lookaheadMs = 25;
  private readonly scheduleAheadSeconds = 0.14;

  constructor(options: TransportOptions) {
    this.engine = options.engine;
    this.getChannels = options.getChannels;
    this.getTempo = options.getTempo;
    this.getSwing = options.getSwing;
    this.getStepCount = options.getStepCount;
    this.onStep = options.onStep;
    this.onChannelPulse = options.onChannelPulse;
    this.onModeChange = options.onModeChange;
    this.onMessage = options.onMessage;
  }

  getMode(): TransportMode {
    return this.mode;
  }

  getCurrentStep(): number {
    const nearest = this.findNearestStep(this.engine.audioContext.currentTime);
    return nearest?.step ?? this.nextStep;
  }

  play(): void {
    if (this.mode === "idle") {
      this.startClock("playback");
      return;
    }

    if (this.mode === "armed" || this.mode === "countIn" || this.mode === "recording") {
      return;
    }

    this.setMode("playback");
  }

  stop(): void {
    this.modeChangeId += 1;
    this.clearTimer();
    this.mode = "idle";
    this.nextStep = 0;
    this.nextStepTime = 0;
    this.countInSteps = 0;
    this.scheduledSteps = [];
    this.suppressedHits.clear();
    this.onModeChange("idle");
    this.onStep(0, "idle");
  }

  armRecording(): void {
    if (this.mode === "idle") {
      this.startClock("armed");
    } else {
      this.countInSteps = 0;
      this.setMode("armed");
    }
    this.onMessage("Waiting for step 1, then count-in for keyboard pattern recording");
  }

  cancelRecording(): void {
    if (this.mode === "armed" || this.mode === "countIn" || this.mode === "recording") {
      this.countInSteps = 0;
      this.setMode("playback");
      this.onMessage("Pattern recording stopped");
    }
  }

  quantizeTime(time: number): number {
    const nearest = this.findNearestStep(time);
    return nearest?.step ?? this.nextStep;
  }

  suppressHit(channelId: number, step: number): void {
    this.suppressedHits.set(`${channelId}:${step}`, this.engine.audioContext.currentTime + 0.5);
  }

  private startClock(mode: TransportMode): void {
    this.nextStep = 0;
    this.nextStepTime = this.engine.audioContext.currentTime + 0.05;
    this.countInSteps = 0;
    this.scheduledSteps = [];
    this.setMode(mode);
    this.ensureTimer();
  }

  private ensureTimer(): void {
    if (this.timer !== null) {
      return;
    }

    this.timer = window.setInterval(() => this.schedule(), this.lookaheadMs);
    this.schedule();
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private schedule(): void {
    const currentTime = this.engine.audioContext.currentTime;
    this.pruneScheduledSteps(currentTime);
    this.pruneSuppressedHits(currentTime);

    while (this.nextStepTime < currentTime + this.scheduleAheadSeconds) {
      this.scheduleStep(this.nextStep, this.nextStepTime);
      const currentStep = this.nextStep;
      this.nextStep = (this.nextStep + 1) % this.getStepCount();
      this.nextStepTime += this.getStepDurationSeconds(currentStep);
    }
  }

  private scheduleStep(step: number, time: number): void {
    if (this.mode === "armed" && step === 0) {
      this.countInSteps = 0;
      this.setMode("countIn", time);
      this.notifyAtTime(time, () => this.onMessage("Count-in for pattern recording"));
    }

    const modeForStep = this.mode;
    const channels = this.getChannels();
    const hasPattern = channels.some((channel) => channel.steps.some(Boolean));

    this.scheduledSteps.push({ step, time });
    window.setTimeout(() => this.onStep(step, modeForStep), Math.max(0, (time - this.engine.audioContext.currentTime) * 1000));

    if (modeForStep === "countIn") {
      this.engine.playMetronome(step % 4 === 0, time);
    } else if ((modeForStep === "armed" || modeForStep === "recording") && !hasPattern) {
      this.engine.playMetronome(step % 4 === 0, time);
    }

    for (const channel of channels) {
      if (!channel.steps[step] || this.isSuppressed(channel.id, step, time)) {
        continue;
      }

      if (this.engine.play(channel, 1, time)) {
        window.setTimeout(
          () => this.onChannelPulse(channel.id),
          Math.max(0, (time - this.engine.audioContext.currentTime) * 1000)
        );
      }
    }

    if (modeForStep === "countIn") {
      this.countInSteps += 1;
      if (this.countInSteps >= 16) {
        const nextStepTime = time + this.getStepDurationSeconds(step);
        this.setMode("recording", nextStepTime);
        this.notifyAtTime(nextStepTime, () => this.onMessage("Recording keyboard input. Press Esc to stop."));
      }
    }
  }

  private getStepDurationSeconds(step: number): number {
    const baseSeconds = 60 / this.getTempo() / 4;
    const swing = this.getSwing();
    return Math.max(0.02, baseSeconds * (step % 2 === 0 ? 1 + swing : 1 - swing));
  }

  private findNearestStep(time: number): ScheduledStep | null {
    const candidates = [...this.scheduledSteps, { step: this.nextStep, time: this.nextStepTime }];
    let nearest: ScheduledStep | null = null;

    for (const candidate of candidates) {
      if (!nearest || Math.abs(candidate.time - time) < Math.abs(nearest.time - time)) {
        nearest = candidate;
      }
    }

    return nearest;
  }

  private isSuppressed(channelId: number, step: number, time: number): boolean {
    const key = `${channelId}:${step}`;
    const suppressUntil = this.suppressedHits.get(key);
    if (suppressUntil === undefined) {
      return false;
    }

    return time <= suppressUntil;
  }

  private pruneScheduledSteps(currentTime: number): void {
    this.scheduledSteps = this.scheduledSteps.filter((step) => step.time >= currentTime - 0.25);
  }

  private pruneSuppressedHits(currentTime: number): void {
    for (const [key, suppressUntil] of this.suppressedHits.entries()) {
      if (suppressUntil < currentTime) {
        this.suppressedHits.delete(key);
      }
    }
  }

  private setMode(mode: TransportMode, notifyTime = this.engine.audioContext.currentTime): void {
    if (this.mode === mode) {
      return;
    }

    const modeChangeId = (this.modeChangeId += 1);
    this.mode = mode;
    this.notifyAtTime(notifyTime, () => {
      if (this.modeChangeId === modeChangeId) {
        this.onModeChange(mode);
      }
    });
  }

  private notifyAtTime(time: number, callback: () => void): void {
    window.setTimeout(callback, Math.max(0, (time - this.engine.audioContext.currentTime) * 1000));
  }
}
