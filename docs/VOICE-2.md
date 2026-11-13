# The second bellows voice: an articulatory tract that runs anywhere

Status: design, 2026-11-12. Nothing here is built yet except the scratch prototype that phase 0
names. Every number is labelled MEASURED, SOURCED or INFERRED in the sense `docs/LANDSCAPE.md` uses.

## Why a second voice

The first `vocal` engine (docs/VOICE.md) is a Klatt-style formant synthesizer. On first listen the
owner's verdict was that it sounds like a robotic text-to-speech voice and is hard to understand,
and that CHIMERA sounds natural. That verdict is the measurement that matters, and it agrees with
the literature: a formant synthesizer is only as natural as its hand-tuned targets and
transitions, and those took Klatt's lab years. CHIMERA gets naturalness from physics: an area
function that moves, noise born where the air is fast, a nose that couples in at the velum, and a
glottis that feels the tract. It pays for it with a full aerodynamic FDTD solve, about 32 percent
of an M1 core per voice (MEASURED, VOICE.md), which no microcontroller can run.

The aim is a voice that keeps CHIMERA's physics where the ear hears it, and replaces the parts
that are expensive with cheaper but equivalent mathematics. It should also be more portable than
either engine.

## Five ideas, each of which is established, and together are new here

**1. The tube is a lattice filter, so it is stable by construction.** A tract of N equal sections
of length c / (2 fs) is exactly a Kelly-Lochbaum scattering network, which is the all-pole lattice
of linear prediction with reflection coefficients k_i = (A_i - A_(i+1)) / (A_i + A_(i+1))
(SOURCED: J. O. Smith, Physical Audio Signal Processing, Kelly-Lochbaum junctions; Bilbao's notes on
the lattice form). A lattice is stable if and only if every |k| < 1 (SOURCED, same). For any
positive areas that holds automatically, so no posture, no interpolation between postures, and
no glitch in a control stream can make the voice blow up. Closures clamp to a small positive
area instead of zero. The formant engine had no such guarantee: its first audit found an
overshoot that took F1 to 2.9 kHz and the output to 8.0.

**2. Run the tube at the rate its physics needs, not the output rate.** Everything the tract
shapes that the ear tracks as vowel quality lives under about 5 kHz. A 17.5 cm tract at an
internal 24 kHz is about 24 sections (INFERRED: N = 2 L fs / c), against about 49 at 48 kHz, and
each section costs half as many samples per second, so the tube costs roughly a quarter. A
polyphase halfband upsampler lifts it to the output rate. What lives above the internal band,
the 6 to 16 kHz hiss of /s/ and /ʃ/ and the air in a breathy vowel, is synthesized directly at
the output rate from the constriction's own state (its position, area and flow), which is the
band CHIMERA is measured to have and the formant engine lacks (VOICE.md, open gaps). A first-order
allpass at the lips makes the length continuous, so `body` scales smoothly from child to giant
instead of stepping by sections.

**3. Aerodynamics as a three-state ODE at control rate, not a field solve.** The audible results
of airflow are: pressure builds behind a closure, then a burst, then aspiration; the voice bar
decays during a voiced closure as the mouth fills; frication is loud only above a flow
threshold; and glottal flow depends on the pressure the tract presents. All of these follow from
a lumped model with subglottal pressure, intraoral pressure and the flows through the glottis
and the narrowest constriction, integrated at about 1 to 2 kHz (INFERRED from the time constants,
which are tens of milliseconds). That model drives the noise sources (Reynolds-number scaled, at
the constriction, as CHIMERA and Pink Trombone place them) and the glottal driving pressure. The
glottal source ported from CHIMERA already computes flow from area with an inertive orifice
(src/dsp/glottal.ts); feeding it the tract's input pressure is what turns it into source-tract
interaction. This is the piece that makes stops and fricatives come out of the physics instead
of out of a table, and it costs a few dozen operations per control period.

**4. A posture is a handful of numbers, not 44 areas.** Story's parametric model builds any vowel
from a neutral tract plus two principal-component modes, with consonant constrictions laid on
top as valving functions, and every parameter can move in time, which is where coarticulation
comes from (SOURCED: Story 2005, JASA 117(5)). The mode shapes are close across speakers while
the mean shape is speaker specific (SOURCED: Story's later multi-speaker work), which is exactly the
`body` parameter. CHIMERA already has a calibrated midsagittal model whose articulators (jaw,
tongue body, tip, lips, velum) map to an area function by geometry (SOURCED: crates/chimera/src
/anatomy/human.rs). bellows samples that mapping offline, per body, and keeps only its modes and
the per-phoneme coordinates in that space: a posture becomes about 8 numbers, the whole inventory
a couple of kilobytes, and moving between sounds is moving a point, so transitions are smooth
and physically plausible by construction. Overlapping gestures (the tongue heading for the next
vowel during a /b/) fall out of moving the articulators on separate timelines, which is
CHIMERA's gestural score idea, kept and made cheap.

**5. One arithmetic, bit-exact on every machine.** The tract, the noise and the source run in
32-bit integer fixed point: reflection coefficients in Q14 or Q15 (always inside (-1, 1), which
is what makes fixed point safe here), states in Q-format with headroom, multiplies through
`Math.imul` in TypeScript and plain int32 in C++. Integer arithmetic is identical in V8, on
x86, on ARM and on RISC-V, so the browser and the embedded build produce the same samples, and the
parity gate becomes equality instead of a tolerance (the float prototype of the first voice
needed 2e-4 to 2.4e-3, VOICE.md decision 6). It also runs at full speed on parts with no FPU: the
ESP32-C3 and the RP2040, where the formant engine measured at 214 percent of a frame and CHIMERA
cannot run at all. If fixed point costs measurable quality anywhere, the fallback is float32
with every TypeScript operation wrapped in `Math.fround` and C++ built without FMA contraction,
which is also bit-exact (an IEEE double result rounded to float is the correctly rounded float
result for + - * / and sqrt), on FPU parts only.

## What it should cost (INFERRED, to be replaced by measurement)

Per output sample at 48 kHz: tract 24 junctions at half rate, nose about 12, glottis, losses and
radiation, the upsampler and the high band. Roughly 120 to 150 integer operations per output
sample, against roughly 300 or more for the formant engine (81 ns a sample, MEASURED) and far
more for CHIMERA. On a Teensy 4.x that is on the order of 1 to 2 percent of the core per voice; on
an ESP32-C3 at 160 MHz with single-cycle integer multiply, on the order of 5 to 10 percent per
voice at 24 kHz output. Memory: about 2 KB of posture tables, and well under 1 KB of state per
voice (two delay lines of 24 and one of 12, plus the ODE).

## Calibration, offline, with gradients

The runtime is small because the knowledge is in the tables. They are fitted offline, in a
script that never ships: a differentiable copy of the same tract (the approach of Südholt et al.,
"Vocal Tract Area Estimation by Gradient Descent", DAFx 2023, SOURCED) is optimized so that each
posture's response matches CHIMERA's frequency-domain solver (airway/frequency.rs, exact for its
geometry) and, where available, recordings. The fit is a build step like gen-tables; the output
is a generated table with its provenance, credited to CHIMERA under its MIT notice.

## Phase 0, measured (2026-11-12)

A scratch prototype (a Kelly-Lochbaum tract with nasal branch, frequency-dependent radiation,
yielding walls every fourth junction, CHIMERA's three noise sources and Reynolds law, the ported
glottal source, a one-cavity pressure estimate) was driven two ways: by CHIMERA's own exported
telemetry, and by the bellows planner over CHIMERA's calibrated postures. All MEASURED against
CHIMERA unless marked.

| | Male vowels, F1/F2/F3 RMS error | Twinkle, median ΔF1/ΔF2 Hz (male) |
|---|---|---|
| current `vocal` (formant) | 4.7 / 9.5 / 7.2 % | 22 / 44 |
| tract, CHIMERA's tracks, 48 kHz | 2.2 / 3.1 / 3.4 % | 8 / 40 |
| tract, bellows plan, 48 kHz | 4.5 / 4.6 / 3.7 % | 14 / 47 |
| tract, CHIMERA's tracks, 24 kHz | 6.3 / 3.9 / 3.7 % (F1 5 % low) | 21 / 34 |

- Band energies are within 1.5 to 3 dB RMS of CHIMERA across six bands; the formant engine has
  essentially nothing above 8 kHz in vowels.
- Without yielding walls F1 comes out 11 percent low; the wall shunt is what fixes it.
- Not yet close: fricative spectral centroids (/s/ 7.7 against 5.6 kHz, /ʃ/ from the planner 9.1
  against 5.4), F2 and F3 bandwidths about twice CHIMERA's, 2 to 4 kHz about 3 to 4 dB low,
  closures silent (no voice bar).
- Cost: about 30 times cheaper than CHIMERA native in the same runs, roughly 1 percent of an M1
  core per voice on a quiet machine (INFERRED from a loaded-machine ratio), about 2 times the
  formant engine. Operation count about 480 per sample at 48 kHz, 190 at 24 kHz (INFERRED).

Two predictions above were wrong and are corrected here. The 24 kHz configuration saves less in
JavaScript than the arithmetic suggested (1.2 times the formant engine all in, because the
upsampler and the top band cost what the half-rate tube saves) and biases F1 low, so the browser
runs the tract at the output rate and 24 kHz is the microcontroller configuration. And int32
fixed point is not free: Q14 coefficients with Q11 waves fail (4 to 34 dB under the signal), Q15
with Q24 waves reach -52 to -60 dB against float but need 64-bit products and run 3.4 times
slower than float in JavaScript. So the browser runs float, the C++ port runs float on FPU parts
with the usual parity tolerance, and the integer core is a variant for parts without an FPU
(ESP32-C3, RP2040), checked against the float one.

## What the waveforms showed (2026-11-12)

After phase 0 the owner's verdict was that CHIMERA still sounds better, the tract renders are
closer but not right, and only CHIMERA gets /l/ right. Looking at the renders side by side
(scratch `insight/`: spectrograms, single glottal cycles, f0 and intensity contours, spectral
slices, LPC formants, voice quality numbers, all loudness-matched), MEASURED:

1. **The tube is not what is missing.** Driven by CHIMERA's own articulation, the tract's vowel
   spectra overlay CHIMERA's within a few dB from 0 to 8 kHz, its glottal cycles look the same,
   H1-H2, H1-A1, spectral tilt and HNR agree within 1 to 3 dB, and its /l/ has CHIMERA's formants
   (422 / 1488 / 2941 Hz against 410 / 1395 / 2953) and level dip (-2.6 against -2.5 dB). The /ɹ/
   low F3 is there in both (about 2 kHz; an LPC peak pick had mislabelled it). Resampling
   CHIMERA's area functions onto the grid moves resonances by under 2 percent (a chain-matrix
   check on raw and gridded profiles).
