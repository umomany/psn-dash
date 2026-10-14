import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseStoreMeta, fetchMeta, storeUrl, localeFor, attachMeta } from "../lib/store.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = fs.readFileSync(path.join(here, "fixtures", "store-concept.html"), "utf8");

const okResponse = (body) => ({ ok: true, text: async () => body });

test("every field is parsed out of a real store page", () => {
  const m = parseStoreMeta(fixture);
  assert.equal(m.releaseDate, "2021-03-26");
  assert.equal(m.stars.average, 4.54);
  assert.ok(m.stars.count > 100000);
  assert.equal(m.ageRating.name, "ESRB_TEEN");
  assert.equal(m.ageRating.authority, "ESRB");
  assert.deepEqual(m.genres, ["Unique"]);
  assert.match(m.players, /2 players/);
  assert.equal(m.publisher, "Electronic Arts Inc");
  assert.deepEqual(m.platforms, ["PS4", "PS5"]);
});

test("a thin widget copy never clobbers a richer one", () => {
  // The page carries contentRating twice: once with the authority and badge,
  // once as just the name. Whichever order they appear in, the full one wins.
  const m = parseStoreMeta(fixture);
  assert.equal(m.ageRating.authority, "ESRB");
  assert.ok(m.ageRating.description, "the fuller contentRating should survive the merge");
});

test("genres are de-duplicated across widgets", () => {
  const dupes = `<script type="application/json">${JSON.stringify({
    args: {},
    cache: {
      "Product:X": {
        localizedGenres: [{ value: "Action" }, { value: "Shooter" }, { value: "Action" }],
      },
    },
  })}</script>`;
  assert.deepEqual(parseStoreMeta(dupes).genres, ["Action", "Shooter"]);
});

test("player counts come out of the compatibility notice", () => {
  const notice = (value) =>
    parseStoreMeta(
      `<script type="application/json">${JSON.stringify({
        args: {},
        cache: { "Product:X": { descriptions: [{ type: "COMPATIBILITY_NOTICE", value }] } },
      })}</script>`
    ).players;

  assert.equal(notice("2 players<br/>Remote Play supported"), "2 players");
  assert.equal(notice("1-4 players<br/>Supports up to 8 online players"), "1-4 players, up to 8 online");
  assert.equal(notice("Remote Play supported"), null);
});

test("a game listed with nothing useful yields nulls, not a throw", () => {
  const bare = `<script type="application/json">${JSON.stringify({
    args: {},
    cache: { "Product:X": { id: "X" } },
  })}</script>`;
  const m = parseStoreMeta(bare);
  assert.equal(m.releaseDate, null);
  assert.equal(m.stars, null);
  assert.equal(m.ageRating, null);
  assert.deepEqual(m.genres, []);
});

test("junk and malformed widgets return null instead of throwing", () => {
  assert.equal(parseStoreMeta("<html>Access Denied</html>"), null);
  assert.equal(parseStoreMeta(""), null);
  // A broken widget must not cost us the ones that still parse.
  const mixed =
    `<script type="application/json">{"args":{},"cache":{BROKEN</script>` +
    `<script type="application/json">${JSON.stringify({
      args: {},
      cache: { "Product:X": { releaseDate: "2020-01-02T00:00:00Z" } },
    })}</script>`;
  assert.equal(parseStoreMeta(mixed).releaseDate, "2020-01-02");
});

test("concept IDs are preferred, product IDs are the fallback", () => {
  assert.match(storeUrl("en-us", { conceptId: "234689" }), /\/en-us\/concept\/234689$/);
  assert.match(storeUrl("en-sa", { productId: "UP1-X" }), /\/en-sa\/product\/UP1-X$/);
  assert.equal(storeUrl("en-us", {}), null);
});

test("each account region maps to the store that rates its games", () => {
  assert.equal(localeFor("US"), "en-us");
  assert.equal(localeFor("KW"), "en-kw");
  assert.equal(localeFor("SA"), "en-sa");
  assert.equal(localeFor("ae"), "en-ae");
  assert.equal(localeFor(null), "en-us", "an unknown region still has to resolve");
});

