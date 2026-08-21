# What the research says, and what it changes here

Companion to `docs/DOCS-PLAN.md`. That file argues for a restructure; this one is
the evidence behind it, from three literatures: how people learn to program, how
maker documentation is written, and how developers actually use documentation.

Every section ends with **what it changes**, because a reading list that changes
no decision is not research, it is decoration. Six of these changed the plan.

## 1. Start from working code, not a blank page

**PRIMM** (Predict, Run, Investigate, Modify, Make) is the current mainstream
model for teaching text-based programming in schools, from Sentance and Waite.
Its core move: rather than copying code or writing programs from scratch,
beginners start by reading working code. It builds on Use-Modify-Create, on
levels of abstraction, and on code comprehension research. In trials, learners
performed better than a control group and teachers reported it worked across
mixed ability.

**Use-Modify-Create** (Lee and colleagues, 2011) is the progression underneath
it: interact with somebody's artifact, modify it until it becomes yours, then
make your own. The measured effect worth knowing: UMC learners showed **no spike
in difficulty** during coding tasks, where traditional groups showed a
significant one. The framing is ownership, moving the learner from consumer to
creator.

**The worked example effect** says the same thing from cognitive load theory:
studying a worked example before attempting a problem beats attempting it cold,
because the example spends the learner's working memory on the principle instead
of on the search.

**What it changes.** The plan already had Use and Modify: play a firmware, drag
two sliders. It was missing **Predict** and **Investigate**, and those are the
two stages that turn listening into learning.

- Add a prediction prompt before each `listen` block. "Decay is 0.35 seconds.
  What do you think happens if you drag it to 2.0? Decide, then find out."
  Committing to a guess before seeing the answer is the cheapest intervention
  available in a written page.
- Add a short investigate beat after it: show the code and ask the reader to
  find the line that did the thing they just heard. Not explain it. Find it.
- **Honest limit**: PRIMM's evidence comes from classrooms with a teacher and
  peer discussion. A documentation page has neither. The mechanism transfers
  better than the study design does, so this is reasoned adoption, not a claim
  that the trial result applies to a web page.

## 2. Unpack, then repack

**Semantic waves**, from Legitimation Code Theory via Maton and applied to
computing by Waite, describes good explanation as a wave: take an abstract,
densely packed idea, **unpack** it into something concrete and familiar, then
**repack** it back into the abstract term now that the reader has something to
attach it to. Lessons that work show clear waves. Flat lines fail at both ends.

This names both failure modes precisely.

- **Flat at the abstract end** is the current embedded documentation. High
  density, no descent into the concrete. The reader never gets a handhold.
- **Flat at the concrete end** is the tutorial I was about to write. All steps,
  no repacking, producing somebody who can follow the tutorial and cannot build
  anything else, because no step was ever given a name they could reuse.

**What it changes.** Every tutorial page ends with a **repack**: one or two
sentences naming what the reader just did in the library's own vocabulary. "The
thing you have been dragging is a parameter on a voice. A voice is one sound
that can be playing; the pool that holds several is the next page." Short, and
not skippable, because it is the whole transfer mechanism.

## 3. Guidance that helps a beginner harms an expert

The **expertise reversal effect** (Sweller, Kalyuga) is the most useful finding
here and the least intuitive. Instructional techniques reverse in value as
expertise grows: worked examples and heavy guidance help novices and measurably
**hurt** advanced learners, who do better with the guidance removed. Kalyuga:
"instructional guidance, which may be essential for novices, may have negative
consequences for more experienced learners."

**What it changes.** It settles a question the plan was answering on taste.

The existing nine pages are not bad documentation. They are documentation for a
reader with prior knowledge, and for that reader the tutorial being proposed
would be worse than what exists, not better. So the correct move is **additive
and segregated**, which is what the plan does: a tutorial path for the reader
who needs guidance, the existing reference and explanation kept intact and
reachable in one click for the reader whom guidance would slow down.

This also sets the failure condition. If the tutorial ends up padding the
reference pages with hand-holding, the change has made the docs worse for the
people they currently serve.

## 4. Working memory is the constraint, and chunking is the mechanism