2. **The control is.** Driven by the bellows plan (whole per-phoneme area functions blended and
   tracked), the same tract misses /l/ entirely (F1 680 Hz, no level dip, no high-band loss),
   forms a /ɹ/ without CHIMERA's deep 4 to 5.5 kHz trough and with extra peaks, and makes every
   consonant short and weak. CHIMERA moves 17 independent articulators, each with its own speed,
   and a consonant holds only the articulators it dominates (the tongue tip and lateral channel
   for /l/) while the tongue body keeps following the vowels. Its transitions are curved and
   overlapping; blending whole area functions is a crossfade, which is what sounds synthetic.
3. **Two English sound rules were never ported.** CHIMERA's spoken front end velarizes a coda
   /l/ to ɫ and flaps /t d/ between a vowel and an unstressed vowel
   (crates/chimera/src/phonetics/english.rs:268-292). Its sung path does not apply them (its
   renders from English lyrics and from IPA are byte-identical, MEASURED in round 2), so the
   rules are a choice for bellows: on by default for American English, off for classical
   diction, now built as src/lyrics/allophones.ts. The bellows port reads one word at a time,
   so these phrase-level rules were not carried over, and the engine's phoneme table aliases ɫ
   to l, so even a dark l from the spelling rules sounds light.
4. **Fricative noise is 15 to 18 dB too weak and too high.** The /s/ of "star": CHIMERA -19 dB
   against its vowel with its centroid at 4.75 kHz; the tract -34 to -37 dB at 6.8 to 10 kHz.
5. **Some anatomy is absent**: the trachea below the glottis, the piriform fossae, the maxillary
   sinus and sound radiated through the walls (human_airway.rs:85-122). Steady vowels already
   match without them, but closures are silent where CHIMERA keeps a voice bar.

So the design changes in one place: idea 4 becomes control in articulator space, not posture
space. A voice keeps CHIMERA's 17 articulators in a critically damped bank (the speeds from
control/articulators.rs), a phoneme sets targets only on the articulators it dominates, the last
vowel's targets stay on the rest (carryover coarticulation), and the facade can post the next
vowel early (anticipation). A cheap map fitted offline from a CHIMERA corpus turns articulators
into log-area modes plus explicit contacts. The bank is 17 channels at control rate and the map
a few hundred multiply-adds per control frame, so it costs nothing next to the tube.

## Round 2, articulator control, measured (2026-11-12)

The bellows plan driving CHIMERA's 17 articulators (dominance, carryover and anticipation,
CHIMERA's speeds and contacts) through the fitted map, with the trachea, piriform fossa, wall
radiation, the lumped airflow and frication calibrated on jet areas. MEASURED, male:

| | CHIMERA | articulators (c) | area blending (b) |
|---|---|---|---|
| /l/ F1 / F2 / F3 Hz | 422 / 1413 / 2911 | 415 / 1341 / 2918 | 622 / 1742 / 2671 |
| /l/ level dip | -2.8 dB | -3.0 dB | +0.1 dB |
| /ɹ/ F3 | 2048 Hz | 1997 Hz | 2434 Hz |
| "star" /s/ level, centroid | -18.5 dB, 4.81 kHz | same, +2 % | +11 dB, -32 % |
| voice bar /b d g/ re vowel | -14.5 / -29 / -21.5 dB | -16.6 / -19.6 / -26.7 dB | none |

Still off: /ʃ/ (16.6 dB weak) and /θ/ (centroid 32 % low). Cost all in, 3.5 percent of an M1
core per voice with the map every 64 samples, about 1/6 to 1/8 of CHIMERA native in the same
runs; the map every 128 samples moves formants by 0 Hz median. The voice bar needed CHIMERA's
wall area scaled six times, a fit rather than physics.

## Beyond CHIMERA: prior art, and what to take from it (2026-11-12)

CHIMERA is a speech synthesizer calibrated on speech, with a parametric glottis that outputs an
area waveform. The literature points at five places a singing voice can go further, roughly in
order of what each buys for its cost. SOURCED unless marked.

1. **Pitch that moves like a singer's.** Saitou, Unoki and Akagi model sung F0 as the score's step
   melody plus four components: overshoot after a note change and preparation before it (second
   order damped systems), vibrato (a second order oscillator) and fine fluctuation above 10 Hz
   (filtered noise). In their listening tests every component affected perceived quality and
   overshoot affected it most (Speech Communication 2005). bellows' `bend` is critically damped,
   so it never overshoots; CHIMERA's glide is the same. This is the cheapest large change on the
   list: a few multiply-adds per control step. Microprosody (F0 dips on voiced obstruents, rises
   after voiceless ones) is barely audible on its own but raised naturalness in some cases in
   Krug et al. (SSW 2021).
2. **A glottis that oscillates instead of one that is drawn.** Articulatory-synthesis studies keep
   finding that naturalness depends largely on the voice source model (Birkholz's group, VTL
   publications), and that what listeners judge is the combined spectrum of source and radiation,
   not the realism of either. Low-order self-oscillating fold models exist that are cheap enough:
   Birkholz's triangular-glottis two-mass model, which makes opening and closing more gradual as
   the folds abduct and gives six voice qualities from one model, and triangular body-cover models
   driven by the intrinsic laryngeal muscles (Galindo et al.; arXiv 2108.01115) following Titze and
   Story's control rules. A self-oscillating source makes onsets, offsets, register changes and
   the breathy-to-pressed continuum emerge, and makes source-tract interaction real, which Titze
   showed grows when the epilarynx narrows. INFERRED cost: tens to about a hundred operations a
   sample, the same order as the parametric source.
3. **Resonance strategies that singers use and speech never does.** The singer's formant, a
   cluster of F3 to F5 near 3 kHz, comes from a narrowed epilaryngeal tube inside a wide pharynx
   (Sundberg; nasendoscopy and MRI studies of singers; Kröger stresses the acoustic-aerodynamic
   interaction behind it). High voices instead tune the first resonance to the fundamental, and
   the second to its double at the top of the range (Joliveau, Smith and Wolfe; Henrich et al.
   2011). Both are articulator settings (epilarynx, larynx height, jaw opening as a function of
   pitch), so in articulator space they are a rule in the planner and cost nothing at runtime.
   A speech-calibrated model sounds wrong on high female and child notes partly because it does
   not open the jaw for them.
4. **Calibrate against singers, not only against CHIMERA.** Measured singer anatomy exists:
   real-time MRI area functions of professional tenors (Echternach et al.), MRI of six soprano
   opera singers (Vos, York 2018), 3D-printed tracts of three professional singers used to study
   the piriform fossae (Delvaux and Howard, PLoS One 2014) and of a tenor with and without the
   valleculae, which affect the singer's formant cluster (Feng and Howard), Story's speaker
   catalogue, and Birkholz's 3D MRI vocal tracts with printable models. Fitting by analysis
   through synthesis is established: Steiner et al. built VTL gestural scores by searching
   gesture parameters (2008), Gao and Birkholz do articulatory copy synthesis, Südholt et al.
   fit Pink Trombone areas by gradient descent (DAFx 2023), and Xu and Reiss map audio to Pink
   Trombone diameters with a network (2025). A differentiable copy of the bellows tract can learn
   targets and timing from recordings of real singing, which CHIMERA's hand calibration cannot.
   SPARC (Cho et al. 2024) shows articulator trajectories can be inferred from arbitrary speech
   audio and generalize across speakers, which makes it an analysis tool for that training data.
5. **Physics where it is cheap, learning where it is not, and only offline.** Hybrids show how far
   a small learned part goes on top of signal-processing structure: LPCNet puts linear prediction
   under a WaveRNN (under 3 GFLOPS), FARGAN reaches near HiFi-GAN quality at about 600 MFLOPS with
   820k parameters, and SawSing filters a sawtooth with learned per-frame coefficients and trains
   from three recordings (ISMIR 2022). All are far over a per-voice microcontroller budget, so for
   bellows the lesson is to learn tables and maps offline (as the articulator map already is) and
   keep the runtime physical; a learned post-filter belongs in the optional neural pack the PRD
   reserves, not in the core voice.

Two findings set limits. A one-dimensional acoustic model is enough: Blandin, Didone, Birkholz
and Remacle found no significant perceptual influence of 1D against 3D acoustics in broadband
articulatory synthesis (2024), so 2D meshes (Mullen, Howard and Murphy, IEEE TASLP 2007) are not
worth their cost here. And articulatory synthesis has been measured at the level of non-commercial
TTS in intelligibility and naturalness, below commercial systems (Krug, Stone and Birkholz, SSW
2021); the gap is in control, prosody and source, which is where items 1 to 4 aim. Perry Cook's
SPASM and SINGER (Computer Music Journal 1993) ran a Kelly-Lochbaum tract with a nasal branch and
neck elements in real time in 1992, at 22.05 kHz, and his dissertation was on identifying control
parameters for singing: prior art for nearly all of idea 1 and 2, three decades old.

## How it all fits: one voice, eight layers

Everything above lands in one structure. Each layer has one job, talks only to the layer
below, and runs at the slowest rate that job allows. Nothing new is added to the public surface
except a few parameters; `sing()`, the phoneme and bend parameters and the lyric layer keep
their shape.

