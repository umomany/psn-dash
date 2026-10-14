// Game metadata from the public PlayStation Store pages: release date, star
// rating, age rating, genres, player count, publisher.
//
// There is no API for this. The store page embeds its data as a series of
// per-widget JSON <script> tags, each holding a partial Apollo cache of the
// same Product entity. No single tag carries every field, so parsing means
// merging all of them and reading the combined Product.
//
// This is unofficial and will break if Sony restructures the page. Every
// function here returns null rather than throwing, so a parse failure costs
// one game's metadata and never the sync.

import fs from "node:fs";

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// A PSN account region maps to the store that sells to it. The age rating
// authority differs per store: ESRB in the US, PEGI in Kuwait, NMC in the
// UAE, GCAM in Saudi Arabia.
const LOCALES = { US: "en-us", KW: "en-kw", AE: "en-ae", SA: "en-sa", GB: "en-gb", JP: "ja-jp" };

export const localeFor = (region) => LOCALES[String(region || "").toUpperCase()] || "en-us";

export function storeUrl(locale, { conceptId, productId }) {
  if (conceptId) return `https://store.playstation.com/${locale}/concept/${conceptId}`;
  if (productId) return `https://store.playstation.com/${locale}/product/${productId}`;
  return null;
}

/**
 * Merge the per-widget caches into one entity map. Widgets disagree about how
 * much of an object they carry — one tag has the full contentRating, another
 * has only its name — so a plain spread would let a thin copy clobber a rich
 * one. Objects merge a level deeper; for everything else the richer value wins.
 */
function mergeEntity(into, from) {
  for (const [k, v] of Object.entries(from)) {
    const old = into[k];
    if (isPlainObject(old) && isPlainObject(v)) into[k] = mergeEntity({ ...old }, v);
    else if (old === undefined || old === null || richer(v, old)) into[k] = v;
  }
  return into;
}

const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const size = (v) => (isPlainObject(v) ? Object.keys(v).length : Array.isArray(v) ? v.length : 0);
const richer = (a, b) => size(a) > size(b);