Felienne Hermans' work on the cognitive science of code reading covers the same
ground the plan reached from cognitive load theory, with one addition worth
having: **chunking**. An expert reads unfamiliar code by matching it against
patterns already in long-term memory. A beginner has no chunks, so every token
costs working memory separately, which is why unfamiliar code overloads and why
code reading, not code writing, is where the difficulty starts.

**What it changes.** Nothing structural, and it sharpens two things. First, it
is the reason PRIMM starts with reading rather than writing: reading is where
chunks are built. Second, it argues for the tutorial reusing the SAME programs
across pages rather than a fresh one per page, so the reader sees a familiar
shape three times and starts to chunk it.

## 5. Debugging is localisation, and a checklist does not teach it

Research on novice debugging is consistent: beginners struggle in the gap
between seeing a failure and forming a concrete, testable explanation, and they
default to **edit-and-test**, making superficial changes with no hypothesis. The
skill being taught is narrowing: subdividing the flow until the problem area is
too small to hide in.

**What it changes.** This is the biggest single change to the plan.

"How to work out why it is silent" was going to be a checklist of causes ordered
by frequency. A checklist is exactly what a beginner does anyway; it automates
edit-and-test instead of replacing it. The page becomes a **bisection of the
signal path**, where each step halves what is left:

1. Is the program running at all? The LED, or a serial print.
2. Is the DSP producing samples? Print a peak level from the render callback.
3. Is anything reaching the pin? A different output path, or headphones on the
   line.
4. Is the far end powered and connected? The amplifier, the speaker.

And bellows has a diagnostic here that no comparable library can offer, which is
worth building the page around: **the same patch runs in the browser.** If it
sounds right there and silent on the board, everything above the DSP is
eliminated in one step, and the fault is in the board half. That is a real
bisection, not an analogy, because the parity harness measures how far apart the
two implementations are.

## 6. Maker documentation has a house style, and it is mostly about parts and pictures

From Adafruit's own guide to writing Adafruit guides, which is the reference
standard in this space:

- First page is **Overview**, with a graphic near the top and one paragraph
  saying what the thing is.
- The **parts list goes at the bottom of the Overview**, and appears twice: as a
  sidebar and in the body. Five parts or fewer get full product cards; six or
  more get a compact list of name, link and description, so a reader can build a
  shopping list.
- **Pictures beside steps**, not after them: text right, images left, and never
  more than four images in one such block.
- **Wire colour is a convention, not a choice**: red positive, black ground.
- **Code lives in the repository and is embedded by URL**, so a guide cannot
  drift from the code it teaches.
- Comment the code for the reader, specifically at board setup, at definitions,
  at **the variables a user may want to change**, and at major sections. Their
  stated reason: users should be able to learn from the code.
- Explain how the code works **after** the code block, not before it.
- There is a launch checklist, and guides are not published until they pass it.
- Point of view is deliberate: "I" for things the author did, "we" for the
  project, "you" for the reader.

**What it changes.** Two concrete additions.

- T4, the hardware page, follows the parts-and-pictures pattern exactly: named
  parts with links at the bottom, a diagram with conventional wire colours, and
  the steps beside the pictures.
- **The example headers get "try this" markers.** The bellows examples are
  heavily commented, and the comments explain *why*, which is excellent
  explanation and is not what a musician needs at the moment they want the decay
  longer. Every parameter that `FIRMWARES` exposes as a slider should carry a
  marker at its declaration giving a range worth trying. That is gateable: a
  check that every exposed param has one.

## 7. Developers do not read documentation, they scan it for code

An observation study of how developers use documentation found the behaviour is
to search, then go through results linearly **until one has a code example**,
repeating up to a dozen times. Code examples are wanted as first-class
artifacts, not illustrations.

The larger field study of API learning obstacles, across more than 440
professional developers at Microsoft, found the severest obstacles were in the
documentation itself, and named five factors: **documentation of intent, code
examples, matching the API to scenarios, penetrability, and presentation**.
"Matching the API to scenarios" is the one this project has least of: the
reference says what `Pluck` is and does not say what you would reach for it to
make.

The **Write the Docs** principles agree and add several that this repository
already lives by, one of which is worth quoting because it is the argument for
`check-docs.mjs`: *consider incorrect documentation to be worse than missing
documentation*. Their other load-bearing ones here are **Skimmable** (structure
so a reader can skip what they know), **Exemplary** (examples for common cases,
and not for everything, because too many hurt skimming), and **Cumulative**
(order so prerequisites come first).

