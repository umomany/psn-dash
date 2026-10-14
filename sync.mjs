#!/usr/bin/env node
// Pulls the games from every account in accounts.json and writes dashboard.html.
//
//   node sync.mjs            fetch from PSN and rebuild the dashboard
//   node sync.mjs --demo     build the dashboard from made-up sample data
//   node sync.mjs --offline  rebuild from the last saved data, no network
//   node sync.mjs --check    only test that each account can sign in
//   node sync.mjs --no-meta  skip the store lookup for release dates, scores, ratings
//   node sync.mjs --share    also write share.html with nothing identifying in it

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLibrary, unmatchedPlayedTitleIds } from "./lib/merge.mjs";
import { render } from "./lib/render.mjs";
import * as store from "./lib/store.mjs";
import { redact } from "./lib/share.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const at = (...p) => path.join(root, ...p);
const args = new Set(process.argv.slice(2));
const outFile = at("dashboard.html");

/**
 * Fill in release date, score, age rating, genres and player count from the
 * public store pages. Cached in data/meta.json: the first run over a full
 * library pulls ~100 MB, every run after it is free. `--no-meta` skips it.
 */
async function withMeta(library) {
  if (args.has("--no-meta")) return library;

  const file = at("data", "meta.json");
  const cache = store.loadMetaCache(file);
  const locales = Object.fromEntries(
    (library.accounts ?? []).map((a) => [a.id, a.storeLocale || store.localeFor(a.regionCode)])
  );

  let n = 0;
  console.log("\nFetching game details from the store (cached in data/meta.json)");
  const { fetched, failed } = await store.attachMeta(library, {
    cache,
    localeOf: (id) => locales[id] ?? "en-us",
    log: (m) => console.log(`  ${m}`),
    // Pauses between live fetches only; cached games never reach here.
    pause: async () => {
      if (++n % 25 === 0) console.log(`  ${n} fetched...`);
      await new Promise((r) => setTimeout(r, 250));
    },
  });

  store.saveMetaCache(file, cache);
  const described = library.games.filter((g) => g.meta).length;
  console.log(
    `  ${described} of ${library.games.length} games described` +
      (fetched ? ` (${fetched} fetched` + (failed ? `, ${failed} failed` : "") + ")" : " (all cached)")
  );
  return library;
}

function write(library) {
  fs.mkdirSync(at("data"), { recursive: true });
  fs.writeFileSync(at("data", "library.json"), JSON.stringify(library, null, 2));
  fs.writeFileSync(outFile, render(library, fs.readFileSync(at("template.html"), "utf8")));
  const owned = library.games.filter((g) => g.ownedBy.length).length;
  console.log(
    `\n${library.games.length} games (${owned} owned) across ${library.accounts.length} accounts`
  );
  console.log(`Dashboard: ${outFile}`);

  if (args.has("--share")) {
    const file = at("share.html");
    fs.writeFileSync(file, render(redact(library), fs.readFileSync(at("template.html"), "utf8")));
    console.log(`Shareable:  ${file} (no handles, IDs or play dates)`);
  }
}

async function main() {
  if (args.has("--demo")) {
    const { demoAccounts } = await import("./lib/demo.mjs");
    return write(buildLibrary(demoAccounts(), {}));
  }

  if (args.has("--offline")) {
    const file = at("data", "raw.json");
    if (!fs.existsSync(file)) throw new Error("No saved data yet. Run `node sync.mjs` first.");
    return write(await withMeta(buildLibrary(JSON.parse(fs.readFileSync(file, "utf8")))));
  }

  const cfgFile = at("accounts.json");
  if (!fs.existsSync(cfgFile)) {
    throw new Error(
      "accounts.json not found. Copy accounts.example.json to accounts.json and add one entry per account."
    );
  }
  const config = JSON.parse(fs.readFileSync(cfgFile, "utf8"));
  if (!Array.isArray(config) || !config.length) throw new Error("accounts.json must be a non-empty list.");
  const ids = new Set();
  for (const a of config) {
    if (!a.id) throw new Error('Every account in accounts.json needs an "id".');
    if (ids.has(a.id)) throw new Error(`Duplicate account id "${a.id}" in accounts.json.`);
    ids.add(a.id);
  }

  const psn = await import("./lib/psn.mjs");
  const psnApi = await import("psn-api");
  const none = async () => ({ data: { purchasedTitlesRetrieve: { games: [] } } });
  const noneList = async () => ({ titles: [], totalItemCount: 0 });
  const noneTitles = async () => ({ trophyTitles: [], totalItemCount: 0 });
  const tokenFile = at(".tokens.json");
  const cache = psn.loadTokenCache(tokenFile);

  // Keep the last good data for an account if it cannot sign in today.
  let previous = [];
  try {
    previous = JSON.parse(fs.readFileSync(at("data", "raw.json"), "utf8"));
  } catch {}

  const results = [];
  for (const acc of config) {
    const log = (m) => console.log(`  [${acc.label || acc.id}] ${m}`);
    console.log(`\n${acc.label || acc.id}`);
    const entry = { id: acc.id, label: acc.label, region: acc.region, storeLocale: acc.storeLocale };
    try {
      const auth = await psn.authenticate(acc, cache);
      psn.saveTokenCache(tokenFile, cache);
      if (args.has("--check")) {
        const raw = await psn.fetchAccount(acc, auth, log, { ...psnApi, getPurchasedGames: none, getUserPlayedGames: noneList, getUserTitles: noneTitles });
        log(`signed in as ${raw.profile?.onlineId ?? "unknown"} (${raw.profile?.regionCode ?? "region unknown"})`);
        results.push({ ...entry, raw });
        continue;
      }
      const raw = await psn.fetchAccount(acc, auth, log);
      log(
        `${raw.purchased.length} purchased, ${raw.played.length} played, ${raw.trophyTitles.length} trophy lists`
      );
      const missing = args.has("--fast") ? [] : unmatchedPlayedTitleIds(raw);
      let trophyLinks = {};
      if (missing.length) {
        log(`matching trophies for ${missing.length} more games`);
        trophyLinks = await psn.trophyLinksFor(auth, missing, log);
      }
      results.push({ ...entry, raw, trophyLinks, fetchedAt: new Date().toISOString() });
    } catch (e) {
      const message = String(e?.message ?? e).slice(0, 300);
      log(`sign-in failed: ${message}`);
      const old = previous.find((p) => p.id === acc.id);
      if (old) {
        log(`showing data saved on ${old.fetchedAt?.slice(0, 10) ?? "an earlier run"}`);
        results.push({
          ...old,
          ...entry,
          raw: {
            ...old.raw,
            errors: [{ section: "sign-in", message: `${message}. Showing data from ${old.fetchedAt?.slice(0, 10)}.` }],
          },
        });
      } else {
        results.push({
          ...entry,
          raw: { profile: null, purchased: [], played: [], trophyTitles: [], errors: [{ section: "sign-in", message }] },
        });
      }
    }
  }

  if (!args.has("--check")) {
    fs.mkdirSync(at("data"), { recursive: true });
    fs.writeFileSync(at("data", "raw.json"), JSON.stringify(results));
    write(await withMeta(buildLibrary(results)));
  }

  // Non-zero exit when an account could not sign in, so a scheduled run notices.
  const failed = results.filter((r) => r.raw.errors.some((e) => e.section === "sign-in"));
  if (failed.length) {
    console.error(`\n${failed.length} of ${results.length} accounts could not sign in. Refresh their npsso in accounts.json.`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(`\n${e.message}`);
  process.exit(1);
});
