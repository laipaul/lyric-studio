# Theme rules

_The rule book in plain words (docs/theme-engine-v2-hyperframes-plan.md, section 4). One entry per rule: its id,
the rule, why (the pro practice behind it), the value and where it lives, the test that proves it, and where it
came from. The code reads the values; this file explains them. Started 9 Nov 2026 (Theme v2 step 2b part 2) with
the rules of the Reel word-by-word theme ("Here with Me"); the spec's Craft Rules follow with T4._

Where a value lives today: `src/line-shape.ts` (constants), the theme's look (`theme.json`: `lineShape`,
`lineBuild`, `finalHook`; Shape → Theme → Text). With T2 these become the v2 groups `composition.lineShape`,
`motion.accumulate` and `rules.repeats.chorus.last`; with T4 the Craft Rule values move to
`presets/craft-rules.json`.

## Lines (LIN)

### LIN-01 Stacked lines: short rows, 2-4 per line, never padded
- **Rule:** with the stacked line shape, a lyric line is shown as rows of 1-3 words, 2-4 rows per line, chosen
  per phrase. 4 is a ceiling, not a target: a line uses as few rows as reads well. A line of one or two words
  stays on one row. Every row fits the width at the line's size; only if a row cannot fit does the size shrink
  (down to the platform's smallest size, 75%). A line that needs more than four rows of three words is
  shown in four rows and marked "too long: split it in the lyrics file".
- **Why:** short stacked rows are the look of word-by-word Reels: each row is read at a glance on a phone,
  and the block stays compact in the middle of the picture.
- **Value:** `STACK_MAX_ROWS` 4, `STACK_MAX_WORDS` 3 (src/line-shape.ts); on with `lineShape: "stacked"`.
- **Test:** test/line-shape.test.ts "LIN-01".
- **From:** the Theme v2 spec (Craft Rules "Lines and characters on screen", Theme schema `composition.lineShape`).

### LIN-02 Break where the singer breathes
- **Rule:** when the singer pauses between two words (a gap of 0.15 s or more in the aligned word times), a row
  break goes there in preference to anywhere else.
- **Why:** a row that ends on a breath follows the singing; the eye and the ear stay together.
- **Value:** `BREATH_S` 0.15 s; only with the singer's own word times (never guessed).
- **Test:** "LIN-02".
- **From:** the spec's moment `breath` and Craft Rule "Line breaks: break at breaths or phrase ends".

### LIN-03 No orphan word
- **Rule:** a line of three words or more never ends with one word alone on its last row.
- **Why:** a single word left at the bottom looks like a mistake and drags the eye down.
- **Value:** always.
- **Test:** "LIN-03".
- **From:** the spec's Craft Rule "no single orphan word".

### LIN-04 Small words stay with the word they lead
- **Rule:** a row never ends on a small word that belongs to the next one: articles, possessives, short
  prepositions and conjunctions ("the", "a", "my", "to", "with", "and"; French "le", "la", "les", "mon",
  "ma", "de", "et", "l'", "d'", ...).
- **Why:** "the / light" splits one idea in two; "until / the light" keeps it whole.
- **Value:** the word list in `isGlueWord` (src/line-shape.ts), English and French (Life Lyrics, Pômé).
- **Test:** "LIN-04".
- **From:** the spec's Craft Rule "never split article from noun".

### LIN-05 Build up: rows appear as they are sung, and stay
- **Rule:** with `lineBuild: "build"`, the first row of a line comes in with the line; each next row appears
  as its first word comes on screen (the word's sung time minus the lead, 0.25 s), fading in over 0.2 s and
  rising slightly into its place, and stays until the whole line leaves. The rows keep their places from the
  start, so nothing jumps. This is independent of the letter animation: with the typewriter, the letters
  still type in as sung.
- **Why:** the phrase builds up on screen as the singer sings it, the "Here with Me" Reel's signature.
- **Value:** `BUILD_ROW_FRAMES` 6 (0.2 s at 30 fps).
- **Test:** "LIN-05".
- **From:** the spec's `motion.accumulate: "build"` (a phrase's lines stay until the phrase ends).

### LIN-06 Bigger final chorus
- **Rule:** with `finalHook: "on"`, the video's last chorus (its last run of hook lines) is drawn 1.3x, and its
  very last line 1.5x. A size set on a single card (Textboard) still wins; a line that would no longer fit is
  shrunk back inside the safe area as usual.
- **Why:** the song's peak at the end of the video: the last chorus lands bigger than the first.
- **Value:** `FINAL_HOOK_SCALE` 1.3, `FINAL_PHRASE_SCALE` 1.5.
- **Test:** "LIN-06".
- **From:** the spec's example theme (`rules.repeats.chorus.last`: size 1.3, its last phrase 1.5).