test("fetchMeta asks the right store and parses the reply", async () => {
  const seen = [];
  const m = await fetchMeta("en-sa", { conceptId: "234689" }, async (url) => {
    seen.push(url);
    return okResponse(fixture);
  });
  assert.deepEqual(seen, ["https://store.playstation.com/en-sa/concept/234689"]);
  assert.equal(m.releaseDate, "2021-03-26");
});

test("an unlisted game is a null, not an exception", async () => {
  const m = await fetchMeta("en-us", { conceptId: "1" }, async () => ({ ok: false, status: 404 }));
  assert.equal(m, null);
  assert.equal(await fetchMeta("en-us", {}, async () => okResponse(fixture)), null);
});

// ---------- attachMeta ----------

const libraryWith = (...owners) => ({
  games: [{ name: "Test Game", owners: owners.map((o) => ({ ...o })) }],
});
const owner = (account, conceptId, productId = null) => ({
  account,
  versions: [{ conceptId, productId }],
});
const localeOf = (id) => ({ main: "en-us", second: "en-kw", third: "en-sa" })[id] ?? "en-us";

/** A store that answers with a different age rating per locale. */
function fakeStore(byLocale) {
  const calls = [];
  const impl = async (url) => {
    const locale = url.split("/")[3];
    calls.push(url);
    const rating = byLocale[locale];
    if (!rating) return { ok: false, status: 404 };
    return okResponse(
      `<script type="application/json">${JSON.stringify({
        args: {},
        cache: {
          "Product:X": {
            releaseDate: "2021-03-26T04:00:00Z",
            starRating: { averageRating: 4.5, totalRatingsCount: 10 },
            contentRating: { authority: rating.split("_")[0], name: rating },
            localizedGenres: [{ value: "Action" }],
            publisherName: "Acme",
          },
        },
      })}</script>`
    );
  };
  return { impl, calls };
}

test("one game, one account: metadata lands on the game", async () => {
  const { impl } = fakeStore({ "en-us": "ESRB_TEEN" });
  const lib = libraryWith(owner("main", "234689"));
  const stats = await attachMeta(lib, { fetchImpl: impl, localeOf });

  const game = lib.games[0];
  assert.equal(game.meta.releaseDate, "2021-03-26");
  assert.equal(game.meta.stars.average, 4.5);
  assert.equal(game.meta.publisher, "Acme");
  assert.deepEqual(game.ageRatings, [
    { account: "main", authority: "ESRB", name: "ESRB_TEEN", description: null, url: null },
  ]);
  assert.equal(stats.fetched, 1);
});

test("a game owned in three regions carries all three age ratings", async () => {
  const { impl, calls } = fakeStore({
    "en-us": "ESRB_TEEN",
    "en-kw": "PEGI_12",
    "en-sa": "GCAM_12",
  });
  const lib = libraryWith(
    owner("main", "234689"),
    owner("second", "234689"),
    owner("third", "234689")
  );
  await attachMeta(lib, { fetchImpl: impl, localeOf });

  assert.equal(calls.length, 3, "same concept, three stores, three fetches");
  assert.deepEqual(
    lib.games[0].ageRatings.map((r) => `${r.account}:${r.name}`),
    ["main:ESRB_TEEN", "second:PEGI_12", "third:GCAM_12"]
  );
});

test("the cache stops a second run from refetching anything", async () => {
  const { impl, calls } = fakeStore({ "en-us": "ESRB_TEEN" });
  const cache = {};
  const first = await attachMeta(libraryWith(owner("main", "234689")), {
    cache,
    fetchImpl: impl,
    localeOf,
  });
  const second = await attachMeta(libraryWith(owner("main", "234689")), {
    cache,
    fetchImpl: impl,
    localeOf,
  });

  assert.equal(first.fetched, 1);
  assert.equal(second.fetched, 0, "the second run must hit the cache, not the store");
  assert.equal(calls.length, 1);
});

