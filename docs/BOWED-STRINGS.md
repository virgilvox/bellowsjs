# Implementation Brief: Bowed-String Realism Upgrade for the `string` Waveguide Engine

Target file: `/Users/obsidian/Projects/ossuary-projects/bellowsjs/packages/bellows/src/engines/waveguide.ts` (class `StringVoice`, `stringParams`, `bowTable`). Presets: `/Users/obsidian/Projects/ossuary-projects/bellowsjs/packages/bellows/src/presets/instruments.ts` (ids `violin`, `viola`, `cello`, `double-bass`, `pizzicato-strings`). Tests: `/Users/obsidian/Projects/ossuary-projects/bellowsjs/packages/bellows/test/engines-physical/waveguide.test.ts`.

Four additions, in order of perceptual payoff: (A) fixed body resonator bank, (B) corrected bow table with pressure→slope mapping, (C) attack/sustain bow noise, (D) vibrato at the delay line. All new params default to "off/neutral" so existing presets and tests are unchanged.

---

## 1. Body resonator bank

**Structure.** N=7 parallel two-pole bandpass resonators, summed, mixed with a dry path. Per sample:

```
bodyOut = dryGain * x + sum_k( gain_k * R_k(x) )
y = (1 - body) * x + body * bodyOut          // 'body' = wet amount param
```

Each `R_k` is a unity-peak-gain two-pole bandpass (RBJ constant-0dB-peak BPF, or the direct resonator `y[n] = A·(x[n] − r·x[n-1]·cosθ …)`; simplest robust choice is the RBJ biquad with `ω = 2π f_k / fs`, `α = sin(ω)/(2 Q_k)`, `b = [α, 0, −α]/a0`, `a = [1, −2cosω, 1−α]/a0`, `a0 = 1+α`). Bandwidth `BW_k = f_k / Q_k`. Set `dryGain = 0.35` (prevents the hollow "talking through a tube" artifact) and a makeup gain of ~0.8 on the wet sum. Cost: 7 biquads/voice/sample: negligible. Apply per voice at the output tap, i.e. replace `const o = sIn * level` with `const o = bodyFilter(sIn) * level`; do **not** put it inside the loop (the body is a radiation filter, not a loop element). Placing it per-voice (not on a shared bus) is required so vibrato FM→AM coupling (section 4) works per note.

**Mode tables.** Frequencies in Hz, Q dimensionless, gain linear relative to B1+ = 1.0.

**Violin** (A0/CBR/B1−/B1+/mid-wood/bridge-hill/upper-BH):

| k | mode | f | Q | gain |
|---|---|---|---|---|
| 0 | A0 air | 275 | 25 | 0.70 |
| 1 | CBR | 405 | 30 | 0.30 |
| 2 | B1− | 465 | 25 | 0.90 |
| 3 | B1+ | 550 | 25 | 1.00 |
| 4 | mid wood | 1000 | 4 | 0.50 |
| 5 | bridge hill | 2300 | 2.5 | 0.80 |
| 6 | upper BH | 3500 | 3 | 0.50 |

**Viola**: not a scaled violin: body is undersized, so A0 sits at ~230 Hz (above the low-string fundamentals) and the 500 Hz–1.5 kHz band is emphasized (nasal formant). A0 gain reduced (under-radiated lows), mid formant gain raised:

| k | f | Q | gain |
|---|---|---|---|
| 0 | 230 | 25 | 0.55 |
| 1 | 340 | 25 | 0.35 |
| 2 | 375 | 22 | 0.85 |
| 3 | 460 | 22 | 1.00 |
| 4 | 800 | 3 | 0.75 |
| 5 | 1700 | 2.5 | 0.70 |
| 6 | 2800 | 3 | 0.45 |

**Cello** (A0 ≈ 105, main wood 150–220, bridge formant cluster 1.5–2.5 kHz per Reinicke sway/bend modes):

| k | f | Q | gain |
|---|---|---|---|
| 0 | 105 | 20 | 0.85 |
| 1 | 150 | 25 | 0.30 |
| 2 | 175 | 20 | 1.00 |
| 3 | 220 | 20 | 0.90 |
| 4 | 400 | 4 | 0.50 |
| 5 | 1600 | 2.5 | 0.70 |
| 6 | 2500 | 3 | 0.45 |

**Double bass** (fundamentals 41–120 Hz radiate weakly: keep A0 gain < B1, let "missing fundamental" carry pitch; growl/definition 250 Hz–1 kHz):

