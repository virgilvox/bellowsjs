# The voice lab, walked through as five people (2026-11-15)

The lab (Code mode, VOCALS, VOICE LAB) was walked through on bellows.live as five people with
different goals. Measured on a 1280 by 788 window: the lab starts 359 px down, its play button is at
1099 px and the mouth at 1235 px, so the play button is below the fold and the controls and the mouth
are never on screen together. Under 900 px wide Code mode stacks its example list (2467 px tall)
above the lab, so on a phone the lab starts about 2800 px down.

## 1. A curious visitor on a phone: "make it say my name in a Scottish accent"

- Lands on a long list of code examples, not the lab. Has to scroll past 60 entries to find it.
- Finds a textarea, but the accent control is a long drop-down further down, and the button that
  speaks is below that. Presses it and hears the voice, but the mouth is off screen.
- Reads "t flap", "l dark-coda", "th fricative" under the IPA and does not know what they mean.

## 2. A web developer: "how do I put this in my app?"

- SHOW CODE is next to STOP, easy to miss, and gives code for Code mode (`lib.singer`) without
  saying how that maps to an import in an app.
- Nothing on the page points to the npm package or the CDN snippet.

## 3. A songwriter: "a tenor singing my tune"

- Finds Male, then Tenor. Switches to SING. The melody box wants "note or note:beats", which is a
  syntax to learn; the presets are a drop-down labelled TUNE in another row.
- "TEMPO 0.35 s a note" is seconds per note, not a tempo anyone uses.
- No way to see which word is being sung while it plays.

## 4. A linguist: "how does Geordie differ from General American?"

- The accent list has thirty-one entries in one drop-down; scanning regions is slow.
- The IPA shows the chosen accent only. Comparing means switching back and forth and remembering.
- The traits are the rule names from the data, not what you hear.

## 5. A keyboard and screen-reader user

- Toggles (MALE, FEMALE, SPEAK, SING) show state only by colour; nothing says which is pressed.
- The fine-tune sliders are labelled by param name ("vibratoDepth") with no description.
- The hold-a-sound pads only respond to pointer events.

## What changed

- **Phone:** under 900 px Code mode shows a compact example picker at the top instead of the full
  list, so the lab (and every example) comes first.
- **One screen:** the lab is two columns on a wide screen, the controls on the left and a stage on
  the right that stays in view (play button, mouth, the line as it plays, the IPA). On a phone the
  stage comes first and the play button stays pinned to the bottom of the screen.
- **Plain language:** accent traits are written as what you hear ("drops the r in car", "think as
  sink"); fine-tune params have names and a one-line description; tempo is beats per minute.
- **Accents by region:** region tabs, then the accents of that region as buttons, and the IPA shown
  for the chosen accent beside General American's.
- **Melody:** preset tunes as buttons; your own tune under "write your own", with an example of the
  syntax.
- **The line as it plays:** each sound of the line as a chip, the one sounding lit.
- **For developers:** GET THE CODE gives the same settings twice, as a Code mode example and as an
  app import, with the install line.
- **Keyboard:** toggles carry aria-pressed, every slider an aria-label and description, the pads
  answer Space and Enter as well as a press.

## Second round (2026-11-16)

The owner found the first rework worse: the Speak and Sing switch looked like buttons beside a
SPEAK IT button, the accent selector (region tabs over accent chips) was clumsy, and the whole thing
was busy. The cause was one thing in several places: the site styles every button as a raised box,
and the lab used buttons for every kind of control, so a switch, a choice, a filter and the action
all looked the same.

The lab now follows how working voice demos are built: one text box, one primary action, two
pickers.

- **Each control looks like what it is.** Speak and Sing are tabs on the text box (underlined text,
  no box). Voice and Accent are fields with a chevron. The only filled button is Play, which becomes
  Stop while it plays. Examples and copy are text links. The rest are plain expandable rows.
- **Searchable pickers** (the WAI-ARIA combobox pattern) for the thirteen voices and thirty-one
  accents: grouped by male, female and child or by region when browsing, searched by the start of
  words and ranked when typing ("ir" gives Irish, then Northern Irish, not Birmingham), each option
  with a line saying what it is. Arrow keys, Enter and Escape work, and focus comes back to the field.
- **One column**, the composer and then the output: the mouth beside the IPA and General American's,
  the sounds lighting as they play. Fewer boxes, sentence-case labels, no numbered steps.
- **Phone**: the same single column, pickers stacked, no sideways scroll, no keyboard hint.
