// Made-up sample data in the same shape PSN returns, for `node sync.mjs --demo`.
// No real account is involved.

const npId = (name, cc) => Buffer.from(`${name}@a1.${cc}`).toString("base64");

function purchased(name, conceptId, titleId, platform, prefix, plus = false) {
  return {
    __typename: "GameLibraryTitle",
    conceptId: conceptId ? String(conceptId) : null,
    entitlementId: `${prefix}0000-${titleId}-ENT`,
    image: { url: null },
    isActive: true,
    isDownloadable: true,
    isPreOrder: false,
    membership: plus ? "PS_PLUS" : "NONE",
    name,
    platform,
    productId: `${prefix}0000-${titleId}-GAME000000000000`,
    titleId,
  };
}

function played(name, conceptId, titleId, platform, hours, first, last, count, service = "none_purchased") {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return {
    titleId,
    name,
    localizedName: name,
    imageUrl: null,
    category: platform === "PS5" ? "ps5_native_game" : "ps4_game",
    service,
    playCount: count,
    concept: { id: conceptId, titleIds: [titleId], name, media: { images: [] } },
    firstPlayedDateTime: `${first}T18:00:00Z`,
    lastPlayedDateTime: `${last}T21:30:00Z`,
    playDuration: `PT${h}H${m}M0S`,
  };
}

function trophies(name, commId, platform, progress, earned, defined, last) {
  const [eb, es, eg, ep] = earned;
  const [db, ds, dg, dp] = defined;
  return {
    npServiceName: platform === "PS5" ? "trophy2" : "trophy",
    npCommunicationId: commId,
    trophyTitleName: name,
    trophyTitleIconUrl: null,
    trophyTitlePlatform: platform,
    progress,
    earnedTrophies: { bronze: eb, silver: es, gold: eg, platinum: ep },
    definedTrophies: { bronze: db, silver: ds, gold: dg, platinum: dp },
    lastUpdatedDateTime: `${last}T21:40:00Z`,
  };
}