| k | f | Q | gain |
|---|---|---|---|
| 0 | 60 | 15 | 0.80 |
| 1 | 85 | 20 | 0.30 |
| 2 | 100 | 15 | 1.00 |
| 3 | 125 | 15 | 0.90 |
| 4 | 400 | 3 | 0.60 |
| 5 | 750 | 2 | 0.60 |
| 6 | 1400 | 2.5 | 0.35 |

**Body-size interpolation.** One param `bodySize ∈ [0,1]`, 0 = violin, 1 = bass. Interpolate per mode index k between the violin and bass anchor rows: frequencies geometrically (`f_k(s) = f_k^vln · (f_k^bass / f_k^vln)^s`), gains and Q linearly. Preset anchor values that land on the measured tables: violin `0.0`, viola `≈0.18`, cello `≈0.62`, bass `1.0`. (The viola/cello tables above are what the interpolation should approximately reproduce at those s values; if exactness matters, store all four tables and interpolate piecewise between adjacent instruments.) Recompute coefficients only when `bodySize` changes (block-rate), not per sample. Crucially the filter frequencies must NOT track the note: the fixed-formant behavior is the single biggest realism cue.

---

## 2. Bow table corrections

Current code (waveguide.ts:60–63, 194–217):

```ts
function bowTable(dv) { const t = Math.pow(Math.abs(dv) * 2.5 + 0.75, -4); return t > 1 ? 1 : t; }
...
const bowForce = 0.5 + 2 * clamp(this.bowPressure, 0, 1);
const dv = bowVel - y;
sIn += dv * bowTable(dv) * bowForce * bowAmt;
sIn = Math.tanh(sIn);
```

Three deviations from the STK/CCRMA reference, with fixes:

1. **`bowPressure` is wired to the wrong knob.** STK maps bow force to the table *slope*: `slope = 5.0 − 4.0·bowPressure` (usable range [1,5]); higher pressure → lower slope → wider stick plateau → higher break-away velocity. The current code fixes slope at 2.5 and instead multiplies the junction output by `bowForce ∈ [0.5, 2.5]`, which is a loudness/instability knob, not a friction knob: it can't produce the pressure-dependent Helmholtz/raucous transition. **Fix:** `bowTable(dv, slope)` with `slope = 5 − 4·bowPressure`; delete the post-table `bowForce` multiply (replace with a fixed junction gain ≈ 1.0–1.2).
2. **Missing offset.** STK uses `offset = 0.001` inside the abs: `t = (|dv + 0.001|·slope + 0.75)^−4, clamp ≤ 1`. It breaks left/right symmetry (bow-direction dependence) and is the DC source the existing dc blocker was built for. Add it as a constant (no param needed).
3. **`tanh(sIn)` on the whole loop signal is a band-aid** for the excess gain in (1). After fix (1) the loop no longer needs it for stability at legal params; keep it if desired as a cheap string-torsional loss surrogate but apply it only to the *injected* term, not the recirculating wave (tanh on the loop signal compresses every partial every period and dulls sustains).

Corrected junction:

```ts
const slope = 5 - 4 * clamp(this.bowPressure, 0, 1);   // slope updated when transientEnv active, see §3
const dv = bowVelInst - y;                              // bowVelInst includes noise + onset ramp
const t = Math.min(Math.pow(Math.abs(dv + 0.001) * slope + 0.75, -4), 1);
sIn += dv * t * bowAmt;
```

`bowVel = 0.05 + 0.25·bowSpeed` is close to STK's `0.03 + 0.2·amp`; keep. Add a 20 ms linear/exponential ramp on `bowVelInst` at noteOn (STK ADSR attack 0.02 s) and a ~10 ms ramp to zero at noteOff: currently bowing hard-stops at gate-off, which clicks.

**Back-compat note:** old presets set `bowPressure ≈ 0.55–0.65`, which under the old code meant "louder"; under the new mapping it means "medium-firm bow": this is the correct region for Helmholtz motion, so old presets land well, but expect a level drop from removing `bowForce`; compensate in preset `gain` if needed.

---

## 3. Noise injection

Both noises perturb the **bow side of the friction junction** (i.e. added to `bowVelInst` / equivalently to `dv` before the table), never the audio output: the nonlinearity must chew the noise so it modulates the slip pattern.

