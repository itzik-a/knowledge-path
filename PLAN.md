# Knowledge Path: plan

My knowledge hub: every topic I'm interested in, with the material I collect for each one (articles, videos, books, podcasts, papers, courses), a place to study and explore them, and my notes and journal, all filed under the same topics. It installs on the iPhone Home Screen and runs in the browser on the MacBook. It works offline and syncs through a private GitHub repo of Markdown files (the "vault") that also opens in Obsidian.

## 1. Concepts

| Thing | What it is | Example |
|---|---|---|
| **Topic** | A subject of interest, nestable, with my own overview note | Philosophy → Stoicism; History → Ancient History → Ancient Rome |
| **Resource** | Saved material: article, video, book, podcast, paper, course, site. Status (saved · up next · in progress · done), highlights, my notes | *Meditations*, a YouTube lecture, an SEP entry |
| **Note** | Any Markdown note, in one or more topics | "Stoic vs Buddhist ideas of control" |
| **Journal entry** | A daily note; shows up under every topic it links to | 2026-11-21 mentions `[[Stoicism]]` → on the Stoicism page |
| **Highlight** | A quote or passage from a resource, with my comment | |
| **Study path** | An ordered checklist of resources, notes and tasks | "Intro to Stoicism" |
| **Habit** | Something to do every day, N times a week or whenever, with a log of the days done (and an amount, if it has a unit), or a timer whose hours go in the log | Meditate, 10 min a day; a 16-hour fast |
| **Recipe** | A dish to cook: servings, times, ingredients (in groups), numbered steps, notes, and a log of the days I made it. Scales to the servings I need | Shakshuka, for 4 or for 8 |
| **Inbox** | Resources and notes with no topic yet | A link shared from the iPhone |

An item is in a topic when its `topics:` property names it, when it links to the topic's note (`[[Stoicism]]`), or when it has the topic's tag (`#stoicism`). Linking is how journal entries and loose notes get filed without extra work.

## 2. The vault

A private GitHub repo (`itzik-a/knowledge-vault`) of plain Markdown, in Obsidian's format:

```
Topics/Philosophy.md                 overview; frontmatter: icon, color, description
Topics/Philosophy/Stoicism.md        a subtopic (the folder is the parent)
Resources/Meditations.md             frontmatter: type, url, author, topics, status, progress, rating, added, summary…
                                     body: my notes, then a "## Highlights" section of > quotes
Journal/2026/2026-11-21.md           daily notes
Paths/Intro to Stoicism.md           - [ ] [[Meditations]]: books 2–4
Habits/Meditate.md                   frontmatter: icon, goal (daily | 3/week | whenever), unit, target, topics, archived; a timed habit: timer: true, unit: h, started: 2026-11-22T20:00 while running
                                     body: a description, then a "## Log" list: - 2026-11-22: 20 min
Recipes/Shakshuka.md                 frontmatter: servings, prep, cook, source, image, tags, topics, rating
                                     body: an intro, "## Ingredients" (- 2 tbsp olive oil; ### groups), "## Steps" (1. …), "## Notes", "## Cooked" (- 2026-11-23: a note)
Notes/…                              everything else
.hub/articles/…, .hub/explore/…      app data (saved article text, explore results); hidden in Obsidian
.github/workflows/enrich.yml         fills in saved links and answers Explore (GitHub Actions)
```

Sync: the app keeps the whole vault in IndexedDB. It reads the repo's file list in one call and downloads only files whose blob changed. Its changes go out as one commit. A file changed on both sides gets a three-way merge; if the same lines changed, the vault's copy keeps the name and mine is saved beside it as `… (conflict <date>).md`. Nothing is overwritten silently.

## 3. Screens

Tabs: **Home · Topics · Library · Notes**, plus **+** (add a link or a note) and search (⌘K). On the Mac there's a sidebar with the topic list and the Inbox.

