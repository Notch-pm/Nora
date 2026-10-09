/**
 * Le processeur AudioWorklet du mode dialogue, EN TEXTE : il regroupe les
 * blocs de 128 échantillons du micro en trames de ~20 ms et les remet au fil
 * principal, qui mesure l'énergie (fin de parole) et garde l'enregistrement.
 *
 * ⚠️ Pourquoi une chaîne, et pas un fichier : un worklet se charge par URL.
 * Petit, un fichier serait intégré par Vite en URL `data:` — que Safari, et
 * toute politique de sécurité de contenu stricte, refusent pour un worklet.
 * Une URL `blob:` créée à la volée passe partout. Le code ne fait QUE copier
 * des échantillons : rien n'est envoyé d'ici, rien n'est gardé.
 */
export const RECORDER_PROCESSOR = "nora-recorder";

export const RECORDER_WORKLET_SOURCE = `
class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // ~20 ms à la fréquence du contexte (44,1 ou 48 kHz) : assez fin pour
    // entendre une fin de phrase, assez gros pour ne pas noyer le fil principal.
    this.frameSize = Math.round(sampleRate / 50);
    this.buffer = new Float32Array(this.frameSize);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      let offset = 0;
      while (offset < channel.length) {
        const take = Math.min(channel.length - offset, this.frameSize - this.filled);
        this.buffer.set(channel.subarray(offset, offset + take), this.filled);
        this.filled += take;
        offset += take;
        if (this.filled === this.frameSize) {
          this.port.postMessage(this.buffer);
          this.buffer = new Float32Array(this.frameSize);
          this.filled = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("nora-recorder", RecorderProcessor);
`;
