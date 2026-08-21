# The embedded documentation, replanned

A plan, not a change. Written 2026-08-21 against the nine pages under
`apps/workbench/src/docs/embedded/` and the seventeen examples under
`packages/bellows-embedded/examples/`.

The complaint that started it: the embedded docs are deeply technical and do not
suit someone who wants to write music. That is correct, and this document works
out why, what good looks like, and what to do about it in an order that can be
executed and checked.

`docs/DOCS-RESEARCH.md` is the evidence behind it, from programming education,
maker documentation and studies of how developers use documentation. Six of its
findings changed this plan after it was first written, and each of those is
marked below with **(research)** so the reason is traceable rather than a matter
of taste.

## 1. The diagnosis

### 1.1 Two of the four kinds of documentation are missing entirely

[Diátaxis](https://diataxis.fr/) splits documentation into four modes on two
axes, practical against theoretical and specific against general: **tutorials**
(learning), **how-to guides** (a task), **reference** (facts), **explanation**
(understanding). Its central claim is that these serve different needs and that
conflating them is the root of most documentation trouble.

Classify the nine embedded pages honestly:

| page | what it actually is |
| --- | --- |
| Getting started on hardware | explanation and reference, with a sketch at the end |
| The shape of a program | explanation |
| Output and wiring | how-to, buried, mixed with a comparison table |
| Engines | reference |
| Effects | reference plus explanation |
| Voices | reference plus explanation |
| Sequencing on hardware | reference |
| Theory on hardware | reference plus explanation |
| Performance | explanation plus reference |

**There is not one tutorial and there is one half of a how-to.** Nine pages sit
in the theoretical half of the grid. Nothing is learning-oriented and almost
nothing is task-oriented. This is not a case of the modes being blended; two of
them were never written. A reader who wants to make music arrives at a library
that only knows how to describe itself.

### 1.2 The first screen answers the second question

`Getting started on hardware` opens with header-only, nothing allocates, nothing
self-registers, 41 parity rows and 428 value rows, then six rules about linkers
and `Init()`, then a table of flash and RAM.

Every one of those facts is true, hard won, and machine-checked. They are also
answers to **"should I depend on this?"**, which is the question a reader asks
second. The first question is **"can I make something?"** Trust evidence
presented before the first sound is a withdrawal from an account that has had no
deposit.

This is worth stating plainly because it cuts against the repository's
instincts, which are good instincts: prove everything, quote the measurement,
never overclaim. None of that changes. The evidence moves to where it answers a
question the reader is actually asking, and the tutorial links to it.

### 1.3 The examples are named after mechanisms

`01_OneKick`, `03_PolySynth`, `06_FirstSteps`, `20_Instruments`. A musician
scanning the File, Examples menu reads a list of engineering demos, in an order
that encodes an internal taxonomy (00 bring-up, 01 to 07 logic, 10 to 17 output
paths, 20 to 21 catalogues) that nobody outside this repository knows.

There is no example that is a piece of music somebody would want to hear, except
the three workstation ones, which are the most advanced in the set.

### 1.4 The one real asset is buried

**bellows can let somebody hear a microcontroller synth without owning a
microcontroller.** The simulator runs the TypeScript implementation of the same
DSP the C++ compiles from, and the difference between the two is measured on
every commit: 41 parity rows, 428 value rows, 1054 preset values.

Mozzi cannot do this. The Teensy Audio Library cannot do this. DaisySP cannot do
this. In every one of those, the path to the first sound runs through buying a
board, wiring an output and installing a toolchain.

It is the single strongest thing this project has for a newcomer and it appears
nowhere in the embedded documentation's opening.

## 2. What good looks like, from libraries that have solved this

**Mozzi** opens with the promise, not the architecture: your Arduino can
currently only beep like a microwave oven, and here is what it could do instead,
with audio you can play on the landing page before installing anything. The
quick start is a four-function template. The audience is explicitly creative
technologists rather than audio engineers.

**Sonic Pi** opens with a person: "Hopefully you're as excited to get started
making your own sounds as I am to show you." The first instruction is to paste
code and press Run, before any explanation, with "don't worry if you don't
understand much (or any) of this" and "there are no mistakes, only
opportunities." It frames the reader as a performer rather than a student of
syntax.

**Strudel** scaffolds First Sounds, First Notes, First Effects, Pattern Effects,
recap, and states up front that no programming knowledge is required.

**The Teensy Audio Library** leads with a visual patcher that generates the
code, which is why it is the one embedded audio library beginners actually get
sound out of. Its documented weakness is the one that matters here: it covers
technical specification thoroughly and says almost nothing about musical
choices, so a musician gets a working patch and no idea what to set anything to.

**Adafruit's guides** are the reference standard for hardware: exact parts with
links, photographs, a wiring diagram, and no assumed knowledge.

The common thread is not simplification. It is **sequence**. Every one of them
puts a result before an explanation, and none of them is less rigorous further
in.

## 3. The psychology, since the request asked for it

**Self-efficacy comes from mastery experiences.** Belief that you can do a thing
is built mostly by having done a smaller version of it. The fastest mastery
experience available here is hearing a sound you caused. So the tutorial's unit
of progress is a sound, not a concept, and there should be one every few
minutes.

**Working memory is the binding constraint.** Cognitive load theory splits load
into intrinsic (the material) and extraneous (everything else). The intrinsic
load of C++ plus hardware plus audio is already near the ceiling. Flash tables,
parity counts and linker behaviour on the tutorial path are pure extraneous
load: they consume the same scarce resource and teach nothing the reader can use
yet.

**Identity is decided in the first screen.** A reader who wants to write music
and meets `--gc-sections` concludes, correctly, that the document was written for
somebody else, and leaves. This is not about intelligence or effort. It is a
judgement about whether the room is theirs. The counter is to address them as
what they are: someone who wants to make a beat.

**The curse of knowledge is the mechanism that produced these docs.** Everything
in them is there because it mattered to somebody who already understood the
system. `Init()` ordering matters enormously, once. It does not matter on page
one, and putting it there does not protect the reader, it filters them.

**Permission to fail lowers the cost of the first attempt.** Sonic Pi's "there
are no mistakes, only opportunities" is doing real work. On hardware the
equivalent is telling somebody what silence means before they hit it, because
silence with no error is the characteristic failure of this whole domain and it
reads as personal incompetence.

**Progressive disclosure keeps the depth without spending it early.** The
technical material is an asset for the reader who wants it. Layer it: hear it,
change it, build it, understand it, optimise it. Each layer complete on its own,
each linking down.

## 4. The proposed structure

Four trees, in Diátaxis order, with the tutorial visually first.

### 4.1 Tutorial, new, four pages, one path, no choices

One narrative. No alternatives, no digressions, no "you could also". Each page
ends with something audible and one obvious next step.

**(research) Each page follows PRIMM**, which is the mainstream model for
teaching text-based programming and is built on Use-Modify-Create: predict, run,
investigate, modify, make. The first draft of this plan had only Use and Modify,
play a firmware and drag two sliders, and was missing the two stages that turn
listening into learning.

- **Predict** before every `listen` block. "Decay is 0.35 seconds. What happens
  if you drag it to 2.0? Decide, then find out." Committing to a guess before
  seeing the answer is the cheapest intervention available in a written page.
- **Investigate** after it. Show the code, ask the reader to FIND the line that
  did what they just heard. Finding, not explaining.
- **(research) Each page ends by repacking.** Semantic waves: an explanation
  works by unpacking an abstract idea into something concrete and then packing
  it back up under its proper name. A tutorial that only ever descends produces
  somebody who can follow the tutorial and build nothing else. So every page
  closes with one or two sentences naming what the reader just did in the
  library's vocabulary.
- **(research) The pages reuse the same programs** rather than a fresh one each
  time, so the reader meets a familiar shape repeatedly and starts to chunk it.
  Chunking is what makes code reading stop costing working memory per token.

1. **Make a sound.** In the browser, no install, no board. A kick drum, a play
   button, then change two numbers and hear the difference. One signposted exit
   at the top for readers who already own a board and want hardware now, because
   that costs one sentence and respects them.
2. **Make a beat.** Snare and hat, then a euclidean pattern. Ends with a groove.
3. **Give it a tune.** Notes, a scale, a melody over the beat.
4. **Put it on a board.** Only now. What to buy, three wires, paste, upload,
   hear the same beat out of a speaker. Adafruit rules: exact parts, a diagram,
   nothing assumed.

Hard constraint: **no page in this path mentions flash, RAM, `--gc-sections`,
parity counts or `Init()` ordering** unless omitting it would make the reader
fail. Where a reader will want the depth, one link at the end of the page.

### 4.2 How-to guides, new, titled "How to ..."

Task-shaped, assume competence, action and only action, link out for the why.

- How to get sound out of a Teensy 4.x
- How to choose a board for what you are making
- How to play notes from a MIDI keyboard
- How to make a patch louder without clipping it
- How to fit a patch on a board that is too small
- How to hear a generated piece again (the seed)
- How to work out why it is silent

The last one is the highest-value page in this plan and does not exist in any
form today. Silence with no error is this domain's signature failure.

### 4.3 Reference, existing, cleaned

`Engines`, `Effects`, `Voices`, `Sequencing`, `Theory` are already good
reference and mostly stay. The work is subtraction: the explanatory passages
inside them move to Explanation, so reference is facts and lookup. Keep the
`Params` tables, the defaults, the costs.

Two additions, both **(research)**:

- **Lead with a snippet, not a table.** An observation study of how developers
  use documentation found they scan results linearly until one has a code
  example, repeating up to a dozen times. A reader scanning for code should hit
  code. The tables stay, underneath.
- **One line of scenario per engine.** The field study of API learning
  obstacles, over 440 developers, named "matching the API to scenarios" as one
  of five factors.

  **Corrected on 2026-08-21, after reading the page rather than the plan.**
  This gap is smaller than stated above: the engine sections already carry the
  scenario sentence. `Kick` says "For kick drums, and for any short pitched
  thump", `Pluck` says "For guitars, harps, koto, and every plucked thing".
  What is true is that the sentence comes second, after the mechanism. That is
  a reordering rather than the rewrite this entry implied, and it is not worth
  ten section rewrites to do it.

### 4.4 Explanation, existing, gathered and added to

`The shape of a program` and `Performance` are already explanation and are
strong. Add one page that does not exist and should: **how the browser and the
board stay the same**, which is where the parity numbers belong. It is the most
interesting claim this project makes and it is currently scattered as evidence
in a getting-started page.

## 5. The site

The tree is the smaller half. Three changes carry most of the value.

1. **Playable examples inside a docs page.** `DocsView` renders markdown with
   `marked` into `v-html` and can embed nothing. Add a fenced block, for example
   ` ```listen ws-piezo `, that mounts a play button wired to the existing
   firmware catalogue. The plumbing exists: `FIRMWARES`, `buildVoice`, and the
   `HEAR IT` button in `CodeView.vue`, which needs extracting into a component.
   Without this the tutorial is a page about sound rather than a page that makes
   sound, and the whole advantage in 1.4 stays unused.
2. **The embedded docs landing changes from a description to an invitation.**
   Sound first, one sentence on what this is, then the path.
3. **The tree groups by mode**, tutorial first and marked as the way in.

## 6. The examples

**Do not rename the folders.** They are published API now: 0.1.2 is on both
registries and the Arduino IDE lists those names in File, Examples. Renaming
breaks every existing tutorial reference and moves figures in `examples/README.md`,
`OUTPUTS.md`, the `check-docs` example rows, the size sketches, `build-matrix.sh`
and `sources.gen.ts` for cosmetic gain.

Instead:

- Give each example a **musical one-line title** in the docs and on the site,
  beside the folder name. `01_OneKick` becomes "One kick drum, the smallest
  program that makes a sound (`01_OneKick`)".
- Publish a **curated order** for reading, which is not the numeric order.
- Add **two or three examples that are pieces of music** rather than
  demonstrations of a subsystem, at a size that fits a 4.x, and say plainly
  which boards they do not fit.

## 7. Order of work, and what each step is worth

| step | work | why it is in this position |
| --- | --- | --- |
| 1 | Extract the `HEAR IT` player, add the `listen` fenced block | Everything in the tutorial depends on it |
| 2 | Write the four tutorial pages | The missing mode, and the one the complaint is about |
| 3 | Rewrite the embedded docs landing | First screen, cheap, and it decides who stays |
| 4 | Write "How to work out why it is silent" and the wiring how-to | The two failures that stop people |
| 5 | Regroup the tree by mode | Makes the above findable |
| 6 | Move explanation out of the reference pages, add the parity page | Reference becomes lookup, the best claim gets a home |
| 7 | The remaining how-tos | Steady value, no longer blocking |
| 8 | Musical titles and a curated order for the examples | Cosmetic until the rest lands |
| 9 | Two or three musical examples | Largest new work, and it needs the size gates updated |

## 8. What this plan deliberately does not do

- **It does not remove or soften a single measured claim.** The evidence is the
  reason to trust this library. It moves to where it answers a question the
  reader is asking, and the tutorial links to it.
- **It does not simplify the reference.** A musician who gets three pages in
  wants to know what `bowPressure` does, and the reference already says.
  **(research)** There is a name for why this would be a mistake: the expertise
  reversal effect. Guidance that helps a novice measurably harms an expert, who
  does better with it removed. The nine existing pages are not bad
  documentation, they are documentation for a reader with prior knowledge, and
  padding them with hand-holding would make them worse for the people they
  currently serve. That is also the failure condition for this whole plan: if
  the tutorial leaks into the reference, the change has done damage.
- **It does not rename anything published.**
- **It does not add a claim that has not been checked.** Anything the tutorial
  asserts about hardware has to be true of a board someone has actually run,
  which today is one Teensy 4.0 and one program.

## 9. How to tell whether it worked

- **Time to first sound**, from landing on the embedded docs to hearing
  something. Today: install a library, buy and wire a board, compile. Call it
  thirty minutes and a purchase. Target: under a minute, in the browser.
- **The tutorial can be followed by somebody who has not read anything else**,
  end to end, without leaving the path to understand a step.
- **Every page in the tutorial produces a sound**, and every page in the how-to
  section names a task in its title.
- The technical material is still reachable in one click from the page that
  needed it.

---

# Part II: the execution plan

Part I is the argument. This part is what gets done, in order, with the files
named and the gates each step moves. Written after reading the machinery rather
than against an imagined version of it, so the constraints below are real ones.

## 10. What the machinery actually allows, checked

Five facts that shape everything after this. Each was read out of the code, not
assumed.

1. **A docs page cannot mount a component today.** `DocsView.vue` does
   `md.parse(page.body)` into a single `<div v-html="html">`, and `v-html`
   cannot instantiate a Vue component. Anything interactive needs the body
   rendered as a sequence of parts rather than one string.
2. **The on-this-page list is built from `md.lexer(body)`**, not from the DOM,
   and it filters `heading` tokens at depth 2. A fenced block is a `code` token,
   so splitting the body on fences leaves the table of contents untouched.
3. **`buildVoice(b, firmware, params)` returns a `RunningVoice`** with
   `step(index, timeSec)`, `setParam(key, value)` and `stepsPerBeat`. Driving it
   is a `setTimeout` loop of about ten lines. This is the whole of what the
   simulator does to make sound.
4. **`stop()` in `SimulatorView` calls `disposeBellows()`**, which tears down the
   instance the whole app shares, and `ensureBellows(seed)` with a seed reboots
   it. A docs player must do neither, or two players on one page would kill each
   other.
5. **`treeOf()` keys on the `emb-` slug prefix**, and the tree switch lands on
   `pagesFor(tree)[0]`. So a new group placed first in `EMBEDDED_DOC_GROUPS`
   becomes what a visitor sees when they press EMBEDDED, with no routing change.

And two couplings that will bite if ignored:

6. **`check-docs.mjs` gates the two site doc pages by path.** `getting-started.ts`
   carries eight size rows and four prose claims; `performance.ts` carries eight
   rows and six claims. Moving that content moves those registrations, and the
   checker fails loudly with ROW NOT FOUND rather than quietly, which is what it
   is for.
7. **No slug is referenced outside the docs tree.** Fourteen cross-links between
   the embedded pages and nothing in `README.md`, `packages/`, or `docs/`. So no
   existing slug has to change and no link breaks. Every new page is additive.

## 11. Step 1: make a docs page able to make a sound

Nothing else in this plan matters if a tutorial page can only describe sound.

**New: `apps/workbench/src/lib/docs-player.ts`**

A module-level registry, because the page may hold several players and the app
holds one `Bellows`. Exports a `claim(id)` that stops whoever is playing and
records the new owner, and a `release(id)`. Ten lines, one concept.

**New: `apps/workbench/src/components/docs/ListenBlock.vue`**

Props: `firmware` (an id from `FIRMWARE_BY_ID`), `params` (an optional list of
param keys to expose as sliders), `label`, and **`predict`**, a question shown
above the play button and left on screen while it plays. The predict slot is not
decoration: it is the P in PRIMM and the reason the block exists rather than an
audio tag.

- One play button, one stop, and the named sliders. Nothing else.
- `ensureBellows()` **with no seed**, so it reuses the shared instance instead of
  rebooting it.
- Its own ten-line step loop. It deliberately does NOT reuse `SimulatorView`'s,
  which carries pot handling and an output stage that a docs page has no use
  for; unifying them is a refactor of a working page in service of a new
  feature, and that is the wrong order. If the two loops turn out identical
  after both exist, unify then.
- On stop: clear the timer, `voice.dispose()`, `release(id)`. **Never**
  `disposeBellows()`.
- `onDeactivated` and `onBeforeUnmount` stop it, so navigating away is silent.
- `buildVoice` and the firmware catalogue are pulled in by a dynamic `import()`
  inside the click handler, so `voices.ts` and `firmware.ts`, which are over a
  thousand lines together, stay out of the docs bundle for readers who never
  press play.

**Edit: `apps/workbench/src/views/DocsView.vue`**

Split the body before parsing. A `segments` computed turns the markdown into an
ordered list of `{ kind: 'md', html }` and `{ kind: 'listen', firmware, params,
label }`, and the template becomes a `v-for` over it. `onArticleClick` stays on
the article element and keeps working by delegation.

**The fence syntax**, chosen so it is inert in any other markdown renderer and
so the generated `llm.txt` tooling sees an ordinary code block:

    ```listen onekick params=decay,drive
    Hear a kick drum. Drag decay.
    ```

Fence line: the word `listen`, the firmware id, then optional `key=value`. The
body is the caption. A fence naming an id that is not in the catalogue must fail
the build rather than render an empty box.

**Gate:** a new `npm run check:listen -w apps/workbench` that scans every doc
page for `listen` fences and asserts each firmware id exists and each named
param is a real key on that firmware. This is the same class of gate as
`check:catalogue`, and it exists because a typo in a fence is silent: the block
just would not play. Mutation tested by pointing a fence at `onekickk`.

**Verify:** `npx vue-tsc`, `npm run build -w apps/workbench`, the new gate red
then green, and press play in a browser on a page with two blocks and confirm
starting the second stops the first.

## 12. Step 2: the four tutorial pages

New files under `apps/workbench/src/docs/embedded/`, new slugs, all `emb-`
prefixed. No existing page is edited in this step, so it is purely additive and
reversible.

| file | slug | plays | reader ends with |
| --- | --- | --- | --- |
| `t1-make-a-sound.ts` | `emb-make-a-sound` | `onekick`, sliders `decay` `drive` | a kick they changed |
| `t2-make-a-beat.ts` | `emb-make-a-beat` | `drummachine`, sliders `bpm` `swing` | a groove |
| `t3-give-it-a-tune.ts` | `emb-give-it-a-tune` | `polysynth`, sliders `cutoff` `resonance` | a melody, and 50 instruments to try |
| `t4-put-it-on-a-board.ts` | `emb-put-it-on-a-board` | nothing, this one is hardware | the same sound out of a speaker |

All four firmwares already exist in the catalogue, so **step 2 adds no entry to
`FIRMWARES` and moves no `check:catalogue` figure.** That is deliberate: the
tutorial is assembled from programs that already compile, already have parity
rows, and already build for every board in the matrix.

**The tutorial pages quote no figures at all.** No flash, no RAM, no parity
count, no CPU percentage. That is the content rule from Part I, and it has a
useful consequence: there is nothing in these four pages for `check-docs` to
gate, and nothing that can go stale.

**T1's opening, which is the paragraph that decides whether the reader stays.**
Draft, to be edited but not softened in its shape:

> You are going to make a drum sound, change it, and hear the difference. It
> takes about a minute and you do not need a board, a soldering iron, or
> anything plugged in. Press play.
>
> (Already have a Teensy and want it making noise now? Skip to Put it on a
> board. Everything here works either way.)

No mention of C++, header-only, flash, or what the library is. What it is can
wait until the reader has heard it and has a reason to care.

**T4 has an honesty constraint that must not be lost.** The wiring it teaches,
a MAX98357A on pins 7, 21 and 20 powered from 5V, is the wiring that has
actually been run and heard, twice, because that is `17_WorkstationI2S`'s rig.
The sketch it teaches is `01_OneKick`, because that is the simplest thing to
send through it. So the page says the wiring has been run and does not imply
that this particular sketch has been heard on hardware. It also states what
silence means before the reader hits it.

**Wiring needs a picture, and there is a component for it.**
`components/sim/BoardDiagram.vue` already draws a Teensy with pins. T4 either
reuses it through a second fenced block, `wiring i2s-amp`, or ships a static
diagram. Decide when the page is written; the fenced approach is better and is
not free.

**Verify:** `vue-tsc`, `check:listen`, `check-docs` unchanged at 542, read all
four pages end to end in a browser and get sound on the first three.

## 13. Step 3: the way in

**Edit `apps/workbench/src/docs/embedded/index.ts`.** `EMBEDDED_DOC_GROUPS`
becomes, in this order:

```
Start here          t1 t2 t3 t4
How to              (step 5, empty until then)
Reference           engines effects voices sequencing theory
Understanding       program-shape performance getting-started
```

Because the tree switch lands on `pagesFor('embedded')[0]`, this one edit makes
`Make a sound` the page a visitor gets when they press EMBEDDED.

**`getting-started.ts` stops being the front door and becomes an explanation
page.** It is good writing aimed at the wrong moment. Retitle it to what it
actually is, roughly "What the port is and what it costs", and leave the body
largely alone. Its eight size rows and four prose claims stay in the same file,
so **`check-docs` needs no change in this step**. Renaming the file would move
those registrations; retitling the page does not.

Set `prev`/`next` across the whole tree so the chain reads in the new order.

**Verify:** `check-docs --check` still 542, `vue-tsc`, and click EMBEDDED to
confirm where it lands.

## 14. Step 4: the two pages that stop people

**New `h1-why-is-it-silent.ts`, slug `emb-how-silent`.** The highest-value page
in the plan and the one that does not exist in any form. Silence with no error
is this domain's signature failure and it reads to a beginner as their own
incompetence.

**(research) It is a bisection, not a checklist**, and this is the largest single
change the research made. Work on novice debugging finds that beginners default
to edit-and-test, changing things with no hypothesis, and that the skill actually
being taught is localisation: subdividing until the problem area is too small to
hide in. A checklist of causes ordered by frequency automates edit-and-test
instead of replacing it. So the page halves the signal path at each step:

1. Is the program running at all? The LED, or a serial print.
2. Is the DSP producing samples? Print a peak from the render callback.
3. Is anything reaching the pin? Another output path, or headphones on the line.
4. Is the far end powered and connected? The amplifier, the speaker.

**The first split is one this project can make and its competitors cannot.** The
same patch runs in the browser. If it sounds right there and silent on the
board, everything above the DSP is eliminated in a single step and the fault is
in the board half. That is a real bisection rather than an analogy, because the
parity harness measures how far apart the two implementations are. Build the
page around it.

Each item still ends in a symptom, a one-line check and a fix: `AudioMemory()`
not called or called before `Init()`, no output stage, wrong pins, a codec that
needs enabling, a level too low to hear, a patch that fits flash and overflows
RAM.

**New `h2-get-sound-out.ts`, slug `emb-how-output`.** The how-to extracted from
`emb-output`, which stays as reference. This one answers "I have a Teensy 4.x
and want to hear it", picks one path, names the part, gives the three wires, and
links to the comparison for the reader who wants to choose differently.

**Verify:** as step 2, plus check every pin number against the example headers
they come from rather than against the existing prose.

## 15. Steps 5 to 7: the rest of the how-tos, and the reference clean

The remaining how-tos from Part I section 4.2, then the subtraction pass that
moves explanatory passages out of `engines`, `effects`, `voices`, `theory` and
into Explanation, then the new page on how the browser and the board stay the
same, which is where the parity numbers belong.

That last page is the one place the 41 rows, 428 value rows and 1054 preset
values become interesting rather than defensive, because there the reader is
asking the question they answer. Moving the parity prose claim out of
`getting-started.ts` **does** move a `check-docs` registration, and that is the
one step in this plan that touches the checker.

## 16. Step 8: the examples

Folder names do not change, for the reason in Part I section 6: 0.1.2 is
published and the Arduino IDE lists those names.

- A `title` and `blurb` per example already exist in `FIRMWARES`. Audit them for
  musical rather than mechanical phrasing and fix in place.
- Publish a reading order that is not the numeric order, in the docs and on the
  CODE page rail.
- **(research) Add "try this" markers to the example headers.** Adafruit's own
  guide to writing guides says to comment the variables a user may want to
  change, because users should be able to learn from the code. The bellows
  headers are heavily commented and the comments explain WHY, which is excellent
  explanation and is not what somebody wants at the moment they would like the
  decay longer. Every parameter that `FIRMWARES` exposes as a slider gets a
  marker at its declaration giving a range worth trying, and that is gateable:
  a check that every exposed param has one.
- **(research) Audit coverage before writing anything new.** SparkFun's bar for
  an Arduino library is that a reader with no other documentation could use
  almost every feature by working through the examples alone. Which public
  classes appear in no example? That list is the specification for the new
  examples, instead of guessing at what would be nice to have.
- **New musical examples are a separate piece of work with a real cost**: a new
  folder needs a size sketch under `test/sketches`, a row in `examples/README.md`
  and in `check-docs`'s `EXAMPLES_ROWS`, an entry in `build-matrix.sh`, a
  `FIRMWARES` entry, a `buildVoice` case, `sources.gen.ts` regeneration, and a
  release to reach anybody. Two or three of them is a day, not an afternoon, and
  it should be scheduled as such rather than smuggled into a docs change.

## 17. What could go wrong, and what is done about it

- **Two players fighting over one `Bellows`.** The registry in step 1, and no
  `disposeBellows()` in the docs player.
- **Audio still running after navigating away.** `onDeactivated` and
  `onBeforeUnmount` in `ListenBlock`.
- **The docs bundle growing by a thousand lines of DSP glue.** Dynamic import
  inside the click handler.
- **A typo in a fence rendering a dead button.** `check:listen`, mutation
  tested.
- **Splitting the body breaking markdown that spans a fence.** Fences are
  block-level and must be at column zero with a blank line either side; the
  splitter asserts that rather than guessing.
- **The tutorial drifting from the library.** It quotes no figures and plays
  only firmwares that the parity harness already covers, so the two things that
  could drift are both already gated.
- **Scope.** Steps 1 to 4 are the change that answers the complaint. Steps 5 to
  8 are improvements that can land one at a time. Nothing after step 4 blocks
  anything before it.

## 18. The order, and where to stop and look

1. Step 1, the player and the gate. Nothing user-visible; everything depends on it.
2. Step 2, the four tutorial pages. **Stop here and read them.** This is the
   point at which the complaint is either answered or not, and it is worth a
   real look before more is built on it.
3. Step 3, the tree order and the retitle. Small, and it is what makes step 2
   findable.
4. Step 4, silence and wiring.
5. Steps 5 to 8, in any order, as time allows.
