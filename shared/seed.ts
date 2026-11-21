/* The starter vault: two topics with subtopics, suggested resources, and a study path.
   The same files go into the vault repo when it's made, so the first sync matches them file by file.
   Resources are real (books, podcasts, encyclopedia entries) and marked `suggested: true` until touched.
   Never rename a path here once the vault exists: the path is how devices match files. */
import { setFrontmatter } from "./vault.ts";

const DAY = "2026-11-21";
const md = (fm: Record<string, unknown>, body: string) => setFrontmatter("", fm) + body.trim() + "\n";

function topic(path: string, fm: Record<string, unknown>, body: string): [string, string] {
  return [`Topics/${path}.md`, md(fm, body)];
}

function res(file: string, fm: Record<string, unknown>, notes = ""): [string, string] {
  const { topics, ...rest } = fm;
  return [`Resources/${file}.md`, md({ ...rest, topics, status: "saved", added: DAY, suggested: true }, notes || "")];
}

const L = (...names: string[]) => names.map((n) => `[[${n}]]`);

export const SEED: Record<string, string> = Object.fromEntries([
  // ── Philosophy ──────────────────────────────────────────────
  topic("Philosophy", { icon: "🦉", color: 7, description: "The big questions: how to live, what we can know, what exists." }, `
What I want from philosophy: better questions, and a few answers I can live by.

## Questions I'm exploring
- What is in my control, and what isn't?
- What makes a life go well?
- What is the mind?
`),
  topic("Philosophy/Ancient Philosophy", { description: "From the Presocratics to Plato, Aristotle and the Hellenistic schools." }, `
Where it started: Socrates' questions, Plato's forms, Aristotle's system, and the schools that came after.
`),
  topic("Philosophy/Stoicism", { description: "Virtue, what's in our control, and calm in the face of fortune." }, `
Zeno, Epictetus, Seneca, Marcus Aurelius. The core: only virtue is good; most things are "indifferent"; focus on what's up to you.
`),
  topic("Philosophy/Ethics", { description: "What's right, what's good, and how we should treat each other." }, `
Virtue ethics, consequentialism, deontology, and the practical questions in between.
`),
  topic("Philosophy/Existentialism", { description: "Freedom, meaning and authenticity in a world without given answers." }, `
Kierkegaard, Nietzsche, Sartre, de Beauvoir, Camus.
`),
  topic("Philosophy/Philosophy of Mind", { description: "Consciousness, the self, and how the mind relates to the brain." }, `
The hard problem, personal identity, free will, and what AI does to these questions.
`),

  res("Meditations", { type: "book", author: "Marcus Aurelius", url: "https://www.gutenberg.org/ebooks/2680", year: "c. 180", topics: L("Stoicism", "Ancient Philosophy"),
    summary: "A Roman emperor's private notes to himself on duty, mortality and keeping his mind clear. Short entries; good to read a few at a time." }),
  res("Letters from a Stoic", { type: "book", author: "Seneca", url: "https://en.wikisource.org/wiki/Moral_letters_to_Lucilius", year: "c. 65", topics: L("Stoicism"),
    summary: "124 letters to a friend on time, friendship, grief, wealth and death: the most readable way into Stoicism." }),
  res("Stoicism (SEP)", { type: "article", author: "Dirk Baltzly", site: "Stanford Encyclopedia of Philosophy", url: "https://plato.stanford.edu/entries/stoicism/", topics: L("Stoicism"),
    summary: "A scholarly overview of the Stoic school: its history, logic, physics and ethics." }),
  res("Stanford Encyclopedia of Philosophy", { type: "site", url: "https://plato.stanford.edu/", topics: L("Philosophy"),
    summary: "Free, peer-reviewed entries on nearly every topic in philosophy, kept up to date by specialists." }),
  res("Existentialism (SEP)", { type: "article", site: "Stanford Encyclopedia of Philosophy", url: "https://plato.stanford.edu/entries/existentialism/", topics: L("Existentialism"),
    summary: "What the existentialists shared: freedom, anxiety, authenticity, and existence before essence." }),
  res("Consciousness (SEP)", { type: "article", site: "Stanford Encyclopedia of Philosophy", url: "https://plato.stanford.edu/entries/consciousness/", topics: L("Philosophy of Mind"),
    summary: "The main questions about consciousness and the theories that try to answer them." }),
  res("Virtue Ethics (SEP)", { type: "article", site: "Stanford Encyclopedia of Philosophy", url: "https://plato.stanford.edu/entries/ethics-virtue/", topics: L("Ethics"),
    summary: "Ethics centred on character rather than rules or outcomes, from Aristotle to today." }),
  res("History of Philosophy without any gaps", { type: "podcast", author: "Peter Adamson", url: "https://historyofphilosophy.net/", topics: L("Ancient Philosophy", "Philosophy"),
    summary: "The whole history of philosophy, one 20-minute episode at a time, including the figures most histories skip." }),
  res("The Republic", { type: "book", author: "Plato", url: "https://www.gutenberg.org/ebooks/1497", year: "c. 375 BC", topics: L("Ancient Philosophy", "Ethics"),
    summary: "What is justice, and is the just life the better one? The cave, the ideal city, and the philosopher-king." }),
  res("The Myth of Sisyphus", { type: "book", author: "Albert Camus", year: "1942", topics: L("Existentialism"),
    summary: "Camus on the absurd: if life has no given meaning, why not give up? His answer is revolt, freedom and passion." }),
  res("The Story of Philosophy", { type: "book", author: "Will Durant", year: "1926", topics: L("Philosophy"),
    summary: "Lively portraits of the great Western philosophers from Plato to Dewey, written for general readers." }),

  // ── History ─────────────────────────────────────────────────
  topic("History", { icon: "🏛️", color: 2, description: "How we got here: people, empires, ideas and turning points." }, `
What I want from history: to understand how things came to be the way they are.

## Questions I'm exploring
- Why do empires rise and fall?
- Which turning points could have gone the other way?
`),
  topic("History/Ancient History", { description: "Mesopotamia, Egypt, Greece, Persia and the ancient world, to about AD 500." }, `
From the first cities to the end of the western Roman Empire.
`),
  topic("History/Ancient History/Ancient Rome", { description: "From a city-state to an empire, and its long fall." }, `
The Republic, the Empire, and what Rome left behind.
`),
  topic("History/Medieval History", { description: "About 500 to 1500: Byzantium, the Islamic world, Europe's Middle Ages, the Mongols." }, `
`),
  topic("History/Modern History", { description: "From about 1500: revolutions, world wars, and the world they made." }, `
`),
  topic("History/Jewish & Israeli History", { description: "The Jewish people from antiquity to the State of Israel today." }, `
`),

  res("SPQR", { type: "book", author: "Mary Beard", year: "2015", topics: L("Ancient Rome"),
    summary: "Rome's first thousand years, from its founding myths to AD 212, and how historians know what they know." }),
  res("The History of Rome (podcast)", { type: "podcast", author: "Mike Duncan", url: "https://thehistoryofrome.typepad.com/", topics: L("Ancient Rome"),
    summary: "179 episodes from Aeneas to the fall of the western empire. The classic narrative history podcast." }),
  res("The Histories", { type: "book", author: "Herodotus", year: "c. 430 BC", topics: L("Ancient History"),
    summary: "The first work of history: the Greco-Persian Wars, and everything Herodotus heard on his travels along the way." }),
  res("Sapiens", { type: "book", author: "Yuval Noah Harari", year: "2011", topics: L("History"),
    summary: "A brief history of humankind: the cognitive, agricultural and scientific revolutions, and the shared stories that make cooperation possible." }),
  res("The Silk Roads", { type: "book", author: "Peter Frankopan", year: "2015", topics: L("History", "Medieval History"),
    summary: "World history told from the middle: the routes between Europe and Asia as the centre of events." }),
  res("A Distant Mirror", { type: "book", author: "Barbara W. Tuchman", year: "1978", topics: L("Medieval History"),
    summary: "The calamitous 14th century (plague, war, schism) through the life of one French nobleman." }),
  res("The Guns of August", { type: "book", author: "Barbara W. Tuchman", year: "1962", topics: L("Modern History"),
    summary: "The first month of the First World War, and the decisions that made it the war it became." }),
  res("Fall of Civilizations", { type: "podcast", author: "Paul Cooper", url: "https://fallofcivilizationspodcast.com/", topics: L("History"),
    summary: "Long episodes on how societies collapse, from Bronze Age empires to the Maya and the Khmer." }),
  res("Hardcore History", { type: "podcast", author: "Dan Carlin", url: "https://www.dancarlin.com/hardcore-history-series/", topics: L("Modern History", "Ancient History"),
    summary: "Long, dramatic deep dives into history's most intense episodes, from the Punic Wars to World War I." }),
  res("A History of the Jews", { type: "book", author: "Paul Johnson", year: "1987", topics: L("Jewish & Israeli History"),
    summary: "Four thousand years of Jewish history in one volume, from Abraham to the modern State of Israel." }),
  res("Israel - A History", { title: "Israel: A History", type: "book", author: "Martin Gilbert", year: "1998", topics: L("Jewish & Israeli History"),
    summary: "The story of Israel from the beginnings of Zionism to the end of the 20th century." }),

  // ── A study path ────────────────────────────────────────────
  ["Paths/Intro to Stoicism.md", md({ topics: L("Stoicism"), description: "A first route through Stoicism, a few weeks of evenings." }, `
- [ ] [[Stoicism (SEP)]]: the overview, an evening's read
- [ ] [[Letters from a Stoic]]: letters 1–20
- [ ] [[Meditations]]: books 2–4 first
- [ ] Journal: what's in my control this week, and what isn't?
`)],
]);

