import { describe, expect, it } from "vitest";
import { closedAssistant } from "./assistant.ts";
import {
  encodeWav,
  isExpectedRecording,
  MAX_RECORDING_BYTES,
  MAX_RECORDING_SECONDS,
  readWav,
  RECORDING_SAMPLE_RATE,
  voiceModeFor,
} from "./voice.ts";

const open = { enabled: true, depositEnabled: false, voiceEnabled: true };

describe("voiceModeFor — ce que la voix permet, et dans quelle langue", () => {
  it("dialogue en français et en anglais, régionaux compris", () => {
    for (const lang of ["fr", "fr-CA", "en", "EN-gb"]) expect(voiceModeFor(open, lang)).toBe("dialogue");
  });

  // Le fournisseur transcrit ces langues mais n'a pas de voix pour elles : une
  // voix française les lirait avec l'accent, ou en charabia.
  it("dictée seule là où la transcription existe sans voix", () => {
    for (const lang of ["es", "de", "it", "pt", "ar", "ru", "zh"]) expect(voiceModeFor(open, lang)).toBe("dictation");
  });

  it("texte seul en turc et en ukrainien, que la transcription refuse", () => {
    expect(voiceModeFor(open, "tr")).toBe("off");
    expect(voiceModeFor(open, "uk")).toBe("off");
  });

  it("⚠️ au doute, rien : voix fermée, ou assistant fermé", () => {
    expect(voiceModeFor({ ...open, voiceEnabled: false }, "fr")).toBe("off");
    expect(voiceModeFor(closedAssistant(), "fr")).toBe("off");
  });
});

describe("WAV — le format unique du portail", () => {
  it("écrit puis relit un enregistrement, durée comprise", () => {
    const wav = encodeWav(new Float32Array(RECORDING_SAMPLE_RATE * 3));
    const info = readWav(wav);
    expect(info).toEqual({ sampleRate: RECORDING_SAMPLE_RATE, channels: 1, bitsPerSample: 16, seconds: 3 });
    expect(isExpectedRecording(info)).toBe(true);
  });

  it("borne la taille d'un enregistrement maximal", () => {
    expect(encodeWav(new Float32Array(RECORDING_SAMPLE_RATE * MAX_RECORDING_SECONDS)).length).toBe(MAX_RECORDING_BYTES);
  });

  it("écrête les échantillons hors de −1…1", () => {
    const wav = encodeWav(new Float32Array([2, -2, 0.5]));
    const view = new DataView(wav.buffer);
    expect([view.getInt16(44, true), view.getInt16(46, true)]).toEqual([0x7fff, -0x8000]);
  });

  it("refuse ce qui n'est pas le format attendu", () => {
    expect(readWav(new Uint8Array(44))).toBe(null);
    expect(isExpectedRecording(readWav(encodeWav(new Float32Array(44_100), 44_100)))).toBe(false);
    expect(isExpectedRecording(readWav(encodeWav(new Float32Array(0))))).toBe(false);
    expect(isExpectedRecording(readWav(encodeWav(new Float32Array(RECORDING_SAMPLE_RATE * (MAX_RECORDING_SECONDS + 1)))))).toBe(false);
    // Un WAV en flottants (format 3) n'est pas du PCM entier.
    const float = encodeWav(new Float32Array(16));
    new DataView(float.buffer).setUint16(20, 3, true);
    expect(readWav(float)).toBe(null);
  });
});

describe("downsample — de la fréquence du micro à 16 kHz", () => {
  it("garde la durée, et moyenne ce qu'il recouvre", async () => {
    const { downsample } = await import("./voice.ts");
    const second48k = new Float32Array(48_000).fill(0.5);
    const out = downsample(second48k, 48_000);
    expect(out.length).toBe(16_000);
    expect(out[0]).toBeCloseTo(0.5, 6);
    expect(downsample(new Float32Array(44_100), 44_100).length).toBe(16_000);
    // Une alternance très aiguë (au-delà de ce que 16 kHz peut porter) s'éteint
    // au lieu de se replier en un son parasite.
    const aigu = Float32Array.from({ length: 48 }, (_, i) => (i % 2 === 0 ? 1 : -1));
    expect(Math.max(...downsample(aigu, 48_000).map(Math.abs))).toBeLessThan(0.34);
  });

  it("refuse de « remonter » une fréquence", async () => {
    const { downsample } = await import("./voice.ts");
    expect(() => downsample(new Float32Array(10), 8_000)).toThrow();
    expect(downsample(new Float32Array([0.1, 0.2]), 16_000)).toEqual(new Float32Array([0.1, 0.2]));
  });
});
