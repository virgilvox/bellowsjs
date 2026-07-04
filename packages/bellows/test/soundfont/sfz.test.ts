import { describe, expect, it } from 'vitest';
import { parseSfz, sfzNoteValue } from '../../src/io/sfz';

describe('sfzNoteValue', () => {
  it('parses MIDI numbers and note names with c4 = 60', () => {
    expect(sfzNoteValue('60')).toBe(60);
    expect(sfzNoteValue('0')).toBe(0);
    expect(sfzNoteValue('c4')).toBe(60);
    expect(sfzNoteValue('C4')).toBe(60);
    expect(sfzNoteValue('c#4')).toBe(61);
    expect(sfzNoteValue('db4')).toBe(61);
    expect(sfzNoteValue('a4')).toBe(69);
    expect(sfzNoteValue('c-1')).toBe(0);
    expect(sfzNoteValue('g9')).toBe(127);
    expect(sfzNoteValue('h4')).toBeNull();
    expect(sfzNoteValue('c')).toBeNull();
    expect(sfzNoteValue('')).toBeNull();
  });
});

/* Modeled on the Salamander piano mapping: velocity layers per key span. */
const SALAMANDER = `
// Salamander style snippet
<control>
default_path=48khz24bit\\
<global>
ampeg_release=0.6
<group> lovel=1 hivel=26 amp_veltrack=73
<region> sample=A0v1.wav lokey=21 hikey=22 pitch_keycenter=21 tune=10
<region> sample=C1v1.wav lokey=23 hikey=25 pitch_keycenter=24
<group> lovel=27 hivel=34 amp_veltrack=73
<region> sample=A0v2.wav lokey=21 hikey=22 pitch_keycenter=21
`;

describe('parseSfz: Salamander style mapping', () => {
  it('parses regions with group and global inheritance', async () => {
    const { regions } = await parseSfz(SALAMANDER);
    expect(regions).toHaveLength(3);

    const r0 = regions[0];
    expect(r0.sample).toBe('48khz24bit/A0v1.wav');
    expect(r0.lokey).toBe(21);
    expect(r0.hikey).toBe(22);
    expect(r0.pitchKeycenter).toBe(21);
    expect(r0.lovel).toBe(1);
    expect(r0.hivel).toBe(26);
    expect(r0.ampVeltrack).toBe(73);
    expect(r0.ampeg.release).toBe(0.6);
    expect(r0.tune).toBe(10);

    const r1 = regions[1];
    expect(r1.sample).toBe('48khz24bit/C1v1.wav');
    expect(r1.tune).toBe(0);
    expect(r1.pitchKeycenter).toBe(24);

    // second group resets velocity bounds
    const r2 = regions[2];
    expect(r2.lovel).toBe(27);
    expect(r2.hivel).toBe(34);
    expect(r2.ampeg.release).toBe(0.6);
  });
});

/* Modeled on VSCO strings: round robins, note names, loop points. */
const VSCO = `
<global>
ampeg_attack=0.05 ampeg_release=1.2
<group>
seq_length=2
<region> seq_position=1 sample=Violins_sus_C4_rr1.wav lokey=58 hikey=62 pitch_keycenter=c4 loop_mode=loop_continuous loop_start=9000 loop_end=41000
<region> seq_position=2 sample=Violins_sus_C4_rr2.wav lokey=58 hikey=62 pitch_keycenter=c4 loop_mode=loop_continuous loop_start=8820 loop_end=40120
<group>
<region> lorand=0 hirand=0.5 sample=Cello_stac_C2_a.wav key=c2
<region> lorand=0.5 hirand=1 sample=Cello_stac_C2_b.wav key=c2
`;

describe('parseSfz: VSCO style mapping', () => {
  it('parses round robin and random layer opcodes', async () => {
    const { regions } = await parseSfz(VSCO);
    expect(regions).toHaveLength(4);

    expect(regions[0].seqLength).toBe(2);
    expect(regions[0].seqPosition).toBe(1);
    expect(regions[1].seqPosition).toBe(2);
    expect(regions[0].pitchKeycenter).toBe(60);
    expect(regions[0].loopMode).toBe('loop_continuous');
    expect(regions[0].loopStart).toBe(9000);
    expect(regions[0].loopEnd).toBe(41000);
    expect(regions[0].ampeg.attack).toBe(0.05);
    expect(regions[0].ampeg.release).toBe(1.2);

    // the second <group> clears seq_length back to its default
    expect(regions[2].seqLength).toBe(1);
    expect(regions[2].lorand).toBe(0);
    expect(regions[2].hirand).toBe(0.5);
    expect(regions[3].lorand).toBe(0.5);
    expect(regions[3].hirand).toBe(1);
  });

  it('expands key into lokey, hikey, and pitch_keycenter', async () => {
    const { regions } = await parseSfz(VSCO);
    const r = regions[2];
    expect(r.lokey).toBe(36);
    expect(r.hikey).toBe(36);
    expect(r.pitchKeycenter).toBe(36);
  });
});