| Layer | Runs | What it does | Where it comes from |
|---|---|---|---|
| 1. Score | main thread | lyrics and notes to timed phonemes and pitches; American flaps and dark l; the next vowel posted early so the mouth anticipates it; pitch changes posted early by the glide's lead time so preparation lands before the note | src/lyrics, src/sing.ts; allophones.ts (BUILT) |
| 2. Expression | control rate | pitch as a singer moves it: preparation and overshoot from one second-order system with a right-half-plane zero, vibrato, drift and jitter; F0 coupled to the pressure across the glottis, so it dips in voiced closures and rises with loudness (microprosody that falls out of the physics) | src/dsp/pitchglide.ts (BUILT), glottal.ts, airflow.ts |
| 3. Articulation | control rate | CHIMERA's 17 articulators in a critically damped bank at its speeds; a phoneme sets only the articulators it dominates, the vowel holds the rest; singer rules as articulator offsets: open the jaw so the first resonance stays above a high pitch (formant tuning, from a per-vowel table of how far the resonance moves per centimetre of jaw), and `ring`, which narrows the epilarynx, lowers the larynx and widens the pharynx for the singer's formant | CHIMERA inventory and planner (data extracted), phase 0 to 2 prototype |
| 4. Geometry | control rate | articulators to a 40-cell log-area function through the fitted map, contacts and the lateral floor by rule, the epilarynx by CHIMERA's own formula, then the harmonic mean onto the tract's sections; velum area; the jet's true minimum for noise | artmap.json and tract-data.json, fitted from CHIMERA |
| 5. Aerodynamics | control rate | lungs, the cavity behind the narrowest point and its yielding walls: transglottal pressure, turbulence strengths, the voice bar, bursts; velocity sets lung pressure, so a louder note is also a brighter, more pressed one, as in a real voice | src/dsp/airflow.ts (BUILT) |
| 6. Source | audio rate | the glottal area waveform ported from CHIMERA, with the flow solved per sample from lung pressure and the pressure the tract presents at the glottis (a quadratic with the glottal inertance), which is real source-tract interaction: ripple, skew, F1 bandwidth that opens with the folds. A self-oscillating triangular two-mass glottis is the later option, behind a gate | src/dsp/glottal.ts plus the tract's glottal end |
| 7. Tract | audio rate | Kelly-Lochbaum lattice with nasal branch and sinus, piriform fossa, trachea, yielding and radiating walls, lip and nostril radiation; noise injected at the jet and the teeth through CHIMERA's source filter. Output rate in the browser, 24 kHz on microcontrollers | the phase 0 to 2 prototype |
| 8. Calibration | offline | every table is generated by a script from recorded data with its provenance: CHIMERA's geometry and planner now; singers' MRI area functions and recordings later, fitted through a differentiable copy of the tract | scripts, never shipped |

New parameters, all optional with defaults that sing well: `overshoot` and `preparation` (the
glide), `ring` (singer's formant), `tuning` (how hard the jaw follows a high pitch), and velocity
mapped to lung pressure. `body` becomes continuous across CHIMERA's three bodies. The voice
stays mono, deterministic per seed, allocation-free, and pure TypeScript below the kernel.

## Into the library, measured (2026-11-12)

Path (d) is now the `vocal` engine (engines/vocal.ts and the vocal-*.ts files beside it,
dsp/tract.ts, dsp/end-tube.ts, dsp/radiation.ts, dsp/band-noise.ts), driven by `sing()` with
every sound posted 0.3 s ahead (`nextIn`, `nextPhoneme`) and every bend posted the glide's
lead time early. MEASURED against CHIMERA's renders of the seven comparison phrases, scratch
`integrated/`:

- Clicks CHIMERA does not have (scratch insight/clicks.ts): 21 over the 21 renders, against
  421 for the prototype and 17 for the tract driven by CHIMERA's own areas. What removed them:
  CHIMERA's area rate limit on the map's cells and the jet (engines/vocal-slew.ts); a
  Lagrange-read end tube whose delay ramps per sample (the Thiran allpass rang at every
  whole-sample crossing of the back tube); per-sample ramps of the burst's coupling, the
  walls' shunts and the slow source inputs; the tract's length limited to 15 cm/s; the
  glottal area averaged over two samples and the output low-passed at 16 kHz; a breath under
  closures, where the folds are not voicing.
- Twinkle F1/F2/F3 median distance from CHIMERA, Hz: male 19/29/41 (path c 22/39/44), female
  13/33/69 (c 14/32/127), child 42/74/155 (c 51/90/136).
- /l/ in son, male: 434/1445/2681 Hz, dip -2.1 dB (CHIMERA 422/1413/2911, -2.8). /ɹ/ F3 male
  2111, female 2564, child 2002 Hz (CHIMERA 2048, 2371, 2077); its 4 to 5.5 kHz trough male
  -18.0, female -19.8, child -16.1 dB (CHIMERA -11.0, -16.1, -14.9).
- The female /s/ is 8 to 9 dB weak and 30 percent high at 48 kHz because the section grid is
  coarse for it: its front cavity, constriction to incisors, comes out 4 sections of 0.36 cm
  (1.46 cm) where the male's is 5. At 96 kHz, sections 0.18 cm, the same line gives -22.5 and
  -19.7 dB at 5.0 to 5.2 kHz (CHIMERA -23.4 and -24.7 dB at 6.0 to 6.2 kHz).
- Cost at 48 kHz, M1, a sung phrase through the kernel: 506 ns a sample, 2.4 percent of a core
  per voice (prototype path d 607 ns).

## The junction airway, in the library (2026-11-12)

The waveguide of "Into the library" carried sound only; a lumped airflow model beside it
supplied pressure, voicing and bursts, and needed three fits to do it (a cavity wall six times
its physical area, a burst at a tenth of its flow, frication low-passed near 3 kHz). The
`vocal` engine now runs one airway that carries the air itself (`src/dsp/junction-airway.ts`):
a waveguide at Courant number 1, the exact case of the scheme CHIMERA runs at 0.93 and 96 kHz,
with all the flow physics in its junctions. Each junction solves its volume flow in closed form
from a Borda-Carnot kinetic loss, viscous resistance and any turbulence source in series; even
junctions add a yielding wall and the anatomical moving-wall flow. Lungs, trachea, glottis,
grid, velum, nasal tube and the radiators at the lips and nostrils pass the mean flow, so
pressure builds behind a closure, a release bursts, a voice bar fades and aspiration takes the
tract's resonances without being injected. The fixed trachea and nasal tube are delay lines
between lumped nodes (`src/dsp/airway-tube.ts`). The shape comes from CHIMERA's geometry ported
exactly (`src/engines/vocal-geometry.ts`, within 1e-13 of CHIMERA's Rust over 8325 frames)
instead of the fitted map, evaluated every 512 samples at 48 kHz and interpolated onto the
grid (`src/engines/vocal-drive.ts`). The map, its tables and the lumped airflow are gone; the
tables went from 114.6 KB to 38.9 KB.

### Decisions, and the numbers behind them

- Geometry exact, not fitted. MEASURED in its prototype: the map's own error added 0.1 dB to
  the distance from CHIMERA, brightened velar bursts and added 20 percent more click events,
  and was 43 KB larger gzipped. The exact geometry costs 57 us an evaluation (MEASURED here),
  0.11 us a sample at one evaluation per 512 samples.
- Aspiration held for each stop's own VOT. The planner held every voiceless stop's glottis
  20 ms past the release (CHIMERA's rule) while `src/sing.ts` releases it the stop's VOT before
  the beat; it now holds VOT less 50 ms (MEASURED: the ramp out and the voicing gate add that).
- f0 follows the pressure across the folds against the pressure below them, not the lungs':
  the lungs' own resistance put a held vowel 24 cents flat.
- Per-sample where a step became a click (each MEASURED as block-periodic clicks first): the
  moving-wall flow is smoothed by CHIMERA's 60 Hz two-pole every sample, with its fade-in weight
  inside the smoothing and its place shared between the two nearest junctions; a moving
  junction's wall surface follows its area every sample and goes to zero continuously as the
  section seals; a turbulence source that moves crossfades the flow it reads with its place, and
  its dipole's sign follows the flow continuously through zero.
- Releases grow over samples, out of closures that are not digital silence. The drive passes
  its interpolated profile through a critically damped two-pole at 70 Hz once a block, so a
  release between two keyframes accelerates as articulators do instead of opening at the area
  rate law's limit from its first block; the airway's least area is 1e-4 cm^2, not 1e-6, so the
  first sample of a release no longer changes a sealed section's impedance 85-fold (which stepped
  the pressure held in its power-normalized waves). MEASURED at the twinkle /k/ and the
  strengths final /t/, every body: the first sample's step over the burst's peak went from 1.05
  to 1.5 down to at most 0.63 (CHIMERA 0.57), and the rise out of the closure from 61 dB to 20 to
  35 (CHIMERA 26).
- No allocation. V8 boxed doubles at calls it did not inline, and wherever a conditional merged
  a double with a module-level constant (1.9 KB a block from one `a > A_FLOOR ? a : A_FLOOR`).
  The audio and control paths pass doubles through fields and typed arrays and write such
  constants as literals; the PRNG closures were replaced by mulberry32 inline, seeded from the
  named forks at each reset.

### Measured (renders of the comparison phrases through the kernel, scratch integrated2/)

| Measure | library voice | waveguide voice | prototype (CHIMERA's tracks) | CHIMERA | human |
| --- | --- | --- | --- | --- | --- |
| Fricative spectral mean error, kHz (f, θ, s, ʃ; Jongman 2000) | 1.11 | 0.90 | 1.31 | 1.55 | |
| /s/ kHz, male/female/child | 6.08/6.71/6.57 | 5.75/5.97/5.79 | 6.19/6.55/7.26 | 5.10/5.92/5.88 | 6.13 |
| /θ/ kHz | 8.61/5.13/8.79 | 6.69/7.91/5.61 | 8.60/8.19/8.63 | 9.12/8.68/8.30 | 5.14 |
| VOT /t/, ms (closure-anchored detector) | 80/65/67 | 52/60/52 | 70/70/70 | 75/70/70 | 70 |
| VOT /k/, ms | 72/72/72 | 52/52/52 | 5/72/65 | 2/62/67 | 80 |
| Voice bar /b/, dB re vowel | -27/-27/-26 | -22/-19/-18 | -34/-30/-29 | -30/-26/-25 | |
| /t/ burst centroid, kHz | 4.2/4.8/4.3 | 4.7/3.2/4.6 | 2.1/2.6/2.3 | 3.7/4.4/4.7 | |
| Vowel /ɑ/ at 6/8/11 kHz, male, dB | -31/-36/-42 | -37/-40/-45 | -32/-37/-42 | -29/-30/-29 | |
| /m/ murmur, above 3 kHz minus below 500 Hz, dB | -29 (female, child) | | -29/-31 | -31/-29/-27 | |
| Click-like events CHIMERA lacks within 30 ms, a render | 2.58 | 1.08 | | | |
| Release onset, first step over the burst's peak (twinkle /k/, strengths /t/) | at most 0.63 | | 0.28 | 0.57 | |
| Largest one-sample jump over local RMS | up to 11.0 | 5.5 | up to 14.3 | up to 14.7 | |
| Allocation, steady singing | 0 collections in 5 s, 0.20 B/sample | 28 to 75 B/sample | | | |
| Cost, us/sample, through the kernel | 0.82 to 1.03 (load 3.1) | 0.51 | 0.65 to 0.87 | about 4 | |

### Not met, and known regressions

- /θ/ stays bright in two bodies (8.6 to 8.9 kHz against 5.1): CHIMERA's /θ/ target puts the
  jet behind the incisors. Moving the tip forward weakened the frication until the measure
  found voicing instead; not solved.
- Clicks: 2.58 events a render that CHIMERA lacks within 30 ms (the waveguide voice 1.08, the
  goal 1.1). Most are real releases, pre-aspiration and onsets at this planner's own times: an
  aspirated stop now releases its VOT (60 to 80 ms) before the beat so voicing lands on it, where
  CHIMERA releases on the beat, and a 30 ms match cannot pair them. Single-sample jumps reach
  11 times the local RMS at a few closures (the gate was 6 outside places where CHIMERA's
  exceed it).
- Cost: the male strengths line measured 1.03 us a sample, over the 1.0 target.
- `ring` lifts the 2.5 to 3.5 kHz band 1.4 dB, against 4.0 in the waveguide prototype: the
  narrowed epilarynx lies in the back duct, a uniform tube.
- The female /l/ and the twinkle formant tracks were not re-measured against the earlier gates.
- With the body changed at every note, a note-on lays the airway out again and allocates
  (0.9 B/sample over a line with a note every 1.6 s); the planner's rebuild at a phoneme
  allocates a little (0.08 B/sample).

## Articulator gesture dynamics (2026-11-12)

The articulators move as a six-stage cascade of identical first-order lags,
H(s) = 1 / (1 + tau s)^6 (`src/dsp/cascade.ts`), the target approximation Birkholz fitted to
measured movements (IEEE TASLP 19(5), 2011; Birkholz and Hoole, Interspeech 2012), in place of
CHIMERA's critically damped pair. It is stepped exactly at control rate (21 multiply-adds a
channel). Each articulator keeps CHIMERA's 98 percent time (t98 = 12.03 tau against 5.83 / w),
so its velocity now peaks at 0.42 of it with 38 percent of the way done (0.17 and 26 before).
The cascade passes half way 0.18 t98 later; the planner evaluates every gesture that much ahead
for each articulator (5 to 28 ms). A consonant's release is a return gesture after VocalTractLab
2.4: its articulators keep the consonant's own speed for a whole movement, whatever follows.
When two consonants hold one articulator, a closure wins over any other constriction, then the
more anterior place. A bilabial closure aims at -1.0 (template cm, k-scaled), past the lips'
contact; the lips stop at CHIMERA's -0.25. The contact rule moves only the cascade's output
stage, so a pressed tongue or lip keeps its motion in the stages behind it and leaves the
contact already accelerating.

Measured with the comparison phrases through the kernel (scratch taskC/, renders tC5), against
int3 (the library before) and CHIMERA:

| measure | CHIMERA | int3 | now |
| --- | --- | --- | --- |
| lip closing speed where the lips meet, of the movement's peak (Lofqvist and Gracco 1997: near it) | | 0.30 | 0.99 |
| closure starts and releases re int3, mean absolute shift (5 phrases, 3 bodies, 2.7 ms grid) | | 0 | 0.8 and 5.7 ms |
| vowel landing t50 re the beat after an onset consonant, stops / son / twinkle / strengths / melisma, ms | | -33 26 -14 -18 -2 | -34 25 -14 -16 -3 |
| VOT, mean absolute error re Lisker and Abramson 1964 (without the phrase-initial /p/) | 32.1 (13.1) | 19.6 (9.0) | 13.1 (5.9) |
| spectral shape velocity after /b d g/, voiced frames, dB per 10 ms | 4.01 | 4.83 | 4.02 |
| max F2 velocity after /b d g p t k/, male, Hz/ms (LPC, noisy) | 11.98 | 14.86 | 12.06 |
| DTW to CHIMERA, worst change over 7 phrases x 3 bodies, dB | | | +0.03 (strengths male -0.10) |
| /l/ dip, 12 seeds, dB (CHIMERA -2.8) | | -1.77 | -1.49 |
| fricative shape distance to the human, 12 seeds, dB | 12.09 | 10.46 | 10.65 |
| cost through the kernel, 9 renders interleaved, us a sample | | 1.009 | 1.024 |

Not met, and known regressions:

- The fricative shape distance to the human rose 0.19 dB (12 seeds): /f/ 3.7 to 5.2 dB and /v/
  18.9 to 19.5, while /ʃ/ fell 6.6 to 6.1 and /z/ 9.0 to 8.7. The lips now close on /f/ still
  moving near their peak speed, and the 20 to 40 ms before the beat carry a louder, brighter
  onset (3 dB) that the measure's noisiest window picks; the held /f/ is unchanged. The canonical
  seed reads 10.77 against int3's 10.59, so the gate below int3 is not met by this change.
- Long closures release later: the pressed articulator has further to come back. Codas and
  phrase-final stops release 8 to 11 ms after int3 (the final /t/ of strengths at 4.516 s
  against 4.505), CV stops within 3 ms after the release leads were lengthened (lips 25 ms, tip
  24, body 39, from 19, 20 and 34).
- The first /t/ of strengths now closes (0.384 to 0.448 s): int3 blended it with /s/ and /ɹ/
  into a 0.06 cm^2 constriction. A closure wins its articulator now; whether a sung "str" should
  close fully was not checked against a recording.
- The return speeds equal the approach speeds except an affricate's (closure 2.0, its fricative
  part 1.3 against 1.4): a glide returning at 1 landed its vowel 8 ms later, and no recording here
  measures release speeds, so the values stay CHIMERA's until one does.

## Vocal folds: three glottis models, measured (2026-11-12)

The airway's glottis was CHIMERA's drawn area pulse and a smoothstep voicing gate. Two fold
models now sit beside it, chosen by the `glottis` parameter (0 geometric, 1 self-oscillating,
2 the pulse). Both are written from the papers; VocalTractLab's code is GPL and was not read.

- Geometric (`src/dsp/geometric-glottis.ts`): Titze's kinematic folds as Birkholz, Drechsel
  and Stone (2019) extend them. A lower and an upper edge, x_i(y, t) = x_rest,i (1 - y / L) +
  x_max sin(pi y / L) sin(phi_i), the upper lagging by 70 degrees (male) or 50 (female, child),
  a posterior chink, skew by a piecewise linear phase warp, double pulsing 0.05, and the area
  the smaller of the two edges' integrals, which is closed form. x_max = c x_rel sqrt(P_trans),
  1 mm at 800 Pa, from the airway's own transglottal pressure (block means through a 30 Hz
  pole). Voicing is a threshold linear in the prephonatory half-width (Titze 1988; 2 cmH2O
  floor from Titze 1992, 4 cmH2O per mm) with offset at 0.7 of onset (Lucero 1999), in
  `src/dsp/phonation-threshold.ts`. The cycle (pitch, drift, jitter, shimmer) is still the
  pulse unit's, stepped without its area (`GlottalSource.nextPhase`).
