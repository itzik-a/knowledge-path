import { describe, expect, it } from "vitest";
import { addItems, aisleOf, clearDone, parseShopping } from "../shared/shopping.ts";
import { kindOf } from "../shared/vault.ts";

describe("the shopping list", () => {
  it("is a note at the top of the vault", () => {
    expect(kindOf("Shopping list.md")).toBe("note");
  });

  it("files things by aisle, English and Hebrew", () => {
    expect(aisleOf("onions")).toBe("Produce");
    expect(aisleOf("eggplant")).toBe("Produce");
    expect(aisleOf("eggs")).toBe("Dairy & eggs");
    expect(aisleOf("nutmeg")).toBe("Spices");
    expect(aisleOf("baking powder")).toBe("Pantry");
    expect(aisleOf("black pepper")).toBe("Spices");
    expect(aisleOf("red pepper, sliced")).toBe("Produce");
    expect(aisleOf("olive oil")).toBe("Pantry");
    expect(aisleOf("crushed tomatoes")).toBe("Pantry");
    expect(aisleOf("2 cans chickpeas")).toBe("Pantry");
    expect(aisleOf("chicken thighs")).toBe("Meat & fish");
    expect(aisleOf("pita")).toBe("Bakery");
    expect(aisleOf("בצל")).toBe("Produce");
    expect(aisleOf("הביצים")).toBe("Dairy & eggs");
    expect(aisleOf("קמח לבן")).toBe("Pantry");
    expect(aisleOf("אבקת אפייה")).toBe("Pantry");
    expect(aisleOf("פפריקה מתוקה")).toBe("Spices");
    expect(aisleOf("roasted peanuts")).toBe("Pantry");
    expect(aisleOf("rainbow chard leaf with stem (mangold)")).toBe("Produce");
    expect(aisleOf("of hydrolyzed collagen powder")).toBe("Pantry");
    expect(aisleOf("pumpkin seeds")).toBe("Pantry");
    expect(aisleOf("tofu cubes")).toBe("Dairy & eggs");
    expect(aisleOf("bulgarit / tofu")).toBe("Dairy & eggs");
    expect(aisleOf("beets")).toBe("Produce");
    expect(aisleOf("blueberries")).toBe("Produce");
    expect(aisleOf("something odd")).toBe("Other");
  });

  it("adds items under their aisles, in the usual order", () => {
    let b = addItems("", [{ text: "6 eggs", recipe: "Shakshuka" }, { text: "2 onions", recipe: "Shakshuka" }]);
    expect(b).toBe("## Produce\n- [ ] 2 onions ([[Shakshuka]])\n\n## Dairy & eggs\n- [ ] 6 eggs ([[Shakshuka]])\n");
    b = addItems(b, [{ text: "parsley" }, { text: "1 cup rice" }]);
    expect(b).toBe("## Produce\n- [ ] 2 onions ([[Shakshuka]])\n- [ ] parsley\n\n## Dairy & eggs\n- [ ] 6 eggs ([[Shakshuka]])\n\n## Pantry\n- [ ] 1 cup rice\n");
    expect(parseShopping(b).map((x) => [x.aisle, x.text, x.recipes])).toEqual([
      ["Produce", "2 onions", ["Shakshuka"]], ["Produce", "parsley", []], ["Dairy & eggs", "6 eggs", ["Shakshuka"]], ["Pantry", "1 cup rice", []],
    ]);
  });

  it("adds up the same thing in the same unit", () => {
    let b = addItems("", [{ text: "1 onion", recipe: "Soup" }, { text: "200 g butter", recipe: "Cake" }]);
    b = addItems(b, [{ text: "2 onions, chopped", recipe: "Shakshuka" }, { text: "50 g butter", recipe: "Cake" }, { text: "2 tbsp butter" }]);
    expect(b).toContain("- [ ] 3 onions, chopped ([[Soup]], [[Shakshuka]])");
    expect(b).toContain("- [ ] 250 g butter ([[Cake]])");
    expect(b).toContain("- [ ] 2 tbsp butter\n"); // another unit: its own line
    // ticked items aren't added to
    const t = addItems(b.replace("- [ ] 250 g butter", "- [x] 250 g butter"), [{ text: "100 g butter" }]);
    expect(t).toContain("- [x] 250 g butter");
    expect(t).toContain("- [ ] 100 g butter");
    // Hebrew
    expect(addItems("## Dairy & eggs\n- [ ] 2 ביצים\n", [{ text: "3 ביצים" }])).toBe("## Dairy & eggs\n- [ ] 5 ביצים\n");
  });

  it("clears what's ticked, and aisles left empty", () => {
    const b = "## Produce\n- [x] 2 onions\n- [ ] parsley\n\n## Dairy & eggs\n- [x] 6 eggs\n\n## Pantry\n- [ ] rice\n";
    expect(clearDone(b)).toBe("## Produce\n- [ ] parsley\n\n## Pantry\n- [ ] rice\n");
    expect(clearDone("## Produce\n- [x] a\n")).toBe("\n");
  });
});
