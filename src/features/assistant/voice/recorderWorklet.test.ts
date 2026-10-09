import { describe, expect, it } from "vitest";
import { RECORDER_PROCESSOR, RECORDER_WORKLET_SOURCE } from "./recorderWorklet.ts";

/**
 * Le processeur est du TEXTE, exécuté par le navigateur dans le contexte d'un
 * worklet : ni le typage ni le build ne le vérifient. On l'exécute donc ici,
 * dans un contexte de worklet simulé.
 */
function load(sampleRate: number) {
  const posted: Float32Array[] = [];
  let registered: { name: string; Processor: new () => { process(inputs: Float32Array[][]): boolean } } | null = null;
  class AudioWorkletProcessor {
    port = { postMessage: (frame: Float32Array) => posted.push(frame) };
  }
  new Function("AudioWorkletProcessor", "sampleRate", "registerProcessor", RECORDER_WORKLET_SOURCE)(
    AudioWorkletProcessor,
    sampleRate,
    (name: string, Processor: never) => (registered = { name, Processor }),
  );
  return { posted, registered: registered! };
}

describe("le processeur du micro", () => {
  it("s'enregistre sous le nom attendu", () => {
    expect(load(48_000).registered.name).toBe(RECORDER_PROCESSOR);
  });

  it("regroupe les blocs de 128 échantillons en trames de 20 ms, sans en perdre un", () => {
    const { posted, registered } = load(48_000);
    const processor = new registered.Processor();
    for (let block = 0; block < 30; block++) {
      const samples = Float32Array.from({ length: 128 }, (_, i) => block * 128 + i);
      expect(processor.process([[samples]])).toBe(true);
    }
    // 30 × 128 = 3 840 échantillons → 4 trames de 960 (20 ms à 48 kHz).
    expect(posted.map((frame) => frame.length)).toEqual([960, 960, 960, 960]);
    expect(posted[1][0]).toBe(960);
    expect(posted[3][959]).toBe(3839);
  });

  it("ignore un bloc sans canal (micro pas encore branché)", () => {
    const { posted, registered } = load(44_100);
    const processor = new registered.Processor();
    expect(processor.process([[]])).toBe(true);
    expect(processor.process([])).toBe(true);
    expect(posted).toEqual([]);
  });
});
