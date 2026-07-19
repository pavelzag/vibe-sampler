import type { Channel, Sample, SamplerEngine } from "./audio";

export function userBankSelectionId(bankId: string): string {
  return `user:${bankId}`;
}

export function selectedUserBankId(selectionId: string): string | null {
  return selectionId.startsWith("user:") ? selectionId.slice(5) : null;
}

export async function loadUserSoundBank(
  engine: SamplerEngine,
  bankId: string
): Promise<{ bank: UserSoundBank; samples: Array<Sample | null>; envelopes: Array<Channel["envelope"] | null> }> {
  const loaded = await window.vibeSampler.loadUserBank(bankId);
  const samples: Array<Sample | null> = Array.from({ length: 8 }, () => null);
  const envelopes: Array<Channel["envelope"] | null> = Array.from({ length: 8 }, () => null);
  await Promise.all(
    loaded.samples.map(async (entry) => {
      const blob = new Blob([entry.data as BlobPart], { type: "audio/wav" });
      samples[entry.slot] = await engine.decode(blob, entry.name, {
        detectedPitch: entry.detectedPitch,
        pitchSemitones: entry.pitchSemitones,
        trimStart: entry.trimStart,
        trimEnd: entry.trimEnd
      });
      envelopes[entry.slot] = entry.envelope ?? null;
    })
  );
  return { bank: loaded, samples, envelopes };
}

export function applyUserBankToChannels(
  channels: Channel[],
  samples: Array<Sample | null>,
  envelopes: Array<Channel["envelope"] | null> = []
): Channel[] {
  return channels.map((channel, index) => ({
    ...channel,
    sample: samples[index] ?? null,
    envelope: envelopes[index] ?? channel.envelope
  }));
}
