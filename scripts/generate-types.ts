import { compileFromFile } from "json-schema-to-typescript";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const schemaPath = join(__dirname, "../packages/schema/src/manifest.schema.json");
const outDir = join(__dirname, "../packages/schema/generated/ts");
const outFile = join(outDir, "index.d.ts");

async function main() {
  const ts = await compileFromFile(schemaPath, {
    bannerComment: "/* AUTO-GENERATED — do not edit by hand */",
    ignoreMinAndMaxItems: true,
  });

  mkdirSync(outDir, { recursive: true });
  writeFileSync(outFile, ts);
  console.log(`Generated ${outFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