/** The vault's README (not synced by the app; for whoever opens the repo). */
export const VAULT_README = `# Knowledge vault

The data of [Knowledge Path](https://itzik-a.github.io/knowledge-path/): plain Markdown files, so it also opens
in Obsidian (sync with the Obsidian Git plugin, not Obsidian Sync).

| Folder | What's in it |
|---|---|
| \`Topics/\` | One note per topic; a folder makes subtopics (\`Topics/Philosophy/Stoicism.md\`) |
| \`Resources/\` | Saved material: frontmatter \`type\`, \`url\`, \`author\`, \`status\` (saved · next · in-progress · done), \`progress\`, \`rating\`, \`topics\`; my notes and a \`## Highlights\` section of quotes |
| \`Journal/\` | Daily notes, \`Journal/2026/2026-11-21.md\` |
| \`Paths/\` | Study paths: a checklist of \`[[links]]\` |
| \`Notes/\` | Everything else |
| \`.hub/\` | App data: saved article text, explore results (hidden in Obsidian) |

Something is in a topic when its \`topics:\` property lists it, when it links to the topic (\`[[Stoicism]]\`), or
when it has the topic's tag (\`#stoicism\`). That's how journal entries and loose notes show up under a topic.

\`.github/workflows/enrich.yml\` fills in saved links (title, author, image, readable text, a summary and
suggested topics) and answers Explore requests. It needs an \`ANTHROPIC_API_KEY\` repository secret for the
Claude parts; without it, it still fetches titles and article text.
`;
