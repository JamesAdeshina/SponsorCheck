// scripts/build_sponsor_index.js

const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");

const INPUT_CSV = path.join(__dirname, "..", "extension", "data", "sponsors", "sponsors.csv");
const OUT_INDEX = path.join(__dirname, "..", "extension", "data", "sponsors", "sponsors_index.json");
const OUT_META = path.join(__dirname, "..", "extension", "data", "sponsors", "metadata.json");

function normalizeCompanyName(value) {
  if (!value) return "";
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(limited|ltd|llp|plc|inc|co|company|group|holdings|holding)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectOrganisationNameColumn(headers) {
  return (
    headers.find((h) => /organis(a|z)tion.*name/i.test(h)) ||
    headers.find((h) => /organisation/i.test(h) && /name/i.test(h)) ||
    headers.find((h) => /organization/i.test(h) && /name/i.test(h)) ||
    headers.find((h) => /^name$/i.test(h)) ||
    headers.find((h) => /name/i.test(h))
  );
}

function main() {
  if (!fs.existsSync(INPUT_CSV)) {
    console.error(`Missing CSV at: ${INPUT_CSV}`);
    process.exit(1);
  }

  const csvText = fs.readFileSync(INPUT_CSV, "utf8");

  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true
  });

  if (!records.length) {
    console.error("CSV parsed but contained zero records.");
    process.exit(1);
  }

  const headers = Object.keys(records[0] || {});
  const orgNameKey = detectOrganisationNameColumn(headers);

  if (!orgNameKey) {
    console.error("Could not detect organisation name column in CSV headers:", headers);
    process.exit(1);
  }

  const index = {};
  let uniqueKeys = 0;

  for (const row of records) {
    const rawName = (row[orgNameKey] || "").toString().trim();
    if (!rawName) continue;

    const normalized = normalizeCompanyName(rawName);
    if (!normalized) continue;

    if (!index[normalized]) {
      index[normalized] = rawName; // key fix: store ONE canonical name to keep file small + fast
      uniqueKeys += 1;
    }
  }

  fs.writeFileSync(OUT_INDEX, JSON.stringify(index, null, 2), "utf8");

  const meta = {
    source: "GOV.UK Register of Licensed Sponsors (Workers and Temporary Workers)",
    generated_at_utc: new Date().toISOString(),
    organisation_name_column: orgNameKey,
    rows_parsed: records.length,
    unique_normalized_keys: uniqueKeys
  };

  fs.writeFileSync(OUT_META, JSON.stringify(meta, null, 2), "utf8");

  console.log("Sponsor index built.");
  console.log(`Detected org column: ${orgNameKey}`);
  console.log(`Rows parsed: ${records.length}`);
  console.log(`Unique normalized keys: ${uniqueKeys}`);
}

main();