- Self-oscillating (`src/dsp/fold-oscillator.ts`): Ishizaka and Flanagan's two masses with
  Steinecke and Herzel's pressures on a triangular glottis (after Birkholz, Kroger and
  Neuschaefer-Rube 2011), collision at three times the spring with extra damping, driven every
  sample by the pressures the airway solved the sample before. Tension scales the masses by
  Q^-1.5 and the springs by Q^0.5. A singer's servo (`src/dsp/pitch-servo.ts`) measures each
  cycle and moves Q toward the target with a 40 ms time constant over a feedforward of
  f / 158 Hz (the model's own frequency at Q = 1, MEASURED). Semi-implicit Euler at the audio
  rate is stable at 22050 Hz up to Q 12, so nothing oversamples.
- Microprosody, all models: the fixed 60-cent rise at a vowel after a voiceless obstruent is
  now a cricothyroid stiffness gesture from the planner (Hanson 2009, Lofqvist 1989), held
  through the consonant and its aspiration and ramped out over 80 ms; full stiffness is 60
  cents, and narrows the geometric folds' swing by a quarter.
- Calibrations (CALIBRATED against CHIMERA's vowel bands, so they are fits): skewness 0.3 for
  every body (the paper tested -0.4 to 0.4; its best were 0 and 0.2, which left the male 1.5
  to 4 kHz 6 dB over CHIMERA's); the two-breakpoint warp, 3 to 4 dB nearer than one breakpoint;
  rest displacement 0.3 mm male, 0.6 mm female and child, the paper's best; the self-oscillating
  folds 0.1 mm (wider stops them above about 600 Hz).

Measured, renders of the comparison phrases through the kernel (scratch taskB/, tags tbP pulse
with the stiffness gesture, tbG geometric, tbS self-oscillating):

| Measure | int3 (pulse before) | pulse now | geometric | self-oscillating | CHIMERA | human |
| --- | --- | --- | --- | --- | --- | --- |
| DTW distance to CHIMERA, male, dB (twinkle/strengths/stops/fric/son/vowels/melisma) | 3.75/3.68/4.28/4.44/4.38/4.85/3.40 | 3.74/3.69/4.29/4.42/4.38/4.85/3.40 | 4.11/4.12/4.29/4.50/4.49/4.74/4.30 | 5.08/4.85/5.04/5.21/5.03/5.81/4.36 | 0 | |
| DTW, female, worst phrase over int3, dB | | +0.05 | +2.52 (son) | +4.59 (fric) | | |
| Vowel bands over CHIMERA, male, 1.5-2.5/2.5-4/4-6 kHz, dB | 0.7/2.9/4.0 | 0.8/2.9/4.0 | 1.9/3.3/5.1 | 4.2/3.0/4.8 | 0 | |
| Held /ɑ/ H1-H2, male/female/child, dB | 0.7/-1.4/-0.8 | same | -0.9/-0.5/0.3 | 6.6/3.3/3.2 | 0.4/-1.9/-1.1 | |
| Voice bar /b d g/ re vowel, male, dB | -27/-31/-24 | -26/-31/-24 | -30/-36/-29 | -53/-41/-41 | -25/-36/-29 | |
| Voice bar /b/, female/child, dB | -25/-25 | -25/-25 | -48/-57 | -60/-55 | -24/-23 | |
| VOT /t/ /k/, male, ms (closure-anchored detector; Lisker and Abramson: 70, 80) | 80/72 | 72/65 | 15/72 | 75/80 | 75/2 | 70/80 |
| Voiced fricatives, frication over voicing, mean distance to the human recordings, male/female/child, dB | 12.8/15.0/16.8 | 13.7/15.1/16.7 | 14.7/13.0/14.7 | 17.1/17.3/18.6 | 15.6/15.0/17.0 | 0 |
| Fricative shape distance to the human, male, dB | 10.59 | 10.60 | 11.08 | 13.74 | 12.09 | 0 |
| Sung notes within 5 cents of target (vibrato, drift off), of 37 a body, male/female/child | 35/34/32 | 35/34/32 | 33/36/36 | 37/33/34 | | |
| Mean error of held vowels, cents, male/female/child | 2.1/1.3/3.6 | same | 3.1/1.8/2.0 | 0.7/0.6/0.6 | | |
| Brighter when louder (velocity 0.2 to 1, harmonics 2-4 kHz re 0-1 kHz), dB | +5.2 | +5.2 | -4.6 | +5.5 | | |
| Cost through the kernel, us/sample, twinkle and stops, male and female (best of 6, interleaved, load 5.2 on 8 cores) | | 1.12 to 1.19 | 1.10 to 1.26 | 1.04 to 1.21 | | |
| Allocation, 5 s of a sung line | | 0 collections | 0 collections | 0 collections | | |

What the numbers say:

- Neither fold model beats the pulse against CHIMERA, and the gates for the library
  (no phrase more than 0.2 dB further from CHIMERA than int3 without a human measure to justify
  it) keep the pulse as the default. The geometric folds come close on the male stops,
  fric and son (0.11 at most) and nearer on the vowels phrase (4.74 against 4.85), but lose 0.4
  to 0.9 dB on twinkle, strengths and melisma, and up to 2.5 (female) and 2.7 dB (child) on the
  consonant phrases, where the wide rest those bodies take (the paper's 0.6 mm) stops voicing in
  closures (voice bars 11 to 34 dB under CHIMERA's).
  The self-oscillating folds lose 0.7 to 4.6 dB everywhere.
- What the fold models do better is pitch and physics. The self-oscillating folds hold a sung
  vowel to 0.6 to 0.7 cents on average in every body, by the servo, where the pulse is off by
  1.3 to 3.6; they are brighter when louder by their own collision (+5.5 dB) where the geometric
  folds, whose shape does not change with pressure, get darker (-4.6). Their weak points are
  voice bars (they stop at a higher pressure than the 2 cmH2O floor) and fast high melismas
  near the first formant (female and child: up to 92 cents, the oscillation drawn to the
  resonance; formant tuning is the singer's answer and is off in that phrase).
- The pulse's own pitch: its pressure term reads the last sample of each block, which aliases
  the cycle. A female /ɑ/ at 494 Hz sat 19.4 cents sharp. Reading block means brings it inside
  5 cents, but moves two single-frame tests: measured more steadily (five frames averaged;
  harmonics at the measured f0), `ring` then lifts 0.95 dB, under its 1 dB gate, and velocity
  brightens 4.9 dB, under 5. So the pulse keeps the old reading and the geometric folds use the means; fixing it
  for the pulse is its own change.
- The voiced fricatives' balance against the human recordings (male: frication 11 to 13 dB too
  weak against the voicing for /v/, 24 to 26 for /ʒ/, every model) is not a source problem: /v/
  and /ʒ/ moved by under 1 dB when the voiced fricative's abduction went from 0.035 to
  0.15 cm^2; only /z/ moved. That is the noise sources' work.

## Noise sources, walls and velum (2026-11-12)

The airway's turbulence follows Stevens and Birkholz now instead of CHIMERA's Reynolds law
(`src/dsp/junction-airway.ts`, written from Stevens 1998, Birkholz ISSP 2014, Jackson and Shadle
2000 and the VocalTractLab 2.4 manual; none of VocalTractLab's code). Each block finds up to three
constrictions (the narrowest section under 1 k^2 cm^2 with its neighbours within 0.2, and runs not
joined to it), and each makes p_s = G |v_c|^3 sqrt(A_min), v_c low-passed at 500 Hz, placed by the
distance D from its separation point to the incisors: a wall source 0.25 cm downstream, an
obstacle source at the incisors, a labiodental one 0.15 cm past the separation where the lower lip
forms it, split linearly between the two junctions of its section. A wide tract has no jet, so /h/
is aspiration 1.5 cm above the glottis shaped by its vowel. In voicing, frication pulses at f0
behind tau = D / (0.5 v_jet) with its index soft-limited at 0.5. A velic source in the velum port
covers velic releases. The tract wall is Birkholz and Zhang's (2025): M 2.0 g/cm^2, K 100,000
dyn/cm^3, B 2000 dyn s/cm^3, against CHIMERA's 1.5, 300,000 and 1600.

### Decisions, and the numbers behind them

- Every source takes Stevens' corner, fc = 0.15 v / d. Birkholz flattens the labiodental and
  glottal ones (6 kHz); here that made /f/ rise 17 dB from 1 to 12 kHz and /h/ bright (shape
  distance to the human 11.5 and 18.0 dB against 5.8 and 15.4).
- The noise high-pass at fc / 12 is gone: /s/ at 0.5 to 1.6 kHz rose 8 and 5 dB toward the human.
- Gains, fitted: wall 7 and obstacle 14 (Birkholz's ratio, 1.4 times his values; at 10 the female
  and child /z/ frication fell under the voicing, shape distance 25.4 and 26.0, at 14, 12.6 and
  12.6), labiodental 18 (at his 3, /f/ lay 37 dB under its vowel), lip rounding 3 (his labiodental
  value, so /o u/ do not hiss), aspiration 20 with the glottis open and 3 in modal voicing (at 10,
  /θ/ lay 13.0 dB from the human shape, at 20, 7.4: the open glottis fills its 1 to 6 kHz).
- Wall and obstacle blend over D = 2 to 3 cm, not 1.5 to 2.5: this geometry's /ʃ/ separates 1.9
  to 2.2 cm behind the incisors, and Birkholz lists /ʃ/ as an obstacle source. At the same gains /ʃ/
  went from -24 to -17 dB re its vowel (-15 now).
- v_c is read at the junction after the narrowest section, where the kinetic loss holds it to
  A sqrt(2 dp / rho); read at the run's exit, a /d/ closure was as loud as the /s/. A section at
  the closed area makes no noise (the area floor's leak is not a jet); without that the strengths
  /t/ closure carried frication 30 dB over CHIMERA's silence and the release test read 1.18.
- No jet outruns the lungs: v_c is capped at 1.2 sqrt(2 P_lung / rho).
- Wall radiation stays at CHIMERA's 0.25 of the wall flow. Birkholz and Zhang radiate all of it;
  here that put the /b/ and /g/ voice bars 8 to 12 dB over CHIMERA's (-3.3 and -8.8 dB re the
  vowel against -16.9 and -17.7). K was chosen by the held-closure voicing: 60 ms on CHIMERA's
  wall, 83 at K 100,000, 102 at 65,000. B 2000 keeps the first formant's bandwidth nearest
  CHIMERA's (44 Hz mean, 41 at B 1400, 49 on CHIMERA's wall, CHIMERA 52).
- The velum port stays under 0.03 cm^2 through every oral stop closure in all three bodies
  (MEASURED 0; a test now holds it).

### Measured (male unless said; scratch taskA/)

| Measure | before (int3) | now | CHIMERA | human |
| --- | --- | --- | --- | --- |
| Fricative shape distance to the human, dB (male / female / child) | 10.59 / 10.96 / 11.33 | 10.27 / 10.54 / 11.55 | 12.09 / 12.33 / 13.57 | |
| /s/, /ʃ/, /f/, /θ/, /h/ shape distance | 7.3, 7.4, 3.5, 9.0, 15.1 | 5.6, 5.7, 5.8, 7.4, 15.4 | 8.1, 4.3, 6.7, 13.7, 16.6 | |
| /z/, /v/, /ʒ/ shape distance | 8.8, 18.4, 15.2 | 10.1, 16.7, 15.4 | 9.6, 18.2, 19.5 | |
| Spectral mean error to Jongman, kHz (f θ s ʃ) | 1.10 | 1.59 | 1.94 | |
| Level re vowel, dB: /s/ /ʃ/ /f/ /θ/ /h/ | -6 -19 -25 -25 -16 | -4 -15 -23 -23 -16 | -10 -12 -18 -22 -19 | |
| /h/ 5 to 12.5 kHz, dB re its total | -7 -6 -10 -14 | -8 -7 -10 -12 | | -21 -31 -31 -38 |
| DTW distance to CHIMERA, mean of 21 renders, 3 seeds | 4.51 | 4.82 | | |
| Vowel F1 / B1 mean, Hz | 508 / 48 | 500 / 44 | 521 / 52 | |
| Cost, us/sample through the kernel (load 5.2) | up to 1.30 | up to 1.33 | | |

### Not met

- /h/ keeps its 6 to 12 kHz hiss: with no jet it is aspiration alone, and aspiration through this
  tract stays flat to 12 kHz with any one-pole corner, where the speaker falls 12 dB an octave
  above 4 kHz. Not tested here: the radiation load's +6 dB an octave past ka = 1 (4.4 kHz for an
  open mouth) is a likely part of it.
- /ʃ/ still peaks at 1.6 to 2.5 kHz, not 2.5 to 4: the geometry puts its front cavity 3.65 cm
  long (separation to lips), which resonates at 2.4 kHz; the human peak needs about 2.5 cm. The
  constriction sits 2.2 cm behind the incisors. That is the articulation target or the geometry,
  not the noise source.
- /θ/'s top: the geometry makes it a 2.3 cm channel of 0.15 to 0.25 cm^2 ending past the
  incisors, and the channel's resonance near 8 kHz stays.
- Voiced /z ʒ/: the jet is 31 percent slower than /s/'s (1930 against 2810 cm/s), so 9.7 dB
  weaker by the law, because the folds sit adducted at 0.05 cm^2 and vibrate at vowel amplitude.
  A glottis whose amplitude falls with transglottal pressure is the fix, outside this change.
- DTW to CHIMERA is 0.31 dB worse on average and 0.2 to 0.65 dB on 18 of 21 renders. Part is the
  human-directed change (noise frames gain 2 to 4 dB at 0.3 to 1.5 kHz, where /s/ moved toward
  the speaker); part is closure frication: a closing constriction passes through an /s/-sized gap
  for about 10 ms at full jet speed (the /tʃ/ closure in the stops line reads 17 dB over
  CHIMERA's). Real closures cross that range in 3 to 5 ms; the closing speed is the planner's.
- The /l/ dip test's tolerance went from 1.5 to 1.6 dB: the heavier wall moved the dip from -1.57
  to -1.28 against CHIMERA's -2.8.

## Integration 4: the three rounds together, retuned (2026-11-12)

The three sections above were built apart, each against int3 (the library before them), and
none passed every gate alone: the cascade lost 0.18 dB of fricative shape distance, the fold
models lost DTW distance to CHIMERA, and Stevens' noise law lost DTW on 18 of 21 renders. All
three are merged. The pulse stays the default glottis; the two fold models are options. Then
only free constants were refitted, against the human recordings and Jongman first and CHIMERA
second (scratch int4/: opt.py evaluates a setting on all 21 renders and three bodies, eval.ts
renders through the kernel).

What the merge alone measured (tag m0): mean DTW 3.80 to 4.05 dB, 15 renders more than 0.2 dB
further from CHIMERA than int3 (worst stops child +0.53), fricative shape distance 11.13 dB (male;
the cascade's /θ/ window fell on the channel's 8 to 12 kHz resonance, 12.8 dB from the human
shape, where the noise round's had fallen on aspiration, 7.4).

What moved, and why:

- A Reynolds threshold. A constriction makes noise only above Re 1000 to 2000 (Re = v d / nu).
  The /tʃ/ closure in the stops line leaked through 0.001 to 0.004 cm^2 at about 2400 cm/s for
  10 ms, frication 9 dB under the /s/'s (Re about 1000): now silent. (The closure only: the
  closing gesture before it carried a new burst at the vowel's level, fixed after verification,
  below.) Over Re 1800 to 3000
  (CHIMERA's critical number) the female /z/ fell under its voicing, 25.3 dB from the human shape
  against 12.7.
- No obstacle past the incisors. The /θ/ channel separates 0.3 cm past the incisors' edge, so
  Birkholz's obstacle source had nothing ahead of it; it now fades to a free-jet source (wall
  place, G 6) as D falls from 0.3 k cm to 0.
- A second pole at 3.5 kHz on every constriction source but the obstacle's share (Shadle 1991:
  the obstacle source is the broadband one). Male /f/ 6.1 to 2.9 dB from the human shape, /θ/ 12.2
  to 9.0, Jongman spectral mean error 1.46 to 0.81 kHz. At 2.5 kHz /f/ went dull (6.6); on the
  sibilants too it cost 0.2 to 1.0 dB of shape.
- Gains: common scale 3.5e-9 to 3e-9; open aspiration 20 to 10 (at 20 the vowels line, whose
  breaths are /h/, read 0.3 dB further from CHIMERA; /θ/ no longer needs it with the second
  pole); voiced aspiration 3 times k^3.5 (male 3, female 2.1, child 1.1: the male line at 1 read
  1.1 dB further from CHIMERA, the child's at 3 0.24 dB further); obstacle 14 to 15 (the child's
  /z/ fell under its voicing at 14: 26.0 dB from the human shape; at 15, 12.8 on the default seed,
  and 26 on four other seeds: verification found the 11.0 first written here was the child's mean
  over all fricatives, and the gain is now 18, below); labiodental 18 to
  25 (keeps /f/ at -27 dB re its vowel under the second pole).
- The wall keeps CHIMERA's mass, 1.5 g/cm^2, with Birkholz and Zhang's K 100,000 and B 2000:
  with 2.0 five renders read 0.20 to 0.27 dB further from CHIMERA, the male vowels line most. The
  held labial closure voices 77 ms (83 at 2.0, CHIMERA's wall 60; the test asks 70 to 150).
- Tried and left: CHIMERA's whole wall (vowels male 4.93 against 4.95, but voice bar hold back to
  60 ms); a labiodental corner apart from the lingual one (no change: v / d already sits at the
  200 Hz floor); a fixed second pole on every source (sibilants 0.2 to 0.9 dB further from the
  human shape); the free jet's gain 0.2 to 12 (the /θ/ shape stays within 1.2 dB, the level moves
  20 dB).

Measured, renders of the standard set through the kernel (S/int4-*, int4so-* the self-oscillating
folds, int4sing-* ring 1 and tuning 1), against int3, CHIMERA and the human data:

| measure | CHIMERA | int3 | int4 | human or norm |
| --- | --- | --- | --- | --- |
| DTW to CHIMERA, mean of 21 renders, all frames, dB | 0 | 3.80 | 3.86 | |
| DTW, male twinkle / melisma / strengths / stops / fric / son / vowels | 0 | 3.75 3.40 3.68 4.28 4.44 4.38 4.85 | 3.92 3.52 3.78 4.28 4.44 4.32 4.95 | |
| DTW, renders more than 0.2 dB further than int3 (worst) | | | 1 (strengths female +0.23) | |
| fricative shape distance to the human, male / female / child, dB | 12.09 12.33 13.57 | 10.59 10.96 11.33 | 10.18 10.59 11.00 | 0 |
| shape, male /s ʃ f θ h z v ʒ/, dB | 8.1 4.3 6.7 13.7 16.6 9.6 18.2 19.5 | 7.3 7.4 3.5 9.0 15.1 8.8 18.4 15.2 | 5.8 5.7 2.9 9.0 15.5 10.5 16.1 15.9 | 0 |
| Jongman spectral mean error (f θ s ʃ, 0-11 kHz), male / female / child, kHz | 1.94 1.58 1.53 | 1.10 1.51 1.86 | 0.81 0.98 0.95 | 0 |
| level re the following vowel, male /s ʃ f θ h/, dB | -10 -12 -18 -22 -19 | -6 -19 -25 -25 -16 | -4 -16 -27 -26 -23 | |
| voiced fricatives, frication over voicing, mean distance to the human, male / female / child, dB | 15.6 15.0 17.0 | 12.8 15.0 16.8 | 17.4 15.7 17.5 | 0 |
| vowel frames over CHIMERA, male, 2.5-4 / 4-6 / 6-9 kHz, dB | 0 | 2.9 4.0 -0.7 | 1.6 0.8 -4.3 | |
| held /ɑ/ above 5 kHz re full band, male / female / child, dB | -26.0 -31.4 -30.7 | -23.3 -31.8 -31.2 | -26.8 -33.0 -32.1 | |
| VOT mean error re Lisker and Abramson (without the phrase-initial /p/), ms | 32.1 (13.1) | 19.6 (9.0) | 17.0 (10.7) | |
| spectral shape velocity after /b d g/, dB per 10 ms | 4.01 | 4.83 | 4.50 | |
| voice bar, 50-500 Hz re vowel, mean of /b d g dʒ/, male / female / child, dB | -20.7 -18.3 -16.3 | -19.4 -19.4 -18.9 | -14.8 -17.5 -16.6 | |
| voice bar duration, mean, male / female / child, ms | 26 40 49 | 25 38 45 | 30 35 44 | |
| sung notes within 5 cents (vibrato and drift off), of 37, male / female / child | | 35 34 32 | 35 35 32 | |
| self-oscillating folds, the same | | | 37 34 35 | |
| one-sample steps of 3 or more times the local RMS among the 60 strongest transients | | 10 (largest 15.4) | 8 (largest 5.1) | |
| cost through the kernel, 48 kHz, worst of 27 renders (3 phrases, 3 bodies, 3 models), us a sample | | | 1.07 | gate 1.5 |

Cost per part (pulse, best of 4, load average 4.2 on 8 cores): airway 0.66 to 0.85 us a sample,
the rest of the voice (planner, cascade, geometry, drive, pitch) 0.15 to 0.18, the kernel 0.03.
The two fold models cost the same within 0.03. Zero allocation was claimed from the existing
GC-count test (0 collections over 5 s of a sung line, each of the three models); it did not hold
for the self-oscillating folds (1.2 to 1.5 bytes a sample on a held vowel), fixed after
verification, below.

The fold models under the new noise (DTW to CHIMERA on twinkle, stops, fric, son over three
bodies): geometric 5.07 dB, self-oscillating 5.76, pulse 3.83 (int3 3.77). The self-oscillating
folds keep the best pitch (37 of 37 male notes within 5 cents; held vowels 0.6 to 0.8 cents) and
lose voice bars (/b/ -45 to -51 dB re the vowel against CHIMERA's -23 to -25); their four lines
have 35 one-sample steps among the 60 strongest transients, most at the fric line's /h/ onset
(3.525 s), where the pulse's have 8, most at the moments int3's 10 fall (stop releases and
strengths at 2.39 s).

Tests: the merge kept the cascade round's /l/ dip test (mean of eight seeds, within 1.5 dB of
-2.8) over the noise round's single seed at 1.6; it passes. The placement test now expects the
free jet past the incisors and the obstacle at 15 / 7 of the wall's gain, and the wall test
CHIMERA's mass. 117 files, 1863 tests. (Verification found that the Reynolds gate, the second
pole, the v_c low-pass, the convective delay, the voicing modulation, the aspiration place, the
velic source, the geometric lag and double pulse and the fold tension law could each be broken
with every test still passing; each now has a test, below.)

### Not met

- One render is 0.23 dB further from CHIMERA than int3 (strengths, female; its vowel frames, 3.99
  to 4.30): over the 0.2 gate by 0.03. Every setting that kept the child's /z/ over its voicing
  (obstacle 15 or more, or the common scale at 3.5e-9) left it at 0.23 to 0.30; at obstacle 14 it
  read 0.21 and the child's /z/ 26.0 dB from the human shape. The human measure is the reason it
  stays.
- Voiced fricatives against the human balance got worse for the male body: /z/ frication over
  voicing -11.8 dB against the speaker's -4.9 (int3 -4.9), mean distance 12.8 to 17.4 dB. The
  /z/ shape went 8.8 to 10.5. The noise round named the cause (folds at vowel amplitude during
  /z/); the geometric folds' pressure-driven swing is the candidate, not the default.
- /h/ still hisses at 6 to 12 kHz (15.5 dB from the human shape); /θ/'s channel resonance near
  8 kHz stays (9.0); /ʃ/ still peaks one band low. These are geometry and radiation, unchanged.
- VOT reads worse without the phrase-initial /p/ (9.0 to 10.7 ms) because both detectors take the
  male /k/ as 0 ms: the aspiration now has energy under 500 Hz and passes their voicing test. The
  airway's own voicing state puts that /k/ at 65 ms (release 2.810 s, voicing over 0.5 at 2.879).
  The cascade alone had 13.1 (5.9).
- The voice bars are louder than CHIMERA's (male mean -14.8 dB against -20.7; male /d/ -3.2,
  where its closure lasts 13 ms against CHIMERA's 29). Release rises in the male stops line are
  10 to 43 dB against int3's 17 to 60: the closures carry more sound before the burst. The release
  test passes.
- Vowel frames lost 6 to 13 kHz against CHIMERA (male 6-9 kHz -0.7 to -4.3 dB): int3's came from
  its Reynolds-law jets in close vowels, which Stevens' v^3 law leaves near silent. No human
  measure here says which is right.

## Fixes after verification (2026-11-12)

Two independent verifiers re-rendered Integration 4 and measured it against int3, CHIMERA and the
human recordings. Every issue they raised reproduced. What was wrong, why, and what changed;
every number is a render of the standard set through the kernel (S/int4-*, overwritten; the
renders before these fixes are S/int4o-*), and the human-data gates are now read over five noise
seeds (the default and s1 to s4), mean and range.

- **The phrase-initial /s/ of /stɹ/ was gone**, in every body and seed: energy above 2.5 kHz over
  0.25 to 0.43 s re the phrase's 95th-percentile level, male / female / child, CHIMERA -28.0
  -39.0 -41.5, int3 -27.8 -36.4 -40.8, int4 -72.5 -85.2 -80.8. Not the noise law: the tract was
  shut from the note-on. The planner moved every onset consonant 60 ms earlier (INITIAL_LEAD),
  so the /t/ was fully under way 5 ms after the note-on and, by the cascade round's priority
  rule (a closure wins a shared articulator), held the tongue tip from the start. Only the
  phrase's first consonant leads now. After: -23.1 -33.7 -31.8 (seeds s1 to s4 within 2.0, 0.7
  and 0.4 dB). A vocal test asks the loudest 5 ms above 2.5 kHz inside that /s/ to be within
  25 dB of its vowel's level (on the harness renders, before -66 -72 -65, now -10 -17 -16;
  CHIMERA -18 -25 -27).
