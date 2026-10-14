import test from "node:test";
import assert from "node:assert/strict";
import { buildLibrary, normName, parseDuration, unmatchedPlayedTitleIds } from "../lib/merge.mjs";
import { demoAccounts } from "../lib/demo.mjs";
import { regionFromNpId } from "../lib/psn.mjs";
import { render } from "../lib/render.mjs";

const lib = buildLibrary(demoAccounts(), { generatedAt: "2026-10-12T00:00:00Z" });
const game = (name) => lib.games.find((g) => g.name === name);
const owner = (g, id) => g.owners.find((o) => o.account === id);

test("durations and names", () => {
  assert.equal(parseDuration("PT228H56M33S"), 228 * 3600 + 56 * 60 + 33);
  assert.equal(parseDuration("PT45M"), 2700);
  assert.equal(parseDuration(undefined), 0);
  assert.equal(normName("Rocket League®"), "rocket league");
  assert.equal(normName("ASTRO's PLAYROOM"), normName("Astro's Playroom"));
});

test("region comes from the npId", () => {
  assert.equal(regionFromNpId(Buffer.from("someone@b6.tr").toString("base64")), "TR");
  assert.equal(regionFromNpId("not base64 at all"), null);
});

test("no game is listed twice", () => {
  const names = lib.games.map((g) => g.name);
  assert.equal(new Set(names).size, names.length);
});

test("same game on two accounts and two platforms becomes one row", () => {
  const g = game("ELDEN RING");
  assert.deepEqual(g.ownedBy.sort(), ["uk", "us"]);
  assert.deepEqual(g.platforms, ["PS4", "PS5"]);
  assert.equal(owner(g, "us").versions[0].store, "Americas store");
  assert.equal(owner(g, "uk").versions[0].store, "Europe store");
  assert.equal(owner(g, "uk").playSeconds, 0);
  assert.equal(g.progress, 100);
  assert.equal(g.platinum, true);
});

test("a localised title joins its English twin through the concept ID", () => {
  const g = game("Gran Turismo™ 7");
  assert.deepEqual(g.ownedBy.sort(), ["jp", "uk"]);
  assert.ok(!game("グランツーリスモ７"));
});

test("PS Plus games are marked", () => {
  const o = owner(game("Returnal"), "us");
  assert.equal(o.owned, true);
  assert.equal(o.viaPlus, true);
  assert.equal(owner(game("Hades"), "us").viaPlus, false);
});

test("played but not purchased is kept and not counted as owned", () => {
  const g = game("Astro's Playroom");
  assert.deepEqual(g.ownedBy, []);
  assert.equal(owner(g, "us").owned, false);
  assert.equal(owner(g, "us").trophies.length, 1, "trophies matched by name despite different casing");
});

test("trophies with a different name attach through the title ID link", () => {
  const raw = demoAccounts()[0].raw;
  assert.deepEqual(unmatchedPlayedTitleIds(raw), ["PPSA01411_00"]);
  const g = game("Demon's Souls");
  assert.equal(owner(g, "us").trophies[0].id, "NPWR22792_00");
  assert.ok(!game("Demon's Souls Trophies"));
});

test("account totals", () => {
  const us = lib.accounts.find((a) => a.id === "us");
  assert.equal(us.owned, 12);
  assert.equal(us.regionName, "United States");
  assert.equal(lib.accounts.find((a) => a.id === "jp").owned, 5);
});

test("an account that failed to sync still appears, with its error", () => {
  const l = buildLibrary([
    { id: "x", label: "Broken", raw: { profile: null, purchased: [], played: [], trophyTitles: [], errors: [{ section: "sign-in", message: "expired" }] } },
  ]);
  assert.equal(l.games.length, 0);
  assert.equal(l.accounts[0].errors[0].message, "expired");
});

test("page data cannot break out of the script tag", () => {
  const html = render({ games: [{ name: "</script><script>alert(1)</script>" }] }, "x /*__LIBRARY__*/null y");
  assert.ok(!html.includes("</script>"));
});
