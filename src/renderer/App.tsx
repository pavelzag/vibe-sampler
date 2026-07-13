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
import {
  Channel,
  FxParams,
  FxSendTarget,
  Sample,
  SamplerEngine,
  createChannels,
  createDefaultFxParams,
  formatFxParamValue,
  getEnvelopeDuration,
  midiNoteName
} from "./audio";
import { applyBankToChannels, defaultBankId, loadSoundBank, soundBanks } from "./banks";
import { installRendererErrorLogging, logError, logInfo, logWarn } from "./logger";
import { MidiActivity, MidiControlMessage, MidiManager, MidiStatus } from "./midi";
import { applyPatternPreset, defaultPatternId, findPatternPreset, patternPresets, patternStepCount } from "./patterns";
import { TransportScheduler } from "./transport";
import "./styles.css";

installRendererErrorLogging();

const engine = createSamplerEngine();
const muteKeys = ["q", "w", "e", "r", "t", "y", "u", "i"];
const triggerKeys = ["a", "s", "d", "f", "g", "h", "j", "k"];
const muteKeyCodes = ["KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyY", "KeyU", "KeyI"];
const triggerKeyCodes = ["KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK"];
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
const fxSendTargets: FxSendTarget[] = ["distortion", "reverb", "delay", "bitcrusher"];
const fxSendLabels: Record<FxSendTarget, string> = {
  distortion: "Dist",
  reverb: "Verb",
  delay: "Delay",
  bitcrusher: "Crush"
};
const fxOverrideCcKeys = ["cc:35", "cc:39", "cc:43"];
const midiChannelOptions = Array.from({ length: 16 }, (_, index) => index + 1);
const fxParamDefs: Record<FxSendTarget, { key: string; label: string }[]> = {
  distortion: [
    { key: "drive", label: "Drive" },
    { key: "tone", label: "Tone" },
    { key: "level", label: "Level" }
  ],
  reverb: [
    { key: "decay", label: "Decay" },
    { key: "damping", label: "Damping" },
    { key: "mix", label: "Mix" }
  ],
  delay: [
    { key: "time", label: "Time" },
    { key: "feedback", label: "Feedback" },
    { key: "mix", label: "Mix" }
  ],
  bitcrusher: [
    { key: "bits", label: "Bits" },
    { key: "rate", label: "Rate" },
    { key: "mix", label: "Mix" }
  ]
};

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
  const [selectedFxSendTarget, setSelectedFxSendTarget] = useState<FxSendTarget>("reverb");
  const [fxParams, setFxParams] = useState<FxParams>(createDefaultFxParams);
  const [fxCcOverride, setFxCcOverride] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedPatternCell, setSelectedPatternCell] = useState<{ channelId: number; step: number } | null>(null);
  const [channelHitTicks, setChannelHitTicks] = useState(() => Array.from({ length: 8 }, () => 0));
  const [audioLatencyMs, setAudioLatencyMs] = useState(0);
  const [midiMonitorEnabled, setMidiMonitorEnabled] = useState(true);
  const [midiEvents, setMidiEvents] = useState<MidiActivity[]>([]);
  const [midiInputChannel, setMidiInputChannel] = useState<number | null>(1);
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
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const midiRef = useRef<MidiManager | null>(null);
  const transportRef = useRef<TransportScheduler | null>(null);
  const recordingTouchedChannelsRef = useRef<Set<number>>(new Set());
  const playingStepRef = useRef(0);
  const tempoRef = useRef(tempo);
  const tempoUiRef = useRef(tempo);
  const lastTempoUiUpdateRef = useRef(0);
  const swingRef = useRef(swing);
  const keyLearnIndexRef = useRef<number | null>(null);
  const volumeControlMapRef = useRef<StoredControl[]>(Array.from({ length: 8 }, () => null));
  const swingControlRef = useRef<StoredControl>(defaultTransportControls.swing);
  const masterControlRef = useRef<StoredControl>(defaultTransportControls.master);
  const transportBindTargetRef = useRef<TransportBindTarget | null>(null);
  const selectedFxSendTargetRef = useRef<FxSendTarget>("reverb");
  const fxCcOverrideRef = useRef(false);
  const engineChannelMixRef = useRef(
    channels.map((channel) => ({
      level: channel.level,
      pan: channel.pan,
      fxSends: { ...channel.fxSends }
    }))
  );

  const activeChannel = channels[activeChannelId];
  const activeSampleDuration = activeChannel.sample?.buffer.duration ?? 0;
  const activeTrimDuration = activeChannel.sample
    ? Math.max(0.02, activeChannel.sample.trimEnd - activeChannel.sample.trimStart)
    : 0.02;
  const waveform = useMemo(
    () => (activeChannel.sample ? engine.renderWaveform(activeChannel.sample, 180) : []),
    [activeChannel.sample?.buffer]
  );

  useEffect(() => {
    logInfo("App component mounted");
    return () => logInfo("App component unmounted");
  }, []);

  useEffect(() => {
    channelsRef.current = channels;
    volumeControlMapRef.current = channels.map((channel) => toStoredControl(channel.levelControlKey, channel.levelControlLabel));
    channels.forEach((channel) => {
      const previous = engineChannelMixRef.current[channel.id];
      if (!previous || previous.level !== channel.level) {
        engine.setChannelLevel(channel.id, channel.level);
      }
      if (!previous || previous.pan !== channel.pan) {
        engine.setChannelPan(channel.id, channel.pan);
      }
      fxSendTargets.forEach((target) => {
        const amount = channel.fxSends?.[target] ?? 0;
        if (!previous || previous.fxSends[target] !== amount) {
          engine.setChannelFxSend(channel.id, target, amount);
        }
      });
    });
    engineChannelMixRef.current = channels.map((channel) => ({
      level: channel.level,
      pan: channel.pan,
      fxSends: { ...channel.fxSends }
    }));
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
    tempoUiRef.current = tempo;
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
    selectedFxSendTargetRef.current = selectedFxSendTarget;
  }, [selectedFxSendTarget]);

  useEffect(() => engine.setDistortionParams(fxParams.distortion), [fxParams.distortion]);
  useEffect(() => engine.setReverbParams(fxParams.reverb), [fxParams.reverb]);
  useEffect(() => engine.setDelayParams(fxParams.delay), [fxParams.delay]);
  useEffect(() => engine.setBitcrusherParams(fxParams.bitcrusher), [fxParams.bitcrusher]);

  useEffect(() => {
    keyLearnIndexRef.current = keyLearnIndex;
  }, [keyLearnIndex]);

  const updateChannel = useCallback((channelId: number, updater: (channel: Channel) => Channel) => {
    setChannels((current) => current.map((channel) => (channel.id === channelId ? updater(channel) : channel)));
  }, []);

  const updateChannelFxSend = useCallback((channelId: number, target: FxSendTarget, amount: number) => {
    const next = Math.max(0, Math.min(1, amount));
    engine.setChannelFxSend(channelId, target, next);
    updateChannel(channelId, (channel) => ({
      ...channel,
      fxSends: {
        ...channel.fxSends,
        [target]: next
      }
    }));
  }, [updateChannel]);

  const updateFxParam = useCallback((target: FxSendTarget, param: string, amount: number) => {
    const next = Math.max(0, Math.min(1, amount));
    setFxParams((current) => ({
      ...current,
      [target]: {
        ...current[target],
        [param]: next
      }
    }));
  }, []);

  const toggleFxCcOverride = useCallback(() => {
    const next = !fxCcOverrideRef.current;
    fxCcOverrideRef.current = next;
    setFxCcOverride(next);
    setMessage(
      next
        ? "CC 35 / 39 / 43 now control the selected FX parameters"
        : "CC 35 / 39 / 43 returned to their channel level assignments"
    );
  }, []);

  const bindFxParamControl = useCallback(
    (control: MidiControlMessage): string[] | null => {
      if (!fxCcOverrideRef.current) {
        return null;
      }

      const paramIndex = fxOverrideCcKeys.indexOf(control.key);
      if (paramIndex === -1) {
        return null;
      }

      const target = selectedFxSendTargetRef.current;
      const def = fxParamDefs[target][paramIndex];
      updateFxParam(target, def.key, control.value);
      const label = `${fxSendLabels[target]} ${def.label}`;
      setMessage(`${label} ${Math.round(control.value * 100)}%`);
      return [label];
    },
    [updateFxParam]
  );

  useEffect(() => {
    const transport = new TransportScheduler({
      engine,
      getChannels: () => channelsRef.current,
      getTempo: () => tempoRef.current,
      getSwing: () => swingRef.current,
      getStepCount: () => patternStepCount,
      onStep: (step) => {
        playingStepRef.current = step;
        setCurrentStep(step);
        if (transportRef.current?.getMode() === "recording" && step === 0) {
          recordingTouchedChannelsRef.current.clear();
        }
      },
      onChannelPulse: pulseChannel,
      onModeChange: (mode) => {
        isPatternRecordArmedRef.current = mode === "armed";
        isPatternCountInRef.current = mode === "countIn";
        isPatternRecordingRef.current = mode === "recording";
        setIsPlaying(mode !== "idle");
        setIsPatternRecordArmed(mode === "armed");
        setIsPatternCountIn(mode === "countIn");
        setIsPatternRecording(mode === "recording");
      },
      onMessage: setMessage
    });
    transportRef.current = transport;
    return () => {
      transport.stop();
      transportRef.current = null;
    };
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem(volumeMapStorageKey);
    if (!stored) {
      return;
    }

    try {
      const defaults = defaultVolumeControlsAsStored();
      const controls = normalizeStoredControls(JSON.parse(stored)).map((control, index) => control ?? defaults[index]);
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
      swingControlRef.current = sanitizeTransportControl(normalizeStoredControl(controls.swing), defaultTransportControls.swing);
      masterControlRef.current = sanitizeTransportControl(normalizeStoredControl(controls.master), defaultTransportControls.master);
      setSwingControl(swingControlRef.current);
      setMasterControl(masterControlRef.current);
      saveTransportMap();
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
    const transport = transportRef.current;
    if (transport?.getMode() !== "recording") {
      return;
    }

    const quantizedStep = transport?.quantizeTime(engine.audioContext.currentTime) ?? playingStepRef.current;
    transport?.suppressHit(channelId, quantizedStep);
    setSelectedPatternCell({ channelId, step: quantizedStep });
    const shouldClearChannel = !recordingTouchedChannelsRef.current.has(channelId);
    recordingTouchedChannelsRef.current.add(channelId);
    setChannels((current) =>
      current.map((channel) =>
        channel.id === channelId
          ? {
              ...channel,
              steps: channel.steps.map((enabled, step) => (step === quantizedStep ? true : shouldClearChannel ? false : enabled))
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
      if (
        event.code === "Escape" &&
        (isPatternRecordArmedRef.current || isPatternCountInRef.current || isPatternRecordingRef.current)
      ) {
        event.preventDefault();
        event.stopPropagation();
        transportRef.current?.cancelRecording();
        return;
      }

      if (event.code === "F8") {
        event.preventDefault();
        event.stopPropagation();
        if (isPatternRecordArmedRef.current || isPatternCountInRef.current || isPatternRecordingRef.current) {
          transportRef.current?.cancelRecording();
        } else {
          void engine.resume().then(() => transportRef.current?.armRecording());
        }
        return;
      }

      if (event.metaKey && (event.code === "ArrowUp" || event.code === "ArrowDown")) {
        event.preventDefault();
        event.stopPropagation();
        const direction = event.code === "ArrowUp" ? -1 : 1;
        const nextChannelId = (activeChannelIdRef.current + direction + channelsRef.current.length) % channelsRef.current.length;
        selectPatternChannel(nextChannelId);
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        event.stopPropagation();
        const transport = transportRef.current;
        if (transport?.getMode() === "idle") {
          void engine.resume().then(() => transport.play());
        } else {
          transport?.stop();
        }
        return;
      }

      if (event.code === "KeyN") {
        event.preventDefault();
        event.stopPropagation();
        toggleFxCcOverride();
        return;
      }

      const triggerChannelId = triggerKeyCodes.indexOf(event.code);
      if (triggerChannelId !== -1) {
        event.preventDefault();
        event.stopPropagation();
        triggerChannel(triggerChannelId, 1, true, true);
        recordPatternHit(triggerChannelId);
        return;
      }

      const channelId = muteKeyCodes.indexOf(event.code);
      if (channelId === -1) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      updateChannel(channelId, (channel) => ({ ...channel, muted: !channel.muted }));
    };

    window.addEventListener("keydown", handleChannelKey, { capture: true });
    return () => window.removeEventListener("keydown", handleChannelKey, { capture: true });
  }, [recordPatternHit, triggerChannel, toggleFxCcOverride]);

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

  const bindSendControl = useCallback(
    (control: MidiControlMessage): string[] => {
      const channelId = activeChannelIdRef.current;
      const target = selectedFxSendTargetRef.current;
      const next = control.value;
      updateChannelFxSend(channelId, target, next);
      const channelName = channelsRef.current[channelId]?.name ?? "channel";
      const label = fxSendLabels[target];
      setMessage(`${label} send assigned on ${channelName}`);
      return [`${label} send ${channelName}`];
    },
    [updateChannelFxSend]
  );

  const bindEnvelopeControl = useCallback(
    (control: MidiControlMessage): string[] => {
      const channelId = activeChannelIdRef.current;
      const channel = channelsRef.current[channelId];
      if (!channel?.sample) {
        return [];
      }

      const duration = channel.sample.buffer.duration;
      const value = mapEnvelopeKnobRange(control.value);
      const label = channel.name;

      if (control.key === "cc:25") {
        const attack = clamp(value * duration, 0, duration);
        updateEnvelope(channelId, {
          ...channel.envelope,
          attack
        });
        setMessage(`Attack moved on ${label}`);
        return [`Attack ${label}`];
      }

      if (control.key === "cc:26") {
        const attack = channel.envelope.attack;
        const release = clamp(attack + value * (duration - attack), 0, duration);
        updateEnvelope(channelId, {
          ...channel.envelope,
          release
        });
        setMessage(`Release moved on ${label}`);
        return [`Release ${label}`];
      }

      return [];
    },
    [updateEnvelope]
  );

  const bindTransportControl = useCallback(
    (control: MidiControlMessage): string[] => {
      const level = control.value;
      const storedControl = toStoredControl(control.key, control.label);
      const actions: string[] = [];

      const levelChannel = channelsRef.current.find((channel) => channel.levelControlKey === control.key);
      if (levelChannel) {
        if (transportBindTargetRef.current) {
          setMessage(`${control.label} is reserved for ${levelChannel.name} level.`);
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
        onSendControl: bindSendControl,
        onEnvelopeControl: bindEnvelopeControl,
        onFxParamControl: bindFxParamControl,
        onTransportControl: bindTransportControl,
        onLevelControlDetected: bindDetectedLevelControl,
        onMute: (channelId, muted) => updateChannel(channelId, (channel) => ({ ...channel, muted })),
        onLearn: () => undefined,
        onClockPulse: (timestamp) => {
          transportRef.current?.receiveExternalClock(timestamp);
        },
        onClockTempo: (clockTempo) => {
          const nextTempo = quantizeTempo(clockTempo);
          tempoRef.current = nextTempo;
          const now = performance.now();
          if (now - lastTempoUiUpdateRef.current >= 250 && Math.abs(nextTempo - tempoUiRef.current) >= 0.1) {
            lastTempoUiUpdateRef.current = now;
            tempoUiRef.current = nextTempo;
            setTempo(nextTempo);
          }
        },
        onClockStart: () => {
          engine.resumeSoon();
          transportRef.current?.startExternal();
          setMessage("Synced to external MIDI clock");
        },
        onClockContinue: () => {
          engine.resumeSoon();
          transportRef.current?.continueExternal();
          setMessage("Continuing on external MIDI clock");
        },
        onClockStop: () => {
          transportRef.current?.stop();
          setMessage("Stopped by MIDI clock");
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
    return () => {
      midi.disconnect();
      if (midiRef.current === midi) {
        midiRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    void loadBank(defaultBankId);
  }, [loadBank]);

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

  function adjustEnvelopeValue(field: "attack" | "release", rawValue: number): void {
    const minimumGap = 0.02;
    if (field === "attack") {
      const attack = clamp(rawValue, 0, Math.max(0, activeTrimDuration - minimumGap));
      updateEnvelope(activeChannelId, {
        attack,
        release: clamp(Math.max(activeChannel.envelope.release, attack + minimumGap), minimumGap, activeTrimDuration)
      });
      return;
    }

    updateEnvelope(activeChannelId, {
      ...activeChannel.envelope,
      release: clamp(rawValue, activeChannel.envelope.attack + minimumGap, activeTrimDuration)
    });
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

  function togglePlayback(): void {
    const transport = transportRef.current;
    if (!transport) {
      return;
    }

    if (transport.getMode() === "idle") {
      void engine.resume().then(() => transport.play());
    } else {
      transport.stop();
    }
  }

  async function togglePatternRecording(): Promise<void> {
    if (isPatternRecordArmed || isPatternCountIn || isPatternRecording) {
      transportRef.current?.cancelRecording();
      return;
    }

    try {
      await engine.resume();
    } catch (error) {
      logError("Could not resume audio engine for pattern recording", error);
      setMessage(error instanceof Error ? error.message : "Could not start pattern recorder");
      return;
    }

    transportRef.current?.armRecording();
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
          <button className={isPlaying ? "primary active" : "primary"} onClick={togglePlayback}>
            {isPlaying ? <Pause size={18} /> : <Play size={18} />}
            {isPlaying ? "Stop" : "Play"}
          </button>
          <label className="tempo">
            <span>BPM</span>
            <input
              min="10"
              max="600"
              step="0.5"
              type="number"
              value={tempo}
              onChange={(event) => setTempo(quantizeTempo(Number(event.target.value)))}
            />
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
          <label className="midi-channel-select">
            <span>MIDI</span>
            <select
              aria-label="MIDI input channel"
              value={midiInputChannel ?? "all"}
              onChange={(event) => {
                const channel = event.target.value === "all" ? null : Number(event.target.value);
                setMidiInputChannel(channel);
                midiRef.current?.setInputChannel(channel);
                setMessage(channel === null ? "Listening on all MIDI channels" : `Listening on MIDI channel ${channel}`);
              }}
            >
              <option value="all">All channels</option>
              {midiChannelOptions.map((channel) => (
                <option value={channel} key={channel}>
                  Channel {channel}
                </option>
              ))}
            </select>
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
              onClick={() => setActiveChannelId(channel.id)}
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

            <WaveformEditor
              sample={activeChannel.sample}
              waveform={waveform}
              envelope={activeChannel.envelope}
              onTrimChange={adjustTrim}
              onEnvelopeChange={(envelope) => updateEnvelope(activeChannelId, envelope)}
            />

            <fieldset className="sample-values" disabled={!activeChannel.sample}>
              <legend>Sample values</legend>
              <ParameterSlider
                label="Level"
                min={0}
                max={100}
                step={1}
                value={Math.round(activeChannel.level * 100)}
                format={(value) => `${Math.round(value)}%`}
                onPreview={(value) => engine.setChannelLevel(activeChannelId, value / 100)}
                onCommit={(value) =>
                  updateChannel(activeChannelId, (channel) => ({ ...channel, level: value / 100 }))
                }
              />
              <ParameterSlider
                label="Pan"
                min={-100}
                max={100}
                step={1}
                value={Math.round(activeChannel.pan * 100)}
                format={(value) => formatPan(value / 100)}
                onPreview={(value) => engine.setChannelPan(activeChannelId, value / 100)}
                onCommit={(value) =>
                  updateChannel(activeChannelId, (channel) => ({ ...channel, pan: value / 100 }))
                }
              />
              <ParameterSlider
                label="Start"
                min={0}
                max={Math.max(0, activeSampleDuration - 0.02)}
                step={0.001}
                value={activeChannel.sample?.trimStart ?? 0}
                format={(value) => `${value.toFixed(3)}s`}
                onCommit={(value) => adjustTrim("trimStart", value)}
              />
              <ParameterSlider
                label="End"
                min={0.02}
                max={Math.max(0.02, activeSampleDuration)}
                step={0.001}
                value={activeChannel.sample?.trimEnd ?? 0.02}
                format={(value) => `${value.toFixed(3)}s`}
                onCommit={(value) => adjustTrim("trimEnd", value)}
              />
              <ParameterSlider
                label="Attack"
                min={0}
                max={Math.max(0, activeTrimDuration - 0.02)}
                step={0.001}
                value={Math.min(activeChannel.envelope.attack, Math.max(0, activeTrimDuration - 0.02))}
                format={(value) => `${value.toFixed(3)}s`}
                onCommit={(value) => adjustEnvelopeValue("attack", value)}
              />
              <ParameterSlider
                label="Release"
                min={Math.min(activeTrimDuration, activeChannel.envelope.attack + 0.02)}
                max={activeTrimDuration}
                step={0.001}
                value={Math.min(activeChannel.envelope.release, activeTrimDuration)}
                format={(value) => `${value.toFixed(3)}s`}
                onCommit={(value) => adjustEnvelopeValue("release", value)}
              />
            </fieldset>

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

            <div className="fx-panel">
              <div className="section-title">
                <h3>FX Sends</h3>
                <span>
                  {fxCcOverride
                    ? `CC 35 / 39 / 43 control ${fxSendLabels[selectedFxSendTarget]} ${fxParamDefs[selectedFxSendTarget]
                        .map((def) => def.label)
                        .join(" / ")}`
                    : "CC 36 controls the selected send on the selected channel"}
                </span>
                <button
                  className={fxCcOverride ? "fx-cc-toggle active" : "fx-cc-toggle"}
                  onClick={toggleFxCcOverride}
                  type="button"
                >
                  {fxCcOverride ? "Knobs → FX (N)" : "Knobs → Levels (N)"}
                </button>
              </div>
              <div className="send-targets" role="tablist" aria-label="Selected FX send target">
                {fxSendTargets.map((target) => (
                  <button
                    key={target}
                    className={selectedFxSendTarget === target ? "selected" : ""}
                    onClick={() => setSelectedFxSendTarget(target)}
                    type="button"
                  >
                    {fxSendLabels[target]}
                  </button>
                ))}
              </div>
              <label className="fx-send-slider">
                <span>{activeChannel.name} {fxSendLabels[selectedFxSendTarget]}</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={Math.round(activeChannel.fxSends[selectedFxSendTarget] * 100)}
                  onChange={(event) =>
                    updateChannelFxSend(activeChannelId, selectedFxSendTarget, Number(event.target.value) / 100)
                  }
                />
              </label>
              <div className="fx-params">
                {fxParamDefs[selectedFxSendTarget].map((def) => {
                  const value = (fxParams[selectedFxSendTarget] as Record<string, number>)[def.key];
                  return (
                    <label className="fx-param-slider" key={def.key}>
                      <span>{def.label}</span>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        value={Math.round(value * 100)}
                        onChange={(event) =>
                          updateFxParam(selectedFxSendTarget, def.key, Number(event.target.value) / 100)
                        }
                      />
                      <em>{formatFxParamValue(selectedFxSendTarget, def.key, value)}</em>
                    </label>
                  );
                })}
              </div>
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
                  <label title={`Level ${Math.round(channel.level * 100)}%`}>
                    <span>Vol</span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      value={Math.round(channel.level * 100)}
                      onChange={(event) =>
                        updateChannel(channel.id, (item) => ({
                          ...item,
                          level: Number(event.target.value) / 100
                        }))
                      }
                    />
                  </label>
                  <label title={`Pan ${formatPan(channel.pan)}`}>
                    <span>Pan</span>
                    <input
                      type="range"
                      min="-100"
                      max="100"
                      step="1"
                      value={Math.round(channel.pan * 100)}
                      onChange={(event) =>
                        updateChannel(channel.id, (item) => ({
                          ...item,
                          pan: Number(event.target.value) / 100
                        }))
                      }
                    />
                  </label>
                  <div className="fx-sends">
                    {fxSendTargets.map((target) => (
                      <label key={target}>
                        <span>{fxSendLabels[target]}</span>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="1"
                          value={Math.round((channel.fxSends?.[target] ?? 0) * 100)}
                          onChange={(event) => updateChannelFxSend(channel.id, target, Number(event.target.value) / 100)}
                        />
                      </label>
                    ))}
                  </div>
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
                ? "Recording keyboard input until Esc"
                : isPatternRecordArmed
                  ? "Waiting for step 1"
                  : isPatternCountIn
                    ? "Count-in"
                  : "32 steps across 8 audio channels"}
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
            {Array.from({ length: patternStepCount }, (_, step) => (
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
        <span>CC 25 attack, CC 26 release, CC 36 FX sends</span>
        <span>N: toggle CC 35/39/43 between channel levels and FX parameters</span>
        <span>Attack controls swing, Master Volume controls master amplitude after binding</span>
        <span>Audio latency: {audioLatencyMs ? `${audioLatencyMs.toFixed(1)} ms` : "unknown"}</span>
      </footer>
    </main>
  );
}

const ParameterSlider = React.memo(function ParameterSlider({
  label,
  min,
  max,
  step,
  value,
  format,
  onPreview,
  onCommit
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (value: number) => string;
  onPreview?: (value: number) => void;
  onCommit: (value: number) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(value);

  useEffect(() => {
    draftRef.current = value;
    setDraft(value);
  }, [value]);

  const updateDraft = (nextValue: number) => {
    draftRef.current = nextValue;
    setDraft(nextValue);
    onPreview?.(nextValue);
  };
  const commit = () => onCommit(draftRef.current);

  return (
    <label>
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(event) => updateDraft(Number(event.target.value))}
        onPointerUp={commit}
        onPointerCancel={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <output>{format(draft)}</output>
    </label>
  );
});

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

function WaveformEditor({
  sample,
  waveform,
  envelope,
  onTrimChange,
  onEnvelopeChange
}: {
  sample: Sample | null;
  waveform: number[];
  envelope: Channel["envelope"];
  onTrimChange: (field: "trimStart" | "trimEnd", value: number) => void;
  onEnvelopeChange: (envelope: Channel["envelope"]) => void;
}): React.JSX.Element {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const width = 1000;
  const height = 300;
  const padding = 28;
  const paddingX = 0;
  const graphWidth = width - paddingX * 2;
  const graphHeight = height - padding * 2;
  const duration = sample?.buffer.duration ?? 1;
  const trimStart = sample?.trimStart ?? 0;
  const trimEnd = sample?.trimEnd ?? duration;
  const trimDuration = Math.max(0.001, trimEnd - trimStart);
  const maxSeconds = trimDuration;
  const attackTime = Math.min(envelope.attack, maxSeconds);
  const releaseTime = Math.min(Math.max(attackTime, envelope.release), maxSeconds);
  const trimStartX = timeToX(trimStart);
  const trimEndX = timeToX(trimEnd);

  const points = [
    { id: "attack", label: "A", x: envelopeTimeToX(attackTime), y: ampToY(1) },
    { id: "release", label: "R", x: envelopeTimeToX(releaseTime), y: ampToY(0) }
  ] as const;

  const path = [
    `M ${trimStartX} ${ampToY(0)}`,
    `L ${points[0].x} ${points[0].y}`,
    `L ${points[1].x} ${points[1].y}`
  ].join(" ");

  function timeToX(time: number): number {
    return paddingX + (clamp(time, 0, duration) / duration) * graphWidth;
  }

  function envelopeTimeToX(time: number): number {
    return timeToX(trimStart + clamp(time, 0, maxSeconds));
  }

  function xToTime(x: number): number {
    return clamp(((x - paddingX) / graphWidth) * duration, 0, duration);
  }

  function xToEnvelopeTime(x: number): number {
    return clamp(xToTime(x) - trimStart, 0, trimDuration);
  }

  function ampToY(amplitude: number): number {
    return padding + (1 - amplitude) * graphHeight;
  }

  function handleTrimPointerDown(field: "trimStart" | "trimEnd", event: React.PointerEvent<SVGElement>): void {
    event.currentTarget.setPointerCapture(event.pointerId);
    updateTrimFromPointer(field, event);
  }

  function handleTrimPointerMove(field: "trimStart" | "trimEnd", event: React.PointerEvent<SVGElement>): void {
    if (event.buttons !== 1) {
      return;
    }
    updateTrimFromPointer(field, event);
  }

  function updateTrimFromPointer(field: "trimStart" | "trimEnd", event: React.PointerEvent<SVGElement>): void {
    if (!sample) {
      return;
    }

    const svg = svgRef.current;
    if (!svg) {
      return;
    }

    const minGap = Math.min(0.02, sample.buffer.duration / 3);
    const time = pointerToTime(event, svg);
    const nextTime = field === "trimStart" ? clamp(time, 0, trimEnd - minGap) : clamp(time, trimStart + minGap, sample.buffer.duration);
    onTrimChange(field, nextTime);
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

    const { x } = pointerToSvgPoint(event, svg);
    const time = xToEnvelopeTime(x);
    const next = { ...envelope };

    if (pointId === "attack") {
      next.attack = clamp(time, 0, maxSeconds);
    }

    if (pointId === "release") {
      next.release = clamp(time, 0, maxSeconds);
    }

    onEnvelopeChange(next);
  }

  function pointerToSvgPoint(event: React.PointerEvent<Element>, svg: SVGSVGElement): { x: number; y: number } {
    const rect = svg.getBoundingClientRect();
    return {
      x: clamp(((event.clientX - rect.left) / rect.width) * width, paddingX, width - paddingX),
      y: clamp(((event.clientY - rect.top) / rect.height) * height, padding, height - padding)
    };
  }

  function pointerToTime(event: React.PointerEvent<Element>, svg: SVGSVGElement): number {
    return xToTime(pointerToSvgPoint(event, svg).x);
  }

  if (!sample || waveform.length === 0) {
    return (
      <div className="waveform-editor empty-wave" aria-label="Sample waveform">
        Record from the microphone to fill this channel
      </div>
    );
  }

  return (
    <svg className="waveform-editor" ref={svgRef} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Sample waveform editor">
      <rect className="waveform-bg" x="0" y="0" width={width} height={height} rx="8" />
      <g className="waveform-grid-lines">
        {[0.25, 0.5, 0.75].map((line) => (
          <line key={`h-${line}`} x1={paddingX} x2={width - paddingX} y1={padding + graphHeight * line} y2={padding + graphHeight * line} />
        ))}
        {[0.25, 0.5, 0.75].map((line) => (
          <line key={`v-${line}`} y1={padding} y2={height - padding} x1={paddingX + graphWidth * line} x2={paddingX + graphWidth * line} />
        ))}
      </g>
      <g className="waveform-bars">
        {waveform.map((point, index) => {
          const barWidth = graphWidth / waveform.length;
          const x = paddingX + index * barWidth;
          const barHeight = Math.max(4, point * graphHeight);
          const isTrimmed = x + barWidth < trimStartX || x > trimEndX;
          return (
            <rect
              className={isTrimmed ? "waveform-bar trimmed" : "waveform-bar"}
              key={index}
              x={x}
              y={padding + (graphHeight - barHeight) / 2}
              width={Math.max(1, barWidth - 2)}
              height={barHeight}
              rx="2"
            />
          );
        })}
      </g>
      <rect className="trim-region" x={trimStartX} y={padding} width={Math.max(0, trimEndX - trimStartX)} height={graphHeight} />
      <path className="envelope-fill" d={`${path} L ${points[1].x} ${height - padding} L ${trimStartX} ${height - padding} Z`} />
      <path className="envelope-line" d={path} />
      {(["trimStart", "trimEnd"] as const).map((field) => {
        const x = field === "trimStart" ? trimStartX : trimEndX;
        return (
          <g
            className="trim-handle"
            key={field}
            onPointerDown={(event) => handleTrimPointerDown(field, event)}
            onPointerMove={(event) => handleTrimPointerMove(field, event)}
          >
            <line x1={x} x2={x} y1={padding - 8} y2={height - padding + 8} />
            <rect x={x - 11} y={padding - 18} width="22" height={graphHeight + 36} rx="8" />
            <text x={clamp(x, 26, width - 26)} y={height - 8} textAnchor="middle">
              {field === "trimStart" ? "START" : "END"}
            </text>
          </g>
        );
      })}
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
          <text className="envelope-dot-label" x={clamp(point.x, 16, width - 16)} y={Math.max(17, point.y - 22)} textAnchor="middle">
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

const reservedControlKeys = new Set([
  ...defaultVolumeControlNumbers.map((cc) => `cc:${cc}`),
  "cc:25",
  "cc:26",
  "cc:36"
]);

function sanitizeTransportControl(control: StoredControl, fallback: StoredControl): StoredControl {
  if (!control || reservedControlKeys.has(control.key)) {
    return fallback;
  }
  return control;
}

function shouldShowMidiEvent(event: MidiActivity): boolean {
  return event.label !== "Timing clock" && event.label !== "Active sensing";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function quantizeTempo(value: number): number {
  return Math.round(clamp(value, 10, 600) * 2) / 2;
}

function formatPan(pan: number): string {
  const amount = Math.round(Math.abs(pan) * 100);
  return amount === 0 ? "Center" : `${pan < 0 ? "L" : "R"} ${amount}`;
}

// The Monologue's envelope knobs transmit CC values 64-127; stretch that span
// so 64 lands at the far left and 127 at the far right.
function mapEnvelopeKnobRange(value: number): number {
  return clamp((value * 127 - 64) / 63, 0, 1);
}
