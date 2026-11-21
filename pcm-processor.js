// AudioWorkletProcessor: แปลงเสียงไมโครโฟนเป็น 16kHz 16-bit PCM (little-endian)
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetRate = 16000;
    this.buffer = [];
    this.chunkSamples = 1600; // 100ms @ 16kHz
    this.resamplePos = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) return true;

    const channelData = input[0];
    const ratio = sampleRate / this.targetRate;

    if (Math.abs(ratio - 1) < 0.001) {
      for (let i = 0; i < channelData.length; i++) this.buffer.push(channelData[i]);
    } else {
      while (this.resamplePos < channelData.length) {
        const idx = Math.floor(this.resamplePos);
        const frac = this.resamplePos - idx;
        const s0 = channelData[idx];
        const s1 = idx + 1 < channelData.length ? channelData[idx + 1] : s0;
        this.buffer.push(s0 + (s1 - s0) * frac);
        this.resamplePos += ratio;
      }
      this.resamplePos -= channelData.length;
    }

    while (this.buffer.length >= this.chunkSamples) {
      const slice = this.buffer.splice(0, this.chunkSamples);
      const pcm16 = new Int16Array(slice.length);
      for (let i = 0; i < slice.length; i++) {
        const clamped = Math.max(-1, Math.min(1, slice[i]));
        pcm16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      }
      this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
    }

    return true;
  }
}

registerProcessor("pcm-processor", PCMProcessor);
