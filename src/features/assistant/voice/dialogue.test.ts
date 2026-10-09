import { describe, expect, it } from "vitest";
import { holdsMicrophone, initialDialogue, reduceDialogue, type DialogueEvent, type DialogueState } from "./dialogue.ts";

const run = (events: DialogueEvent[], from: DialogueState = initialDialogue()) => events.reduce(reduceDialogue, from);

describe("l'automate du mode dialogue", () => {
  it("un tour complet : écoute, transcription, relecture, réflexion, parole, puis l'écoute reprend", () => {
    let state = run([{ type: "start", mode: "dialogue" }]);
    expect(state.phase).toBe("opening");
    state = run([{ type: "micReady" }, { type: "speechEnded" }], state);
    expect(state.phase).toBe("transcribing");
    state = reduceDialogue(state, { type: "transcribed", text: "  Un dépôt sauvage.  " });
    expect(state).toMatchObject({ phase: "review", heard: "Un dépôt sauvage." });
    state = run([{ type: "sent" }], state);
    expect(state).toMatchObject({ phase: "thinking", heard: null });
    state = run([{ type: "replied" }], state);
    expect(state.phase).toBe("speaking");
    state = reduceDialogue(state, { type: "spoken", cardWaiting: false, failed: false });
    expect(state.phase).toBe("opening");
  });

  // Un calendrier ou une pièce ne se remplissent pas à la voix : le micro se
  // tait jusqu'à ce que la carte, validée, relance l'assistant.
  it("⚠️ une carte arrête la boucle — et la relance de la carte la fait repartir", () => {
    let state = run([
      { type: "start", mode: "dialogue" }, { type: "micReady" }, { type: "speechEnded" },
      { type: "transcribed", text: "Mardi dernier" }, { type: "sent" }, { type: "replied" },
      { type: "spoken", cardWaiting: true, failed: false },
    ]);
    expect(state).toMatchObject({ phase: "paused", pause: "card" });
    expect(holdsMicrophone(state.phase)).toBe(false);
    state = run([{ type: "sent" }, { type: "replied" }], state);
    expect(state.phase).toBe("speaking");
  });

  it("la dictée ne boucle pas : l'assistant répond par écrit, le micro attend le geste suivant", () => {
    const state = run([
      { type: "start", mode: "dictation" }, { type: "micReady" }, { type: "speechEnded" },
      { type: "transcribed", text: "Hola" }, { type: "sent" }, { type: "replied" },
    ]);
    expect(state).toMatchObject({ phase: "paused", pause: "dictation" });
  });

  it("« Corriger » rend la main au clavier ; un silence n'envoie rien", () => {
    const base = run([{ type: "start", mode: "dialogue" }, { type: "micReady" }, { type: "speechEnded" }]);
    expect(run([{ type: "transcribed", text: "Bonjour" }, { type: "correct" }], base)).toMatchObject({
      phase: "paused", pause: "user", heard: null,
    });
    expect(reduceDialogue(base, { type: "transcribed", text: "   " })).toMatchObject({ phase: "paused", pause: "heardNothing" });
  });

  it("couper la parole à l'assistant rouvre l'écoute — semi-duplex", () => {
    const speaking = run([
      { type: "start", mode: "dialogue" }, { type: "micReady" }, { type: "speechEnded" },
      { type: "transcribed", text: "x" }, { type: "sent" }, { type: "replied" },
    ]);
    expect(reduceDialogue(speaking, { type: "interrupt" }).phase).toBe("opening");
    // Couper n'a de sens que pendant qu'il parle.
    expect(reduceDialogue({ ...speaking, phase: "listening" }, { type: "interrupt" }).phase).toBe("listening");
  });

  it("dit pourquoi il s'arrête : micro refusé, personne n'a parlé, transcription ou tour en échec", () => {
    const opening = run([{ type: "start", mode: "dialogue" }]);
    expect(reduceDialogue(opening, { type: "micFailed", denied: true }).pause).toBe("micDenied");
    expect(reduceDialogue(opening, { type: "micFailed", denied: false }).pause).toBe("micUnavailable");
    const listening = reduceDialogue(opening, { type: "micReady" });
    expect(reduceDialogue(listening, { type: "noSpeech" }).pause).toBe("noSpeech");
    expect(run([{ type: "speechEnded" }, { type: "transcribeFailed" }], listening).pause).toBe("transcribeFailed");
    expect(run([{ type: "turnFailed" }], listening).pause).toBe("turnFailed");
    // Et « Reprendre » rouvre le micro.
    expect(run([{ type: "noSpeech" }, { type: "resume" }], listening).phase).toBe("opening");
  });

  it("une voix qui n'a pas pu être jouée ne casse pas la boucle — elle se signale", () => {
    const speaking = run([
      { type: "start", mode: "dialogue" }, { type: "micReady" }, { type: "speechEnded" },
      { type: "transcribed", text: "x" }, { type: "sent" }, { type: "replied" },
    ]);
    expect(reduceDialogue(speaking, { type: "spoken", cardWaiting: false, failed: true })).toMatchObject({
      phase: "opening", speechFailed: true,
    });
  });

  it("hors du mode dialogue, rien ne bouge ; « stop » ramène toujours au texte", () => {
    expect(reduceDialogue(initialDialogue(), { type: "sent" })).toEqual(initialDialogue());
    expect(reduceDialogue(initialDialogue(), { type: "replied" })).toEqual(initialDialogue());
    const listening = run([{ type: "start", mode: "dialogue" }, { type: "micReady" }]);
    expect(reduceDialogue(listening, { type: "stop" })).toEqual(initialDialogue());
  });

  it("les événements hors de leur phase sont ignorés", () => {
    const listening = run([{ type: "start", mode: "dialogue" }, { type: "micReady" }]);
    expect(reduceDialogue(listening, { type: "transcribed", text: "x" })).toEqual(listening);
    expect(reduceDialogue(listening, { type: "replied" })).toEqual(listening);
    expect(reduceDialogue(listening, { type: "correct" })).toEqual(listening);
  });
});
