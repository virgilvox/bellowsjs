/*
 * Value parity for bellows/presets/instruments.h.
 *
 * A preset table is 50 rows of hand-transcribed floats with no runtime
 * consequence a test can hear: get one wrong and the instrument plays,
 * confidently, in slightly the wrong voice, on a board with no way to
 * compare it to the browser. So this dumps the whole table as JSON and
 * presets.mjs diffs it against packages/bellows/src/presets/instruments.ts.
 *
 * Every value goes through ApplyPreset into a mirror of the destination
 * Params rather than being read out of the table, which is deliberate.
 * The table is only half the transcription: the other half is which field
 * each column lands in, and dumping the table would check the numbers
 * while leaving a swapped pair of assignments in ApplyPreset invisible.
 * It also puts the additive zero-fill under the check, because that
 * happens in ApplyPreset and nowhere else.
 *
 * The mirrors are local structs, not the engines' own Params, for the
 * reason instruments.h includes no engine: what is under test is a header
 * that must stay engine-free, and a dumper that pulls in eleven engines to
 * read it proves less about it, not more. The field NAMES still have to
 * match, because ApplyPreset assigns by name, so a rename in an engine
 * that instruments.h did not follow is caught at the sketch, which is
 * where the compiler can say so. Each mirror is seeded with a poison value
 * so a field ApplyPreset forgets to write shows up as poison in the diff
 * rather than as a plausible zero.
 *
 * tapeDelay has no ApplyPreset (the port has no tape delay, see the header
 * comment in instruments.h), so its three surviving params are read out of
 * the table directly. It is the one row here that is not applied.
 */
#include <stdio.h>

#include "bellows/presets/instruments.h"

using namespace bellows;

