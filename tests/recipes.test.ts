import { describe, expect, it } from "vitest";
import { buildIndex, parseDoc, type Doc } from "../shared/index.ts";
import {
  allIngredients, allSteps, fillRecipe, findTimes, fmtFraction, fmtMetric, minutesOf, parseIngredient, parseRecipe, readNumber,
  convertText, parseRecipeText, recipeBody, recipeOf, setCooked, showIngredient, timeText, totalMinutes,
} from "../shared/recipes.ts";
import { merge3 } from "../src/lib/vaultsync.ts";
import { kindOf } from "../shared/vault.ts";

const ing = (s: string) => { const x = parseIngredient(s); return { qty: x.qty, unit: x.unit, rest: x.rest }; };

const SHAKSHUKA = `Spicy, from a friend.

## Ingredients

- 2 tbsp olive oil
- 1 onion, sliced
- 400 g crushed tomatoes
- ½ tsp cumin
- salt to taste

### For serving
- parsley, chopped

## Steps

1. Fry the onion in the oil for 10 minutes.
2. Add the tomatoes and spices;
   simmer 15 minutes.
3. Crack in the eggs, cover for 6–8 minutes.

## Notes

Less harissa for the kids.

## Cooked

- 2026-11-02
- 2026-11-23: double batch
`;

describe("recipe files", () => {
  it("are their own kind, only directly in Recipes/", () => {
    expect(kindOf("Recipes/Shakshuka.md")).toBe("recipe");
    expect(kindOf("Recipes/Old/Shakshuka.md")).toBe("note");
  });

  it("read the frontmatter, all of it optional", () => {
    expect(recipeOf({})).toEqual({ provisional: false, servings: undefined, yield: undefined, prep: undefined, cook: undefined, total: undefined, source: undefined, image: undefined, site: undefined, author: undefined, rating: undefined, enrich: undefined, enrichError: undefined });
    const r = recipeOf({ servings: "12 cookies", prep: 15, cook: "PT1H30M", rating: 4, url: "https://x.y/z" });
    expect(r.servings).toBe(12);
    expect(r.yield).toBe("12 cookies");
    expect(r.prep).toBe("15 min");
    expect(r.cook).toBe("1 h 30 min");
    expect(r.source).toBe("https://x.y/z");
    expect(totalMinutes(r)).toBe(105);
    expect(recipeOf({ servings: 4 }).yield).toBeUndefined();
  });

  it("read times as written", () => {
    expect(timeText("PT0M")).toBeUndefined();
    expect(minutesOf("1 h 30 min")).toBe(90);
    expect(minutesOf("שעה וחצי")).toBe(90);
    expect(minutesOf("1:15")).toBe(75);
    expect(minutesOf("45 דקות")).toBe(45);
  });

  it("are indexed with ingredient names and the days cooked", () => {
    const d = parseDoc("Recipes/Shakshuka.md", `---\nservings: 4\ntopics: ["[[Food]]"]\n---\n${SHAKSHUKA}`);
    expect(d.kind).toBe("recipe");
    expect(d.excerpt).toBe("Spicy, from a friend.");
    expect(d.cooking!.cooked).toEqual(["2026-11-23", "2026-11-02"]);
    expect(d.cooking!.ingredients).toContain("crushed tomatoes");
    const ix = buildIndex(new Map([["Topics/Food.md", parseDoc("Topics/Food.md", "")], [d.path, d]] as [string, Doc][]));
    expect(ix.topicsOf.get(d.path)).toEqual(["Food"]);
  });
});

