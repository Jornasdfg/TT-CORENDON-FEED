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
        // follow redirects (TradeTracker doet dit vaak)
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
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

function firstDefined(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  }
  return "";
}

function toNumber(v) {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
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

  // TradeTracker kan array of object teruggeven
  const items = Array.isArray(json)
    ? json
    : (json.items || json.products || json.productFeed || json.data || []);

  if (!Array.isArray(items) || items.length === 0) {
    console.error("No items array found. Top-level keys:", Object.keys(json || {}));
    process.exit(1);
  }

  console.log("Items:", items.length);

  // Maak thin data, zonder enorme teksten
  const thin = items.map((p) => {
    const id = firstDefined(p, ["productID", "productId", "id", "sku"]);
    const title = firstDefined(p, ["name", "title", "productName"]);
    const price = toNumber(firstDefined(p, ["price", "currentPrice", "salePrice", "amount"]));
    const deeplink = firstDefined(p, ["URL", "url", "deeplink", "productUrl", "link"]);
    const image = firstDefined(p, ["imageURL", "imageUrl", "image", "image_link", "imageLink"]);
    const dep = firstDefined(p, ["airport_departure", "departureAirport", "dep_airport", "departure"]);
    const arr = firstDefined(p, ["airport_destination", "destinationAirport", "arr_airport", "destination"]);

    return {
      id,
      title,
      price,
      url: deeplink,
      image,
      dep,
      arr,
    };
  }).filter(x => x.id && x.url);

  // Slugs (pas later aan naar jouw echte logica)
  const weekend = thin.filter(x => x.price !== null && x.price <= 150);
  const under100 = thin.filter(x => x.price !== null && x.price <= 100);

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
      all_min: "corendon/all.min.json",
      weekend: "corendon/weekend.json",
      under_100: "corendon/under_100.json",
    },
  };

  fs.writeFileSync(path.join(outBase, "index.json"), JSON.stringify(index, null, 2));

  console.log("Done. Wrote public/corendon/*.json");
})();
