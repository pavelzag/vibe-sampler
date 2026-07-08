import type { Channel, Sample, SamplerEngine } from "./audio";

type SampleModuleMap = Record<string, string>;

const tr909SampleUrls = import.meta.glob("../../samples/Roland TR-909/*.WAV", {
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
  }
];

export const defaultBankId = soundBanks[0].id;

export async function loadSoundBank(engine: SamplerEngine, bankId: string): Promise<Sample[]> {
  const bank = soundBanks.find((item) => item.id === bankId);
  if (!bank) {
    throw new Error(`Unknown sound bank: ${bankId}`);
  }

  return Promise.all(
    bank.slots.map(async (slot) => {
      const url = findSampleUrl(slot.fileName);
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Could not load ${slot.fileName}`);
      }
      const blob = await response.blob();
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

function findSampleUrl(fileName: string): string {
  const entry = Object.entries(tr909SampleUrls).find(([path]) => path.endsWith(`/${fileName}`));
  if (!entry) {
    throw new Error(`Missing bundled sample: ${fileName}`);
  }
  return entry[1];
}