- **A noise burst before every voiceless alveolar closure**, 10 to 20 ms at the vowel's level.
  CHIMERA's area rate law (dsp/area-rate.ts) closes the last 0.4 cm^2 slowly so a seal does not
  click, and Stevens' v^3 sqrt(A) read that dwell as a fricative: at the male /tʃ/ the airway's
  area was still 0.05 cm^2 while the articulators had sealed (commanded 5e-4), at 3000 cm/s. The
  source now reads the commanded area where it is under the airway's, so a closing seal is quiet;
  opening and steady constrictions are unchanged (the airway's area is the smaller there). Level
  above 2 kHz at 3.985 to 4.005 s (/tʃ/), dB re the phrase: CHIMERA -24 -38 -42, int3 -34 -46
  -46, int4 before -4 -12 -7, now -46 -47 -50; before the /t/ of "ta" (1.565 to 1.575 s), before
  2.6 -12 -7, now -40 -47 -60. A vocal test gates the loudest 5 ms above 2 kHz in the 30 ms
  before /t tʃ/ close at the vowel's level less 15 dB (harness renders, male: before +4.1 and
  -4.4, now -20 and -57; CHIMERA -27 and -37). The male closures the verifiers found short were this burst read as open tract:
  /t d k/ closure 15 13 42 ms before, 32 29 59 now (CHIMERA 37 29 56), and the male /d/ voice
  bar -3.2 dB before, -19.6 now (int3 -20.6, CHIMERA -27.5). The excess scanner (5 ms frames
  above 2 kHz more than 15 dB over both CHIMERA and int3) flagged stops at 3.99 s in all three
  bodies before; now it flags only the /t/ release of /stɹ/ at 0.445 s (male -3.5, child -13.1
  dB re the phrase), a burst the restored /s/ now precedes. 'past' at 2.355 s reads -10 against
  CHIMERA's -27: its /s/ runs 5 ms longer into the closure, at its own level, not a burst.
  The /t/ of "ta" now closes 15 ms before CHIMERA's and int3's (1.565 s reads -40 against their
  vowel, -7 and 0).
