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