test("a cached miss is remembered, so dead lookups are not retried", async () => {
  const { impl, calls } = fakeStore({}); // every locale 404s
  const cache = {};
  await attachMeta(libraryWith(owner("main", "234689")), { cache, fetchImpl: impl, localeOf });
  await attachMeta(libraryWith(owner("main", "234689")), { cache, fetchImpl: impl, localeOf });
  assert.equal(calls.length, 1, "a 404 is cached as null, not retried every run");
});

test("a store that throws costs one game, not the sync", async () => {
  const boom = async () => {
    throw new Error("socket hang up");
  };
  const lines = [];
  const lib = libraryWith(owner("main", "234689"));
  const stats = await attachMeta(lib, { fetchImpl: boom, localeOf, log: (m) => lines.push(m) });

  assert.equal(stats.failed, 1);
  assert.equal(lib.games[0].meta, undefined, "the game survives without metadata");
  assert.match(lines[0], /socket hang up/);
});

test("games with no store ID at all are skipped quietly", async () => {
  const { impl, calls } = fakeStore({ "en-us": "ESRB_TEEN" });
  const lib = { games: [{ name: "Mystery", owners: [{ account: "main", versions: [] }] }] };
  const stats = await attachMeta(lib, { fetchImpl: impl, localeOf });
  assert.equal(calls.length, 0);
  assert.equal(stats.fetched, 0);
});

test("a product ID is used when no concept ID exists", async () => {
  const { impl, calls } = fakeStore({ "en-us": "ESRB_TEEN" });
  const lib = libraryWith(owner("main", null, "UP0002-PPSA07805_00-OWORIGINS0000000"));
  await attachMeta(lib, { fetchImpl: impl, localeOf });
  assert.match(calls[0], /\/product\/UP0002-PPSA07805_00-OWORIGINS0000000$/);
});

test("a delisted game is read from its Concept when the Product is gone", () => {
  // Old FIFA/F1 titles keep a concept page but lose the Product entity, and
  // put releaseDate in a {value} object instead of a bare string.
  const delisted = `<script type="application/json">${JSON.stringify({
    args: {},
    cache: {
      "Concept:231776": {
        releaseDate: { __typename: "ReleaseDate", type: "DAY_MONTH_YEAR", value: "2018-09-24T00:00:00Z" },
        contentRating: { authority: "ESRB", name: "ESRB_EVERYONE", description: "ESRB Everyone" },
        localizedGenres: [{ value: "Sport" }, { value: "Sport" }],
        publisherName: "Electronic Arts Inc",
        defaultProduct: null,
      },
    },
  })}</script>`;

  const m = parseStoreMeta(delisted);
  assert.equal(m.releaseDate, "2018-09-24");
  assert.equal(m.ageRating.name, "ESRB_EVERYONE");
  assert.deepEqual(m.genres, ["Sport"]);
  assert.equal(m.publisher, "Electronic Arts Inc");
  assert.equal(m.stars, null, "a delisted game has no ratings widget");
});

test("when both entities exist the Product wins", () => {
  const both = `<script type="application/json">${JSON.stringify({
    args: {},
    cache: {
      "Concept:1": { releaseDate: { value: "2000-01-01T00:00:00Z" }, publisherName: "Old" },
      "Product:X": { releaseDate: "2021-03-26T04:00:00Z", publisherName: "New" },
    },
  })}</script>`;
  const m = parseStoreMeta(both);
  assert.equal(m.releaseDate, "2021-03-26");
  assert.equal(m.publisher, "New");
});

test("a concept ID from one account rescues an account that only has a dead product ID", async () => {
  const { impl, calls } = fakeStore({ "en-us": "ESRB_TEEN", "en-sa": "GCAM_12" });
  const lib = libraryWith(
    owner("main", "228618"), // has the concept
    owner("third", null, "EP0006-NPEJ00420_00-GONE") // delisted product only
  );
  await attachMeta(lib, { fetchImpl: impl, localeOf });

  assert.ok(
    calls.every((u) => u.includes("/concept/228618")),
    `both lookups should use the concept page, got ${calls.join(", ")}`
  );
  assert.equal(lib.games[0].ageRatings.length, 2, "and both regions still get their own rating");
});