- **The child /z/ result behind obstacle 15 was one seed.** Its shape distance to the human,
  mean [range] over five seeds: int3 12.4 [12.2..12.7]; obstacle 14, 26.1 [26.0..26.3]; 15,
  23.5 [12.8..26.3]; 17, 18.0 [12.6..26.3]; 18, 12.6 [12.4..12.9]. The frication either clears
  the voicing or not and the seed decides; lowering the Reynolds window's floor (500 to 2000,
  0 to 2000) did not move it (23.5). The obstacle gain is 18, the smallest that holds on all
  five. Cost: DTW to CHIMERA on the strengths line female and child, +0.23 and +0.24 dB over
  int3 (at 15, with the two fixes above, +0.17 and +0.17); the human measures below are the
  reason.
- **The VOT gain was a detector artifact.** The old detector took a -49 dB tick at 0.360 s as
  the male /p/'s release and any 80-500 Hz energy as voicing. A new one (scratch fix5/vot2.ts)
  takes the release at the largest 2-12 kHz jump among frames within 30 dB of the vowel's level,
  and voicing where a 20 ms window is periodic at the note (autocorrelation over 0.6) for three
  steps. Mean |VOT error| re Lisker and Abramson over p b t d k g and three bodies: CHIMERA 14.3,
  int3 12.6, int4 7.2 ms; the voiceless stops alone 7.4 (int3) and 7.8 (int4), the voiced 17.7
  and 6.8 (int3 read prevoicing on the male /g/ and child /d/). Male /k/ reads 57 ms (the old
  detector 0; by eye about 75). The fixes do not change any VOT.
