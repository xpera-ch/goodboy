import { compileFromFile } from "json-schema-to-typescript";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const outDir = join(__dirname, "../packages/schema/generated/ts");

const targets = [
  {
    schemaPath: join(__dirname, "../packages/schema/src/manifest.schema.json"),
    outFile: join(outDir, "index.d.ts"),
  },
  {
    schemaPath: join(__dirname, "../packages/schema/src/goodboy-json.schema.json"),
    outFile: join(outDir, "goodboy-json.d.ts"),
  },
  {
    schemaPath: join(__dirname, "../packages/schema/src/goodboy-lock.schema.json"),
    outFile: join(outDir, "goodboy-lock.d.ts"),
  },
];

async function main() {
  mkdirSync(outDir, { recursive: true });

  for (const { schemaPath, outFile } of targets) {
    const ts = await compileFromFile(schemaPath, {
      bannerComment: "/* AUTO-GENERATED — do not edit by hand */",
      ignoreMinAndMaxItems: true,
    });
    writeFileSync(outFile, ts);
    console.log(`Generated ${outFile}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
