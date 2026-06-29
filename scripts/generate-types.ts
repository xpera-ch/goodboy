import { compileFromFile } from "json-schema-to-typescript";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const schemaPath = join(__dirname, "../schema/manifest.schema.json");
const outDir = join(__dirname, "../types/ts");
const outFile = join(outDir, "index.d.ts");

async function main() {
  const ts = await compileFromFile(schemaPath, {
    bannerComment: "/* AUTO-GENERATED — do not edit by hand */",
  });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outFile, ts);
  console.log(`Generated ${outFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