namespace {

/* Nothing in a preset is anywhere near this, and it survives a float
 * round trip exactly, so an unwritten field reads as -12345 in the diff. */
constexpr float kPoison = -12345.0f;

void F(const char* name, float v, bool last = false) {
  printf("\"%s\":%.9g%s", name, static_cast<double>(v), last ? "" : ",");
}

/* One mirror per engine: the fields ApplyPreset writes, under the names it
 * writes them by. A field an engine has and no preset names is absent
 * here on purpose, the same way it is absent from the preset struct. */

struct PluckDst {
  float damp = kPoison, pick_pos = kPoison, excite_type = kPoison, decay = kPoison,
        level = kPoison;
};

struct ModalDst {
  float material = kPoison, decay = kPoison, brightness = kPoison, strike_hardness = kPoison,
        level = kPoison;
};

struct VaDst {
  float shape = kPoison, detune = kPoison, sub = kPoison, cutoff = kPoison, resonance = kPoison,
        filter_type = kPoison, env_amount = kPoison, attack = kPoison, decay = kPoison,
        sustain = kPoison, release = kPoison, f_attack = kPoison, f_decay = kPoison,
        f_sustain = kPoison, f_release = kPoison, drift = kPoison;
};

/* Six operators, so the dump shows what ApplyPreset leaves alone at the
 * top of the array as well as what it writes at the bottom. */
struct FmDst {
  float ops = kPoison, algorithm = kPoison, feedback = kPoison, brightness = kPoison,
        attack = kPoison, decay = kPoison, sustain = kPoison, release = kPoison,
        m_attack = kPoison, m_decay = kPoison, m_sustain = kPoison, m_release = kPoison;
  float ratio[6] = {kPoison, kPoison, kPoison, kPoison, kPoison, kPoison};
  float level[6] = {kPoison, kPoison, kPoison, kPoison, kPoison, kPoison};
};

struct TubeDst {
  float breath = kPoison, noise = kPoison, level = kPoison, glide = kPoison,
        legato_scratch = kPoison;
};

struct FormantDst {
  float vowel = kPoison, breath = kPoison, vibrato_rate = kPoison, vibrato_depth = kPoison,
        shape = kPoison, level = kPoison;
};

struct WestCoastDst {
  float fold_amount = kPoison, fold_stages = kPoison, fold_env = kPoison, lpg_color = kPoison,
        lpg_decay = kPoison, level = kPoison;
};

struct StringDst {
  float damp = kPoison, sustain = kPoison, dispersion = kPoison, bow = kPoison,
        bow_pressure = kPoison, bow_speed = kPoison, level = kPoison, body = kPoison,
        body_size = kPoison, bow_noise = kPoison, attack_bite = kPoison, vib_rate = kPoison,
        vib_depth = kPoison, vib_onset = kPoison, bow_pos = kPoison, dynamics = kPoison,
        pol_detune = kPoison, glide = kPoison, legato_scratch = kPoison;
};

struct HarmonicDst {
  float brightness = kPoison, even_odd = kPoison, formant_shift = kPoison, noise_mix = kPoison,
        noise_color = kPoison, portamento = kPoison, attack = kPoison, release = kPoison,
        level = kPoison;
};

/* 32 partials, which is Additive<>'s default, so the zero-fill past the
 * table's twelve is dumped and compared rather than trusted. */
constexpr int kDstPartials = 32;

struct AdditiveDst {
  float inharm = kPoison, decay = kPoison, rolloff = kPoison, attack = kPoison, release = kPoison,
        gain = kPoison;
  float partial[kDstPartials];
  float target[kDstPartials];
  AdditiveDst() {
    for (int i = 0; i < kDstPartials; ++i) {
      partial[i] = kPoison;
      target[i] = kPoison;
    }
  }
};

struct WavetableDst {
  float position = kPoison, scan_rate = kPoison, scan_depth = kPoison, env_to_position = kPoison,
        attack = kPoison, decay = kPoison, sustain = kPoison, release = kPoison, filter = kPoison,
        cutoff = kPoison, resonance = kPoison;
};

struct ChorusDst {
  float rate = kPoison, depth = kPoison, mix = kPoison, feedback = kPoison;
};

struct TremoloDst {
  float rate = kPoison, depth = kPoison;
};

struct PlateDst {
  float decay = kPoison, predelay = kPoison, mix = kPoison;
};

void DumpParams(const InstrumentPreset& p) {
  if (const auto* d = PluckParamsOf(p)) {
    PluckDst v;
    ApplyPreset(*d, &v);
    F("damp", v.damp);
    F("pick_pos", v.pick_pos);
    F("excite_type", v.excite_type);
    F("decay", v.decay);
    F("level", v.level, true);
  } else if (const auto* d = ModalParamsOf(p)) {
    ModalDst v;
    ApplyPreset(*d, &v);
    F("material", v.material);
    F("decay", v.decay);
    F("brightness", v.brightness);
    F("strike_hardness", v.strike_hardness);
    F("level", v.level, true);
  } else if (const auto* d = VaParamsOf(p)) {
    VaDst v;
    ApplyPreset(*d, &v);
    F("shape", v.shape);
    F("detune", v.detune);
    F("sub", v.sub);
    F("cutoff", v.cutoff);
    F("resonance", v.resonance);
    F("filter_type", v.filter_type);
    F("env_amount", v.env_amount);
    F("attack", v.attack);
    F("decay", v.decay);
    F("sustain", v.sustain);
    F("release", v.release);
    F("f_attack", v.f_attack);
    F("f_decay", v.f_decay);
    F("f_sustain", v.f_sustain);
    F("f_release", v.f_release);
    F("drift", v.drift, true);
  } else if (const auto* d = FmParamsOf(p)) {
    FmDst v;
    ApplyPreset(*d, &v);
    F("ops", v.ops);
    F("algorithm", v.algorithm);
    F("feedback", v.feedback);
    F("brightness", v.brightness);
    F("attack", v.attack);
    F("decay", v.decay);
    F("sustain", v.sustain);
    F("release", v.release);
    F("m_attack", v.m_attack);
    F("m_decay", v.m_decay);
    F("m_sustain", v.m_sustain);
    F("m_release", v.m_release);
    /* Only the four operators the table carries. Five and six are left at
     * the engine default by design, so they are poison here and the diff
     * has nothing to say about them. */
    for (int k = 0; k < kFmPresetOps; ++k) {
      char n[16];
      snprintf(n, sizeof(n), "ratio[%d]", k);
      F(n, v.ratio[k]);
      snprintf(n, sizeof(n), "level[%d]", k);
      F(n, v.level[k], k == kFmPresetOps - 1);
    }
  } else if (const auto* d = TubeParamsOf(p)) {
    TubeDst v;
    ApplyPreset(*d, &v);
    F("breath", v.breath);
    F("noise", v.noise);
    F("level", v.level);
    F("glide", v.glide);
    F("legato_scratch", v.legato_scratch, true);
  } else if (const auto* d = FormantParamsOf(p)) {
    FormantDst v;
    ApplyPreset(*d, &v);
    F("vowel", v.vowel);
    F("breath", v.breath);
    F("vibrato_rate", v.vibrato_rate);
    F("vibrato_depth", v.vibrato_depth);
    F("shape", v.shape);
    F("level", v.level, true);
  } else if (const auto* d = WestCoastParamsOf(p)) {
    WestCoastDst v;
    ApplyPreset(*d, &v);
    F("fold_amount", v.fold_amount);
    F("fold_stages", v.fold_stages);
    F("fold_env", v.fold_env);
    F("lpg_color", v.lpg_color);
    F("lpg_decay", v.lpg_decay);
    F("level", v.level, true);
  } else if (const auto* d = StringParamsOf(p)) {
    StringDst v;
    ApplyPreset(*d, &v);
    F("damp", v.damp);
    F("sustain", v.sustain);
    F("dispersion", v.dispersion);
    F("bow", v.bow);
    F("bow_pressure", v.bow_pressure);
    F("bow_speed", v.bow_speed);
    F("level", v.level);
    F("body", v.body);
    F("body_size", v.body_size);
    F("bow_noise", v.bow_noise);
    F("attack_bite", v.attack_bite);
    F("vib_rate", v.vib_rate);
    F("vib_depth", v.vib_depth);
    F("vib_onset", v.vib_onset);
    F("bow_pos", v.bow_pos);
    F("dynamics", v.dynamics);
    F("pol_detune", v.pol_detune);
    F("glide", v.glide);
    F("legato_scratch", v.legato_scratch, true);
  } else if (const auto* d = HarmonicParamsOf(p)) {
    HarmonicDst v;
    ApplyPreset(*d, &v);
    F("brightness", v.brightness);
    F("even_odd", v.even_odd);
    F("formant_shift", v.formant_shift);
    F("noise_mix", v.noise_mix);
    F("noise_color", v.noise_color);
    F("portamento", v.portamento);
    F("attack", v.attack);
    F("release", v.release);
    F("level", v.level, true);
  } else if (const auto* d = AdditiveParamsOf(p)) {
    AdditiveDst v;
    ApplyPreset(*d, &v);
    F("inharm", v.inharm);
    F("decay", v.decay);
    F("rolloff", v.rolloff);
    F("attack", v.attack);
    F("release", v.release);
    F("gain", v.gain);
    for (int k = 0; k < kDstPartials; ++k) {
      char n[16];
      snprintf(n, sizeof(n), "partial[%d]", k);
      F(n, v.partial[k]);
      snprintf(n, sizeof(n), "target[%d]", k);
      F(n, v.target[k], k == kDstPartials - 1);
    }
  } else if (const auto* d = WavetableParamsOf(p)) {
    WavetableDst v;
    ApplyPreset(*d, &v);
    F("position", v.position);
    F("scan_rate", v.scan_rate);
    F("scan_depth", v.scan_depth);
    F("env_to_position", v.env_to_position);
    F("attack", v.attack);
    F("decay", v.decay);
    F("sustain", v.sustain);
    F("release", v.release);
    F("filter", v.filter);
    F("cutoff", v.cutoff);
    F("resonance", v.resonance, true);
  }
}

void DumpFx(const InstrumentPreset& p) {
  if (const auto* c = ChorusParamsOf(p)) {
    ChorusDst v;
    ApplyPreset(*c, &v);
    printf("{\"effectId\":\"chorus\",\"params\":{");
    F("rate", v.rate);
    F("depth", v.depth);
    F("mix", v.mix);
    F("feedback", v.feedback, true);
    printf("}}");
  } else if (const auto* t = TremoloParamsOf(p)) {
    TremoloDst v;
    ApplyPreset(*t, &v);
    printf("{\"effectId\":\"tremolo\",\"params\":{");
    F("rate", v.rate);
    F("depth", v.depth, true);
    printf("}}");
  } else if (const auto* t = PlateParamsOf(p)) {
    PlateDst v;
    ApplyPreset(*t, &v);
    printf("{\"effectId\":\"plate\",\"params\":{");
    F("decay", v.decay);
    F("predelay", v.predelay);
    F("mix", v.mix, true);
    printf("}}");
  } else if (const auto* t = TapeDelayParamsOf(p)) {
    /* No ApplyPreset for this one, on purpose. Read straight from the
     * table, which is all a caller can do with it either. */
    printf("{\"effectId\":\"tapeDelay\",\"params\":{");
    F("time", t->time);
    F("feedback", t->feedback);
    F("mix", t->mix, true);
    printf("}}");
  } else {
    printf("null");
  }
}

}  // namespace

int main() {
  printf("[\n");
  for (int i = 0; i < kInstrumentPresetCount; ++i) {
    const InstrumentPreset& p = kInstrumentPresets[i];
    printf("{\"id\":\"%s\",\"label\":\"%s\",\"family\":\"%s\",\"engine\":\"%s\",", p.id, p.label,
           FamilyName(p.family), PresetEngineName(p.engine));
    printf("\"gain\":%.9g,\"octave\":%d,\"params\":{", static_cast<double>(p.gain), p.octave);
    DumpParams(p);
    printf("},\"fx\":");
    DumpFx(p);
    printf("}%s\n", i == kInstrumentPresetCount - 1 ? "" : ",");
  }
  printf("]\n");
  return 0;
}
