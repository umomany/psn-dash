import test from "node:test";
import assert from "node:assert/strict";
import { authenticate, fetchAccount, trophyLinksFor, setPause, cleanNpsso, exchangeNpssoForAccessCodeExplained } from "../lib/psn.mjs";

setPause(0);
const TOKEN = "abc" + "x".repeat(61);
const range = (n, f) => Array.from({ length: n }, (_, i) => f(i));

function fakeApi({ purchased = 0, played = 0, trophies = 0, fail = {} } = {}) {
  const calls = { purchased: [], played: [], trophies: [], links: [] };
  return {
    calls,
    getProfileFromUserName: async () => ({
      profile: { onlineId: "tester", accountId: "1", npId: Buffer.from("tester@c2.jo").toString("base64"), plus: 1, avatarUrls: [], trophySummary: { level: 10, earnedTrophies: {} } },
    }),
    getPurchasedGames: async (_a, { size, start }) => {
      calls.purchased.push(start);
      if (fail.purchased) throw new Error("boom");
      const all = range(purchased, (i) => ({ entitlementId: "E" + i, titleId: "T" + i, name: "Game " + i }));
      return { data: { purchasedTitlesRetrieve: { games: all.slice(start, start + size) } } };
    },
    getUserPlayedGames: async (_a, _id, { limit, offset }) => {
      calls.played.push(offset);
      const all = range(played, (i) => ({ titleId: "T" + i, name: "Game " + i }));
      const page = all.slice(offset, offset + limit);
      return { titles: page, totalItemCount: played, nextOffset: offset + page.length };
    },
    getUserTitles: async (_a, _id, { limit, offset }) => {
      calls.trophies.push(offset);
      if (fail.trophies) return { error: { message: "Access denied" } };
      const all = range(trophies, (i) => ({ npCommunicationId: "N" + i, trophyTitleName: "Game " + i }));
      return { trophyTitles: all.slice(offset, offset + limit), totalItemCount: trophies };
    },
    getUserTrophiesForSpecificTitle: async (_a, _id, { npTitleIds }) => {
      const ids = npTitleIds.split(",");
      calls.links.push(ids.length);
      return { titles: ids.map((id) => ({ npTitleId: id, trophyTitles: id === "T3" ? [] : [{ npCommunicationId: "N-" + id }] })) };
    },
  };
}

test("walks every page of every list", async () => {
  const api = fakeApi({ purchased: 250, played: 430, trophies: 1700 });
  const raw = await fetchAccount({ id: "a" }, { accessToken: "x" }, () => {}, api);
  assert.equal(raw.purchased.length, 250);
  assert.deepEqual(api.calls.purchased, [0, 100, 200]);
  assert.equal(raw.played.length, 430);
  assert.deepEqual(api.calls.played, [0, 200, 400]);
  assert.equal(raw.trophyTitles.length, 1700);
  assert.deepEqual(api.calls.trophies, [0, 800, 1600]);
  assert.equal(raw.profile.regionCode, "JO");
  assert.equal(raw.profile.isPlus, true);
  assert.deepEqual(raw.errors, []);
});

test("an exact multiple of the page size stops cleanly", async () => {
  const api = fakeApi({ purchased: 200 });
  const raw = await fetchAccount({ id: "a" }, { accessToken: "x" }, () => {}, api);
  assert.equal(raw.purchased.length, 200);
  assert.deepEqual(api.calls.purchased, [0, 100, 200]);
});

test("a purchased list that ignores paging does not loop or duplicate", async () => {
  const api = fakeApi();
  api.getPurchasedGames = async () => ({
    data: { purchasedTitlesRetrieve: { games: range(100, (i) => ({ entitlementId: "E" + i, titleId: "T" + i, name: "G" + i })) } },
  });
  const raw = await fetchAccount({ id: "a" }, { accessToken: "x" }, () => {}, api);
  assert.equal(raw.purchased.length, 100);
});

