import { compileFromFile } from "json-schema-to-typescript";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const schemaPath = join(__dirname, "../packages/schema/src/manifest.schema.json");
const outDir = join(__dirname, "../packages/schema/generated/ts");
const outFile = join(outDir, "index.d.ts");

async function main() {
  let ts = await compileFromFile(schemaPath, {
    bannerComment: "/* AUTO-GENERATED — do not edit by hand */",
  });

  // json-schema-to-typescript expands maxItems into verbose tuple unions;
  // collapse them back to simple arrays since runtime validation handles the limit.
  ts = ts.replace(
    /( +)(\/\*\*\n +\* @maxItems \d+\n +\*\/\n +\w+\??:)((?:\n +\| [^\n]+)+);/g,
    (_, indent, propHeader) => {
      const propLine = propHeader.split("\n").pop()!.trim();
      return `${indent}${propLine} string[];`;
    }
  );

  mkdirSync(outDir, { recursive: true });
  writeFileSync(outFile, ts);
  console.log(`Generated ${outFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