describe("amounts", () => {
  it("read numbers in every form", () => {
    expect(readNumber("2 cups")).toEqual({ n: 2, len: 1 });
    expect(readNumber("1½ cups")!.n).toBe(1.5);
    expect(readNumber("1 1/2 cups")!.n).toBe(1.5);
    expect(readNumber("1-1/2 cups")!.n).toBe(1.5);
    expect(readNumber("3/4 cup")!.n).toBe(0.75);
    expect(readNumber("0.5 l")!.n).toBe(0.5);
    expect(readNumber("1,5 כוסות")!.n).toBe(1.5);
    expect(readNumber("1,000 g")).toEqual({ n: 1000, len: 5 });
    expect(readNumber("two eggs")!.n).toBe(2);
    expect(readNumber("שתי ביצים")!.n).toBe(2);
    expect(readNumber("onion")).toBeNull();
  });

  it("read the amount, unit and rest of an ingredient", () => {
    expect(ing("2 tbsp olive oil")).toEqual({ qty: { n: 2 }, unit: "tbsp", rest: "olive oil" });
    expect(ing("1 onion, sliced")).toEqual({ qty: { n: 1 }, unit: undefined, rest: "onion, sliced" });
    expect(ing("400g crushed tomatoes")).toEqual({ qty: { n: 400 }, unit: "g", rest: "crushed tomatoes" });
    expect(ing("2-3 cloves garlic")).toEqual({ qty: { n: 2, to: 3 }, unit: undefined, rest: "cloves garlic" });
    expect(ing("2 to 3 Tbsp. sugar")).toEqual({ qty: { n: 2, to: 3 }, unit: "tbsp", rest: "sugar" });
    expect(ing("half a cup of milk")).toEqual({ qty: { n: 0.5 }, unit: "cup", rest: "of milk" });
    expect(ing("a pinch of salt")).toEqual({ qty: { n: 1 }, unit: "pinch", rest: "of salt" });
    expect(ing("1 large egg")).toEqual({ qty: { n: 1 }, unit: undefined, rest: "large egg" });
    expect(ing("2 large eggs").unit).toBeUndefined(); // not litres
    expect(ing("2 garlic cloves").unit).toBeUndefined(); // not grams
    expect(ing("2 Tomatoes").unit).toBeUndefined();
    expect(ing("salt to taste")).toEqual({ qty: undefined, unit: undefined, rest: "salt to taste" });
    expect(ing("cup of flour")).toEqual({ qty: undefined, unit: undefined, rest: "cup of flour" });
  });

  it("read Hebrew ingredients", () => {
    expect(ing("2 כוסות קמח")).toEqual({ qty: { n: 2 }, unit: "cup", rest: "קמח" });
    expect(ing("כוס קמח")).toEqual({ qty: { n: 1 }, unit: "cup", rest: "קמח" });
    expect(ing("כוס וחצי סוכר")).toEqual({ qty: { n: 1.5 }, unit: "cup", rest: "סוכר" });
    expect(ing("2 וחצי כוסות מים")).toEqual({ qty: { n: 2.5 }, unit: "cup", rest: "מים" });
    expect(ing("חצי כפית מלח")).toEqual({ qty: { n: 0.5 }, unit: "tsp", rest: "מלח" });
    expect(ing("3 כפות שמן זית")).toEqual({ qty: { n: 3 }, unit: "tbsp", rest: "שמן זית" });
    expect(ing("200 גרם חמאה")).toEqual({ qty: { n: 200 }, unit: "g", rest: "חמאה" });
    expect(ing("500 מ\"ל חלב")).toEqual({ qty: { n: 500 }, unit: "ml", rest: "חלב" });
    expect(ing("1 ק״ג תפוחי אדמה")).toEqual({ qty: { n: 1 }, unit: "kg", rest: "תפוחי אדמה" });
    expect(ing("שתי ביצים")).toEqual({ qty: { n: 2 }, unit: undefined, rest: "ביצים" });
    expect(ing("כ-200 גרם גבינה").qty).toEqual({ n: 200 });
    expect(ing("קורט מלח").unit).toBe("pinch");
    expect(ing("מלח ופלפל")).toEqual({ qty: undefined, unit: undefined, rest: "מלח ופלפל" });
  });

  it("scale, as a cook would write it", () => {
    const show = (s: string, f: number) => { const x = showIngredient(parseIngredient(s), f); return `${x.amount ?? ""}|${x.rest}`; };
    expect(show("2 tbsp olive oil", 1)).toBe("2 tbsp|olive oil");
    expect(show("1½ cups flour", 2)).toBe("3 cups|flour");
    expect(show("1 cup flour", 0.5)).toBe("½ cup|flour");
    expect(show("1 onion", 1.5)).toBe("1½|onion");
    expect(show("2-3 cloves garlic", 2)).toBe("4–6|cloves garlic");
    expect(show("400 g tomatoes", 1.5)).toBe("600 g|tomatoes");
    expect(show("כוס קמח", 2)).toBe("2 כוסות|קמח");
    expect(show("about 1 cup milk", 3)).toBe("about 3 cups|milk");
    expect(show("salt to taste", 2)).toBe("|salt to taste");
    expect(fmtFraction(0.33)).toBe("⅓");
    expect(fmtFraction(2.7)).toBe("2⅔");
    expect(fmtFraction(0.02)).toBe("⅛");
    expect(fmtFraction(6.3)).toBe("6½");
    expect(fmtFraction(1.97)).toBe("2");
    expect(fmtMetric(7.3)).toBe("7.5");
    expect(fmtMetric(123)).toBe("125");
    expect(fmtMetric(1234)).toBe("1230");
  });
});

