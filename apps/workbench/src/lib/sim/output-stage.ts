/*
 * Models of what each way of getting sound off a Teensy does to the audio.
 *
 * This is the part of the simulator with the most to offer and the most
 * room to mislead, so read this first.
 *
 * Every model here is a model, not a measurement. The bit depths and the
 * mono behaviour are facts from the data sheets and the audio library. The
 * filter shapes are engineering: a 12 bit converter really does sit 24 dB
 * noisier than a 16 bit one, and a piezo disc really is a high pass with a
 * resonance, but the corner of any particular disc depends on what it is
 * glued to. Every chosen number says so in `basis`, and the UI shows it.
 *
 * What this gets right is the relative difference, which is the question
 * people actually have: why does the built-in DAC hiss under a quiet tail,
 * and why does a piezo sound thin. What it does not model is the amplifier,
 * the speaker or the room.
 *
 * Built from native Web Audio nodes rather than a worklet: quantisation is
 * exactly what a WaveShaperNode does, given a staircase curve, and the rest
 * is biquads. Nothing here needs to see individual samples, so nothing here
 * asks to.
 */

export type OutputId = 'shield' | 'i2s-dac' | 'i2s-amp' | 'dac12' | 'mqs' | 'pwm' | 'piezo';

export interface OutputSpec {
  id: OutputId;
  label: string;
  example: string;
  blurb: string;
  /** Converter resolution, or null when the path is not a converter. */
  bits: number | null;
  mono: boolean;
  boards: string[];
  /** Which parts of this model are datasheet and which are chosen. */
  basis: string;
}

const ALL = ['teensy32', 'teensy35', 'teensy36', 'teensy40', 'teensy41', 'teensymm'];
const FOUR_X = ['teensy40', 'teensy41', 'teensymm'];
const THREE_X = ['teensy32', 'teensy35', 'teensy36'];

export const OUTPUTS: OutputSpec[] = [
  {
    id: 'shield',
    label: 'AUDIO SHIELD',
    example: '10_AudioShield',
    blurb: 'SGTL5000 over I2S. 16 bit stereo, headphone amp and line out.',
    bits: 16,
    mono: false,
    boards: ALL,
    basis: '16 bit is the codec spec. Modelled as otherwise transparent, which at this resolution it is.',
  },
  {
    id: 'i2s-dac',
    label: 'I2S DAC',
    example: '11_I2SAmp',
    blurb: 'PCM5102A or UDA1334A breakout. 16 bit stereo line out, nothing to configure.',
    bits: 16,
    mono: false,
    boards: ALL,
    basis: 'As the shield: at 16 bit the converter is not what you hear.',
  },
  {
    id: 'i2s-amp',
    label: 'I2S AMP, MONO',
    example: '11_I2SAmp',
    blurb: 'MAX98357A. Amplifier included, and mono: it sums left and right.',
    bits: 16,
    mono: true,
    boards: ALL,
    basis: 'Mono summing is the part default with SD_MODE unwired, from the data sheet.',
  },
  {
    id: 'dac12',
    label: '12 BIT DAC',
    example: '12_DacOut',
    blurb: 'The Teensy 3.x built-in DAC. Four bits less than a codec, and you can hear all four.',
    bits: 12,
    mono: false,
    boards: THREE_X,
    basis: '12 bit is the part spec. The audible result is the quantisation floor and nothing else.',
  },
  {
    id: 'mqs',
    label: 'MQS',
    example: '13_BareOutput',
    blurb: 'Teensy 4.x medium quality sound. Two pins and an RC filter, no converter.',
    bits: 12,
    mono: false,
    boards: FOUR_X,
    basis:
      'ESTIMATE. MQS is a noise-shaped one bit stream and has no bit depth; 12 stands in for its in-band floor. The 14 kHz corner models the RC filter.',
  },
  {
    id: 'pwm',
    label: 'PWM',
    example: '13_BareOutput',
    blurb: 'AudioOutputPWM into an RC filter. Works on every board, noisier than all of them.',
    bits: 10,
    mono: false,
    boards: ALL,
    basis: 'ESTIMATE. Roughly 10 bits of in-band resolution at the audio library rate, plus the RC corner.',
  },
  {
    id: 'piezo',
    label: 'PIEZO DISC',
    example: '15_Piezo',
    blurb: 'A disc straight off two pins. Loud, thin, and no bass at all.',
    bits: 10,
    mono: true,
    boards: ALL,
    basis:
      'ESTIMATE. The 1.2 kHz high pass and the 4 kHz resonance model a bare 27 mm disc. Mounting moves both: a disc glued to a box is lower and louder. 15_Piezo has a sweep mode for measuring a real one.',
  },
];

export const OUTPUT_BY_ID = new Map(OUTPUTS.map((o) => [o.id, o]));

/** Quantisation floor in dB below full scale, from 6.02n + 1.76. */
export function noiseFloorDb(bits: number | null): number | null {
  return bits === null ? null : -Math.round(6.02 * bits + 1.76);
}

/**
 * A staircase transfer curve for a WaveShaperNode.
 *
 * WaveShaper maps [-1, 1] across the curve array, so a curve that is itself
 * quantised to 2^bits levels quantises whatever passes through it. This is
 * the whole 12 bit DAC model, and it is exact rather than approximate: the
 * only inaccuracy is the curve's own resolution, which is why it is sampled
 * at 16384 points rather than at 2^bits.
 */
