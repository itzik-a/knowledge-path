/* Write the starter vault into a folder (to make the vault repo):
     node scripts/make-vault.ts <dir>
   The seed files, the README, .gitignore and the enrich workflow from vault-template/. */
import { cp, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { SEED, VAULT_README } from "../shared/seed.ts";

const dir = process.argv[2];
if (!dir) { console.error("usage: node scripts/make-vault.ts <dir>"); process.exit(1); }
for (const [p, c] of Object.entries(SEED)) {
  await mkdir(join(dir, dirname(p)), { recursive: true });
  await writeFile(join(dir, p), c);
}
await writeFile(join(dir, "README.md"), VAULT_README);
await cp(new URL("../vault-template/", import.meta.url), dir, { recursive: true });
console.log(`Wrote ${Object.keys(SEED).length} files + README + workflow to ${dir}`);