SparkFun's guidance for Arduino libraries sets the bar for the examples
themselves: a reader with no other documentation should be able to use almost
every feature by working through the examples alone.

**What it changes.**

- **Reference pages lead with a snippet, not a table.** A reader scanning for
  code should hit code. The tables stay, below.
- **Each engine gets one line of scenario**, which is the "matching to
  scenarios" gap: what you reach for it to make, in musical words. `Pluck` is
  not "a Karplus-Strong loop", it is "guitars, harps, anything with a string".
  Both sentences belong, in that order.
- **An audit against SparkFun's bar**: which public classes appear in no
  example? That list is the specification for the new examples in step 8 of the
  plan, rather than guessing at what would be nice to have.

## 8. What none of this justifies

Worth writing down, because research is easy to point at while doing whatever
you were going to do anyway.

- It does not justify removing or softening a measured claim. The Write the Docs
  principle about incorrect documentation cuts the other way.
- It does not justify simplifying the reference pages. Expertise reversal says
  that would make them worse for the readers they currently serve.
- It does not justify a friendly tone as an end in itself. Sonic Pi's warmth
  works because a sound arrives in the first thirty seconds; without that it is
  just an adjective.
- It does not justify more examples. Write the Docs is explicit that too many
  hurt skimmability, and SparkFun's bar is coverage of the API, not volume.

## Sources

- [Diátaxis](https://diataxis.fr/), and its pages on
  [tutorials](https://diataxis.fr/tutorials/) and
  [how-to guides](https://diataxis.fr/how-to-guides/)
- [Using PRIMM to structure programming lessons](https://teachcomputing.org/blog/using-primm-to-structure-programming-lessons/),
  and [Teaching Programming with PRIMM](https://www.raspberrypi.org/app/uploads/2022/08/Teaching_Programming_with_PRIMM-1.pdf)
- [PRIMM: Exploring pedagogical approaches for teaching text-based programming in school](https://dl.acm.org/doi/10.1145/3137065.3137084),
  Sentance and Waite
- [Teachers' Experiences of using PRIMM to Teach Programming in School](https://dl.acm.org/doi/10.1145/3287324.3287477)
- [Extending and Evaluating the Use-Modify-Create Progression](https://www.semanticscholar.org/paper/30328c54404f8cf12e50f37bd6688b7410a60461),
  Martin and Lee
- [Use, Modify, Create: Comparing Computational Thinking Lesson Progressions for STEM Classes](https://www.semanticscholar.org/paper/cb6e7601cfc73ec0fd06143c6f7f81cddb29f548)
- [The Expertise Reversal Effect](https://link.springer.com/article/10.1007/s11251-009-9102-0),
  Kalyuga, and the
  [meta-analysis](https://www.sciencedirect.com/science/article/pii/S0959475225000660)
- [Semantic Waves quick read](https://raspberrypi-education.s3-eu-west-1.amazonaws.com/Quick+Reads/Pedagogy+Quick+Read+6+-+Semantic+Waves.pdf),
  and [Unplugged Computing and Semantic Waves](https://dl.acm.org/doi/10.1145/3351287.3351291), Waite et al.
- [The Programmer's Brain](https://www.manning.com/books/the-programmers-brain), Felienne Hermans
- [A field study of API learning obstacles](https://link.springer.com/article/10.1007/s10664-010-9150-8),
  Robillard and DeLine
- [How developers use API documentation: an observation study](https://www.researchgate.net/publication/335456576_How_developers_use_API_documentation_an_observation_study)
- [Documentation principles](https://www.writethedocs.org/guide/writing/docs-principles/), Write the Docs
- [Creating Great Guide Content for the Adafruit Learning System](https://cdn-learn.adafruit.com/downloads/pdf/creating-great-guides-for-the-adafruit-learning-system.pdf)
- [How to Write A Great Arduino Library](https://news.sparkfun.com/3245), SparkFun
- [Mozzi](https://sensorium.github.io/Mozzi/),
  [Teensy Audio Library](https://www.pjrc.com/teensy/td_libs_Audio.html),
  [Sonic Pi tutorial](https://sonic-pi.net/tutorial.html),
  [Strudel workshop](https://strudel.cc/workshop/getting-started/)
