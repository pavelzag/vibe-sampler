import type { Channel, Sample, SamplerEngine } from "./audio";
import { logInfo } from "./logger";

type SampleModuleMap = Record<string, string>;

const tr909SampleUrls = import.meta.glob("../../samples/Roland TR-909/*.WAV", {
  eager: true,
  query: "?url",
  import: "default"
}) as SampleModuleMap;

const tr808SampleUrls = import.meta.glob("../../samples/Roland TR-808/**/*.{WAV,wav}", {
  eager: true,
  query: "?url",
  import: "default"
}) as SampleModuleMap;

const linnSampleUrls = import.meta.glob("../../samples/linndrum/*.{WAV,wav}", {
  eager: true,
  query: "?url",
  import: "default"
}) as SampleModuleMap;

export type BankSlot = {
  channelName: string;
  fileName: string;
  label: string;
};

export type SoundBank = {
  id: string;
  name: string;
  slots: BankSlot[];
};

export const soundBanks: SoundBank[] = [
  {
    id: "roland-tr-909",
    name: "Roland TR-909",
    slots: [
      { channelName: "Kick", fileName: "BTAAAD0.WAV", label: "909 Bass Drum" },
      { channelName: "Snare", fileName: "STATAS7.WAV", label: "909 Snare" },
      { channelName: "Clap", fileName: "HANDCLP2.WAV", label: "909 Hand Clap" },
      { channelName: "Hat", fileName: "HHCD4.WAV", label: "909 Closed Hat" },
      { channelName: "Open Hat", fileName: "HHOD6.WAV", label: "909 Open Hat" },
      { channelName: "Tom", fileName: "LT7D3.WAV", label: "909 Low Tom" },
      { channelName: "Rim", fileName: "RIM127.WAV", label: "909 Rimshot" },
      { channelName: "Ride", fileName: "RIDED6.WAV", label: "909 Ride" }
    ]
  },
  {
    id: "roland-tr-808",
    name: "Roland TR-808",
    slots: [
      { channelName: "Kick", fileName: "BD/BD5000.WAV", label: "808 Bass Drum" },
      { channelName: "Snare", fileName: "SD/SD5000.WAV", label: "808 Snare" },
      { channelName: "Clap", fileName: "CL/CL.WAV", label: "808 Clap" },
      { channelName: "Hat", fileName: "CH/CH.WAV", label: "808 Closed Hat" },
      { channelName: "Open Hat", fileName: "OH/OH50.WAV", label: "808 Open Hat" },
      { channelName: "Tom", fileName: "MT/MT50.WAV", label: "808 Mid Tom" },
      { channelName: "Rim", fileName: "RS/RS.WAV", label: "808 Rimshot" },
      { channelName: "Ride", fileName: "CY/CY5000.WAV", label: "808 Cymbal" }
    ]
  },
  {
    id: "linndrum",
    name: "LinnDrum",
    slots: [
      { channelName: "Kick", fileName: "kick.wav", label: "Linn Kick" },
      { channelName: "Snare", fileName: "sd.wav", label: "Linn Snare" },
      { channelName: "Clap", fileName: "clap.wav", label: "Linn Clap" },
      { channelName: "Hat", fileName: "chh.wav", label: "Linn Closed Hat" },
      { channelName: "Open Hat", fileName: "chhs.wav", label: "Linn Open Hat" },
      { channelName: "Tom", fileName: "tom.wav", label: "Linn Tom" },
      { channelName: "Rim", fileName: "cowb.wav", label: "Linn Cowbell" },
      { channelName: "Ride", fileName: "ride.wav", label: "Linn Ride" }
    ]
  }
];

export const defaultBankId = soundBanks[0].id;

export async function loadSoundBank(engine: SamplerEngine, bankId: string): Promise<Sample[]> {
  const bank = soundBanks.find((item) => item.id === bankId);
  if (!bank) {
    throw new Error(`Unknown sound bank: ${bankId}`);
  }

  const sampleUrls = getSampleUrls(bankId);

  logInfo("Sound bank sample manifest resolved", {
    bankId,
    availableSampleCount: Object.keys(sampleUrls).length,
    requestedSamples: bank.slots.map((slot) => slot.fileName)
  });

  return Promise.all(
    bank.slots.map(async (slot) => {
      const url = findSampleUrl(sampleUrls, slot.fileName);
      logInfo("Fetching bundled sample", { fileName: slot.fileName, url });
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Could not load ${slot.fileName}`);
      }
      const blob = await response.blob();
      logInfo("Fetched bundled sample", { fileName: slot.fileName, bytes: blob.size, type: blob.type });
      return engine.decode(blob, slot.label);
    })
  );
}

export function applyBankToChannels(channels: Channel[], bankId: string, samples: Sample[]): Channel[] {
  const bank = soundBanks.find((item) => item.id === bankId);
  if (!bank) {
    return channels;
  }

  return channels.map((channel, index) => ({
    ...channel,
    name: bank.slots[index]?.channelName ?? channel.name,
    sample: samples[index] ?? channel.sample
  }));
}

function getSampleUrls(bankId: string): SampleModuleMap {
  if (bankId === "roland-tr-808") {
    return tr808SampleUrls;
  }

  if (bankId === "linndrum") {
    return linnSampleUrls;
  }

  return tr909SampleUrls;
}

function findSampleUrl(sampleUrls: SampleModuleMap, fileName: string): string {
  const entry = Object.entries(sampleUrls).find(([path]) => path.endsWith(`/${fileName}`));
  if (!entry) {
    throw new Error(`Missing bundled sample: ${fileName}`);
  }
  return entry[1];
}