test("one failing section does not lose the others", async () => {
  const api = fakeApi({ purchased: 5, played: 7, trophies: 3, fail: { purchased: true, trophies: true } });
  const raw = await fetchAccount({ id: "a" }, { accessToken: "x" }, () => {}, api);
  assert.equal(raw.played.length, 7);
  assert.equal(raw.purchased.length, 0);
  assert.deepEqual(raw.errors.map((e) => e.section), ["purchased games", "trophies"]);
  assert.equal(raw.errors[1].message, "Access denied");
});

test("trophy links are requested five title IDs at a time", async () => {
  const api = fakeApi();
  const links = await trophyLinksFor({ accessToken: "x" }, range(12, (i) => "T" + i), () => {}, api);
  assert.deepEqual(api.calls.links, [5, 5, 2]);
  assert.equal(Object.keys(links).length, 11);
  assert.deepEqual(links.T0, ["N-T0"]);
});

test("sign-in prefers the saved session, then falls back to the npsso", async () => {
  const used = [];
  const api = {
    exchangeRefreshTokenForAuthTokens: async (t) => { used.push("refresh:" + t); if (t === "stale") throw new Error("expired"); return { accessToken: "A1", refreshToken: "R2", refreshTokenExpiresIn: 5000 }; },
    exchangeNpssoForAccessCodeExplained: async (n) => { used.push("npsso:" + n.slice(0, 3)); return "code"; },
    exchangeAccessCodeForAuthTokens: async () => ({ accessToken: "A2", refreshToken: "R3", refreshTokenExpiresIn: 5000 }),
  };
  const future = Date.now() + 1e9;
  let cache = { a: { refreshToken: "good", refreshExpiresAt: future } };
  assert.equal((await authenticate({ id: "a", npsso: TOKEN }, cache, api)).accessToken, "A1");
  assert.equal(cache.a.refreshToken, "R2");

  cache = { a: { refreshToken: "stale", refreshExpiresAt: future } };
  assert.equal((await authenticate({ id: "a", npsso: TOKEN }, cache, api)).accessToken, "A2");
  assert.deepEqual(used, ["refresh:good", "refresh:stale", "npsso:abc"]);

  await assert.rejects(() => authenticate({ id: "b" }, {}, api), /no npsso/);
});

test("npsso is cleaned up from common paste mistakes", () => {
  assert.equal(cleanNpsso(`  ${TOKEN} `), TOKEN);
  assert.equal(cleanNpsso(`"${TOKEN}"`), TOKEN);
  assert.equal(cleanNpsso(`{"npsso":"${TOKEN}"}`), TOKEN);
  assert.throws(() => cleanNpsso("paste-the-64-character-npsso-here"), /placeholder/);
  assert.throws(() => cleanNpsso(TOKEN.slice(0, 40)), /64 letters and digits, got 40/);
  assert.throws(() => cleanNpsso(""), /no npsso/);
});

const fakeFetch = (status, location, body = "") => async () => ({
  status,
  headers: new Headers(location ? { location } : {}),
  text: async () => body,
});

test("sign-in explains why Sony refused", async () => {
  assert.equal(
    await exchangeNpssoForAccessCodeExplained(TOKEN, fakeFetch(302, "com.scee.psxandroid.scecompcall://redirect/?code=v3.ABC&cid=1")),
    "v3.ABC"
  );
  await assert.rejects(
    () => exchangeNpssoForAccessCodeExplained(TOKEN, fakeFetch(302, "com.scee.psxandroid.scecompcall://redirect/?error=login_required&error_code=4165")),
    /login_required/
  );
  await assert.rejects(
    () => exchangeNpssoForAccessCodeExplained(TOKEN, fakeFetch(302, "x://r/?error=invalid_client&error_description=bad+client")),
    /invalid_client \(bad client\)/
  );
  await assert.rejects(() => exchangeNpssoForAccessCodeExplained(TOKEN, fakeFetch(403, null, "<html>Access Denied</html>")), /blocked.*HTTP 403.*Access Denied/);
  await assert.rejects(() => exchangeNpssoForAccessCodeExplained(TOKEN, fakeFetch(200, null, "ok")), /HTTP 200, no redirect/);
});