export function demoAccounts() {
  const us = {
    id: "us",
    label: "Main",
    storeLocale: "en-us",
    trophyLinks: { PPSA01411_00: ["NPWR22792_00"] },
    raw: {
      profile: {
        onlineId: "SampleHero_US",
        accountId: "1000000000000000001",
        regionCode: "US",
        isPlus: true,
        avatarUrl: null,
        trophyLevel: 412,
        earnedTrophies: { bronze: 2140, silver: 610, gold: 198, platinum: 31 },
      },
      purchased: [
        purchased("ELDEN RING", 10000333, "PPSA04609_00", "PS5", "UP"),
        purchased("God of War Ragnarök", 10001850, "PPSA08329_00", "PS5", "UP"),
        purchased("Marvel's Spider-Man 2", 10002456, "PPSA03016_00", "PS5", "UP"),
        purchased("Hades", 10002172, "PPSA03355_00", "PS5", "UP"),
        purchased("The Last of Us™ Part II", 229220, "CUSA07820_00", "PS4", "UP"),
        purchased("Ghost of Tsushima DIRECTOR'S CUT", 10002694, "PPSA03417_00", "PS5", "UP"),
        purchased("Rocket League®", 201530, "CUSA01433_00", "PS4", "UP"),
        purchased("Returnal", 10000176, "PPSA01284_00", "PS5", "UP", true),
        purchased("Stray", 10000844, "PPSA02599_00", "PS5", "UP", true),
        purchased("Horizon Forbidden West", 10000886, "PPSA01521_00", "PS5", "UP"),
        purchased("Baldur's Gate 3", 10004172, "PPSA07950_00", "PS5", "UP"),
        purchased("Sackboy: A Big Adventure", 10000649, "PPSA01289_00", "PS5", "UP", true),
      ],
      played: [
        played("ELDEN RING", 10000333, "PPSA04609_00", "PS5", 186.4, "2022-02-25", "2026-09-28", 214),
        played("God of War Ragnarök", 10001850, "PPSA08329_00", "PS5", 61.2, "2022-11-09", "2023-01-14", 58),
        played("Marvel's Spider-Man 2", 10002456, "PPSA03016_00", "PS5", 34.5, "2023-10-20", "2023-11-30", 37),
        played("Hades", 10002172, "PPSA03355_00", "PS5", 92.1, "2021-08-14", "2026-10-03", 163),
        played("The Last of Us™ Part II", 229220, "CUSA07820_00", "PS4", 29.8, "2020-06-19", "2020-07-08", 22),
        played("Rocket League®", 201530, "CUSA01433_00", "PS4", 412.7, "2015-07-10", "2026-10-09", 1380),
        played("Returnal", 10000176, "PPSA01284_00", "PS5", 18.3, "2023-03-02", "2023-04-11", 26, "ps_plus"),
        played("Baldur's Gate 3", 10004172, "PPSA07950_00", "PS5", 143.9, "2023-09-06", "2026-08-17", 121),
        played("Astro's Playroom", 10000507, "PPSA01325_00", "PS5", 6.2, "2020-11-12", "2021-01-03", 9, "none"),
        played("Demon's Souls", 10000169, "PPSA01411_00", "PS5", 48.0, "2020-11-14", "2021-02-20", 41, "none"),
      ],
      trophyTitles: [
        trophies("ELDEN RING", "NPWR22811_00", "PS5", 100, [24, 14, 3, 1], [24, 14, 3, 1], "2022-05-02"),
        trophies("God of War Ragnarök", "NPWR22392_00", "PS5", 78, [15, 10, 2, 0], [15, 15, 5, 1], "2023-01-14"),
        trophies("Marvel's Spider-Man 2", "NPWR24901_00", "PS5", 100, [24, 16, 2, 1], [24, 16, 2, 1], "2023-11-30"),
        trophies("Hades", "NPWR21880_00", "PS5", 63, [20, 9, 1, 0], [34, 10, 5, 1], "2026-10-03"),
        trophies("The Last of Us™ Part II", "NPWR15206_00", "PS4", 41, [9, 3, 1, 0], [13, 7, 7, 1], "2020-07-08"),
        trophies("Rocket League®", "NPWR07910_00", "PS4", 88, [48, 22, 8, 1], [54, 25, 9, 1], "2025-12-21"),
        trophies("Returnal", "NPWR20004_00", "PS5", 22, [8, 1, 0, 0], [20, 7, 3, 1], "2023-04-11"),
        trophies("Baldur's Gate 3", "NPWR32125_00", "PS5", 70, [30, 9, 2, 0], [40, 10, 3, 1], "2026-08-17"),
        trophies("ASTRO's PLAYROOM", "NPWR20188_00", "PS5", 100, [24, 16, 5, 1], [24, 16, 5, 1], "2021-01-03"),
        trophies("Demon's Souls Trophies", "NPWR22792_00", "PS5", 35, [10, 3, 0, 0], [22, 9, 5, 1], "2021-02-20"),
      ],
      errors: [],
    },
  };

  const gb = {
    id: "uk",
    label: "UK store",
    storeLocale: "en-gb",
    raw: {
      profile: {
        onlineId: "SampleHero_UK",
        accountId: "1000000000000000002",
        regionCode: "GB",
        isPlus: false,
        avatarUrl: null,
        trophyLevel: 96,
        earnedTrophies: { bronze: 240, silver: 51, gold: 12, platinum: 2 },
      },
      purchased: [
        purchased("ELDEN RING", 10000333, "CUSA28863_00", "PS4", "EP"),
        purchased("Hades", 10002172, "PPSA03356_00", "PS5", "EP"),
        purchased("EA SPORTS FC™ 25", 10009584, "PPSA19570_00", "PS5", "EP"),
        purchased("Gran Turismo™ 7", 10001507, "PPSA01316_00", "PS5", "EP"),
        purchased("Bloodborne™", 201930, "CUSA00207_00", "PS4", "EP"),
        purchased("It Takes Two", 10000593, "PPSA02398_00", "PS5", "EP"),
        purchased("Cyberpunk 2077", 233379, "PPSA04027_00", "PS5", "EP"),
      ],
      played: [
        played("EA SPORTS FC™ 25", 10009584, "PPSA19570_00", "PS5", 208.6, "2024-09-27", "2025-09-20", 402),
        played("Gran Turismo™ 7", 10001507, "PPSA01316_00", "PS5", 77.3, "2022-03-04", "2026-07-11", 96),
        played("Bloodborne™", 201930, "CUSA00207_00", "PS4", 54.9, "2018-03-06", "2019-01-27", 49),
        played("It Takes Two", 10000593, "PPSA02398_00", "PS5", 14.1, "2021-12-26", "2022-01-09", 8),
      ],
      trophyTitles: [
        trophies("EA SPORTS FC™ 25", "NPWR36901_00", "PS5", 56, [18, 6, 1, 0], [28, 10, 4, 1], "2025-09-20"),
        trophies("Gran Turismo™ 7", "NPWR22055_00", "PS5", 47, [22, 4, 0, 0], [38, 10, 2, 1], "2026-07-11"),
        trophies("Bloodborne™", "NPWR06221_00", "PS4", 100, [20, 9, 4, 1], [20, 9, 4, 1], "2019-01-27"),
        trophies("It Takes Two", "NPWR21504_00", "PS5", 100, [10, 5, 4, 1], [10, 5, 4, 1], "2022-01-09"),
      ],
      errors: [],
    },
  };

  const jp = {
    id: "jp",
    label: "Japan store",
    storeLocale: "ja-jp",
    raw: {
      profile: {
        onlineId: "SampleHero_JP",
        accountId: "1000000000000000003",
        regionCode: "JP",
        isPlus: false,
        avatarUrl: null,
        trophyLevel: 58,
        earnedTrophies: { bronze: 121, silver: 30, gold: 9, platinum: 1 },
      },
      purchased: [
        purchased("ペルソナ５ ザ・ロイヤル", 232843, "CUSA17416_00", "PS4", "JP"),
        purchased("龍が如く８", 10005591, "PPSA09690_00", "PS5", "JP"),
        purchased("グランツーリスモ７", 10001507, "PPSA01317_00", "PS5", "JP"),
        purchased("ドラゴンクエストXI　過ぎ去りし時を求めて S", 10000102, "CUSA18146_00", "PS4", "JP"),
        purchased("モンスターハンターワイルズ", 10005927, "PPSA13091_00", "PS5", "JP"),
      ],
      played: [
        played("ペルソナ５ ザ・ロイヤル", 232843, "CUSA17416_00", "PS4", 118.5, "2019-10-31", "2020-03-15", 97),
        played("龍が如く８", 10005591, "PPSA09690_00", "PS5", 66.0, "2024-01-26", "2024-04-02", 60),
        played("モンスターハンターワイルズ", 10005927, "PPSA13091_00", "PS5", 95.4, "2025-02-28", "2026-10-10", 140),
      ],
      trophyTitles: [
        trophies("ペルソナ５ ザ・ロイヤル", "NPWR17853_00", "PS4", 100, [41, 9, 2, 1], [41, 9, 2, 1], "2020-03-15"),
        trophies("龍が如く８", "NPWR30420_00", "PS5", 52, [28, 3, 0, 0], [45, 12, 2, 1], "2024-04-02"),
        trophies("モンスターハンターワイルズ", "NPWR35118_00", "PS5", 44, [17, 4, 0, 0], [35, 12, 2, 1], "2026-10-10"),
      ],
      errors: [],
    },
  };

  return [us, gb, jp];
}
