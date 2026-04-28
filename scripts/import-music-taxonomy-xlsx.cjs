#!/usr/bin/env node
/**
 * Reads syncbiz_music_taxonomy_stage3_clean.xlsx → sheet "Stage 3 Seed"
 * (or first sheet) and writes prisma/seed-data/music-taxonomy.generated.json
 *
 * Usage:
 *   node scripts/import-music-taxonomy-xlsx.cjs [path/to/file.xlsx]
 *
 * Dev dependency: `xlsx` (sheetjs).
 */
const fs = require("fs");
const path = require("path");

function normHeader(cell) {
  return String(cell ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/gu, "");
}

function pick(row, aliases) {
  const keys = Object.keys(row);
  for (const a of aliases) {
    const na = normHeader(a);
    const hit = keys.find((k) => normHeader(k) === na);
    if (hit !== undefined && row[hit] !== undefined && row[hit] !== "") {
      return row[hit];
    }
  }
  return "";
}

function parseAliases(cell) {
  if (cell === undefined || cell === null || cell === "") return [];
  if (Array.isArray(cell)) return cell.map(String).map((s) => s.trim()).filter(Boolean);
  return String(cell)
    .split(/[,;|]/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

function main() {
  let XLSX;
  try {
    XLSX = require("xlsx");
  } catch {
    console.error("Missing dependency `xlsx`. Run: npm install xlsx --save-dev");
    process.exit(1);
  }

  const inputArg = process.argv[2]?.trim();
  const inputPath = path.resolve(
    process.cwd(),
    inputArg || path.join("data", "syncbiz_music_taxonomy_stage3_clean.xlsx"),
  );

  if (!fs.existsSync(inputPath)) {
    console.error(`File not found: ${inputPath}`);
    process.exit(1);
  }

  const workbook = XLSX.readFile(inputPath, { cellDates: false });
  const preferred = workbook.SheetNames.find((n) => n.trim() === "Stage 3 Seed");
  const sheetName = preferred ?? workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });

  const out = [];
  let line = 0;
  for (const raw of rows) {
    line += 1;
    const row = raw;
    const slug = String(pick(row, ["slug"])).trim();
    if (!slug) continue;

    const category = String(pick(row, ["category"])).trim();
    const labelEn = String(pick(row, ["labelEn", "label_en", "english", "English label"])).trim();
    const labelHe = String(pick(row, ["labelHe", "label_he", "hebrew", "Hebrew label"])).trim();

    if (!category || !labelEn || !labelHe) {
      console.warn(`Line ${line}: skipping incomplete row for slug=${slug}`);
      continue;
    }

    const sortRaw = pick(row, ["sortOrder", "sort_order", "sort"]);
    let sortOrder = 0;
    if (sortRaw !== "" && sortRaw !== undefined && sortRaw !== null) {
      const n = Number(sortRaw);
      if (Number.isFinite(n)) sortOrder = Math.floor(n);
    }

    const descriptionHeUserRaw = pick(row, ["descriptionHeUser", "description_he_user"]);
    const descriptionAiRaw = pick(row, ["descriptionAi", "description_ai"]);

    const statusRaw = String(pick(row, ["status"]) || "ACTIVE").trim();

    const parentSlugRaw = pick(row, ["parentSlug", "parent_slug", "parent"]);
    const mergedIntoSlugRaw = pick(row, ["mergedIntoSlug", "merged_into_slug", "merged_into"]);

    out.push({
      slug,
      category,
      labelEn,
      labelHe,
      descriptionHeUser:
        descriptionHeUserRaw === "" || descriptionHeUserRaw === undefined ? null : String(descriptionHeUserRaw),
      descriptionAi:
        descriptionAiRaw === "" || descriptionAiRaw === undefined ? null : String(descriptionAiRaw),
      aliases: parseAliases(pick(row, ["aliases"])),
      status: statusRaw || "ACTIVE",
      parentSlug:
        parentSlugRaw === "" || parentSlugRaw === undefined ? null : String(parentSlugRaw).trim(),
      mergedIntoSlug:
        mergedIntoSlugRaw === "" || mergedIntoSlugRaw === undefined
          ? null
          : String(mergedIntoSlugRaw).trim(),
      sortOrder,
    });
  }

  const outDir = path.join(process.cwd(), "prisma", "seed-data");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "music-taxonomy.generated.json");
  fs.writeFileSync(outFile, `${JSON.stringify(out, null, 2)}\n`, "utf8");

  console.info(`Sheet: "${sheetName}"`);
  console.info(`Wrote ${out.length} rows → ${outFile}`);
}

main();
