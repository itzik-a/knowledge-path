/* Note templates, the way Obsidian's core Templates plugin keeps them: plain notes in `Templates/`, with {{title}},
   {{date}}, {{time}} and {{date:YYYY-MM-DD}}-style placeholders filled in when one is used (in the + sheet's Note form,
   or with /template in the editor). A few starters are built in, offered until the vault has a template of that name.
   DOM- and Node-free. */
import { splitFrontmatter } from "./vault.ts";

export const TEMPLATES = "Templates";
export const isTemplatePath = (path: string) => path.startsWith(TEMPLATES + "/") && path.endsWith(".md");

export const STARTER_TEMPLATES: { name: string; text: string }[] = [
  { name: "Book notes", text: "## About it\n\n- Author: \n- Started: {{date}}\n\n## Key ideas\n\n- \n\n## Quotes\n\n> \n\n## What I think\n\n" },
  { name: "Lecture", text: "> [!info] {{title}}\n> {{date:dddd D MMMM YYYY}} · \n\n## Notes\n\n- \n\n## Questions\n\n- [ ] \n\n## To read next\n\n- \n" },
  { name: "Weekly review", text: "## Week of {{date:D MMMM}}\n\n### What went well\n\n- \n\n### What didn't\n\n- \n\n### What I learned\n\n- \n\n### Next week\n\n- [ ] \n" },
  { name: "Meeting", text: "**{{date:ddd D MMM}} {{time}}** · \n\n## Agenda\n\n- \n\n## Notes\n\n- \n\n## Actions\n\n- [ ] \n" },
];

const pad = (n: number) => String(n).padStart(2, "0");
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** A date in a Moment-style format (the tokens Obsidian's templates use most): YYYY YY MMMM MMM MM M DD D dddd ddd HH H mm. */
export function formatDate(t: Date, fmt: string): string {
  return fmt.replace(/YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|mm|\[[^\]]*\]/g, (tok) => {
    switch (tok) {
      case "YYYY": return String(t.getFullYear());
      case "YY": return String(t.getFullYear()).slice(2);
      case "MMMM": return MONTHS[t.getMonth()];
      case "MMM": return MONTHS[t.getMonth()].slice(0, 3);
      case "MM": return pad(t.getMonth() + 1);
      case "M": return String(t.getMonth() + 1);
      case "DD": return pad(t.getDate());
      case "D": return String(t.getDate());
      case "dddd": return DAYS[t.getDay()];
      case "ddd": return DAYS[t.getDay()].slice(0, 3);
      case "HH": return pad(t.getHours());
      case "H": return String(t.getHours());
      case "mm": return pad(t.getMinutes());
      default: return tok.slice(1, -1); // [literal]
    }
  });
}

/** A template's text with its placeholders filled in, without its frontmatter (`fm` gives that, to merge). */
export function fillTemplate(text: string, o: { title: string; now: Date }): { body: string; fm: Record<string, unknown> } {
  const { fm, body } = splitFrontmatter(text);
  const filled = body.replace(/\{\{\s*(title|date|time)(?::([^}]*))?\s*\}\}/gi, (_m, key: string, fmt?: string) => {
    const k = key.toLowerCase();
    if (k === "title") return o.title;
    return formatDate(o.now, fmt?.trim() || (k === "date" ? "YYYY-MM-DD" : "HH:mm"));
  });
  return { body: filled, fm };
}