describe("recipe bodies", () => {
  it("parse into ingredients in groups, steps, notes and the Cooked log", () => {
    const p = parseRecipe(SHAKSHUKA);
    expect(p.intro).toBe("Spicy, from a friend.");
    expect(p.ingredients.map((g) => [g.title, g.items.length])).toEqual([[undefined, 5], ["For serving", 1]]);
    expect(allSteps(p).map((s) => s.text)).toEqual([
      "Fry the onion in the oil for 10 minutes.",
      "Add the tomatoes and spices; simmer 15 minutes.",
      "Crack in the eggs, cover for 6–8 minutes.",
    ]);
    expect(p.notes).toBe("Less harissa for the kids.");
    expect(p.cooked.map((c) => [c.date, c.note])).toEqual([["2026-11-23", "double batch"], ["2026-11-02", undefined]]);
  });

  it("read Hebrew headings, plain lines and paragraphs", () => {
    const p = parseRecipe("# עוגה\n\nעוגה פשוטה.\n\n## מצרכים:\n\n2 כוסות קמח\nכוס סוכר\n\nלציפוי:\n- 100 גרם שוקולד\n\n## אופן ההכנה\n\nמחממים תנור.\n\nמערבבים הכל ואופים 40 דקות.\n\n## משהו אחר\n\nטקסט\n");
    expect(p.intro).toBe("עוגה פשוטה.");
    expect(p.ingredients.map((g) => [g.title, g.items.map((x) => x.rest)])).toEqual([[undefined, ["קמח", "סוכר"]], ["לציפוי", ["שוקולד"]]]);
    expect(allSteps(p).map((s) => s.text)).toEqual(["מחממים תנור.", "מערבבים הכל ואופים 40 דקות."]);
    expect(p.notes).toBe("## משהו אחר\n\nטקסט");
  });

  it("write a new recipe, and fill an empty one without overwriting", () => {
    expect(recipeBody()).toBe("## Ingredients\n\n- \n\n## Steps\n\n1. \n");
    expect(parseRecipe(recipeBody())).toMatchObject({ ingredients: [], steps: [] });
    const body = recipeBody({ intro: "Nice.", ingredients: ["1 cup rice", "### Sauce", "2 tbsp soy"], steps: ["Cook.", "Serve."] });
    expect(body).toBe("Nice.\n\n## Ingredients\n\n- 1 cup rice\n\n### Sauce\n- 2 tbsp soy\n\n## Steps\n\n1. Cook.\n2. Serve.\n");
    expect(parseRecipe(body).ingredients.map((g) => g.title)).toEqual([undefined, "Sauce"]);
    // an empty template, with my notes and log, gets the import; my notes stay
    const mine = "## Ingredients\n\n- \n\n## Steps\n\n1. \n\n## Notes\n\nFrom Dana.\n\n## Cooked\n\n- 2026-11-01\n";
    const filled = fillRecipe(mine, { intro: "Imported.", ingredients: ["2 eggs"], steps: ["Whisk."] });
    expect(filled).toBe("Imported.\n\n## Ingredients\n\n- 2 eggs\n\n## Steps\n\n1. Whisk.\n\n## Notes\n\nFrom Dana.\n\n## Cooked\n\n- 2026-11-01\n");
    expect(fillRecipe(SHAKSHUKA, { ingredients: ["x"], steps: ["y"] })).toBe(SHAKSHUKA);
    // a resource's notes made into a recipe
    expect(fillRecipe("## Notes\n\nLooks good.\n", { ingredients: ["1 egg"], steps: ["Fry."] })).toBe("## Ingredients\n\n- 1 egg\n\n## Steps\n\n1. Fry.\n\n## Notes\n\nLooks good.\n");
  });

  it("keep a Cooked log, newest first", () => {
    let b = "Intro.\n";
    b = setCooked(b, "2026-11-20");
    expect(b).toBe("Intro.\n\n## Cooked\n\n- 2026-11-20\n");
    b = setCooked(b, "2026-11-23", "too salty");
    b = setCooked(b, "2026-11-01");
    expect(parseRecipe(b).cooked.map((c) => c.date)).toEqual(["2026-11-23", "2026-11-20", "2026-11-01"]);
    expect(b).toContain("- 2026-11-23: too salty\n- 2026-11-20\n- 2026-11-01");
    b = setCooked(b, "2026-11-20", null);
    expect(parseRecipe(b).cooked.map((c) => c.date)).toEqual(["2026-11-23", "2026-11-01"]);
    expect(setCooked("## Cooked\n", "2026-11-20")).toBe("## Cooked\n\n- 2026-11-20\n");
    expect(setCooked("## Cooked\n\n## Notes\n\nx\n", "2026-11-20")).toBe("## Cooked\n\n- 2026-11-20\n\n## Notes\n\nx\n");
  });

  it("merge two devices' Cooked logs without a conflict copy", () => {
    const base = "## Cooked\n\n- 2026-11-01\n";
    const a = setCooked(base, "2026-11-20");
    const b = setCooked(base, "2026-11-21", "with friends");
    expect(merge3(base, a, b, { logs: true })).toBe("## Cooked\n\n- 2026-11-21: with friends\n- 2026-11-20\n- 2026-11-01\n");
  });
});