- **Home**: today's journal entry, the Inbox, in progress, up next, a highlight to revisit, topics, recently saved.
- **Topics**: the topics, then one topic's page: overview note, subtopics, resources (by status), notes, journal entries that mention it, study paths, and Explore.
- **Library**: every resource; filter by status, type and topic; sort by date added, title or author. A resource's page: details, status, progress, rating, topics, summary, a reader for the saved article text (select a passage → highlight), my notes, highlights, backlinks.
- **Notes**: notes by folder; the Journal (a calendar, entries by month); a note's page with title, topics, editor, tags and backlinks.
- **Inbox**: unsorted items, with the enricher's suggested topics one tap away.
- **Vault & settings**: connect the vault, the enricher's status, save from other apps (Mac bookmarklet, iOS Shortcut), backup.

## 4. Milestones

1. **Scaffold**: plan, CLAUDE.md, PWA, Pages deploy, IndexedDB store, vault parser with tests, starter topics.
2. **Topics & Library**: topic tree and pages, resources (add, edit, remove), status, filters, instant YouTube titles (oEmbed).
3. **Notes & Journal**: Markdown rendering, CodeMirror editor, `[[links]]` with autocomplete, tags, backlinks, daily journal, Hebrew.
4. **Vault sync**: private repo, fine-grained token, changed-files-only sync, offline queue, three-way merge and conflict copies.
5. **Capture**: quick-add sheet, Inbox, Mac bookmarklet, iOS Shortcut that writes straight to the vault.
6. **Search & Home**: full-text search on the device (MiniSearch), ⌘K, Home.
7. **Enrichment** (GitHub Actions in the vault + Claude Haiku 5.5): title, author, image, readable article text, a summary, suggested topics; renames captured links to their title.
8. **Study & explore**: highlights, study paths, the daily highlight, Explore a topic with Claude (map, key people, timeline, what to read next).
9. **Habits**: habits with a daily or weekly goal and an optional amount; check off today on Home; #habits; a habit's page with streaks, the last 7 days, a calendar heatmap and the log (backfill, change, remove with Undo); habits on topic pages and on the journal day they were logged; two devices' logs merge without a conflict copy.
10. **Timed habits** (a fasting tracker): a habit whose log is a timer: start it (Home, #habits or its page), see the time so far toward a goal in hours, change when it started, end it (the hours go in the log on the day it ends, with Undo) or discard it. The running timer is `started:` in the frontmatter, so both devices see it. Later: a notification when the goal is reached (needs Web Push from a server; a Home Screen web app can't schedule local alerts).

11. **Recipes**: `Recipes/` files read into ingredients (amount, unit and the rest, English and Hebrew: "1½ cups", "כוס וחצי", "2-3"), steps and the Cooked log; #recipes (cards, search by name or ingredient, tags, sort); a recipe's page (servings − / + scale every amount, as ½ ⅓ ¼; stars; the days cooked with a note each); new from the + sheet; edit as Markdown; details sheet; recipes on Home ("cook again"), topic pages and in search. Two devices' Cooked logs merge like habit logs.
12. **Import a recipe**: a recipe's link is read by the enricher (the page's schema.org Recipe data; Claude Haiku when there is none); paste a recipe's text and it's split on the device; **Make it a recipe** on a saved link (and a nudge when the enricher saw a recipe on its page).
13. **Cook mode**: full screen, one step at a time, the screen kept on, ingredients and steps ticked off, timers from the steps' times (several at once, a sound at the end), "Done" logs the day.
14. **Shopping list**: `Shopping list.md`, a checklist grouped by aisle; add a recipe's ingredients at the servings chosen, untick what I have; same items add up.
15. **Units**: cups, ounces and pounds shown in grams (or millilitres for liquids), from each ingredient's weight per cup; °F → °C and inches → cm in the steps. As written / Metric, kept per device.

