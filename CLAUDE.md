# Knowledge Path

A personal knowledge hub (React, built with Vite, hosted on GitHub Pages), used on a MacBook and an iPhone (installed to the Home Screen): topics of interest, the resources collected for each, study paths and highlights, and my notes and journal filed under the same topics. The data is a private GitHub repo of Markdown files (the vault, `itzik-a/knowledge-vault`) that also opens in Obsidian. See `PLAN.md` for the concepts, milestones and decisions.

## How it's built

Vite + React 19 + TypeScript. Node 22 (`.nvmrc`). On this Mac `npm start` runs `nvm use` and then the dev server; `npm run dev` alone runs the local server (also reachable from the iPhone on the same Wi-Fi); `npm run build` typechecks the app and the enricher and builds into `dist/`; `npm test` runs Vitest (`tests/`).

- **The vault format** is `shared/vault.ts` (used by the app and the enricher, no DOM or Node APIs): a file's kind comes from its folder (`Topics/`, `Resources/`, `Journal/YYYY/YYYY-MM-DD.md`, `Paths/`, anything else is a note, `.hub/` is app data); frontmatter read and written with `yaml` keeping order and comments (`splitFrontmatter`, `setFrontmatter`, `setBody`); `[[links]]`, `#tags`, highlights (a `## Highlights` section of `>` quotes), study path steps (`- [ ] [[x]]`), safe file names. `isSynced()` says which paths the app keeps (`.md` outside `.obsidian/.github/.git`, `.hub/*.json|md`; never the root `README.md`).
- `shared/index.ts`: `parseDoc()` per file, `buildIndex()` → topics (tree from folders; icon and colour inherited), `topicsOf` / `itemsOf` (by `topics:` property, link to the topic note, or tag), backlinks, tags, `resolve()` (Obsidian-style link resolution), `itemsIn()`, `inbox()`.
- `shared/seed.ts`: the starter vault (Philosophy and History with subtopics, real suggested resources with `suggested: true`, a study path). The same files went into the vault repo, so the first sync matches them. **Never rename a seed path**: paths are how devices match files.
- `src/state/store.ts`: every file in memory (`FileRec`: content, `base` text and `baseSha` as last synced, `dirty`, `deleted` tombstone, `rev`), persisted to IndexedDB (`src/state/db.ts`, db `knowledgePath`) in batches. `useVault()` / `useIndex()`; the index is rebuilt after each change, parsing only changed files (`writeFile(…, { lazy: true })` from the editor rebuilds 400 ms later). `renameFile()` re-points `[[links]]` everywhere and moves a topic's subtopic folder along.
- `src/state/actions.ts`: every change in vault terms (`createResource`, `setStatus`, `setTopics` (writes `topics: ["[[Name]]"]`), `retitle` (renames the file), highlights, `toggleStep`, topics, `requestExplore`). Removals show an Undo toast.
- **Sync**: `src/lib/vaultsync.ts` `syncOnce()` is the algorithm (browser-free; `tests/sync.test.ts` runs two devices against a fake GitHub): head (ETag, a 304 is free) → tree → download changed blobs → per file: take theirs / three-way merge (`node-diff3`) / conflict copy `… (conflict <date>).md` / removals (an edit elsewhere beats my removal) → one commit via the Git Data API (`base_tree`, then PATCH the ref; a moved ref retries). `src/state/sync.ts` is the GitHub client (fine-grained token in localStorage `knowledgePath.vault`), the schedule (on start, focus, every 2 min, 15 s after changes / at most 60 s, on leaving) and the status pill. An empty repo gets a README via the contents API first, then everything on the device.
- Routing is the URL hash (`src/lib/route.ts`): `#home`, `#topics[/<topic id>]`, `#library`, `#notes[/journal]`, `#inbox`, `#tag/<tag>`, `#doc/<vault path>`, `#capture?url=&title=&text=` (bookmarklet). Sheets open through `src/lib/sheets.ts` (`openSheet({ kind: "capture" | "topic" | "search" | "data" })`).
- Views (`src/views/`): `Home`, `Topics` (index + topic page), `Library`, `Notes` (notes, journal calendar, tag page), `Inbox`, `DocPage` (resource / note / journal / study path). Components: `Editor` (CodeMirror 6: per-line text direction, `[[`/`#` completion, ⌘B/⌘I/⌘K; ignores `value` updates it produced itself), `Markdown` (+ `src/lib/markdown.ts`: markdown-it, html off, wikilinks, tags, clickable task boxes, `dir="auto"` blocks), `NoteBody`, `bits.tsx` (topic chips and picker, rows), sheets (`CaptureSheet`, `TopicSheet`, `ResourceSheet`, `DataSheet`, `SearchDialog`), `Explore`.
- Search: `src/lib/search.ts` (MiniSearch, Hebrew-aware tokens, updated incrementally).
- **Enricher** (`enricher/`, runs in the vault repo's Actions, see `vault-template/.github/workflows/enrich.yml`): resources with `enrich: pending` get title, author, image, site, readable text (`.hub/articles/<name>.md`, linked as `article:`), and with `ANTHROPIC_API_KEY` a summary and `suggestedTopics`; `provisional: true` files (iOS Shortcut captures) are renamed to their title. `.hub/requests/*.json` (Explore) are answered into `.hub/explore/<topic>.json`. Writes `.hub/status.json` (last run, counts, cost). It commits with the workflow's own token.
- Styling: plain CSS in `src/styles.css`, tokens in `:root` (the Workout / Feed / Finance Path system with a plum accent `#9C2F5A` / dark `#F08DB4`). Topic colours are the categorical `--s1`…`--s8` (a top-level topic's `color:`; subtopics inherit).
- PWA: `public/manifest.webmanifest`, `public/icon.svg`, PNG icons in `public/icons/` (full-bleed, from the SVG with `qlmanage` + `sips`), `public/sw.js` (production only; network first for the page, cache first for hashed assets; never touches other origins).

## Rules for changes

- Design mobile-first (iPhone ~390 px), tap targets at least 44 px, safe-area padding. Below 768 px: top bar + bottom tab bar (4 tabs) + the + button; from 768 px a sidebar. Check both widths, light and dark.
- Colours only from the CSS tokens in `:root`; light and dark both readable. Text never wears a series colour (use a swatch beside it).
- Hebrew and English both: `dir="auto"` on user text, per-line direction in notes; check mixed text.
- **Stay Obsidian-compatible**: everything is plain Markdown + YAML frontmatter in the folders above; links are `[[Name]]`; app-only data goes in `.hub/`. Don't invent syntax Obsidian would show as junk.
- New frontmatter fields must be optional; old files must still read.
- Touching `shared/vault.ts`, `shared/index.ts` or `src/lib/vaultsync.ts`: add a test and run `npm test`.
- Run `npm run build` after edits; it must pass with no type errors.

## Deploy

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every push to `main` (Pages source = GitHub Actions). Live at https://itzik-a.github.io/knowledge-path/. The vault repo's workflow checks out this repo to run the enricher, so enricher changes take effect on push too.
