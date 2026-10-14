import test from "node:test";
import assert from "node:assert/strict";
import { redact } from "../lib/share.mjs";

// A library shaped like a real one, carrying every kind of private value.
const library = () => ({
  generatedAt: "2026-10-13T00:00:00Z",
  accounts: [
    {
      id: "main",
      label: "Main - US",
      onlineId: "ExampleGamer99",
      regionCode: "US",
      regionName: "United States",
      storeLocale: "en-us",
      isPlus: true,
      avatarUrl: "http://static-resource.np.community.playstation.net/avatar/ExampleGamer99.png",
      trophyLevel: 31,
      earnedTrophies: { bronze: 10, silver: 2, gold: 1, platinum: 1 },
      owned: 48,
      played: 53,
      playSeconds: 943200,
      errors: [{ section: "sign-in", message: "npsso for ExampleGamer99 expired" }],
    },
  ],
  games: [
    {
      key: "c:234689",
      name: "It Takes Two",
      image: "https://image.api.playstation.com/x.png",
      platforms: ["PS4", "PS5"],
      ownedBy: ["main"],
      playSeconds: 7200,
      lastPlayed: "2026-10-04T19:22:11Z",
      progress: 70,
      platinum: false,
      meta: { releaseDate: "2021-03-26", stars: { average: 4.54, count: 144430 }, genres: ["Unique"], players: "2 players", publisher: "EA" },
      ageRatings: [{ account: "main", authority: "ESRB", name: "ESRB_TEEN", description: "ESRB Teen", url: "https://x/t.png" }],
      owners: [
        {
          account: "main",
          owned: true,
          viaPlus: false,
          playSeconds: 7200,
          playCount: 6,
          firstPlayed: "2023-08-05T13:30:30Z",
          lastPlayed: "2026-10-04T19:22:11Z",
          trophies: [{ platform: "PS5", progress: 70, platinum: false, counts: { bronze: 8 } }],
          versions: [
            {
              platform: "PS5",
              titleId: "PPSA02342_00",
              productId: "UP0006-PPSA02342_00-ITTAKESTWORETAIL",
              conceptId: "234689",
              source: "Purchased",
              store: "Europe store",
              active: true,
              preOrder: false,
            },
          ],
        },
      ],
    },
  ],
});

// The real test of a redaction is the bytes that leave the machine, not the
// shape of the object: a handle nested somewhere unexpected passes a
// field-by-field check and still ships.
const serialised = () => JSON.stringify(redact(library()));

test("no PSN handle survives anywhere in the output", () => {
  assert.doesNotMatch(serialised(), /ExampleGamer99/);
});

test("no store or title identifier survives anywhere in the output", () => {
  const out = serialised();
  for (const pattern of [/PPSA\d/, /CUSA\d/, /UP0006-/, /ITTAKESTWORETAIL/, /\bconceptId\b/]) {
    assert.doesNotMatch(out, pattern, `${pattern} leaked into the shared page`);
  }
});

test("avatars, trophy level and sign-in errors are gone", () => {
  const out = serialised();
  assert.doesNotMatch(out, /static-resource/);
  assert.doesNotMatch(out, /avatarUrl/);
  assert.doesNotMatch(out, /trophyLevel/);
  assert.doesNotMatch(out, /expired/);
  assert.deepEqual(redact(library()).accounts[0].errors, []);
});

test("the play schedule is gone but the hours stay", () => {
  const out = serialised();
  assert.doesNotMatch(out, /firstPlayed/);
  assert.doesNotMatch(out, /playCount/);
  assert.doesNotMatch(out, /2023-08-05/);

  const g = redact(library()).games[0];
  assert.equal(g.playSeconds, 7200, "total hours are the point of the page");
  assert.equal(g.owners[0].playSeconds, 7200);
  assert.equal(g.lastPlayed, undefined, "the last-played date is part of the schedule");
});

test("accounts are labelled by region, not by handle", () => {
  const a = redact(library()).accounts[0];
  assert.equal(a.label, "United States");
  assert.equal(a.regionCode, "US");
  assert.equal(a.onlineId, undefined);
});

test("an account with no region still gets a usable label", () => {
  const lib = library();
  delete lib.accounts[0].regionName;
  delete lib.accounts[0].regionCode;
  const a = redact(lib).accounts[0];
  assert.equal(a.label, "Main - US", "falling back to the label beats rendering nothing");
});

test("the shelf itself is untouched", () => {
  const g = redact(library()).games[0];
  assert.equal(g.name, "It Takes Two");
  assert.deepEqual(g.platforms, ["PS4", "PS5"]);
  assert.equal(g.progress, 70);
  assert.equal(g.meta.stars.average, 4.54);
  assert.equal(g.meta.releaseDate, "2021-03-26");
  assert.equal(g.ageRatings[0].name, "ESRB_TEEN");
  assert.equal(g.owners[0].trophies[0].progress, 70);
  assert.equal(g.owners[0].owned, true);
  assert.equal(g.owners[0].versions[0].platform, "PS5", "platform survives, the IDs do not");
});

test("redact does not mutate the library it was given", () => {
  const lib = library();
  redact(lib);
  assert.equal(lib.accounts[0].onlineId, "ExampleGamer99");
  assert.equal(lib.games[0].owners[0].versions[0].titleId, "PPSA02342_00");
});

test("an empty or partial library does not throw", () => {
  assert.deepEqual(redact({}).games, []);
  assert.deepEqual(redact({}).accounts, []);
  assert.deepEqual(redact({ games: [{ name: "X" }] }).games[0].owners, []);
});

test("game keys are opaque: the merge builds them out of store IDs", () => {
  // key is "t:PPSA04622_00" or "c:234689" upstream, so stripping versions[]
  // alone still ships the identifier inside the key.
  const lib = library();
  lib.games[0].key = "t:PPSA04622_00";
  const out = JSON.stringify(redact(lib));
  assert.doesNotMatch(out, /PPSA04622/);
  assert.equal(redact(lib).games[0].key, "g0");
});

test("opaque keys stay unique, or rows would share open/close state", () => {
  const lib = library();
  lib.games = [
    { key: "t:A", name: "A" },
    { key: "t:B", name: "B" },
    { key: "n:c", name: "C" },
  ];
  const keys = redact(lib).games.map((g) => g.key);
  assert.equal(new Set(keys).size, 3, keys.join(","));
});

test("the region is not printed twice under itself in the sidebar", () => {
  // The sidebar subtitle is [onlineId, regionName] filtered; with the handle
  // gone, a surviving regionName repeats the label verbatim.
  const a = redact(library()).accounts[0];
  assert.equal(a.label, "United States");
  assert.equal(a.regionName, null);
  assert.equal(a.regionCode, "US", "the chip still needs the code");
});
