import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import {
  Circle,
  Eraser,
  MicOff,
  Mic,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Scissors,
  Wand2
} from "lucide-react";
import { Channel, Sample, SamplerEngine, createChannels, getEnvelopeDuration, midiNoteName } from "./audio";
import { applyBankToChannels, defaultBankId, loadSoundBank, soundBanks } from "./banks";
import { installRendererErrorLogging, logError, logInfo, logWarn } from "./logger";
import { MidiActivity, MidiControlMessage, MidiManager, MidiStatus } from "./midi";
import { applyPatternPreset, defaultPatternId, findPatternPreset, patternPresets } from "./patterns";
import "./styles.css";

installRendererErrorLogging();

const engine = createSamplerEngine();
const muteKeys = ["q", "w", "e", "r", "t", "y", "u", "i"];
const triggerKeys = ["a", "s", "d", "f", "g", "h", "j", "k"];
const defaultVolumeControls = [
  "VCO2 pitch",
  "VCO2 shape",
  "Mixer VCO1",
  "Mixer VCO2",
  "Filter Cutoff",
  "Resonance Cutoff",
  "EG Decay",
  "LFO Rate"
];
const volumeMapStorageKey = "vibe-sampler.volume-control-map.v4";
const transportMapStorageKey = "vibe-sampler.transport-control-map.v4";
const defaultTransportControls = {
  swing: { key: "cc:16", label: "CC 16" },
  master: { key: "cc:28", label: "CC 28" }
} satisfies Record<TransportBindTarget, { key: string; label: string }>;
const defaultVolumeControlNumbers = [35, 37, 39, 40, 43, 44, 17, 24];
type TransportBindTarget = "swing" | "master";
type StoredControl = { key: string; label: string } | null;

declare global {
  interface Window {
    vibeSamplerRoot?: Root;
  }
}

function createSamplerEngine(): SamplerEngine {
  try {
    logInfo("Creating sampler engine");
    const samplerEngine = new SamplerEngine();
    logInfo("Sampler engine created", {
      audioContextState: samplerEngine.audioContext.state,
      sampleRate: samplerEngine.audioContext.sampleRate,
      baseLatency: samplerEngine.audioContext.baseLatency
    });
    return samplerEngine;
  } catch (error) {
    logError("Failed to create sampler engine", error);
    throw error;
  }
}

