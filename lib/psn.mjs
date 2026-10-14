// Talks to PSN for one account and returns the raw responses.
// Every section is fetched independently, so one failing endpoint
// (privacy setting, API change) costs that section only, not the account.

import fs from "node:fs";
import * as psnApi from "psn-api";

// Tests pass a fake `api`; everything else uses the real library.
let PAUSE = 250;
export const setPause = (ms) => (PAUSE = ms);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Some library calls return PSN's error body instead of throwing.
const ok = (res) => {
  if (res?.error) {
    throw new Error(res.error.message ?? JSON.stringify(res.error));
  }
  return res;
};

// ---------- auth ----------

export function loadTokenCache(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

export function saveTokenCache(file, cache) {
  fs.writeFileSync(file, JSON.stringify(cache, null, 2), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

/**
 * Prefer the cached refresh token (valid ~2 months, renewed on every run),
 * fall back to the NPSSO from accounts.json.
 */
export async function authenticate(account, cache, api = psnApi) {
  const cached = cache[account.id];
  const now = Date.now();

  if (cached?.refreshToken && cached.refreshExpiresAt > now + 60_000) {
    try {
      const t = await api.exchangeRefreshTokenForAuthTokens(cached.refreshToken);
      if (t?.accessToken) {
        remember(cache, account.id, t);
        return { accessToken: t.accessToken };
      }
    } catch {
      /* fall through to NPSSO */
    }
  }

  const npsso = cleanNpsso(account.npsso);
  const code = await (api.exchangeNpssoForAccessCodeExplained ?? exchangeNpssoForAccessCodeExplained)(npsso);
  const t = await api.exchangeAccessCodeForAuthTokens(code);
  if (!t?.accessToken) {
    throw new Error(`PSN accepted the npsso but did not return an access token (${t?.error_description || t?.error || "no details"})`);
  }
  remember(cache, account.id, t);
  return { accessToken: t.accessToken };
}

/**
 * Accepts the bare token, a quoted token, or the whole {"npsso":"..."} page
 * pasted from the ssocookie URL. Throws a specific message when it is not a token.
 */
export function cleanNpsso(input) {
  if (!input || !String(input).trim()) {
    throw new Error("Saved session expired and no npsso is set for this account in accounts.json");
  }
  let v = String(input).trim();
  const fromJson = /"npsso"\s*:\s*"([^"]*)"/.exec(v);
  if (fromJson) v = fromJson[1];
  v = v.replace(/^["'\s]+|["'\s]+$/g, "");
  if (v.startsWith("paste-")) {
    throw new Error("npsso is still the placeholder from accounts.example.json");
  }
  if (!/^[A-Za-z0-9]{64}$/.test(v)) {
    throw new Error(
      `npsso should be 64 letters and digits, got ${v.length} characters${/[^A-Za-z0-9]/.test(v) ? " including other symbols" : ""}. ` +
        "Copy only the value inside the quotes after \"npsso\"."
    );
  }
  return v;
}

const AUTHZ = "https://ca.account.sony.com/api/authz/v3/oauth/authorize";

/**
 * Same request psn-api makes, but it reports why Sony refused instead of a
 * generic "is your NPSSO valid?". The npsso itself is never printed.
 */
export async function exchangeNpssoForAccessCodeExplained(npsso, fetchImpl = fetch) {
  const url =
    AUTHZ +
    "?" +
    new URLSearchParams({
      access_type: "offline",
      client_id: "09515159-7237-4370-9b40-3806e67c0891",
      redirect_uri: "com.scee.psxandroid.scecompcall://redirect",
      response_type: "code",
      scope: "psn:mobile.v2.core psn:clientapp",
    });
  const res = await fetchImpl(url, {
    headers: {
      Cookie: `npsso=${npsso}`,
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36",
      Accept: "*/*",
    },
    redirect: "manual",
  });

  const location = res.headers.get("location") ?? "";
  const code = /[?&]code=([^&]+)/.exec(location)?.[1];
  if (code) return decodeURIComponent(code);

  const params = new URLSearchParams(location.split("?")[1] ?? "");
  const err = params.get("error");
  const desc = params.get("error_description");
  const status = res.status;

  if (err === "login_required") {
    throw new Error(
      "Sony says this npsso is not signed in (login_required). It has expired or was cancelled by signing out. Get a fresh one."
    );
  }
  if (err) {
    throw new Error(`Sony refused the sign-in: ${err}${desc ? ` (${desc})` : ""}, HTTP ${status}`);
  }
  let body = "";
  try {
    body = (await res.text()).replace(/\s+/g, " ").slice(0, 160);
  } catch {}
  if (status === 403 || status === 429) {
    throw new Error(
      `Sony blocked the request from this network (HTTP ${status}). A VPN, proxy or cloud IP can cause this; try from your home connection. ${body}`
    );
  }
  throw new Error(
    `Unexpected answer from Sony: HTTP ${status}, ${location ? "redirect without a code" : "no redirect"}. ${body}`
  );
}

function remember(cache, id, t) {
  cache[id] = {
    refreshToken: t.refreshToken,
    refreshExpiresAt: Date.now() + (t.refreshTokenExpiresIn ?? 0) * 1000,
  };
}

// ---------- region ----------

// The npId is base64 of "onlineId@xx.cc" where cc is the account's country.
export function regionFromNpId(npId) {
  try {
    const decoded = Buffer.from(npId, "base64").toString("utf8");
    const cc = decoded.split(".").pop();
    return /^[a-z]{2}$/i.test(cc) ? cc.toUpperCase() : null;
  } catch {
    return null;
  }
}

// ---------- paged fetchers ----------

async function allPurchased(auth, api) {
  const size = 100;
  const out = [];
  const seen = new Set();
  for (let start = 0; start < 5000; start += size) {
    const res = await api.getPurchasedGames(auth, { size, start });
    const games = res?.data?.purchasedTitlesRetrieve?.games ?? [];
    let fresh = 0;
    for (const g of games) {
      const k = g.entitlementId || `${g.titleId}|${g.productId}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(g);
      fresh++;
    }
    // Stop on a short page, or if the API ignored `start` and repeated itself.
    if (games.length < size || fresh === 0) break;
    await sleep(PAUSE);
  }
  return out;
}

async function allPlayed(auth, api) {
  const limit = 200;
  const out = [];
  for (let offset = 0; offset < 10000; ) {
    const res = ok(await api.getUserPlayedGames(auth, "me", { limit, offset }));
    const titles = res?.titles ?? [];
    out.push(...titles);
    const total = res?.totalItemCount ?? out.length;
    if (titles.length === 0 || out.length >= total) break;
    offset = res.nextOffset > offset ? res.nextOffset : offset + titles.length;
    await sleep(PAUSE);
  }
  return out;
}

async function allTrophyTitles(auth, api) {
  const limit = 800;
  const out = [];
  for (let offset = 0; offset < 20000; ) {
    const res = ok(await api.getUserTitles(auth, "me", { limit, offset }));
    const titles = res?.trophyTitles ?? [];
    out.push(...titles);
    const total = res?.totalItemCount ?? out.length;
    if (titles.length === 0 || out.length >= total) break;
    offset = res.nextOffset > offset ? res.nextOffset : offset + titles.length;
    await sleep(PAUSE);
  }
  return out;
}

/**
 * Trophy lists carry no title ID, so names are matched first (free).
 * For played games whose name did not match any trophy list, ask PSN
 * which trophy list belongs to the title ID. 5 IDs per request.
 */
export async function trophyLinksFor(auth, titleIds, log = () => {}, api = psnApi) {
  const links = {};
  for (let i = 0; i < titleIds.length; i += 5) {
    const batch = titleIds.slice(i, i + 5);
    try {
      const res = ok(
        await api.getUserTrophiesForSpecificTitle(auth, "me", {
          npTitleIds: batch.join(","),
        })
      );
      for (const t of res?.titles ?? []) {
        const ids = (t.trophyTitles ?? []).map((x) => x.npCommunicationId);
        if (ids.length) links[t.npTitleId] = ids;
      }
    } catch (e) {
      log(`trophy lookup skipped for ${batch.join(", ")}: ${e.message}`);
    }
    await sleep(PAUSE);
  }
  return links;
}

// ---------- one account ----------

export async function fetchAccount(account, auth, log = () => {}, api = psnApi) {
  const raw = {
    profile: null,
    purchased: [],
    played: [],
    trophyTitles: [],
    errors: [],
  };

  const section = async (name, fn) => {
    try {
      return await fn();
    } catch (e) {
      const msg = String(e?.message ?? e).slice(0, 300);
      raw.errors.push({ section: name, message: msg });
      log(`${name} failed: ${msg}`);
      return null;
    }
  };

  const prof = await section("profile", () =>
    api.getProfileFromUserName(auth, "me")
  );
  if (prof?.profile) {
    const p = prof.profile;
    raw.profile = {
      onlineId: p.onlineId,
      accountId: p.accountId,
      regionCode: p.npId ? regionFromNpId(p.npId) : null,
      isPlus: p.plus === 1,
      avatarUrl: p.avatarUrls?.[0]?.avatarUrl ?? null,
      trophyLevel: p.trophySummary?.level ?? null,
      earnedTrophies: p.trophySummary?.earnedTrophies ?? null,
    };
  }

  raw.purchased = (await section("purchased games", () => allPurchased(auth, api))) ?? [];
  raw.played = (await section("played games", () => allPlayed(auth, api))) ?? [];
  raw.trophyTitles =
    (await section("trophies", () => allTrophyTitles(auth, api))) ?? [];

  return raw;
}