function staircase(bits: number): Float32Array<ArrayBuffer> {
  const n = 16384;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  const levels = 1 << bits;
  const step = 2 / levels;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.max(-1, Math.min(1, Math.round(x / step) * step));
  }
  return curve;
}

/**
 * The output stage as a Web Audio sub-graph.
 *
 * Call connect() once with the node carrying the dry signal and the node to
 * feed. setOutput() rebuilds the chain in place. dispose() returns the graph
 * to how it was found.
 */
export class OutputStageGraph {
  private readonly ctx: BaseAudioContext;
  private readonly input: GainNode;
  private readonly output: GainNode;
  private chain: AudioNode[] = [];
  private spec: OutputSpec;

  /* Defaults are piezo.h's Voicing defaults for a bare 27 mm brass disc. */
  private piezo = { highpassHz: 1200, resonanceHz: 4000, resonanceDb: 9 };
  private piezoNodes: { hp1: BiquadFilterNode; hp2: BiquadFilterNode; res: BiquadFilterNode } | null =
    null;

  constructor(ctx: BaseAudioContext, id: OutputId) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.spec = OUTPUT_BY_ID.get(id) as OutputSpec;
    this.build();
  }

  get inputNode(): AudioNode {
    return this.input;
  }

  get outputNode(): AudioNode {
    return this.output;
  }

  get current(): OutputSpec {
    return this.spec;
  }

  /*
   * The piezo voicing, live.
   *
   * These three are Voicing fields in 15_Piezo/piezo.h, and the firmware
   * entry has always offered them as sliders. They reached nothing: the
   * chain hard-coded 1200, 4000 and 9, and the sliders were routed at the
   * pluck engine, which has no such parameters. Now they move the filters
   * they name, which is what a reader would assume they already did.
   */
  setPiezo(v: Partial<{ highpassHz: number; resonanceHz: number; resonanceDb: number }>): void {
    Object.assign(this.piezo, v);
    const n = this.piezoNodes;
    if (!n) return;
    n.hp1.frequency.value = this.piezo.highpassHz;
    n.hp2.frequency.value = this.piezo.highpassHz;
    n.res.frequency.value = this.piezo.resonanceHz;
    n.res.gain.value = this.piezo.resonanceDb;
  }

  setOutput(id: OutputId): void {
    const next = OUTPUT_BY_ID.get(id);
    if (!next || next.id === this.spec.id) return;
    this.spec = next;
    this.build();
  }

  private build(): void {
    this.input.disconnect();
    for (const n of this.chain) n.disconnect();
    this.chain = [];

    const ctx = this.ctx;
    const nodes: AudioNode[] = [];

    if (this.spec.mono) {
      /* Sum to mono by folding the stereo pair through a merger fed from
       * one splitter output on both channels. A ChannelMergerNode with the
       * same source on both inputs is the standard way to do this without
       * a worklet. */
      const merge = ctx.createChannelMerger(2);
      const mono = ctx.createGain();
      mono.channelCount = 1;
      mono.channelCountMode = 'explicit';
      mono.channelInterpretation = 'speakers';
      nodes.push(mono, merge as unknown as AudioNode);
      /* mono -> both merger inputs, wired below in the connect pass. */
    }

    if (this.spec.id === 'piezo') {
      const hp1 = ctx.createBiquadFilter();
      hp1.type = 'highpass';
      hp1.frequency.value = this.piezo.highpassHz;
      hp1.Q.value = 0.707;
      const hp2 = ctx.createBiquadFilter();
      hp2.type = 'highpass';
      hp2.frequency.value = this.piezo.highpassHz;
      hp2.Q.value = 0.707;
      const res = ctx.createBiquadFilter();
      res.type = 'peaking';
      res.frequency.value = this.piezo.resonanceHz;
      res.Q.value = 1.2;
      res.gain.value = this.piezo.resonanceDb;
      nodes.push(hp1, hp2, res);
      this.piezoNodes = { hp1, hp2, res };
    } else if (this.spec.id === 'pwm' || this.spec.id === 'mqs') {
      const rc = ctx.createBiquadFilter();
      rc.type = 'lowpass';
      rc.frequency.value = 14000;
      rc.Q.value = 0.707;
      nodes.push(rc);
    }

    /* 16 bit sits under everything else in this chain and quantising to it
     * changes nothing anyone can hear, so it is skipped rather than faked. */
    if (this.spec.bits !== null && this.spec.bits < 16) {
      const shaper = ctx.createWaveShaper();
      shaper.curve = staircase(this.spec.bits);
      shaper.oversample = 'none'; /* quantisation must not be smoothed */
      nodes.push(shaper);
    }

    let prev: AudioNode = this.input;
    for (const n of nodes) {
      if ((n as ChannelMergerNode).numberOfInputs === 2 && n instanceof ChannelMergerNode) {
        prev.connect(n, 0, 0);
        prev.connect(n, 0, 1);
      } else {
        prev.connect(n);
      }
      prev = n;
    }
    prev.connect(this.output);
    this.chain = nodes;
  }

  dispose(): void {
    this.input.disconnect();
    for (const n of this.chain) n.disconnect();
    this.output.disconnect();
    this.chain = [];
  }
}