function App(): React.JSX.Element {
  const [channels, setChannels] = useState<Channel[]>(() => applyPatternPreset(createChannels(), findPatternPreset(defaultPatternId)));
  const [activeChannelId, setActiveChannelId] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isPatternRecordArmed, setIsPatternRecordArmed] = useState(false);
  const [isPatternCountIn, setIsPatternCountIn] = useState(false);
  const [isPatternRecording, setIsPatternRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedBankId, setSelectedBankId] = useState(defaultBankId);
  const [selectedPatternId, setSelectedPatternId] = useState(defaultPatternId);
  const [isBankLoading, setIsBankLoading] = useState(false);
  const [tempo, setTempo] = useState(() => findPatternPreset(defaultPatternId).tempo);
  const [swing, setSwing] = useState(() => findPatternPreset(defaultPatternId).swing);
  const [masterLevel, setMasterLevel] = useState(0.9);
  const [swingControl, setSwingControl] = useState<StoredControl>(defaultTransportControls.swing);
  const [masterControl, setMasterControl] = useState<StoredControl>(defaultTransportControls.master);
  const [transportBindTarget, setTransportBindTarget] = useState<TransportBindTarget | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedPatternCell, setSelectedPatternCell] = useState<{ channelId: number; step: number } | null>(null);
  const [channelHitTicks, setChannelHitTicks] = useState(() => Array.from({ length: 8 }, () => 0));
  const [audioLatencyMs, setAudioLatencyMs] = useState(0);
  const [midiMonitorEnabled, setMidiMonitorEnabled] = useState(true);
  const [midiEvents, setMidiEvents] = useState<MidiActivity[]>([]);
  const [keyLearnIndex, setKeyLearnIndex] = useState<number | null>(null);
  const [midiStatus, setMidiStatus] = useState<MidiStatus>({
    supported: true,
    connectedInputs: [],
    korgDetected: false
  });
  const [message, setMessage] = useState("Ready");
  const channelsRef = useRef(channels);
  const activeChannelIdRef = useRef(activeChannelId);
  const isPatternRecordArmedRef = useRef(isPatternRecordArmed);
  const isPatternCountInRef = useRef(isPatternCountIn);
  const isPatternRecordingRef = useRef(isPatternRecording);
  const patternCountInStepCountRef = useRef(0);
  const patternRecordStepCountRef = useRef(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const midiRef = useRef<MidiManager | null>(null);
  const schedulerRef = useRef<number | null>(null);
  const stepRef = useRef(0);
  const playingStepRef = useRef(0);
  const stepStartedAtRef = useRef(performance.now());
  const stepDurationMsRef = useRef(60_000 / tempo / 4);
  const tempoRef = useRef(tempo);
  const swingRef = useRef(swing);
  const keyLearnIndexRef = useRef<number | null>(null);
  const volumeControlMapRef = useRef<StoredControl[]>(Array.from({ length: 8 }, () => null));
  const swingControlRef = useRef<StoredControl>(defaultTransportControls.swing);
  const masterControlRef = useRef<StoredControl>(defaultTransportControls.master);
  const transportBindTargetRef = useRef<TransportBindTarget | null>(null);

  const activeChannel = channels[activeChannelId];
  const waveform = useMemo(
    () => (activeChannel.sample ? engine.renderWaveform(activeChannel.sample, 180) : []),
    [activeChannel.sample]
  );

  useEffect(() => {
    logInfo("App component mounted");
    return () => logInfo("App component unmounted");
  }, []);

  useEffect(() => {
    channelsRef.current = channels;
    volumeControlMapRef.current = channels.map((channel) => toStoredControl(channel.levelControlKey, channel.levelControlLabel));
    channels.forEach((channel) => {
      engine.setChannelLevel(channel.id, channel.level);
      engine.setChannelPan(channel.id, channel.pan);
    });
  }, [channels]);

  useEffect(() => {
    activeChannelIdRef.current = activeChannelId;
  }, [activeChannelId]);

  useEffect(() => {
    isPatternRecordArmedRef.current = isPatternRecordArmed;
  }, [isPatternRecordArmed]);

  useEffect(() => {
    isPatternCountInRef.current = isPatternCountIn;
  }, [isPatternCountIn]);

  useEffect(() => {
    isPatternRecordingRef.current = isPatternRecording;
  }, [isPatternRecording]);

  useEffect(() => {
    tempoRef.current = tempo;
  }, [tempo]);

  useEffect(() => {
    swingRef.current = swing;
  }, [swing]);

  useEffect(() => {
    engine.setMasterLevel(masterLevel);
  }, [masterLevel]);

  useEffect(() => {
    transportBindTargetRef.current = transportBindTarget;
  }, [transportBindTarget]);

  useEffect(() => {
    keyLearnIndexRef.current = keyLearnIndex;
  }, [keyLearnIndex]);

  const updateChannel = useCallback((channelId: number, updater: (channel: Channel) => Channel) => {
    setChannels((current) => current.map((channel) => (channel.id === channelId ? updater(channel) : channel)));
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem(volumeMapStorageKey);
    if (!stored) {
      return;
    }

    try {
      const controls = normalizeStoredControls(JSON.parse(stored));
      volumeControlMapRef.current = controls;
      setChannels((current) =>
        current.map((channel, index) => ({
          ...channel,
          levelCc: controlCcNumber(controls[index]),
          levelControlKey: controls[index]?.key ?? null,
          levelControlLabel: controls[index]?.label ?? null,
          levelCcLearned: controls[index] !== null
        }))
      );
    } catch {
      localStorage.removeItem(volumeMapStorageKey);
    }
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem(transportMapStorageKey);
    if (!stored) {
      return;
    }

    try {
      const controls = JSON.parse(stored) as { swing?: StoredControl; master?: StoredControl };
      swingControlRef.current = normalizeStoredControl(controls.swing);
      masterControlRef.current = normalizeStoredControl(controls.master);
      setSwingControl(swingControlRef.current);
      setMasterControl(masterControlRef.current);
    } catch {
      localStorage.removeItem(transportMapStorageKey);
    }
  }, []);

  const loadBank = useCallback(async (bankId: string) => {
    logInfo("Loading sound bank", { bankId });
    setIsBankLoading(true);
    setMessage(`Loading ${soundBanks.find((bank) => bank.id === bankId)?.name ?? "sound bank"}`);
    try {
      const samples = await loadSoundBank(engine, bankId);
      setChannels((current) => applyBankToChannels(current, bankId, samples));
      setSelectedBankId(bankId);
      logInfo("Sound bank loaded", { bankId, sampleCount: samples.length });
      setMessage(`${soundBanks.find((bank) => bank.id === bankId)?.name ?? "Sound bank"} loaded`);
    } catch (error) {
      logError("Sound bank failed to load", { bankId, error });
      setMessage(error instanceof Error ? error.message : "Could not load sound bank");
    } finally {
      setIsBankLoading(false);
    }
  }, []);

  const applyPattern = useCallback((patternId: string) => {
    const pattern = findPatternPreset(patternId);
    logInfo("Applying pattern preset", {
      patternId,
      tempo: pattern.tempo,
      swing: pattern.swing
    });
    setSelectedPatternId(pattern.id);
    setTempo(pattern.tempo);
    setSwing(pattern.swing);
    setCurrentStep(0);
    stepRef.current = 0;
    setChannels((current) => applyPatternPreset(current, pattern));
    setMessage(`${pattern.name} pattern loaded at ${pattern.tempo} BPM`);
  }, []);

  const triggerChannel = useCallback((channelId: number, velocity = 1, selectChannel = false, pulseWhenSilent = false) => {
    const channel = channelsRef.current[channelId];
    const didPlay = engine.isRunning()
      ? engine.play(channel, velocity)
      : (engine.resumeSoon(), engine.play(channel, velocity));
    if (didPlay || pulseWhenSilent) {
      pulseChannel(channelId);
    }
    if (selectChannel) {
      setActiveChannelId(channelId);
    }
  }, []);

  const recordPatternHit = useCallback((channelId: number) => {
    if (!isPatternRecordingRef.current) {
      return;
    }

    const elapsedMs = performance.now() - stepStartedAtRef.current;
    const stepOffset = elapsedMs > stepDurationMsRef.current * 0.5 ? 1 : 0;
    const quantizedStep = (playingStepRef.current + stepOffset) % 16;
    setSelectedPatternCell({ channelId, step: quantizedStep });
    setChannels((current) =>
      current.map((channel) =>
        channel.id === channelId
          ? {
              ...channel,
              steps: channel.steps.map((enabled, step) => (step === quantizedStep ? true : enabled))
            }
          : channel
      )
    );
    setMessage(`Recorded ${channelsRef.current[channelId]?.name ?? "channel"} on step ${quantizedStep + 1}`);
  }, []);

  useEffect(() => {
    const resumeAudio = () => engine.resumeSoon();
    window.addEventListener("pointerdown", resumeAudio, { passive: true });
    window.addEventListener("keydown", resumeAudio);
    return () => {
      window.removeEventListener("pointerdown", resumeAudio);
      window.removeEventListener("keydown", resumeAudio);
    };
  }, []);

  useEffect(() => {
    const handleChannelKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLTextAreaElement ||
        event.repeat
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      if (
        event.code === "Escape" &&
        (isPatternRecordArmedRef.current || isPatternCountInRef.current || isPatternRecordingRef.current)
      ) {
        event.preventDefault();
        isPatternRecordArmedRef.current = false;
        isPatternCountInRef.current = false;
        isPatternRecordingRef.current = false;
        setIsPatternRecordArmed(false);
        setIsPatternCountIn(false);
        setIsPatternRecording(false);
        setIsPlaying(true);
        setMessage("Pattern recording stopped");
        return;
      }

      if (event.code === "F8") {
        event.preventDefault();
        void togglePatternRecording();
        return;
      }

      if (event.metaKey && (event.code === "ArrowUp" || event.code === "ArrowDown")) {
        event.preventDefault();
        const direction = event.code === "ArrowUp" ? -1 : 1;
        const nextChannelId = (activeChannelIdRef.current + direction + channelsRef.current.length) % channelsRef.current.length;
        selectPatternChannel(nextChannelId);
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        setIsPlaying((value) => !value);
        return;
      }

      const triggerChannelId = triggerKeys.indexOf(key);
      if (triggerChannelId !== -1) {
        event.preventDefault();
        triggerChannel(triggerChannelId, 1, true, true);
        recordPatternHit(triggerChannelId);
        return;
      }

      const channelId = muteKeys.indexOf(key);
      if (channelId === -1) {
        return;
      }

      event.preventDefault();
      updateChannel(channelId, (channel) => ({ ...channel, muted: !channel.muted }));
    };

    window.addEventListener("keydown", handleChannelKey);
    return () => window.removeEventListener("keydown", handleChannelKey);
  }, [recordPatternHit, triggerChannel, updateChannel]);

  useEffect(() => {
    const updateLatency = () => setAudioLatencyMs(engine.getLatencyMs());
    updateLatency();
    const timer = window.setInterval(updateLatency, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const bindDetectedLevelControl = useCallback(
    (control: MidiControlMessage): boolean => {
      return false;
    },
    [updateChannel]
  );

  const bindTransportControl = useCallback(
    (control: MidiControlMessage): string[] => {
      const level = control.value;
      const storedControl = toStoredControl(control.key, control.label);
      const actions: string[] = [];

      if (control.key === "cc:24") {
        if (transportBindTargetRef.current) {
          setMessage("CC 24 is reserved for Ride level.");
        }
        return actions;
      }

      if (transportBindTargetRef.current === "swing") {
        swingControlRef.current = storedControl;
        setSwingControl(storedControl);
        setSwing(level * 0.55);
        setTransportBindTarget(null);
        saveTransportMap();
        setMessage(`Swing assigned to ${control.label}`);
        return [`Swing assigned to ${control.label}`];
      }

      if (transportBindTargetRef.current === "master") {
        masterControlRef.current = storedControl;
        setMasterControl(storedControl);
        setMasterLevel(level);
        setTransportBindTarget(null);
        saveTransportMap();
        setMessage(`Master volume assigned to ${control.label}`);
        return [`Master volume assigned to ${control.label}`];
      }

      if (swingControlRef.current?.key === control.key) {
        setSwing(level * 0.55);
        actions.push("Swing");
      }

      if (masterControlRef.current?.key === control.key) {
        setMasterLevel(level);
        actions.push("Master");
      }

      return actions;
    },
    []
  );

  useEffect(() => {
    const midi = new MidiManager(
      {
        getChannels: () => channelsRef.current,
        onTrigger: triggerChannel,
        onLevel: (channelId, level) =>
          updateChannel(channelId, (channel) => ({
            ...channel,
            level
          })),
        onTransportControl: bindTransportControl,
        onLevelControlDetected: bindDetectedLevelControl,
        onMute: (channelId, muted) => updateChannel(channelId, (channel) => ({ ...channel, muted })),
        onLearn: () => undefined,
        onClockTempo: (clockTempo) => {
          const nextTempo = Math.round(clockTempo);
          if (Math.abs(nextTempo - tempoRef.current) >= 1) {
            setTempo(nextTempo);
          }
        },
        onActivity: (event) => {
          if (keyLearnIndexRef.current !== null && event.kind === "Note on") {
            const channelId = keyLearnIndexRef.current;
            updateChannel(channelId, (channel) => ({ ...channel, note: event.data1 }));
            const nextIndex = channelId + 1;
            if (nextIndex >= channelsRef.current.length) {
              setKeyLearnIndex(null);
              setMessage(`Key map learned through ${channelsRef.current[channelId].name}`);
            } else {
              setKeyLearnIndex(nextIndex);
              setMessage(`Assigned ${channelsRef.current[channelId].name}. Press key for ${channelsRef.current[nextIndex].name}.`);
            }
            event.action = `Assign ${channelsRef.current[channelId].name}`;
          }

          if (midiMonitorEnabled && shouldShowMidiEvent(event)) {
            setMidiEvents((current) => [event, ...current].slice(0, 48));
          }
        }
      },
      setMidiStatus
    );

    midiRef.current = midi;
    logInfo("Connecting MIDI manager");
    void midi.connect().catch((error) => {
      logWarn("MIDI unavailable", error);
      setMessage(`MIDI unavailable: ${error instanceof Error ? error.message : "unknown error"}`);
    });
  }, [bindDetectedLevelControl, bindTransportControl, midiMonitorEnabled, triggerChannel, updateChannel]);

  useEffect(() => {
    void loadBank(defaultBankId);
  }, [loadBank]);

  useEffect(() => {
    const shouldRunSequencer = isPlaying || isPatternRecordArmed || isPatternCountIn || isPatternRecording;
    if (!shouldRunSequencer) {
      if (schedulerRef.current) {
        window.clearTimeout(schedulerRef.current);
      }
      schedulerRef.current = null;
      return;
    }

    let stopped = false;

    const tick = () => {
      const step = stepRef.current;
      const now = performance.now();
      const isArmedForPatternRecord = isPatternRecordArmedRef.current;
      let isCountingInPattern = isPatternCountInRef.current;
      let isRecordingPattern = isPatternRecordingRef.current;
      if (isArmedForPatternRecord && step === 0) {
        isPatternRecordArmedRef.current = false;
        isPatternCountInRef.current = true;
        patternCountInStepCountRef.current = 0;
        setIsPatternRecordArmed(false);
        setIsPatternCountIn(true);
        setMessage("Count-in for pattern recording");
        isCountingInPattern = true;
      }
      const isRecordMonitoring = isRecordingPattern || isCountingInPattern || isArmedForPatternRecord;
      const hasPattern = channelsRef.current.some((channel) => channel.steps.some(Boolean));

      playingStepRef.current = step;
      stepStartedAtRef.current = now;
      setCurrentStep(step);
      for (const channel of channelsRef.current) {
        if (channel.steps[step]) {
          if (engine.play(channel, 1)) {
            pulseChannel(channel.id);
          }
        }
      }

      if (isCountingInPattern) {
        engine.playMetronome(step % 4 === 0);
      } else if (isRecordMonitoring && !hasPattern) {
        engine.playMetronome(step % 4 === 0);
      }

      stepRef.current = (step + 1) % 16;
      if (isCountingInPattern) {
        patternCountInStepCountRef.current += 1;
        if (patternCountInStepCountRef.current >= 16) {
          isPatternCountInRef.current = false;
          isPatternRecordingRef.current = true;
          patternRecordStepCountRef.current = 0;
          setIsPatternCountIn(false);
          setIsPatternRecording(true);
          setMessage("Recording keyboard input for 16 steps");
        }
      }

      if (isRecordingPattern) {
        patternRecordStepCountRef.current += 1;
        if (patternRecordStepCountRef.current >= 16) {
          isPatternRecordArmedRef.current = false;
          isPatternCountInRef.current = false;
          isPatternRecordingRef.current = false;
          setIsPatternRecordArmed(false);
          setIsPatternCountIn(false);
          setIsPatternRecording(false);
          setIsPlaying(true);
          setMessage("Pattern recording complete");
        }
      }

      const baseMs = 60_000 / tempoRef.current / 4;
      const swingAmount = swingRef.current;
      const nextDelayMs = Math.max(20, baseMs * (step % 2 === 0 ? 1 + swingAmount : 1 - swingAmount));
      stepDurationMsRef.current = nextDelayMs;
      if (!stopped) {
        schedulerRef.current = window.setTimeout(tick, nextDelayMs);
      }
    };

    tick();

    return () => {
      stopped = true;
      if (schedulerRef.current) {
        window.clearTimeout(schedulerRef.current);
      }
    };
  }, [isPatternCountIn, isPatternRecordArmed, isPatternRecording, isPlaying]);

  async function toggleRecording(): Promise<void> {
    logInfo("Toggling recording", { isRecording, activeChannelId });
    try {
      await engine.resume();
      logInfo("Audio engine resumed for recording", { audioContextState: engine.audioContext.state });
    } catch (error) {
      logError("Could not resume audio engine for recording", error);
      setMessage(error instanceof Error ? error.message : "Could not start audio engine");
      return;
    }

    if (isRecording) {
      mediaRecorderRef.current?.stop();
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      logInfo("Microphone stream acquired", { trackCount: stream.getTracks().length });
    } catch (error) {
      logError("Could not acquire microphone stream", error);
      setMessage(error instanceof Error ? error.message : "Could not access microphone");
      return;
    }

    const recorder = new MediaRecorder(stream);
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };
    recorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      setIsRecording(false);
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
      try {
        logInfo("Recording stopped, decoding sample", { size: blob.size, type: blob.type });
        const sample = await engine.decode(blob, `${activeChannel.name} take`);
        updateChannel(activeChannelId, (channel) => ({ ...channel, sample }));
        logInfo("Recorded sample decoded", { duration: sample.buffer.duration, channels: sample.buffer.numberOfChannels });
        setMessage(`Recorded ${sample.name} (${sample.buffer.duration.toFixed(2)}s)`);
      } catch (error) {
        logError("Could not decode recorded sample", error);
        setMessage(error instanceof Error ? error.message : "Could not decode recording");
      }
    };
    recorder.start();
    mediaRecorderRef.current = recorder;
    setIsRecording(true);
    setMessage(`Recording into ${activeChannel.name}`);
  }

  function setSample(channelId: number, sample: Sample | null): void {
    updateChannel(channelId, (channel) => ({ ...channel, sample }));
  }

  function adjustTrim(field: "trimStart" | "trimEnd", rawValue: number): void {
    if (!activeChannel.sample) {
      return;
    }

    const sample = activeChannel.sample;
    const value = Math.max(0, Math.min(sample.buffer.duration, rawValue));
    const next = {
      ...sample,
      [field]: value
    };

    if (next.trimEnd <= next.trimStart + 0.02) {
      return;
    }

    setSample(activeChannelId, next);
  }

  function toggleStep(channelId: number, step: number): void {
    setSelectedPatternCell({ channelId, step });
    updateChannel(channelId, (channel) => ({
      ...channel,
      steps: channel.steps.map((enabled, index) => (index === step ? !enabled : enabled))
    }));
  }

  function clearPatternRow(channelId: number): void {
    setSelectedPatternCell((current) => (current?.channelId === channelId ? null : current));
    updateChannel(channelId, (channel) => ({
      ...channel,
      steps: channel.steps.map(() => false)
    }));
    setMessage(`${channelsRef.current[channelId]?.name ?? "Channel"} row cleared`);
  }

  function updateEnvelope(
    channelId: number,
    envelope: Channel["envelope"]
  ): void {
    updateChannel(channelId, (channel) => ({
      ...channel,
      envelope
    }));
  }

  function resetVolumeControlMap(): void {
    const defaults = defaultVolumeControlsAsStored();
    localStorage.setItem(volumeMapStorageKey, JSON.stringify(defaults));
    volumeControlMapRef.current = defaults;
    setChannels((current) =>
      current.map((channel, index) => ({
        ...channel,
        levelCc: defaultVolumeControlNumbers[index],
        levelControlKey: defaults[index]?.key ?? null,
        levelControlLabel: defaults[index]?.label ?? null,
        levelCcLearned: true
      }))
    );
    setMessage("Volume knob map reset to the fixed Monologue map.");
  }

  function saveTransportMap(): void {
    localStorage.setItem(
      transportMapStorageKey,
      JSON.stringify({
        swing: swingControlRef.current,
        master: masterControlRef.current
      })
    );
  }

  function resetTransportMap(): void {
    const defaults = {
      swing: defaultTransportControls.swing,
      master: defaultTransportControls.master
    };
    localStorage.setItem(transportMapStorageKey, JSON.stringify(defaults));
    swingControlRef.current = defaults.swing;
    masterControlRef.current = defaults.master;
    setSwingControl(defaults.swing);
    setMasterControl(defaults.master);
    setTransportBindTarget(null);
    setMessage("Transport knob map reset to the fixed Monologue map.");
  }

  function pulseChannel(channelId: number): void {
    setChannelHitTicks((current) => current.map((tick, index) => (index === channelId ? tick + 1 : tick)));
  }

  function startKeyLearn(): void {
    setKeyLearnIndex(0);
    setMessage("Key learn armed. Press 8 Monologue keys in order: Kick, Snare, Clap, Hat, Open Hat, Tom, Rim, Ride.");
  }

  function selectPatternChannel(channelId: number): void {
    setActiveChannelId(channelId);
    if (isPatternRecordArmedRef.current) {
      setMessage(`Selected ${channelsRef.current[channelId]?.name ?? "channel"} row. Waiting for step 1.`);
    } else if (isPatternCountInRef.current) {
      setMessage(`Selected ${channelsRef.current[channelId]?.name ?? "channel"} row. Count-in running.`);
    } else if (isPatternRecordingRef.current) {
      setMessage(`Selected ${channelsRef.current[channelId]?.name ?? "channel"} row. Recording all keyboard input.`);
    }
  }

  async function togglePatternRecording(): Promise<void> {
    if (isPatternRecordArmed || isPatternCountIn || isPatternRecording) {
      isPatternRecordArmedRef.current = false;
      isPatternCountInRef.current = false;
      isPatternRecordingRef.current = false;
      setIsPatternRecordArmed(false);
      setIsPatternCountIn(false);
      setIsPatternRecording(false);
      setMessage("Stopped pattern recording");
      return;
    }

    try {
      await engine.resume();
    } catch (error) {
      logError("Could not resume audio engine for pattern recording", error);
      setMessage(error instanceof Error ? error.message : "Could not start pattern recorder");
      return;
    }

    if (!isPlaying) {
      stepRef.current = 0;
      playingStepRef.current = 0;
      setCurrentStep(0);
    }
    patternCountInStepCountRef.current = 0;
    patternRecordStepCountRef.current = 0;
    isPatternRecordArmedRef.current = true;
    isPatternCountInRef.current = false;
    isPatternRecordingRef.current = false;
    setIsPlaying(true);
    setIsPatternRecordArmed(true);
    setIsPatternCountIn(false);
    setIsPatternRecording(false);
    setMessage("Waiting for step 1, then count-in for keyboard pattern recording");
  }

  return (
    <main className="app">
      <header className="topbar">
        <div>
          <h1>Vibe Sampler</h1>
          <p>8-channel recorder, MIDI pad map, and x0x-style sequencer</p>
        </div>
        <div className="transport">
          <label className="bank-select">
            <span>Pattern</span>
            <select value={selectedPatternId} onChange={(event) => applyPattern(event.target.value)}>
              {patternPresets.map((pattern) => (
                <option key={pattern.id} value={pattern.id}>
                  {pattern.name}
                </option>
              ))}
            </select>
          </label>
          <label className="bank-select">
            <span>Bank</span>
            <select
              value={selectedBankId}
              disabled={isBankLoading}
              onChange={(event) => void loadBank(event.target.value)}
            >
              {soundBanks.map((bank) => (
                <option key={bank.id} value={bank.id}>
                  {bank.name}
                </option>
              ))}
            </select>
          </label>
          <button className={isPlaying ? "primary active" : "primary"} onClick={() => setIsPlaying((value) => !value)}>
            {isPlaying ? <Pause size={18} /> : <Play size={18} />}
            {isPlaying ? "Stop" : "Play"}
          </button>
          <label className="tempo">
            <span>BPM</span>
            <input min="60" max="190" type="number" value={tempo} onChange={(event) => setTempo(Number(event.target.value))} />
          </label>
          <label className="tempo">
            <span>Swing</span>
            <input
              min="0"
              max="55"
              type="number"
              value={Math.round(swing * 100)}
              onChange={(event) => setSwing(Math.max(0, Math.min(55, Number(event.target.value))) / 100)}
            />
          </label>
          <label className="tempo">
            <span>Master</span>
            <input
              min="0"
              max="100"
              type="number"
              value={Math.round(masterLevel * 100)}
              onChange={(event) => setMasterLevel(Math.max(0, Math.min(100, Number(event.target.value))) / 100)}
            />
          </label>
          <div className="midi-pill">
            <Radio size={16} />
            {midiStatus.connectedInputs.length ? midiStatus.connectedInputs.join(", ") : midiStatus.supported ? "No MIDI input" : "MIDI unsupported"}
          </div>
        </div>
      </header>

      <section className="workspace">
        <aside className="channels">
          {channels.map((channel) => (
            <button
              className={channel.id === activeChannelId ? "channel selected" : "channel"}
              key={channel.id}
              onPointerDown={() => triggerChannel(channel.id, 1, true, true)}
              style={{ "--level": channel.muted ? 0 : channel.level } as React.CSSProperties}
            >
              <span className="channel-hit" key={channelHitTicks[channel.id]} />
              <span className="channel-level-fill" />
              <span className="channel-index">{channel.id + 1}</span>
              <span className="channel-name">{channel.name}</span>
              <span className="channel-note">
                {triggerKeys[channel.id].toUpperCase()} / {midiNoteName(channel.note)}
              </span>
            </button>
          ))}
        </aside>

        <section className="editor">
          <div className="panel sample-panel">
            <div className="panel-title">
              <div>
                <h2>{activeChannel.name}</h2>
                <p>{activeChannel.sample ? `${activeChannel.sample.buffer.duration.toFixed(2)}s sample` : "No sample loaded"}</p>
              </div>
              <button className={isRecording ? "danger active" : "primary"} onClick={() => void toggleRecording()}>
                {isRecording ? <Circle size={18} fill="currentColor" /> : <Mic size={18} />}
                {isRecording ? "Stop" : "Record"}
              </button>
            </div>

            <div className="waveform" aria-label="Sample waveform">
              {waveform.length ? (
                waveform.map((point, index) => (
                  <span key={index} style={{ height: `${Math.max(4, point * 100)}%` }} />
                ))
              ) : (
                <div className="empty-wave">Record from the microphone to fill this channel</div>
              )}
            </div>

            <div className="trim-row">
              <label>
                <span>Start</span>
                <input
                  type="range"
                  min="0"
                  max={activeChannel.sample?.buffer.duration || 1}
                  step="0.01"
                  value={activeChannel.sample?.trimStart || 0}
                  onChange={(event) => adjustTrim("trimStart", Number(event.target.value))}
                />
              </label>
              <label>
                <span>End</span>
                <input
                  type="range"
                  min="0"
                  max={activeChannel.sample?.buffer.duration || 1}
                  step="0.01"
                  value={activeChannel.sample?.trimEnd || 0}
                  onChange={(event) => adjustTrim("trimEnd", Number(event.target.value))}
                />
              </label>
            </div>

            <div className="envelope-panel">
              <div className="section-title">
                <h3>ADSR</h3>
                <span>Amplitude envelope</span>
              </div>
              <EnvelopeGraph
                envelope={activeChannel.envelope}
                sampleDuration={activeChannel.sample?.buffer.duration ?? 1.5}
                onChange={(envelope) => updateEnvelope(activeChannelId, envelope)}
              />
            </div>

            <div className="tool-row">
              <button onClick={() => triggerChannel(activeChannelId, 1, true)} disabled={!activeChannel.sample}>
                <Play size={16} />
                Audition
              </button>
              <button onClick={() => activeChannel.sample && setSample(activeChannelId, engine.normalize(activeChannel.sample))} disabled={!activeChannel.sample}>
                <Wand2 size={16} />
                Normalize
              </button>
              <button onClick={() => activeChannel.sample && setSample(activeChannelId, engine.reverse(activeChannel.sample))} disabled={!activeChannel.sample}>
                <RotateCcw size={16} />
                Reverse
              </button>
              <button onClick={() => setSample(activeChannelId, null)} disabled={!activeChannel.sample}>
                <Eraser size={16} />
                Clear
              </button>
            </div>
          </div>

          <div className="panel mixer-panel">
            <div className="panel-title compact">
              <h2>MIDI + Mixer</h2>
              <div className="panel-actions">
                <button onClick={startKeyLearn}>{keyLearnIndex === null ? "Learn Keys" : `Learning ${channels[keyLearnIndex].name}`}</button>
                <button onClick={resetVolumeControlMap}>Reset Volumes</button>
                <button onClick={resetTransportMap}>Reset Transport</button>
              </div>
            </div>
            <div className="transport-map">
              <span>Attack swing {swingControl === null ? "not bound" : swingControl.label}</span>
              <span>Master volume {masterControl === null ? "not bound" : masterControl.label}</span>
              <button onClick={() => setTransportBindTarget("swing")}>
                {transportBindTarget === "swing" ? "Move Attack" : "Bind Swing"}
              </button>
              <button onClick={() => setTransportBindTarget("master")}>
                {transportBindTarget === "master" ? "Move Master" : "Bind Master"}
              </button>
            </div>
            <div className="mixer-grid">
              {channels.map((channel) => (
                <div className="mixer-strip" key={channel.id}>
                  <button className="mini-play" onClick={() => triggerChannel(channel.id, 1, true)}>
                    <Play size={13} />
                  </button>
                  <strong>{channel.name}</strong>
                  <button
                    className={channel.muted ? "mute-button muted" : "mute-button"}
                    onClick={() => updateChannel(channel.id, (item) => ({ ...item, muted: !item.muted }))}
                  >
                    <MicOff size={13} />
                    {channel.muted ? "Muted" : "Mute"}
                  </button>
                </div>
              ))}
            </div>
            <div className="midi-monitor">
              <div className="monitor-head">
                <strong>Korg Monologue MIDI Monitor</strong>
                <div className="monitor-actions">
                  <button onClick={() => setMidiMonitorEnabled((enabled) => !enabled)}>
                    {midiMonitorEnabled ? "On" : "Off"}
                  </button>
                  <button onClick={() => setMidiEvents([])}>Clear</button>
                </div>
              </div>
              {!midiMonitorEnabled ? (
                <div className="monitor-empty">Monitor is paused.</div>
              ) : midiEvents.length ? (
                <div className="monitor-list">
                  {midiEvents.map((event) => (
                    <div className="monitor-event" key={event.id}>
                      <span>{event.time}</span>
                      <span>{event.inputName}</span>
                      <span>Ch {event.channel}</span>
                      <span>{event.kind}</span>
                      <strong>{event.label}</strong>
                      <span>{event.action}</span>
                      <code>{event.raw}</code>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="monitor-empty">Press a key or move a knob to see incoming MIDI.</div>
              )}
              <div className="monitor-map">
                {channels.map((channel) => (
                  <span key={channel.id}>
                    {channel.name}: {midiNoteName(channel.note)} / {midiNoteName(channel.note - 12)}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>
      </section>

      <section className="sequencer">
        <div className="sequencer-head">
          <div>
            <h2>Sequencer</h2>
            <p>
              {isPatternRecording
                ? "Recording keyboard input"
                : isPatternRecordArmed
                  ? "Waiting for step 1"
                  : isPatternCountIn
                    ? "Count-in"
                  : "16 steps across 8 audio channels"}
            </p>
          </div>
          <div className="sequencer-actions">
            <button className={isPatternRecording || isPatternRecordArmed || isPatternCountIn ? "danger active" : ""} onClick={() => void togglePatternRecording()}>
              <Circle size={16} fill={isPatternRecording || isPatternRecordArmed || isPatternCountIn ? "currentColor" : "none"} />
              {isPatternRecording ? "Stop Recording" : isPatternCountIn ? "Cancel Count-in" : isPatternRecordArmed ? "Cancel Armed" : "Record Pattern"}
            </button>
            <button onClick={() => setChannels((current) => current.map((channel) => ({ ...channel, steps: channel.steps.map(() => false) })))}>
              <Scissors size={16} />
              Clear Pattern
            </button>
          </div>
        </div>
        <div className="step-grid">
          <div className="step-labels">
            <span />
            {Array.from({ length: 16 }, (_, step) => (
              <span className={currentStep === step && (isPlaying || isPatternRecordArmed || isPatternCountIn || isPatternRecording) ? "running" : ""} key={step}>
                {step + 1}
              </span>
          ))}
        </div>
        {channels.map((channel) => (
            <div
              className={`${channel.id === activeChannelId ? "step-row selected" : "step-row"} ${
                selectedPatternCell?.channelId === channel.id ? "has-selected-cell" : ""
              }`}
              key={channel.id}
            >
              <div className="row-controls">
                <button className={channel.id === activeChannelId ? "row-name selected" : "row-name"} onClick={() => selectPatternChannel(channel.id)}>
                  {channel.name}
                </button>
                <button className="row-clear" aria-label={`Clear ${channel.name} row`} onClick={() => clearPatternRow(channel.id)}>
                  <Eraser size={13} />
                </button>
              </div>
              {channel.steps.map((enabled, step) => (
                <button
                  aria-label={`${channel.name} step ${step + 1}`}
                  className={`${enabled ? "step on" : "step"} ${(step + 1) % 4 === 1 ? "bar" : ""} ${channel.id === activeChannelId ? "selected-row" : ""} ${selectedPatternCell?.channelId === channel.id && selectedPatternCell.step === step ? "selected-cell" : ""} ${currentStep === step && (isPlaying || isPatternRecordArmed || isPatternCountIn || isPatternRecording) ? "playing" : ""}`}
                  key={step}
                  onClick={() => toggleStep(channel.id, step)}
                />
              ))}
            </div>
          ))}
        </div>
      </section>

      <footer>
        <span>{message}</span>
        <span>Space: play / stop</span>
        <span>F8: arm count-in recording</span>
        <span>Esc: stop recording</span>
        <span>Command+Up/Down: recording row</span>
        <span>Play keys: a s d f g h j k</span>
        <span>Mute keys: q w e r t y u i</span>
        <span>Attack controls swing, Master Volume controls master amplitude after binding</span>
        <span>Audio latency: {audioLatencyMs ? `${audioLatencyMs.toFixed(1)} ms` : "unknown"}</span>
      </footer>
    </main>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  logError("Could not mount React app because #root is missing");
  throw new Error("Missing #root element");
}

logInfo("Mounting React app");
const root = window.vibeSamplerRoot ?? createRoot(rootElement);
window.vibeSamplerRoot = root;
root.render(<App />);
logInfo("React app mounted");

function EnvelopeGraph({
  envelope,
  sampleDuration,
  onChange
}: {
  envelope: Channel["envelope"];
  sampleDuration: number;
  onChange: (envelope: Channel["envelope"]) => void;
}): React.JSX.Element {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const width = 1000;
  const height = 260;
  const padding = 22;
  const graphWidth = width - padding * 2;
  const graphHeight = height - padding * 2;
  const maxSeconds = Math.max(0.25, sampleDuration, getEnvelopeDuration(envelope));
  const attackTime = envelope.attack;
  const decayTime = envelope.attack + envelope.decay;
  const holdTime = envelope.attack + envelope.decay + envelope.hold;
  const releaseTime = getEnvelopeDuration(envelope);

  const points = [
    { id: "attack", label: "A", x: timeToX(attackTime), y: ampToY(envelope.peak) },
    { id: "decay", label: "D", x: timeToX(decayTime), y: ampToY(envelope.sustain) },
    { id: "sustain", label: "S", x: timeToX(holdTime), y: ampToY(envelope.sustain) },
    { id: "release", label: "R", x: timeToX(releaseTime), y: ampToY(0) }
  ] as const;

  const path = [
    `M ${padding} ${ampToY(0)}`,
    `L ${points[0].x} ${points[0].y}`,
    `L ${points[1].x} ${points[1].y}`,
    `L ${points[2].x} ${points[2].y}`,
    `L ${points[3].x} ${points[3].y}`
  ].join(" ");

  function timeToX(time: number): number {
    return padding + (time / maxSeconds) * graphWidth;
  }

  function xToTime(x: number): number {
    return ((x - padding) / graphWidth) * maxSeconds;
  }

  function ampToY(amplitude: number): number {
    return padding + (1 - amplitude) * graphHeight;
  }

  function yToAmp(y: number): number {
    return clamp(1 - (y - padding) / graphHeight, 0, 1);
  }

  function handlePointerDown(pointId: (typeof points)[number]["id"], event: React.PointerEvent<SVGCircleElement>): void {
    event.currentTarget.setPointerCapture(event.pointerId);
    updateEnvelopeFromPointer(pointId, event);
  }

  function handlePointerMove(pointId: (typeof points)[number]["id"], event: React.PointerEvent<SVGCircleElement>): void {
    if (event.buttons !== 1) {
      return;
    }
    updateEnvelopeFromPointer(pointId, event);
  }

  function updateEnvelopeFromPointer(pointId: (typeof points)[number]["id"], event: React.PointerEvent<SVGCircleElement>): void {
    const svg = svgRef.current;
    if (!svg) {
      return;
    }

    const rect = svg.getBoundingClientRect();
    const x = clamp(((event.clientX - rect.left) / rect.width) * width, padding, width - padding);
    const y = clamp(((event.clientY - rect.top) / rect.height) * height, padding, height - padding);
    const time = xToTime(x);
    const amplitude = yToAmp(y);
    const next = { ...envelope };

    if (pointId === "attack") {
      next.attack = clamp(time, 0, decayTime);
      next.peak = amplitude;
    }

    if (pointId === "decay") {
      const clampedTime = clamp(time, attackTime, holdTime);
      next.decay = clampedTime - next.attack;
      next.sustain = amplitude;
    }

    if (pointId === "sustain") {
      const clampedTime = clamp(time, decayTime, releaseTime);
      next.hold = clampedTime - next.attack - next.decay;
      next.sustain = amplitude;
    }

    if (pointId === "release") {
      const clampedTime = clamp(time, holdTime, maxSeconds);
      next.release = clampedTime - next.attack - next.decay - next.hold;
    }

    onChange(next);
  }

  return (
    <svg className="envelope-graph" ref={svgRef} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="ADSR envelope">
      <rect className="envelope-bg" x="0" y="0" width={width} height={height} rx="8" />
      <g className="envelope-grid-lines">
        {[0.25, 0.5, 0.75].map((line) => (
          <line key={`h-${line}`} x1={padding} x2={width - padding} y1={padding + graphHeight * line} y2={padding + graphHeight * line} />
        ))}
        {[0.25, 0.5, 0.75].map((line) => (
          <line key={`v-${line}`} y1={padding} y2={height - padding} x1={padding + graphWidth * line} x2={padding + graphWidth * line} />
        ))}
      </g>
      <path className="envelope-fill" d={`${path} L ${points[3].x} ${height - padding} L ${padding} ${height - padding} Z`} />
      <path className="envelope-line" d={path} />
      {points.map((point) => (
        <g key={point.id}>
          <circle
            className="envelope-dot"
            cx={point.x}
            cy={point.y}
            r="14"
            onPointerDown={(event) => handlePointerDown(point.id, event)}
            onPointerMove={(event) => handlePointerMove(point.id, event)}
          />
          <text className="envelope-dot-label" x={point.x} y={Math.max(17, point.y - 22)} textAnchor="middle">
            {point.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

function toStoredControl(key: string | null, label: string | null): StoredControl {
  if (!key) {
    return null;
  }

  return {
    key,
    label: label || key
  };
}

function normalizeStoredControls(value: unknown): StoredControl[] {
  const values = Array.isArray(value) ? value : [];
  return Array.from({ length: 8 }, (_, index) => normalizeStoredControl(values[index]));
}

function normalizeStoredControl(value: unknown): StoredControl {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number") {
    return {
      key: `cc:${value}`,
      label: `CC ${value}`
    };
  }

  if (typeof value === "string") {
    return {
      key: value,
      label: value
    };
  }

  if (typeof value === "object" && "key" in value) {
    const control = value as { key?: unknown; label?: unknown };
    if (typeof control.key === "string") {
      return {
        key: control.key,
        label: typeof control.label === "string" ? control.label : control.key
      };
    }
  }

  return null;
}

function controlCcNumber(control: StoredControl): number | null {
  if (!control?.key.startsWith("cc:")) {
    return null;
  }

  const cc = Number(control.key.slice(3));
  return Number.isFinite(cc) ? cc : null;
}

function defaultVolumeControlsAsStored(): StoredControl[] {
  return defaultVolumeControlNumbers.map((cc) => ({
    key: `cc:${cc}`,
    label: `CC ${cc}`
  }));
}

function shouldShowMidiEvent(event: MidiActivity): boolean {
  return event.label !== "Timing clock" && event.label !== "Active sensing";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
