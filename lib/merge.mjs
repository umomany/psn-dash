// Turns the raw per-account responses into one list of games.
// Pure functions, no network: this is the part the tests cover.

// Product IDs start with the store that sold the game.
const STORE_PREFIX = {
  UP: "Americas store",
  EP: "Europe store",
  JP: "Japan store",
  HP: "Asia store",
  KP: "Korea store",
  UB: "Americas store",
  EB: "Europe store",
};

export function normName(name) {
  return String(name ?? "")
    .normalize("NFKC")
    .replace(/[®™©]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function parseDuration(iso) {
  // "PT228H56M33S" -> seconds
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$/.exec(iso ?? "");
  if (!m) return 0;
  const [, d, h, min, s] = m;
  return Math.round(
    (+d || 0) * 86400 + (+h || 0) * 3600 + (+min || 0) * 60 + (+s || 0)
  );
}

function platformOf(category, fallback) {
  if (/ps5/i.test(category ?? "")) return "PS5";
  if (/ps4/i.test(category ?? "")) return "PS4";
  if (/pspc/i.test(category ?? "")) return "PC";
  return fallback ?? "Other";
}

function trophyPlatforms(str) {
  return String(str ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .map((s) => (s === "PSVITA" ? "Vita" : s));
}

const sum = (c) =>
  c ? (c.bronze || 0) + (c.silver || 0) + (c.gold || 0) + (c.platinum || 0) : 0;

// ---- tiny union-find: records that share a concept ID, a title ID,
// or a normalised name are the same game ----
class Groups {
  constructor() {
    this.parent = new Map();
  }
  find(x) {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let r = x;
    while (this.parent.get(r) !== r) r = this.parent.get(r);
    while (this.parent.get(x) !== r) {
      const n = this.parent.get(x);
      this.parent.set(x, r);
      x = n;
    }
    return r;
  }
  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
  link(ids) {
    for (let i = 1; i < ids.length; i++) this.union(ids[0], ids[i]);
    return ids[0];
  }
}

/**
 * @param accounts [{ id, label, storeLocale?, raw: {profile, purchased, played, trophyTitles, errors}, trophyLinks? }]
 */
export function buildLibrary(accounts, { generatedAt = new Date().toISOString() } = {}) {
  const groups = new Groups();
  const records = []; // { handle, accountId, kind, data }

  for (const acc of accounts) {
    const raw = acc.raw;

    for (const g of raw.purchased ?? []) {
      const ids = [];
      if (g.conceptId) ids.push(`c:${g.conceptId}`);
      if (g.titleId) ids.push(`t:${g.titleId}`);
      const n = normName(g.name);
      if (n) ids.push(`n:${n}`);
      if (!ids.length) continue;
      records.push({ handle: groups.link(ids), accountId: acc.id, kind: "purchased", data: g });
    }

    for (const p of raw.played ?? []) {
      const ids = [];
      if (p.concept?.id) ids.push(`c:${p.concept.id}`);
      if (p.titleId) ids.push(`t:${p.titleId}`);
      for (const t of p.concept?.titleIds ?? []) ids.push(`t:${t}`);
      const n = normName(p.name || p.localizedName);
      if (n) ids.push(`n:${n}`);
      const cn = normName(p.concept?.name);
      if (cn) ids.push(`n:${cn}`);
      if (!ids.length) continue;
      records.push({ handle: groups.link(ids), accountId: acc.id, kind: "played", data: p });
    }

    // Trophy lists: join through an explicit title ID link when we have one,
    // otherwise through the name.
    const byComm = new Map();
    for (const [titleId, commIds] of Object.entries(acc.trophyLinks ?? {})) {
      for (const c of commIds) {
        if (!byComm.has(c)) byComm.set(c, []);
        byComm.get(c).push(titleId);
      }
    }
    for (const t of raw.trophyTitles ?? []) {
      const ids = [];
      for (const titleId of byComm.get(t.npCommunicationId) ?? []) ids.push(`t:${titleId}`);
      const n = normName(t.trophyTitleName);
      if (n) ids.push(`n:${n}`);
      if (!ids.length) continue;
      records.push({ handle: groups.link(ids), accountId: acc.id, kind: "trophy", data: t });
    }
  }

  // ---- fold records into games ----
  const games = new Map();
  const gameFor = (handle) => {
    const key = groups.find(handle);
    if (!games.has(key)) {
      games.set(key, { key, name: null, image: null, platforms: new Set(), owners: new Map(), _nameRank: 0 });
    }
    return games.get(key);
  };
  const ownerFor = (game, accountId) => {
    if (!game.owners.has(accountId)) {
      game.owners.set(accountId, {
        account: accountId,
        owned: false,
        viaPlus: false,
        versions: [],
        playSeconds: 0,
        playCount: 0,
        firstPlayed: null,
        lastPlayed: null,
        trophies: [],
      });
    }
    return game.owners.get(accountId);
  };
  const setName = (game, name, rank) => {
    if (name && rank > game._nameRank) {
      game.name = name;
      game._nameRank = rank;
    }
  };

  for (const r of records) {
    const game = gameFor(r.handle);
    const o = ownerFor(game, r.accountId);

    if (r.kind === "purchased") {
      const g = r.data;
      setName(game, g.name, 3);
      game.image ??= g.image?.url ?? null;
      const platform = g.platform ?? "Other";
      game.platforms.add(platform);
      o.owned = true;
      const plus = g.membership === "PS_PLUS";
      const prefix = (g.productId ?? "").slice(0, 2);
      o.versions.push({
        platform,
        titleId: g.titleId ?? null,
        productId: g.productId ?? null,
        conceptId: g.conceptId ?? null,
        source: plus ? "PS Plus" : "Purchased",
        store: STORE_PREFIX[prefix] ?? null,
        active: g.isActive !== false,
        preOrder: !!g.isPreOrder,
      });
    } else if (r.kind === "played") {
      const p = r.data;
      setName(game, p.concept?.name || p.name || p.localizedName, 2);
      game.image ??= p.imageUrl ?? p.localizedImageUrl ?? null;
      const platform = platformOf(p.category);
      game.platforms.add(platform);
      o.playSeconds += parseDuration(p.playDuration);
      o.playCount += p.playCount || 0;
      if (p.firstPlayedDateTime && (!o.firstPlayed || p.firstPlayedDateTime < o.firstPlayed)) {
        o.firstPlayed = p.firstPlayedDateTime;
      }
      if (p.lastPlayedDateTime && (!o.lastPlayed || p.lastPlayedDateTime > o.lastPlayed)) {
        o.lastPlayed = p.lastPlayedDateTime;
      }
      // A played title that is not in the purchased list is still worth a row
      // (disc game, shared from another account, lapsed PS Plus).
      if (!o.versions.some((v) => v.titleId === p.titleId)) {
        o._playedOnly ??= [];
        o._playedOnly.push({
          platform,
          titleId: p.titleId ?? null,
          conceptId: p.concept?.id ? String(p.concept.id) : null,
          service: p.service ?? null,
        });
      }
    } else {
      const t = r.data;
      setName(game, t.trophyTitleName, 1);
      game.image ??= t.trophyTitleIconUrl ?? null;
      const plats = trophyPlatforms(t.trophyTitlePlatform);
      plats.forEach((p) => game.platforms.add(p));
      o.trophies.push({
        id: t.npCommunicationId,
        platform: plats.join(", "),
        progress: t.progress ?? 0,
        earned: t.earnedTrophies ?? null,
        defined: t.definedTrophies ?? null,
        platinum: (t.earnedTrophies?.platinum ?? 0) > 0,
        lastEarned: t.lastUpdatedDateTime ?? null,
      });
    }
  }

  // ---- finish ----
  const out = [];
  for (const game of games.values()) {
    const owners = [];
    for (const o of game.owners.values()) {
      // Add "played only" versions that never showed up as purchased.
      for (const v of o._playedOnly ?? []) {
        if (o.versions.some((x) => x.titleId && x.titleId === v.titleId)) continue;
        // Same platform already owned: it is the same copy under another title ID.
        if (o.owned && o.versions.some((x) => x.platform === v.platform)) continue;
        o.versions.push({
          platform: v.platform,
          titleId: v.titleId,
          productId: null,
          conceptId: v.conceptId,
          source: v.service === "ps_plus" ? "PS Plus (played)" : "Played, not in purchases",
          store: null,
          active: true,
          preOrder: false,
        });
      }
      delete o._playedOnly;
      o.viaPlus = o.owned && o.versions.every((v) => v.source.startsWith("PS Plus") || v.productId === null);
      owners.push(o);
    }
    if (!game.name) continue;

    const best = owners.flatMap((o) => o.trophies).sort((a, b) => b.progress - a.progress)[0];
    out.push({
      key: game.key,
      name: game.name,
      image: game.image,
      platforms: [...game.platforms].sort(),
      owners,
      ownedBy: owners.filter((o) => o.owned).map((o) => o.account),
      playSeconds: owners.reduce((s, o) => s + o.playSeconds, 0),
      lastPlayed: owners.map((o) => o.lastPlayed).filter(Boolean).sort().pop() ?? null,
      progress: best ? best.progress : null,
      platinum: owners.some((o) => o.trophies.some((t) => t.platinum)),
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  const regionName = (code) => {
    try {
      return new Intl.DisplayNames(["en"], { type: "region" }).of(code);
    } catch {
      return code;
    }
  };

  const accountsOut = accounts.map((acc) => {
    const p = acc.raw.profile;
    const code = (acc.region || p?.regionCode || "").toUpperCase() || null;
    const mine = out.filter((g) => g.owners.some((o) => o.account === acc.id));
    return {
      id: acc.id,
      label: acc.label || p?.onlineId || acc.id,
      onlineId: p?.onlineId ?? null,
      regionCode: code,
      regionName: code ? regionName(code) : null,
      storeLocale: acc.storeLocale ?? null,
      isPlus: p?.isPlus ?? null,
      avatarUrl: p?.avatarUrl ?? null,
      trophyLevel: p?.trophyLevel ?? null,
      earnedTrophies: p?.earnedTrophies ?? null,
      owned: mine.filter((g) => g.ownedBy.includes(acc.id)).length,
      played: mine.filter((g) => g.owners.find((o) => o.account === acc.id).playSeconds > 0).length,
      playSeconds: mine.reduce((s, g) => s + g.owners.find((o) => o.account === acc.id).playSeconds, 0),
      errors: acc.raw.errors ?? [],
    };
  });

  return { generatedAt, accounts: accountsOut, games: out };
}

/** Title IDs of played games that no trophy list matched by name. */
export function unmatchedPlayedTitleIds(raw) {
  const names = new Set((raw.trophyTitles ?? []).map((t) => normName(t.trophyTitleName)));
  const ids = [];
  for (const p of raw.played ?? []) {
    const candidates = [p.name, p.localizedName, p.concept?.name].map(normName).filter(Boolean);
    if (candidates.some((n) => names.has(n))) continue;
    if (p.titleId) ids.push(p.titleId);
  }
  return [...new Set(ids)];
}

export { sum as trophyCount };