- **The self-oscillating folds allocated**: a held /ɑ/ at 220 Hz grew new space 1.24 to 1.53
  bytes a sample (the verifier's probe, bundled, 128 MB semi-space), against 0.036 for the other
  models. Three causes, each measured: the tension clamps were conditionals merging a double
  with module-level constants (V8 boxed the result: computing the coefficients every sample
  made 16 bytes a sample); tune() and the servo's cycle(), called once a block and once a cycle,
  stayed unoptimized and boxed what they computed; the turning point went to a call taking two
  doubles. The clamps are Math.min and Math.max, tune() marks the coefficients stale for step()
  to compute, step() calls the servo every sample (it works only on a pending cycle) and writes
  the turning point out. After, over 60 s: 0.032 bytes a sample for all three models. A test
  holds a vowel 40 s per model under 0.15 (one 135 KB allocation buffer above the rate; before,
  0.28 for the folds under vitest).
- **Untested physics.** White-box tests now cover the Reynolds gate (no noise under Re 1000,
  v^3 sqrt(A) within 5 percent over 2300, between at 1500), the free jet's second pole (4 to
  8 kHz against 2 to 4 kHz, 8.2 dB steeper than the obstacle's at matched places, 4.3 with the
  pole removed), the 500 Hz v_c low-pass and the convective delay D / (0.5 v), the voicing
  modulation (block spread over mean 0.32 voiced, 0.81 with the limit removed, 0.01 unvoiced),
  the aspiration place, the velic source, the geometric upper edge's lag (the open phase loses
  its first 70 degrees, not its last), double pulsing (alternate peaks 0.8 at d 0.2) and the
  fold tension law (at Q 2, f0 x1.97 and swing x0.73, where Q^-0.5 is 0.71 and Ishizaka and
  Flanagan's law 0.5). Each of the verifiers' ten mutants now fails a test.

| measure | CHIMERA | int3 | int4 before | int4 now |
| --- | --- | --- | --- | --- |
| DTW to CHIMERA, mean of 21 renders, dB | 0 | 3.80 | 3.86 | 3.87 |
| DTW renders more than 0.2 dB over int3 | | | 1 (strengths female +0.23) | 2 (strengths female +0.23, child +0.24) |
| fricative shape distance to the human, 5 seeds, male, mean [range], dB | 12.09 | 10.44 [10.23..10.59] | 10.23 [10.00..10.45] | 10.18 [9.96..10.40] |
| the same, female | 12.33 | 11.55 [10.96..11.92] | 10.96 [10.59..11.09] | 10.89 [10.54..11.02] |
| the same, child | 13.57 | 11.44 [11.33..11.58] | 12.16 [11.00..12.47] | 10.81 [10.75..10.95] |
| Jongman spectral mean error, male / female / child, kHz | 1.94 1.58 1.53 | 1.10 1.51 1.86 | 0.81 0.98 0.95 | 0.81 0.98 0.95 |
| voiced fricatives, frication over voicing (80-500 Hz), mean distance to the human, male / female / child, dB | 15.6 15.0 17.0 | 12.8 15.0 16.8 | 17.4 15.7 17.5 | 16.1 15.6 17.4 |
| voiceless /t/ closure, 80-500 Hz re vowel, male / female / child, dB | -65.0 -69.9 -67.8 | -49.0 -56.1 -61.2 | -38.6 -45.5 -50.8 | -38.6 -45.5 -50.8 |
| voice bar, mean of /b d g dʒ/, male, dB | -20.7 | -19.4 | -14.8 | -18.8 |
| cost through the kernel, worst, us a sample (load average) | | | 1.07 | 1.07 pulse (4.4 to 4.9), 1.12 fold models (5.3 to 6.1) |

Per fricative and body over the five seeds (shape distance to the human, dB, mean), int3 / int4
now: male s 7.3/5.8, ʃ 6.5/5.9, f 4.0/3.3, θ 8.9/9.2, h 15.1/15.2, z 9.0/9.9, v 18.4/16.1, ʒ
14.3/15.9; female s 7.5/4.6, ʃ 6.0/5.5, f 7.7/4.1, θ 8.7/9.8, h 14.4/14.8, z 12.2/11.9, v
13.0/12.5, ʒ 23.0/24.0; child s 7.6/4.1, ʃ 5.6/5.3, f 5.2/3.9, θ 10.4/10.2, h 14.0/14.1, z
12.4/12.6, v 11.2/10.5, ʒ 25.1/25.8. The male mean's gain over int3 lies within the seeds'
spread; the female's and the child's do not.

### Still open, measured

- /θ/ is further from the human than int3 in the male and female bodies (8.9 to 9.2, 8.7 to 9.8),
  and further from CHIMERA's shape in all three (5.7 to 9.3, 4.4 to 7.7, 4.2 to 7.4 on the
  default seed, as the verifiers measured; this round did not move /θ/). /ʒ/ is further in every
  body (14.3 to 15.9, 23.0 to 24.0, 25.1 to 25.8), /h/ in every body by 0.1 to 0.4, /z/ in the
  male and child (9.0 to 9.9, 12.4 to 12.6). These are regressions, not ties.
