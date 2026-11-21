# Knowledge Path

My knowledge hub: topics of interest, the material I collect for each (articles, videos, books, podcasts), study paths and highlights, and my notes and journal, all filed under the same topics.

- Installable web app for iPhone and Mac: https://itzik-a.github.io/knowledge-path/
- The data is a private GitHub repo of Markdown files (the vault) that also opens in Obsidian.
- A GitHub Action in the vault fills in saved links and answers Explore with Claude.

See [PLAN.md](PLAN.md) for the concepts and decisions and [CLAUDE.md](CLAUDE.md) for how it's built.

```sh
npm install
npm start      # dev server (nvm use + vite)
npm test       # vault format and sync tests
npm run build
```