describe('parseSfz: defaults', () => {
  it('applies spec defaults to a bare region', async () => {
    const { regions } = await parseSfz('<region> sample=a.wav');
    const r = regions[0];
    expect(r.lokey).toBe(0);
    expect(r.hikey).toBe(127);
    expect(r.pitchKeycenter).toBe(60);
    expect(r.lovel).toBe(0);
    expect(r.hivel).toBe(127);
    expect(r.loopMode).toBeNull();
    expect(r.loopStart).toBeNull();
    expect(r.loopEnd).toBeNull();
    expect(r.offset).toBe(0);
    expect(r.tune).toBe(0);
    expect(r.transpose).toBe(0);
    expect(r.volume).toBe(0);
    expect(r.pan).toBe(0);
    expect(r.ampVeltrack).toBe(100);
    expect(r.ampeg).toEqual({ delay: 0, attack: 0, hold: 0, decay: 0, sustain: 100, release: 0 });
    expect(r.seqLength).toBe(1);
    expect(r.seqPosition).toBe(1);
    expect(r.lorand).toBe(0);
    expect(r.hirand).toBe(1);
    expect(r.group).toBe(0);
    expect(r.offBy).toBe(0);
    expect(r.swLast).toBeNull();
  });

  it('lets explicit lokey/hikey override key', async () => {
    const { regions } = await parseSfz('<region> sample=a.wav key=60 lokey=58');
    expect(regions[0].lokey).toBe(58);
    expect(regions[0].hikey).toBe(60);
    expect(regions[0].pitchKeycenter).toBe(60);
  });

  it('drops regions without a sample', async () => {
    const { regions } = await parseSfz('<region> key=60\n<region> sample=b.wav');
    expect(regions).toHaveLength(1);
    expect(regions[0].sample).toBe('b.wav');
  });
});

describe('parseSfz: hierarchy', () => {
  const FIXTURE = `
<global> volume=-6 pan=0 tune=0
<master> pan=-30
<group> tune=5 volume=-3
<region> sample=a.wav
<region> sample=b.wav volume=0
<master>
<region> sample=c.wav
`;

  it('merges control-global-master-group-region, region-most wins', async () => {
    const { regions } = await parseSfz(FIXTURE);
    expect(regions).toHaveLength(3);
    expect(regions[0].volume).toBe(-3); // group over global
    expect(regions[0].pan).toBe(-30); // master over global
    expect(regions[0].tune).toBe(5);
    expect(regions[1].volume).toBe(0); // region over group
  });

  it('resets master and group scopes at a new master header', async () => {
    const { regions } = await parseSfz(FIXTURE);
    expect(regions[2].volume).toBe(-6); // back to global
    expect(regions[2].pan).toBe(0);
    expect(regions[2].tune).toBe(0);
  });

  it('resets everything below global at a new global header', async () => {
    const { regions } = await parseSfz(`
<global> volume=-6
<group> pan=10
<region> sample=a.wav
<global> volume=-1
<region> sample=b.wav
`);
    expect(regions[0].volume).toBe(-6);
    expect(regions[0].pan).toBe(10);
    expect(regions[1].volume).toBe(-1);
    expect(regions[1].pan).toBe(0);
  });
});

describe('parseSfz: voice muting groups', () => {
  it('parses group and off_by (closed hat chokes open hat)', async () => {
    const { regions } = await parseSfz(`
<region> sample=hat_open.wav key=46 group=1 off_by=2 loop_mode=one_shot
<region> sample=hat_closed.wav key=42 group=2
`);
    expect(regions[0].group).toBe(1);
    expect(regions[0].offBy).toBe(2);
    expect(regions[0].loopMode).toBe('one_shot');
    expect(regions[1].group).toBe(2);
    expect(regions[1].offBy).toBe(0);
  });
});

describe('parseSfz: keyswitches', () => {
  it('parses sw_ opcodes into region fields', async () => {
    const { regions } = await parseSfz(`
<group> sw_lokey=24 sw_hikey=35 sw_last=26 sw_default=24 sw_down=c2 sw_up=d2
<region> sample=sus.wav key=60
`);
    const r = regions[0];
    expect(r.swLokey).toBe(24);
    expect(r.swHikey).toBe(35);
    expect(r.swLast).toBe(26);
    expect(r.swDefault).toBe(24);
    expect(r.swDown).toBe(36);
    expect(r.swUp).toBe(38);
  });
});