describe("times in steps", () => {
  const times = (s: string) => findTimes(s).map((t) => [t.seconds, t.label]);
  it("find durations in English and Hebrew", () => {
    expect(times("Simmer for 15 minutes, then rest 5 min.")).toEqual([[900, "15 min"], [300, "5 min"]]);
    expect(times("Bake 1 1/2 hours")).toEqual([[5400, "1 h 30 min"]]);
    expect(times("cover for 6–8 minutes")).toEqual([[360, "6–8 min"]]);
    expect(times("Rest for an hour, or half an hour if rushed")).toEqual([[3600, "1 h"], [1800, "30 min"]]);
    expect(times("Boil 30 seconds")).toEqual([[30, "30 s"]]);
    expect(times("אופים 40 דקות עד להזהבה")).toEqual([[2400, "40 min"]]);
    expect(times("מתפיחים שעתיים, ואז חצי שעה נוספת")).toEqual([[7200, "2 h"], [1800, "30 min"]]);
    expect(times("Add 2 cups of flour")).toEqual([]);
    expect(times("Preheat to 180°C")).toEqual([]);
  });
});

describe("the recipe page helpers", () => {
  it("know every ingredient line", () => {
    expect(allIngredients(parseRecipe(SHAKSHUKA)).map((x) => x.line)).toEqual([4, 5, 6, 7, 8, 11]);
  });
});

describe("pasted recipes", () => {
  it("split on their headings", () => {
    const p = parseRecipeText(`Lemon cake\nMoist and quick.\n\nIngredients:\n• 2 cups flour\n• 1 cup sugar\nFor the glaze:\n• 1 lemon\n\nMethod\n1. Mix the dry things.\n2. Add the eggs\nand stir well.\n3. Bake 35 minutes.\n\nNotes\nKeeps 3 days.`);
    expect(p.title).toBe("Lemon cake");
    expect(p.intro).toBe("Moist and quick.");
    expect(p.ingredients).toEqual(["2 cups flour", "1 cup sugar", "### For the glaze", "1 lemon"]);
    expect(p.steps).toEqual(["Mix the dry things.", "Add the eggs and stir well.", "Bake 35 minutes."]);
    expect(p.notes).toBe("Keeps 3 days.");
  });
  it("read Hebrew", () => {
    const p = parseRecipeText(`עוגת גבינה\n\nמצרכים:\n- 500 גרם גבינה\n- 3 ביצים\n\nאופן ההכנה:\nמערבבים הכל.\nאופים 50 דקות.`);
    expect(p.title).toBe("עוגת גבינה");
    expect(p.ingredients).toEqual(["500 גרם גבינה", "3 ביצים"]);
    expect(p.steps).toEqual(["מערבבים הכל.", "אופים 50 דקות."]);
  });
  it("find the ingredients by their amounts when there are no headings", () => {
    const p = parseRecipeText(`Pancakes\n1 cup flour\n1 egg\n1 cup milk\nWhisk everything together.\nFry in a hot pan, 2 minutes a side.`);
    expect(p.title).toBe("Pancakes");
    expect(p.ingredients).toEqual(["1 cup flour", "1 egg", "1 cup milk"]);
    expect(p.steps).toEqual(["Whisk everything together.", "Fry in a hot pan, 2 minutes a side."]);
    expect(p.intro).toBeUndefined();
  });
  it("make a body that reads back the same", () => {
    const p = parseRecipeText(`Ingredients\n- 1 cup rice\nSteps\n1. Cook it.`);
    const r = parseRecipe(recipeBody(p));
    expect(allIngredients(r).map((x) => x.text)).toEqual(["1 cup rice"]);
    expect(allSteps(r).map((x) => x.text)).toEqual(["Cook it."]);
  });
});

