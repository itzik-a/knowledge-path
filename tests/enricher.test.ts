import { describe, expect, it } from "vitest";
import { cleanTitle, shortDescription } from "../enricher/extract.ts";
import { explorePath } from "../shared/vault.ts";
import { recipeFromLd } from "../enricher/recipe.ts";

describe("enricher helpers", () => {
  it("drops a site name from titles", () => {
    expect(cleanTitle("סטואה – ויקיפדיה", "he.wikipedia.org")).toBe("סטואה");
    expect(cleanTitle("Stoicism - Wikipedia")).toBe("Stoicism");
    expect(cleanTitle("Why we sleep | Aeon Essays", "aeon.co")).toBe("Why we sleep");
    expect(cleanTitle("Rick Astley - Never Gonna Give You Up", "youtube")).toBe("Rick Astley - Never Gonna Give You Up");
    expect(cleanTitle("Marcus Aurelius: Meditations")).toBe("Marcus Aurelius: Meditations");
    expect(cleanTitle("Epictetus (Stanford Encyclopedia of Philosophy)", "plato.stanford.edu")).toBe("Epictetus");
    expect(cleanTitle("Meditations (Penguin Classics)", "amazon.com")).toBe("Meditations (Penguin Classics)");
  });
  it("makes a one-line fallback summary", () => {
    expect(shortDescription("The official video.\n\nFollow https://x.y for more")).toBeUndefined();
    expect(shortDescription("A long first paragraph about Stoic ethics and its reception https://x.y\nsecond line.\n\nmore")).toBe("A long first paragraph about Stoic ethics and its reception second line.");
  });
  it("names explore files safely", () => {
    expect(explorePath("History/Jewish & Israeli History")).toBe(".hub/explore/history-jewish-israeli-history.json");
  });
});

describe("recipes from a page's JSON-LD", () => {
  const ld = (o: unknown) => JSON.stringify(o);
  it("find the Recipe in a @graph and read it as written", () => {
    const page = ld({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebPage", name: "x" },
        {
          "@type": "Recipe", name: "Shakshuka &amp; Feta", description: "<p>Eggs poached in a spicy tomato sauce.</p>",
          recipeYield: ["4", "4 servings"], prepTime: "PT10M", cookTime: "PT25M", totalTime: "PT35M",
          image: [{ "@type": "ImageObject", url: "https://img.example/a.jpg" }], author: { "@type": "Person", name: "Dana" },
          recipeCategory: "Breakfast", recipeCuisine: ["Middle Eastern"],
          recipeIngredient: ["2 tbsp olive oil", "1&nbsp;onion, sliced", "For serving:", "parsley"],
          recipeInstructions: [
            { "@type": "HowToSection", name: "The sauce", itemListElement: [{ "@type": "HowToStep", text: "Fry the onion." }, { "@type": "HowToStep", text: "Add the tomatoes." }] },
            { "@type": "HowToSection", name: "Eggs", itemListElement: [{ "@type": "HowToStep", text: "Crack in the eggs." }] },
          ],
        },
      ],
    });
    expect(recipeFromLd(["{ not json", page])).toEqual({
      title: "Shakshuka & Feta", intro: "Eggs poached in a spicy tomato sauce.", servings: 4, prep: "10 min", cook: "25 min", total: "35 min",
      image: "https://img.example/a.jpg", author: "Dana", tags: ["breakfast", "middle-eastern"],
      ingredients: ["2 tbsp olive oil", "1 onion, sliced", "### For serving", "parsley"],
      steps: ["### The sauce", "Fry the onion.", "Add the tomatoes.", "### Eggs", "Crack in the eggs."],
    });
  });
  it("read instructions given as one block of text, and Hebrew", () => {
    const r = recipeFromLd([ld([{ "@type": ["Recipe", "NewsArticle"], name: "עוגה", recipeYield: "12 פרוסות", recipeIngredient: ["2 כוסות קמח"], recipeInstructions: "<ol><li>מערבבים.</li><li>אופים 40 דקות.</li></ol>" }])]);
    expect(r?.servings).toBe("12 פרוסות");
    expect(r?.steps).toEqual(["מערבבים.", "אופים 40 דקות."]);
    const lines = recipeFromLd([`{"@type":"Recipe","name":"x","recipeIngredient":["1 egg"],"recipeInstructions":"1. Whisk.\n2. Fry."}`]);
    expect(lines?.steps).toEqual(["Whisk.", "Fry."]);
  });
  it("ignore pages without a recipe, or with an empty one", () => {
    expect(recipeFromLd([ld({ "@type": "Article", name: "x" })])).toBeUndefined();
    expect(recipeFromLd([ld({ "@type": "Recipe", name: "x" })])).toBeUndefined();
  });
});
