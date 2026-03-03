const fs = require("fs");
const path = require("path");
const https = require("https");
const { parse } = require("csv-parse/sync");

function download(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      })
      .on("error", reject);
  });
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function pick(row, key) {
  return row[key] ?? "";
}

(async () => {
  const url = process.env.TT_FEED_URL;
  if (!url) {
    console.error("Missing TT_FEED_URL secret");
    process.exit(1);
  }

  console.log("Downloading feed...");
  const raw = await download(url);

  // Dit gaat ervan uit dat je TT output CSV is
  // Als jouw TT output JSON is, zeg het, dan pas ik dit aan
  const records = parse(raw, {
    columns: true,
    skip_empty_lines: true,
  });

  console.log(`Rows: ${records.length}`);

  // Pas deze veldnamen aan op jouw TT kolommen
  // Je gaat straks 1x de kolomnamen checken
  const FIELD_ID = "productID";
  const FIELD_TITLE = "name";
  const FIELD_PRICE = "price";
  const FIELD_DEEPLINK = "URL";
  const FIELD_IMAGE = "imageURL";
  const FIELD_DESC = "description";

  // Thin output: geen lange description
  const thin = records.map((r) => ({
    id: pick(r, FIELD_ID),
    title: pick(r, FIELD_TITLE),
    price: Number(pick(r, FIELD_PRICE)) || null,
    url: pick(r, FIELD_DEEPLINK),
    image: pick(r, FIELD_IMAGE),
    updated_at: new Date().toISOString(),
  }));

  // Voorbeeld slug filters (pas aan naar jouw logica)
  const weekend = thin.filter((x) => x.price !== null && x.price <= 150);
  const under100 = thin.filter((x) => x.price !== null && x.price <= 100);

  const outBase = path.join(process.cwd(), "public", "corendon");
  ensureDir(outBase);

  fs.writeFileSync(path.join(outBase, "all.min.json"), JSON.stringify(thin));
  fs.writeFileSync(path.join(outBase, "weekend.json"), JSON.stringify(weekend));
  fs.writeFileSync(path.join(outBase, "under_100.json"), JSON.stringify(under100));

  const index = {
    last_updated: new Date().toISOString(),
    counts: {
      all: thin.length,
      weekend: weekend.length,
      under_100: under100.length,
    },
    files: {
      all_min: "/corendon/all.min.json",
      weekend: "/corendon/weekend.json",
      under_100: "/corendon/under_100.json",
    },
  };

  fs.writeFileSync(path.join(outBase, "index.json"), JSON.stringify(index, null, 2));

  console.log("Done. Files written to public/corendon/");
})();