**Sustain (rosin) noise.**
- Source: white noise through a one-pole lowpass, `fc ≈ 6 kHz` (rosin hiss band; a single `y += a(x−y)` is enough).
- Injection: `bowVelInst = bowVel + nSus·noiseLP`.
- Level law: proportional to bow speed, relatively more prominent at low pressure:
  `nSus = bowNoise · bowVel · (0.05 + 0.10·(1 − bowPressure))`
  This is a few percent of the bow-velocity signal at typical settings (matches the Yamaha/Fletcher "irregularity of the frictional characteristic" practice): enough to roughen the slip timing without being audible as hiss per se; the audible bow-noise floor emerges from the junction.

**Attack bite.** Two cooperating mechanisms, both on a one-shot envelope `e(t) = exp(−t/τ)`, `τ = 30 ms`, restarted at noteOn:
- *Raised sticking (friction hysteresis fake):* temporarily raise effective force, i.e. lower slope: `slopeEff = slope · (1 − 0.35·attackBite·e(t))`. This widens the plateau at onset so the string breaks away late and produces the irregular multi-slip scratch before locking into Helmholtz.
- *Break-away noise burst:* extra noise gated into `bowVelInst`, amplitude proportional to the bow-acceleration proxy: `nAtt = attackBite · bowVel · (0.5 + bowPressure) · 0.3 · e(t)`, same LP filter (or slightly higher fc, 4–8 kHz).

Keep the existing seed noise burst in `noteOn` (waveguide.ts:143–149) unchanged: it serves plucks and bootstraps the bowed loop.

---

## 4. Vibrato

Implemented purely as delay-line length modulation; the body filter (section 1) converts the FM into correlated AM for free (Gough: 1% FM through fixed resonances ≈ 35% AM perceptually; per-partial AM up to ~100%). No explicit AM needed while `body > 0`.

- **Where:** per sample, read at `readDelay + Δ(t)` in `readCubic`; do not re-run `updateLoop()` (phase-delay compensation stays at the base frequency; the ±25-cent excursion error is inaudible).
  `Δ(t) = baseReadDelay · (2^(d(t)/1200) − 1) · sin(φ)` ≈ `baseReadDelay · d(t) · 5.78e−4 · sin(φ)`, `d(t)` in cents, `φ += 2π·rate/fs`.
- **Rate:** param `vibRate`, range 3–9 Hz, default 6.1 Hz (violin 5.5–6.3, cello ~5, bass ~4.5). Add slow drift: modulate rate ±8% and depth ±20% with a random walk (noise → one-pole LP at ~0.5 Hz). A perfectly periodic LFO reads as synthetic.
- **Depth:** param `vibDepth` in **cents (half-excursion)**, range 0–50, default 0 (off). Typical ±12–15, expressive up to ±25 (20–50 cents peak-to-peak).
- **Onset ramp:** hold depth at 0 for `vibOnset` seconds after noteOn (default 0.3 s, range 0–1), then raise with a raised-cosine ramp over ~0.3 s to full depth. Never apply vibrato inside the attack transient.

---

## 5. ParamSpec additions (append to `stringParams`; all existing seven params keep name, range, default, and: with the §2 caveat: behavior)

```ts
// existing, unchanged:
// damp, sustain, dispersion, bow, bowPressure, bowSpeed, level  (all 0..1)

// new:
{ name: 'body',       min: 0, max: 1,  default: 0 },                      // body filter wet mix
{ name: 'bodySize',   min: 0, max: 1,  default: 0 },                      // 0=violin … 1=bass, log-freq morph
{ name: 'bowNoise',   min: 0, max: 1,  default: 0 },                      // sustain rosin noise amount
{ name: 'attackBite', min: 0, max: 1,  default: 0 },                      // onset overpressure + noise burst
{ name: 'vibRate',    min: 3, max: 9,  default: 6.1, unit: 'Hz' },
{ name: 'vibDepth',   min: 0, max: 50, default: 0,   unit: 'cents' },
{ name: 'vibOnset',   min: 0, max: 1,  default: 0.3, unit: 's' },
```

Defaults of 0 for `body`, `bowNoise`, `attackBite`, `vibDepth` mean a params record from an old preset produces (near-)identical output. Handle all seven in `setParam`; `body`/`bodySize` trigger coefficient recompute; the rest are sample-rate-safe live.

---

## 6. Presets