describe('parseSfz: includes and defines', () => {
  it('resolves #include through the caller resolver', async () => {
    const files: Record<string, string> = {
      'control.sfz': '<control> default_path=Samples/',
      'regions.sfz': '<region> sample=kick.wav key=36\n<region> sample=snare.wav key=38',
    };
    const main = '#include "control.sfz"\n<group> group=7\n#include "regions.sfz"';
    const { regions } = await parseSfz(main, { resolveInclude: (p) => files[p] });
    expect(regions).toHaveLength(2);
    expect(regions[0].sample).toBe('Samples/kick.wav');
    expect(regions[0].group).toBe(7); // group scope survives across the include
    expect(regions[1].sample).toBe('Samples/snare.wav');
  });

  it('supports async resolvers and nested includes', async () => {
    const files: Record<string, string> = {
      'a.sfz': '#include "b.sfz"',
      'b.sfz': '<region> sample=deep.wav key=40',
    };
    const { regions } = await parseSfz('#include "a.sfz"', {
      resolveInclude: (p) => Promise.resolve(files[p]),
    });
    expect(regions[0].sample).toBe('deep.wav');
    expect(regions[0].lokey).toBe(40);
  });

  it('throws when #include appears with no resolver', async () => {
    await expect(parseSfz('#include "x.sfz"')).rejects.toThrow(/no resolver/);
  });

  it('throws on unbounded include recursion', async () => {
    await expect(
      parseSfz('#include "loop.sfz"', { resolveInclude: () => '#include "loop.sfz"' }),
    ).rejects.toThrow(/nesting too deep/);
  });

  it('substitutes #define variables', async () => {
    const { regions } = await parseSfz(`
#define $KICKKEY 36
#define $VOL -3
<region> sample=kick.wav key=$KICKKEY volume=$VOL
`);
    expect(regions[0].lokey).toBe(36);
    expect(regions[0].volume).toBe(-3);
  });

  it('prefers the longest matching define name', async () => {
    const { regions } = await parseSfz(`
#define $N 1
#define $NN 2
<region> sample=a.wav group=$NN off_by=$N
`);
    expect(regions[0].group).toBe(2);
    expect(regions[0].offBy).toBe(1);
  });
});

describe('parseSfz: lexical details', () => {
  it('keeps spaces inside sample paths', async () => {
    const { regions } = await parseSfz('<region> sample=Grand Piano C4.wav key=60 volume=-3');
    expect(regions[0].sample).toBe('Grand Piano C4.wav');
    expect(regions[0].volume).toBe(-3);
  });

  it('handles opcodes split across lines and // comments', async () => {
    const { regions } = await parseSfz(`
<region> // a region
sample=a.wav // the sample
key=60
`);
    expect(regions[0].sample).toBe('a.wav');
    expect(regions[0].lokey).toBe(60);
  });

  it('normalizes backslashes in paths', async () => {
    const { regions } = await parseSfz(
      '<control> default_path=Kit\\Close\\\n<region> sample=snare\\v1.wav key=38',
    );
    expect(regions[0].sample).toBe('Kit/Close/snare/v1.wav');
  });

  it('accepts v1 aliases loopmode/loopstart/loopend', async () => {
    const { regions } = await parseSfz(
      '<region> sample=a.wav loopmode=loop_sustain loopstart=5 loopend=99',
    );
    expect(regions[0].loopMode).toBe('loop_sustain');
    expect(regions[0].loopStart).toBe(5);
    expect(regions[0].loopEnd).toBe(99);
  });

  it('ignores curve and effect header contents', async () => {
    const { regions } = await parseSfz(`
<region> sample=a.wav
<effect> type=reverb dsp_order=1
<curve> curve_index=17 v000=0 v127=1
<region> sample=b.wav
`);
    expect(regions).toHaveLength(2);
    expect(regions[1].other).toEqual({});
  });

  it('keeps unknown opcodes verbatim in other', async () => {
    const { regions } = await parseSfz('<region> sample=a.wav cutoff=1200 fil_type=lpf_2p');
    expect(regions[0].other).toEqual({ cutoff: '1200', fil_type: 'lpf_2p' });
  });

  it('rejects malformed numeric and note values', async () => {
    await expect(parseSfz('<region> sample=a.wav volume=loud')).rejects.toThrow(/volume/);
    await expect(parseSfz('<region> sample=a.wav lokey=q9')).rejects.toThrow(/lokey/);
    await expect(parseSfz('<region> sample=a.wav loop_mode=sideways')).rejects.toThrow(
      /loop_mode/,
    );
  });
});