- Voiced fricatives are further from the human balance than int3 in all 9 body-by-fricative
  cells (frication 2.5-11 kHz over voicing 50-900 Hz; human z 11.4, ʒ 15.4, v -9.2): male z
  -1.7 (int3 1.2), ʒ -19.1 (-16.2), v -16.8 (-13.7). Obstacle 18 moved the male /z/ from -3.3
  toward the human; /ʒ/ and /v/ did not move.
- The voiceless closures carry 10 dB more 80-500 Hz than int3 in every body. Not the walls and
  not the voicing gate: with CHIMERA's stiffer wall (K 3e5) the male /t/ reads -37.7, with no
  wall radiation -38.3, and with the articulators' moving-wall flow (vflow) removed -48.2 (/k/
  -60.4). The flow comes from the tongue tip leaving the roof about 10 ms before the release,
  stepped at the 512-sample keyframes (male, 1.600 to 1.605 s: -32 dB re the phrase against
  int3's -51).
  Fixed in the audit below: the flow now comes from the smoothed profile per block, and it adds
  0.2 dB to the closures' 80-500 Hz where it added 3.1 (7 in the female and child "stops"). The
  rest of the excess is not the wall flow.
- The /t/ releases after /s/ (/stɹ/ at 0.445 s, "street" at 3.115 s) burst 13 to 16 dB over
  CHIMERA's above 2 kHz.
- DTW: the two strengths renders above, from obstacle 18.

## The self-oscillating folds' onset chirp (2026-11-12)

Heard on the listening page: the self-oscillating folds (glottis 1) put a short chirp at some
onsets. Three causes, each measured in scratch chirp/ and fixed:

- A 1.5 kHz tone while the folds closed after a voiceless stop. The airway set the folds' rest
  once a block (32 samples at 48 kHz), so a fast adduction moved the glottis in steps at 48000 /
  32 = 1500 Hz and rang the tract: the 1.5 kHz band ran 20 to 35 dB over the pulse's from 1.078
  to 1.093 s in the female "twinkle". The rest now ramps across each block, as the pulse ramps its
  opening (FoldOscillator rest1To, rest2To, rampLeft). Frames with a 1.5 kHz line 15 dB over the
  pulse's, over all 21 renders: 470 before, 60 after, the rest male harmonics near 1.5 kHz, not a
  line. The line's prominence in a 10 ms adduction (test/dsp-osc/fold-oscillator.test.ts): 9.2 dB
  before, under the pulse's plus 6 after.
- The voicing flag stayed 1 from the first cycle on (a count since reset), and abducted folds
  shiver by micrometres, so turns alone also read as voicing (0.5 after 60 ms at 0.3 cm^2). A cycle
  now counts as voiced when the area swings by 20 percent of its mean; voicing is whether one
  came in the last 1.6 target periods, smoothed at 25 Hz as the pulse's gate is.
- Onsets 1 to 2.7 semitones sharp, sliding down over 60 to 100 ms. The shiver's turns (44 to 854
  Hz under a 460 Hz target) reached the servo and moved its correction before the note began, and
  the servo's 40 ms took the rest that long. The servo now tunes only on cycles that swing the
  area by 3 percent; its time constant shrinks by 1 + |error| / 40 cents when a full cycle's error
  agrees with the cycle before. Mean |f0 difference| from the pulse over twinkle and melisma, 3
  bodies: 28.2 cents before, 19.5 after; frames over 50 cents 683 to 360. Onsets still begin up to
  280 cents sharp in the child body, settling in 30 to 40 ms: the pressure under the closing folds
  overshoots (10 against 6 to 8 cmH2O).
- Not fixed: near 500 Hz (female melisma, /o/) f0 meets F1 and the folds lock to it, about 100
  cents flat with the servo at its working limit. That is source-tract interaction, which the
  `tuning` setting addresses as a singer does.

## Audit of the onset fix (2026-11-13)

An audit of bf9fe42, with an independent review, found five faults; each has a test that fails
on the code before it.

- The fold voicing was blended with the pulse's pressure gate: beginBlock() still moved it toward
  the gate, then foldBlock() moved it toward the folds, so it settled near the mean of the two
  (0.40 before the folds' first cycle). The gate now runs for the pulse only.
- The ramp restarted each block from a rest computed afresh, so a change of chink, fold length or
  press between blocks still stepped the area. Rest, chink and length now ramp on from where the
  last block ended (FoldOscillator chinkTo, lengthTo).
- The speed-up chased the pressure. In a voiced closure f0 falls as the pressure backs up, two
  full cycles agree, and the speed-up took the correction from 1.08 to 1.76 in 25 ms; past the
  servo's 1.6 ratio limit every cycle was then ignored, and the child's /bɑ/ in "stops" sang 0.5 s
  at 1.8 times its note. The speed-up now runs only in the first 50 ms after a voicing gap, a run
  of three full cycles far off on one side is chased at the limit ratio, and the servo's memory of
  the last error clears at a gap.
- The plain servo also chased the dips. Each cycle now counts by a weight from the airway: down
  from 1 to 0 as the pressure above the folds rises from 0.1 to 0.3 of the pressure under them
  (vowels under 0.08 in 95 percent of frames in every body, closures 0.2 to 0.97), and as the
  opening rises from 0.03 to 0.08 k^2 (voiced vowels hold 0.0147 k^2). Over a 60 ms lip closure the
  correction moves 63 cents (641 before); through an aspirated stop's opening, 0 to 4 cents (77 to
  403 before), so the next onset no longer starts on a wound-up tension.
- The moving-wall flow was differenced across the 10.7 ms keyframe, so it stepped there and ran
  ahead of the smoothed areas; and the lengths and incisors were interpolated straight while the
  areas eased, so the volume's rate turned at every keyframe (228 cm^3/s in one block at a /t/).
  The drive now differences the smoothed profile per block and smooths the lengths and incisors
  with the areas. Low band in voiceless closures: -45.4 dB re the phrase before, -48.5 after; with
  the flow removed, -48.7. Fricative shape distance to the human: 10.13 dB before, 10.02 after.

Measured on all 21 self-oscillating renders against the pulse: mean |f0 difference| 18.1 cents
before, 13.2 after; frames over 50 cents 1378 to 1114. The 1.5 kHz scan flags 62 frames, all in
the male body, each sampled one an integer harmonic (9th to 13th). Twinkle and melisma alone went
from 19.5 to 21.9 cents: the dips of voiced consonants are now left in, and the pulse they are
measured against has none. That is a choice by ear, not a gate.

## Release audit (2026-11-13)

Three independent reviews before the merge to main: the docs and site against the code, the voice
code, and the English lyric reader.

- Voice code: no NaN or blow-up at any parameter extreme, sample rate (8 to 192 kHz) or note, and
  no allocation on the audio path. Three faults, each fixed with a test that fails on the old code:
  the self-oscillating folds started a note on the last note's pressures (a reused voice parted from
  a fresh one at sample 19); a glottis change moved the sounding note's rest (2.4 dB) though it waits
  for the next note; and with a long glide a short opening note was sung at the second note's pitch,
  because its bend reached the fresh voice at the NoteOn and snapped. The first bend now waits half
  its note. Left open: level rises steeply with pitch (about -31 dB at 80 Hz, -7 at 1200 Hz, peaks
  over 1.0 above 1.3 kHz), and a female /ɑ/ at 880 Hz on the self-oscillating folds locks to F1.
- Lyric reader: 202 English rules scored against the CMU dictionary went in ahead of CHIMERA's,
  with a table of irregular words and contractions and stress on the first full vowel. Exact against
  CMU: 77.0 percent of 469 common lyric words (49.7 before), 74.8 of 397 inflected ones (9.6). A word
  with no vowel ("hmm", "TV") now keeps its note on its most sonorous sound instead of vanishing and
  moving every later syllable a note early. Fire, hour and desire stay one syllable, a sung word's
  one note. The CHIMERA golden cases these change moved to the module tests beside upstream's reading.

## The phases, each with a gate

0. **Is the tube enough?** A float Kelly-Lochbaum tract at 48 kHz, driven both by CHIMERA's own
   exported articulator tracks and by bellows' planner over CHIMERA's postures, on the listening
   page beside the current voice and CHIMERA. Gate: the owner's ear, plus LPC formant tracks and
   band energies against CHIMERA. Running now in scratch.
1. **Reduced rate and the high band.** The same at 24 kHz internal. Gate: no measurable loss
   against phase 0 under 6 kHz, and the 6 to 16 kHz band within a few dB of CHIMERA on /s/ /ʃ/.
2. **Aerodynamics.** The three-state ODE driving bursts, aspiration, voice bar and source-tract
   interaction. Gate: stop and fricative intelligibility by ear, voice bar decay and burst timing
   against CHIMERA's renders.
3. **Articulator modes.** Offline sampling of CHIMERA's articulatory model, PCA, fitted posture
   coordinates. Gate: every posture's first four resonances within a few percent of CHIMERA's
   frequency solver.
4. **Fixed point.** Int32 core, bit-exact TypeScript and C++ from one specification. Gate: an
   equality parity row, and no audible or measurable loss against float.
5. **Into the library.** The `vocal` engine keeps its id, parameters and `sing()`; only its inside
   changes. The formant engine stays as `formant`. Gates: everything in docs/KICKOFF.md VERIFY,
   golden renders, allocation tests.
6. **Embedded.** The same integer core as a header, a stored phoneme score from the host planner,
   CC for live phonemes. Gates: parity equality, size report, a real board run at 1, 4 and 8
   voices on a Teensy and an ESP32-C3.

## What is certain and what is not

Certain, because it is mathematics: the tube is a lattice and is stable for positive areas; the
integer core is bit-exact across machines; running the tube at half rate costs about a quarter.
Measurable and not yet measured: the cost figures above, and whether 24 kHz loses anything the
ear hears. Not certain until someone listens: whether this sounds as natural as CHIMERA. CHIMERA
solves real airflow with kinetic losses and moving walls, and the lumped model approximates
those; the bet is that the ear hears the tract shape, the noise placement and the coupling far
more than the second-order aerodynamics, and phase 0 and phase 2 are where that bet is tested.

## Credit

The tract shapes, the articulatory model the modes are drawn from, the frication source
placement and the gestural timing all come from CHIMERA by Jameson Hodge (MIT), and are credited
in every file that carries them and in THIRD_PARTY_NOTICES.md. The lattice and waveguide theory is
Kelly and Lochbaum (1962) as presented by J. O. Smith; the parametric area model is Story (2005);
the calibration method follows Südholt, Cámara, Xu and Reiss (2023). Pink Trombone (Neil Thapen) is
the proof that a waveguide tract runs comfortably in a browser.
