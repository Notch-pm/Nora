import { describe, expect, it } from "vitest";
import { createEndpointer, rms, type EndpointEvent } from "./endpointer.ts";

const FRAME = 20;

/** Joue une suite de (niveau, durée) et rend les événements, avec l'instant où ils tombent. */
function play(segments: Array<[level: number, ms: number]>, options = {}) {
  const endpointer = createEndpointer({ frameMs: FRAME, ...options });
  const events: Array<[EndpointEvent, number]> = [];
  let t = 0;
  for (const [level, ms] of segments) {
    for (let i = 0; i < ms / FRAME; i++) {
      t += FRAME;
      const event = endpointer.push(level);
      if (event !== "none") events.push([event, t]);
    }
  }
  return events;
}

describe("rms", () => {
  it("mesure l'énergie d'une trame", () => {
    expect(rms(new Float32Array([0, 0]))).toBe(0);
    expect(rms(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5, 6);
    expect(rms(new Float32Array(0))).toBe(0);
  });
});

describe("createEndpointer — quand l'usager a fini de parler", () => {
  it("une phrase, puis le silence : début, puis fin après 1,2 s de silence", () => {
    const events = play([[0.002, 1000], [0.2, 2000], [0.002, 2000]]);
    expect(events.map(([e]) => e)).toEqual(["speechStart", "speechEnd"]);
    expect(events[1][1]).toBe(3000 + 1200);
  });

  // Une pause pour respirer, ou pour chercher un mot, n'est pas la fin.
  it("une pause courte au milieu de la phrase ne la clôt pas", () => {
    const events = play([[0.2, 1000], [0.002, 600], [0.2, 1000], [0.002, 1500]]);
    expect(events.map(([e]) => e)).toEqual(["speechStart", "speechEnd"]);
  });

  it("un claquement de porte n'est pas une phrase", () => {
    const events = play([[0.002, 500], [0.6, 100], [0.002, 9000]]);
    expect(events.map(([e]) => e)).toEqual(["noSpeech"]);
  });

  it("personne ne parle : il rend la main au bout de 8 s", () => {
    expect(play([[0.001, 10_000]])).toEqual([["noSpeech", 8000]]);
  });

  // Le plancher suit l'ambiance : dans une rue bruyante, le bruit seul ne
  // déclenche rien, mais une voix au-dessus, si.
  it("le seuil suit le bruit ambiant", () => {
    const noisy = play([[0.03, 3000], [0.2, 1000], [0.03, 2000]]);
    expect(noisy.map(([e]) => e)).toEqual(["speechStart", "speechEnd"]);
  });

  it("borne une prise de parole à 30 s", () => {
    const events = play([[0.2, 35_000]]);
    expect(events.map(([e]) => e)).toEqual(["speechStart", "maxLength"]);
  });

  it("ne dit plus rien une fois la prise de parole close", () => {
    const endpointer = createEndpointer({ frameMs: FRAME, noSpeechMs: 400 });
    const events = Array.from({ length: 20 }, () => endpointer.push(0));
    expect(events.filter((e) => e !== "none")).toEqual(["noSpeech"]);
    expect(endpointer.push(0.5)).toBe("none");
  });

  // Un usager qui parle dès l'ouverture du micro ne doit pas devenir le
  // « bruit ambiant » de l'étalonnage.
  it("entend un usager qui parle dès l'ouverture du micro", () => {
    const events = play([[0.2, 2000], [0.002, 2000]]);
    expect(events.map(([e]) => e)).toEqual(["speechStart", "speechEnd"]);
  });
});
