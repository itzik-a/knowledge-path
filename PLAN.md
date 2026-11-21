# Knowledge Path: plan

My knowledge hub: every topic I'm interested in, with the material I collect for each one (articles, videos, books, podcasts, papers, courses), a place to study and explore them, and my notes and journal, all filed under the same topics. It installs on the iPhone Home Screen and runs in the browser on the MacBook. It works offline and syncs through a private GitHub repo of Markdown files (the "vault") that also opens in Obsidian.

## 1. Concepts

| Thing | What it is | Example |
|---|---|---|
| **Topic** | A subject of interest, nestable, with my own overview note | Philosophy → Stoicism; History → Ancient History → Ancient Rome |
| **Resource** | Saved material: article, video, book, podcast, paper, course, site. Status (saved · up next · in progress · done), progress, rating, highlights, my notes | *Meditations*, a YouTube lecture, an SEP entry |
| **Note** | Any Markdown note, in one or more topics | "Stoic vs Buddhist ideas of control" |
| **Journal entry** | A daily note; shows up under every topic it links to | 2026-11-21 mentions `[[Stoicism]]` → on the Stoicism page |
| **Highlight** | A quote or passage from a resource, with my comment | |
| **Study path** | An ordered checklist of resources, notes and tasks | "Intro to Stoicism" |
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
2. **Topics & Library**: topic tree and pages, resources (add, edit, remove), status, progress, rating, filters, instant YouTube titles (oEmbed).
3. **Notes & Journal**: Markdown rendering, CodeMirror editor, `[[links]]` with autocomplete, tags, backlinks, daily journal, Hebrew.
4. **Vault sync**: private repo, fine-grained token, changed-files-only sync, offline queue, three-way merge and conflict copies.
5. **Capture**: quick-add sheet, Inbox, Mac bookmarklet, iOS Shortcut that writes straight to the vault.
6. **Search & Home**: full-text search on the device (MiniSearch), ⌘K, Home.
7. **Enrichment** (GitHub Actions in the vault + Claude Haiku 5.5): title, author, image, readable article text, a summary, suggested topics; renames captured links to their title.
8. **Study & explore**: highlights, study paths, the daily highlight, Explore a topic with Claude (map, key people, timeline, what to read next).

## 5. Follow-ups

- Flashcards with spaced repetition (FSRS) from highlights.
- Graph view of notes and topics.
- Ask my notes (questions over the vault).
- "Save to hub" from feed-path entries.
- PDFs in the vault with a reader and highlights; images (`![[…]]` embeds) shown inline.
- Kindle / Readwise highlight import.
- A timeline view for History (resources and notes by period).
- Note templates; a richer editor (live preview, slash commands, a mobile toolbar).
- Optional encryption for the journal.
- Explore and summaries with my Anthropic key on the device (answers in seconds instead of a minute).

## 6. Decisions (2026-11-21)

- **Name**: knowledge-path. Accent: plum (`#9C2F5A`, dark `#F08DB4`).
- **Storage**: a private GitHub repo of Markdown files instead of a gist: one file per note scales, keeps history, and opens in Obsidian. Not encrypted (a private repo isn't readable by URL; encryption would break Obsidian, search and the enricher).
- **Obsidian**: optional second editor on the same vault (via the Obsidian Git plugin, not Obsidian Sync). The app has its own editor; whether to grow it toward Obsidian's features is decided later.
- **Token**: fine-grained, only the vault repo, Contents read and write.
- **Claude**: runs in GitHub Actions (vault secret `ANTHROPIC_API_KEY`), not in the browser. Haiku 5.5 for summaries and topic suggestions, Sonnet 5.5 for Explore. Without the key the enricher still fetches titles and article text. A key on the device may come later.
- **Notes rendering**: markdown-it with raw HTML off (so nothing in a note can run script), single line breaks kept, each line's direction (Hebrew / English) from its own text.
- **Capture on iPhone**: a Shortcut that writes the link straight into the vault (Safari can't make a Home Screen app a share target, and the installed app has its own storage).
