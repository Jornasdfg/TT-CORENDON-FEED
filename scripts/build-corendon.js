const fs = require("fs");
const path = require("path");
const https = require("https");

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function fetchUrl(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        // Follow redirects (TradeTracker doet dit vaak)
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          redirectsLeft > 0
        ) {
          const next = res.headers.location.startsWith("http")
            ? res.headers.location
            : new URL(res.headers.location, url).toString();
          res.resume();
          return resolve(fetchUrl(next, redirectsLeft - 1));
        }

        if (res.statusCode >= 400) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }

        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve(data));
      })
      .on("error", reject);
  });
}

function first(arrOrVal) {
  if (Array.isArray(arrOrVal)) return arrOrVal[0] || "";
  return arrOrVal || "";
}

function toNumber(v) {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]+/g, "");
}

function pickImage(images) {
  if (!Array.isArray(images) || images.length === 0) return "";
  return images[0];
}

(async () => {
  const url = process.env.TT_FEED_URL;
  if (!url) {
    console.error("Missing TT_FEED_URL secret");
    process.exit(1);
  }

  console.log("Downloading JSON feed...");
  const raw = await fetchUrl(url);

  let json;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    console.error("Not valid JSON. First 200 chars:");
    console.error(raw.slice(0, 200));
    process.exit(1);
  }

  // Jouw feed is: { products: [...] }
  const products = Array.isArray(json?.products) ? json.products : [];
  if (products.length === 0) {
    console.error("No products found. Top-level keys:", Object.keys(json || {}));
    process.exit(1);
  }

  console.log("Products:", products.length);

  // Price caps per land (pas aan)
  const COUNTRY_PRICE_CAPS = {
    Spanje: 600,
    Griekenland: 650,
    Turkije: 700,
    Portugal: 650,
    "Italië": 650,
    Egypte: 800,
  };
  const DEFAULT_CAP = 700;

  // Thin dataset met extra velden
  const thin = products
    .map((p) => {
      const props = p.properties || {};

      const id = String(p.ID || "").trim();
      const title = String(p.name || "").trim();

      const price = toNumber(p.price?.amount);
      const currency = String(p.price?.currency || "EUR");

      const link = String(p.URL || "").trim();
      const banner = pickImage(p.images);

      const country = String(first(props.country) || "").trim();
      const departure = String(first(props.iataDeparture) || "").trim(); // bijv AMS
      const departureDate = String(first(props.departureDate) || "").trim();
      const duration = toNumber(first(props.duration));

      // Nieuw: extra data uit properties
      const stars = String(first(props.stars) || "").trim(); // vaak "3"
      const province = String(first(props.province) || "").trim();
      const region = String(first(props.region) || "").trim();
      const serviceType = String(first(props.serviceType) || "").trim();

      return {
        id,
        title,
        price,
        currency,
        country,
        departure,
        departureDate,
        duration,
        stars,
        province,
        region,
        serviceType,
        url: link,
        banner,
      };
    })
    .filter((x) => x.id && x.url);

  // Sorteer goedkoop naar duur
  thin.sort((a, b) => (a.price ?? 99999999) - (b.price ?? 99999999));

  const outBase = path.join(process.cwd(), "public", "corendon");
  const outCountryDir = path.join(outBase, "country");
  ensureDir(outBase);
  ensureDir(outCountryDir);

  // Algemene file
  fs.writeFileSync(path.join(outBase, "all.min.json"), JSON.stringify(thin));

  // Groepeer per land en schrijf per land een bestand met eigen cap
  const byCountry = new Map();
  for (const p of thin) {
    const c = p.country || "Onbekend";
    if (!byCountry.has(c)) byCountry.set(c, []);
    byCountry.get(c).push(p);
  }

  const countryIndex = {
    last_updated: new Date().toISOString(),
    caps: { ...COUNTRY_PRICE_CAPS, __default: DEFAULT_CAP },
    countries: {},
    files: {
      all_min: "corendon/all.min.json",
      country_index: "corendon/country/index.json",
    },
  };

  for (const [countryName, list] of byCountry.entries()) {
    const cap = COUNTRY_PRICE_CAPS[countryName] ?? DEFAULT_CAP;

    const filtered = list
      .filter((x) => x.price !== null && x.price <= cap)
      .sort((a, b) => (a.price ?? 99999999) - (b.price ?? 99999999));

    const fileName = `${slugify(countryName)}_under_${cap}.json`;
    fs.writeFileSync(path.join(outCountryDir, fileName), JSON.stringify(filtered));

    countryIndex.countries[countryName] = {
      cap,
      total: list.length,
      under_cap: filtered.length,
      file: `corendon/country/${fileName}`,
    };
  }

  fs.writeFileSync(
    path.join(outCountryDir, "index.json"),
    JSON.stringify(countryIndex, null, 2)
  );

  console.log("Done. Updated thin fields incl stars, banner, province, region, serviceType");
})();