/** Pull every embedded widget cache out of the page and merge them. */
export function parseStoreCache(html) {
  const cache = {};
  let found = 0;
  for (const m of html.matchAll(
    /<script[^>]*type="application\/json"[^>]*>(\{"args".*?)<\/script>/gs
  )) {
    let blob;
    try {
      blob = JSON.parse(m[1]);
    } catch {
      continue; // one malformed widget must not lose the rest
    }
    for (const [key, entity] of Object.entries(blob?.cache ?? {})) {
      if (!isPlainObject(entity)) continue;
      cache[key] = mergeEntity(cache[key] ?? {}, entity);
      found++;
    }
  }
  return found ? cache : null;
}

/** "...<br/>2 players<br/>Supports up to 4 online players..." -> "2 players" */
function playersFrom(descriptions) {
  const notice = (descriptions ?? []).find((d) => d?.type === "COMPATIBILITY_NOTICE");
  if (!notice?.value) return null;
  const text = String(notice.value).replace(/<[^>]+>/g, " ");
  const offline = /(\d+(?:\s*-\s*\d+)?)\s+players?\b/i.exec(text);
  const online = /up to (\d+)\s+online players?/i.exec(text);
  const parts = [];
  if (offline) parts.push(`${offline[1].replace(/\s+/g, "")} players`);
  if (online) parts.push(`up to ${online[1]} online`);
  return parts.length ? parts.join(", ") : null;
}

/** releaseDate is a bare string on a Product and a {value} object on a Concept. */
const dateOf = (v) => {
  const s = isPlainObject(v) ? v.value : v;
  return s ? String(s).slice(0, 10) : null;
};

/**
 * The seven fields the dashboard shows. Missing values come back null so a
 * partially-listed game still contributes what it has.
 *
 * A game still on sale has a Product entity carrying everything. A delisted
 * one — old FIFA and F1 titles, anything whose licence lapsed — keeps its
 * Concept page but loses the Product entirely, and the Concept holds the same
 * fields in a slightly different shape. Reading Concept first and letting
 * Product win on top covers both without a special case.
 */
export function parseStoreMeta(html) {
  const cache = parseStoreCache(html);
  if (!cache) return null;
  const entry = (prefix) => Object.entries(cache).find(([k]) => k.startsWith(prefix))?.[1];
  const concept = entry("Concept:");
  const product = { ...(concept ?? {}), ...(entry("Product:") ?? {}) };
  if (!concept && !entry("Product:")) return null;

  const stars = product.starRating;
  const rating = product.contentRating;
  const genres = [
    ...new Set((product.localizedGenres ?? []).map((g) => g?.value).filter(Boolean)),
  ];

  return {
    releaseDate: dateOf(product.releaseDate),
    stars: Number.isFinite(stars?.averageRating)
      ? { average: stars.averageRating, count: stars.totalRatingsCount ?? 0 }
      : null,
    ageRating: rating?.name
      ? {
          authority: rating.authority ?? String(rating.name).split("_")[0],
          name: rating.name,
          description: rating.description ?? null,
          url: rating.url ?? null,
        }
      : null,
    genres,
    players: playersFrom(product.descriptions),
    publisher: product.publisherName ?? null,
    platforms: product.platforms ?? [],
  };
}

/**
 * Fetch one game's metadata. `fetchImpl` is injectable so the tests never
 * touch the network, matching how lib/psn.mjs takes an `api`.
 */
export async function fetchMeta(locale, ids, fetchImpl = fetch) {
  const url = storeUrl(locale, ids);
  if (!url) return null;
  const res = await fetchImpl(url, { headers: { "user-agent": UA, "accept-language": locale } });
  if (!res?.ok) return null;
  return parseStoreMeta(await res.text());
}

// ---------- cache ----------

// Store pages are 0.6-1.1 MB each, so a cold run over a full library moves
// ~100 MB. None of this data changes often, so it is fetched once and kept.
export function loadMetaCache(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

export function saveMetaCache(file, cache) {
  fs.writeFileSync(file, JSON.stringify(cache, null, 2));
}

// ---------- attaching metadata to a built library ----------

/**
 * The store ID to look a game up by, for one owner. Concept pages outlive
 * product pages — a delisted product soft-404s to an error page while its
 * concept survives — so a concept ID found on any owner beats this owner's
 * own product ID. Concept pages are still per-locale, so age ratings stay
 * tied to the account's own store.
 */
function idsForOwner(owner, fallbackConceptId = null) {
  const versions = owner?.versions ?? [];
  const conceptId = versions.find((v) => v.conceptId)?.conceptId ?? fallbackConceptId;
  const productId = versions.find((v) => v.productId)?.productId ?? null;
  return conceptId || productId ? { conceptId, productId } : null;
}

/**
 * Fill in `game.meta` and `game.ageRatings` for every game in a built library.
 *
 * Release date, score, genres and publisher are the same everywhere, so the
 * first store that answers wins. Age ratings are not — the same game is ESRB
 * Teen in the US, PEGI 12 in Kuwait and GCAM 12 in Saudi Arabia — so each
 * owning account contributes the rating from its own store.
 *
 * Never throws: a game the store refuses is left with whatever it already had.
 */
export async function attachMeta(library, options = {}) {
  const {
    cache = {},
    fetchImpl = fetch,
    log = () => {},
    pause = async () => {},
    localeOf = () => "en-us",
  } = options;

  let fetched = 0;
  let failed = 0;

  for (const game of library.games ?? []) {
    const ratings = [];
    let shared = null;
    const anyConcept =
      (game.owners ?? []).flatMap((o) => o.versions ?? []).find((v) => v.conceptId)?.conceptId ??
      null;

    for (const owner of game.owners ?? []) {
      const ids = idsForOwner(owner, anyConcept);
      if (!ids) continue;
      const locale = localeOf(owner.account);
      const key = `${locale}:${ids.conceptId ?? ids.productId}`;

      if (!(key in cache)) {
        try {
          cache[key] = await fetchMeta(locale, ids, fetchImpl);
          fetched++;
        } catch (e) {
          cache[key] = null;
          failed++;
          log(`metadata skipped for ${game.name} (${locale}): ${e.message}`);
        }
        await pause();
      }

      const meta = cache[key];
      if (!meta) continue;
      shared ??= meta;
      if (meta.ageRating) ratings.push({ account: owner.account, ...meta.ageRating });
    }

    if (shared) {
      game.meta = {
        releaseDate: shared.releaseDate,
        stars: shared.stars,
        genres: shared.genres,
        players: shared.players,
        publisher: shared.publisher,
      };
    }
    if (ratings.length) game.ageRatings = ratings;
  }

  return { fetched, failed };
}