describe("metric", () => {
  const m = (s: string, f = 1) => { const x = showIngredient(parseIngredient(s), f, true); return `${x.amount ?? ""}|${x.rest}${x.original ? `|${x.original}` : ""}`; };
  it("turns cups into grams by what's in them, and liquids into millilitres", () => {
    expect(m("2 cups all-purpose flour")).toBe("250 g|all-purpose flour|2 cups");
    expect(m("1 cup sugar")).toBe("200 g|sugar|1 cup");
    expect(m("1 cup packed brown sugar")).toBe("215 g|packed brown sugar|1 cup"); // "packed brown sugar" still finds brown sugar
    expect(m("½ cup butter, melted")).toBe("115 g|butter, melted|½ cup");
    expect(m("1 cup peanut butter")).toBe("260 g|peanut butter|1 cup");
    expect(m("1 cup milk")).toBe("240 ml|milk|1 cup");
    expect(m("1½ cups water", 2)).toBe("720 ml|water|3 cups");
    expect(m("1 cup something unusual")).toBe("240 ml|something unusual|1 cup");
    expect(m("2 cups קמח")).toBe("250 גרם|קמח|2 כוסות"); // a Hebrew line gets Hebrew units
    expect(m("כוס וחצי סוכר")).toBe("300 גרם|סוכר|1½ כוסות");
    expect(m("חצי כוס שמן")).toBe("110 גרם|שמן|½ כוס");
    expect(m("4 cups flour")).toBe("500 g|flour|4 cups");
    expect(m("8 cups flour")).toBe("1 kg|flour|8 cups");
  });
  it("turns ounces, pounds and sticks into grams, and leaves spoons and metric alone", () => {
    expect(m("8 oz cream cheese")).toBe("225 g|cream cheese|8 oz");
    expect(m("2 lb potatoes")).toBe("905 g|potatoes|2 lb");
    expect(m("3 lbs chicken")).toBe("1.36 kg|chicken|3 lb");
    expect(m("1 stick butter")).toBe("115 g|butter|1 stick");
    expect(m("1 cup (2 sticks) butter, melted")).toBe("225 g|butter, melted|1 cup");
    expect(m("1 cup (about 4 oz) walnuts")).toBe("115 g|walnuts|1 cup");
    expect(m("2 fl oz cream")).toBe("60 ml|cream|2 fl oz");
    expect(m("2 tbsp olive oil")).toBe("2 tbsp|olive oil");
    expect(m("200 g butter")).toBe("200 g|butter");
    expect(m("2 eggs")).toBe("2|eggs");
    expect(m("salt to taste")).toBe("|salt to taste");
  });
  it("converts temperatures, pan sizes and ounces in text", () => {
    expect(convertText("Bake at 350°F for 30 minutes")).toBe("Bake at 175°C for 30 minutes");
    expect(convertText("Preheat the oven to 425 F.")).toBe("Preheat the oven to 220°C.");
    expect(convertText("a 9x13-inch pan")).toBe("a 23×33 cm pan");
    expect(convertText("a 9-inch springform")).toBe("a 23 cm springform");
    expect(convertText("cut into 1 in. pieces")).toBe("cut into 3 cm pieces");
    expect(m("1 (14 oz) can tomatoes")).toBe("1|(395 g) can tomatoes");
    expect(convertText("Bake at 180°C")).toBe("Bake at 180°C");
    expect(convertText("2 eggs, in a bowl")).toBe("2 eggs, in a bowl");
  });
});