Status 2026-11-23: 11–15 built (recipes, import, cook mode, shopping list, units). Checked: phone and iPad / desktop widths, light and dark, Hebrew recipes; 120+ tests (ingredient parsing in English and Hebrew, scaling, conversion, pasted text, JSON-LD, the Cooked log merge, the shopping list); the enricher against a real recipe page (BBC Good Food: ingredients, steps, times, photo, tags; a site that blocks robots fails with its reason). The vault's workflow runs on `Recipes/` pushes too (vault 8776d13). Not yet: cook mode's wake lock and timer sound on a real iPhone and iPad.

Status 2026-11-21: 1–8 built. Checked: phone and desktop widths, light and dark, Hebrew/English per line; 35 tests (vault format, two-device sync against a fake GitHub, enricher helpers); a real round trip with the private vault (connect, push, pull, merge of neighbouring-line edits, conflict copy, removals); the enricher on a scratch vault (SEP article, YouTube, Hebrew Wikipedia) and its Claude calls against a mock API. Live at https://itzik-a.github.io/knowledge-path/; a real enricher run in Actions checked. Not yet: the `ANTHROPIC_API_KEY` secret in the vault.

## 5. Follow-ups

- Flashcards with spaced repetition (FSRS) from highlights.
- Graph view of notes and topics.
- Ask my notes (questions over the vault).
- "Save to hub" from feed-path entries.
- PDFs in the vault with a reader and highlights; images (`![[…]]` embeds) shown inline.
- Kindle / Readwise highlight import.
- A timeline view for History (resources and notes by period).
- Note templates; a richer editor (live preview, slash commands, a mobile toolbar).
- Sketches, later: resize or recolour a lasso selection, a partial (pixel) eraser, Pencil double-tap to switch tools (not reachable from a web page), handwriting search.
- Explore and summaries with my Anthropic key on the device (answers in seconds instead of a minute).

## 6. Decisions (2026-11-21)

- 2026-11-23: Apple Pencil sketches as SVG files in `Sketches/`, embedded with `![[…svg]]` (option 2 of: Scribble only / SVG sketches / Excalidraw). Text, so they sync like notes and open in Obsidian.
- 2026-11-23: **Private notes** (notes and journal entries, one by one, `private: true`): the body is encrypted with a passphrase on the way into the vault, in the Meld Encrypt plugin's inline v3 format (so Obsidian with that plugin opens them, and without it hides the block). The frontmatter and file name stay readable, so topics and the title still work everywhere. The passphrase is typed once per device (kept in localStorage like the token) and can't be recovered. On a device with it a private note is an ordinary note (search, links, tags); without it, it's locked. Explore leaves private notes out. The rest of the vault stays unencrypted, as decided below.

- **Name**: knowledge-path. Accent: plum (`#9C2F5A`, dark `#F08DB4`).
- **Storage**: a private GitHub repo of Markdown files instead of a gist: one file per note scales, keeps history, and opens in Obsidian. Not encrypted (a private repo isn't readable by URL; encryption would break Obsidian, search and the enricher).
- **Obsidian**: optional second editor on the same vault (via the Obsidian Git plugin, not Obsidian Sync). The app has its own editor; whether to grow it toward Obsidian's features is decided later.
- **Token**: fine-grained, only the vault repo, Contents read and write.
- **Claude**: runs in GitHub Actions (vault secret `ANTHROPIC_API_KEY`), not in the browser. Haiku 5.5 for summaries and topic suggestions (~$0.001 a link); Opus 5.5 for Explore (rare, ~$0.10 an answer), with the API's server-side refusal fallback on. Without the key the enricher still fetches titles and article text. A key on the device may come later.
- **Notes rendering**: markdown-it with raw HTML off (so nothing in a note can run script), single line breaks kept, each line's direction (Hebrew / English) from its own text.
- **Capture on iPhone**: a Shortcut that writes the link straight into the vault (Safari can't make a Home Screen app a share target, and the installed app has its own storage).