| param | violin | viola | cello | double-bass (arco) | pizzicato-strings |
|---|---|---|---|---|---|
| damp | 0.18 | 0.28 | 0.38 | 0.50 | 0.45 |
| sustain | 0.85 | 0.85 | 0.90 | 0.90 | 0.30 |
| dispersion | 0 | 0 | 0 | 0.05 | 0 |
| bow | 0.80 | 0.80 | 0.85 | 0.85 | 0 |
| bowPressure | 0.55 | 0.60 | 0.65 | 0.70 |: |
| bowSpeed | 0.60 | 0.55 | 0.45 | 0.35 |: |
| body | 0.80 | 0.80 | 0.80 | 0.70 | 0.60 |
| bodySize | 0.00 | 0.18 | 0.62 | 1.00 | 0.30 |
| bowNoise | 0.35 | 0.35 | 0.40 | 0.45 | 0 |
| attackBite | 0.50 | 0.45 | 0.55 | 0.60 | 0 |
| vibRate | 6.1 | 5.6 | 5.0 | 4.5 | 6.1 |
| vibDepth | 14 | 13 | 12 | 8 | 0 |
| vibOnset | 0.30 | 0.30 | 0.35 | 0.40 | 0.30 |
| level | 0.8 | 0.8 | 0.8 | 0.85 | 0.9 |

Preset-record notes: cello keeps `octave: -1`, double-bass keeps `octave: -2` but changes from plucked to bowed (add the bow params above; if the plucked upright is still wanted, keep it as a separate `upright-bass` preset). `pizzicato-strings` gains body coloration but no bow/vibrato: the body filter alone will markedly improve pizz realism. Expect to trim preset `gain` (currently 0.75) after the §2 junction-gain change.

---

## 7. Offline test assertions (extend `waveguide.test.ts`; render mono at 48 kHz, analyze with FFT/Welch)

1. **Body transfer function.** Drive the body filter directly with white noise (or an impulse), 2^16-point spectrum: for each instrument's `bodySize` anchor, assert a local spectral peak within ±5% of each table `f_k` for the high-Q modes (A0, B1−, B1+) and elevated energy (≥ +6 dB over the inter-mode floor) in the bridge-hill band. Assert the peaks do **not** move when note frequency changes (render two notes an octave apart, body-on; peak bins identical within one bin).
2. **A/B body audibility.** Same bowed A4 note with `body=0` vs `body=0.8`: band energy ratio (wet/dry, normalized to total RMS) ≥ +4 dB in 500–600 Hz and 2–3 kHz for violin settings.
3. **Vibrato as f0 modulation.** 3 s violin note, `vibDepth=14`, `vibOnset=0.3`: track f0 (autocorrelation/YIN per 20 ms hop). Assert (a) first 250 ms: peak deviation < 5 cents; (b) after 0.8 s: peak-to-peak deviation in [0.7, 1.3]·(2·vibDepth) cents; (c) FFT of the f0 track has its maximum at `vibRate ± 0.3` Hz. With `vibDepth=0`, deviation < 3 cents throughout.
4. **FM→AM coupling.** Track the amplitude envelope of the partial nearest 550 Hz (violin, body on, vibrato on): its envelope spectrum shows a component at the vibrato rate with modulation depth ≥ 2 dB; with `body=0` that component drops substantially.
5. **Bow noise floor.** Sustain segment spectrum: measure median energy in inter-harmonic bins (between partials, 1–6 kHz). Assert `bowNoise=0.5` render ≥ 10 dB above the `bowNoise=0` render in those bins, and that the floor is monotonic in `bowSpeed` across {0.2, 0.5, 0.8}.
6. **Attack bite.** Spectral flatness (or aperiodicity) of the first 50 ms vs a 50 ms sustain window: with `attackBite=0.6`, attack flatness > sustain flatness by a fixed margin; with `attackBite=0`, the margin shrinks. Also assert steady Helmholtz-like sustain: sustained waveform is periodic (autocorr peak at 1/f0 > 0.9) for the four bowed presets across MIDI 55–88 (violin) / 36–72 (cello) / 28–55 (bass).
7. **Pressure→slope behavior.** At `bowPressure=0.05` (minimum-force violation) the sustain should show weak/multi-slip character (lower periodicity or lower fundamental energy) than at `bowPressure=0.55`; at `bowPressure=1.0` output remains bounded and periodic-ish (no NaN, |sample| ≤ 1): regression guard for removing `tanh`.
8. **Backward compatibility.** Render every legacy preset params record (no new keys) and assert output RMS within ±1 dB of pre-change renders and identical f0; all new params at defaults must produce no body coloration (wet path bit-silent), no noise, no vibrato.
9. **Lifecycle/stability.** noteOff during vibrato/noise decays below SILENCE and frees the voice; no denormal stalls; bowVel ramp at noteOff produces no click (max inter-sample step below threshold in the last 20 ms).
