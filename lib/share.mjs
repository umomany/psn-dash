// Strips a built library down to something safe to hand to someone else.
//
// The dashboard is a private page: it carries PSN handles, avatars, trophy
// levels, every title and product ID, which store each copy was bought from,
// and a timestamped log of when each game was played. The shared page keeps
// the shelf — what the games are and how much they were played — and drops
// everything that identifies the person behind it.
//
// Pure, like lib/merge.mjs: library in, library out, no files and no network.

/** Accounts become their region. "Main - US" -> "United States". */
function shareAccount(a) {
  return {
    id: a.id,
    label: a.regionName || a.regionCode || a.label,
    regionCode: a.regionCode,
    // The sidebar's second line is [onlineId, regionName]. With the handle
    // gone, keeping regionName would just print the region twice under itself.
    regionName: null,
    isPlus: a.isPlus,
    owned: a.owned,
    played: a.played,
    playSeconds: a.playSeconds,
    // onlineId, avatarUrl, trophyLevel, earnedTrophies, storeLocale and
    // errors are all dropped: they identify the account, not the shelf.
    errors: [],
  };
}

/**
 * Versions carry the store IDs and the purchase trail, so only the platform
 * survives. The detail panel maps over this list and renders nothing for an
 * empty one, which is what we want.
 */
const shareVersion = (v) => ({ platform: v.platform, source: v.source });

function shareOwner(o) {
  return {
    account: o.account,
    owned: o.owned,
    viaPlus: o.viaPlus,
    playSeconds: o.playSeconds,
    trophies: o.trophies ?? [],
    versions: (o.versions ?? []).map(shareVersion),
    // playCount, firstPlayed and lastPlayed are a log of when someone was at
    // their console. Hours played stays; the schedule does not.
  };
}

/**
 * The merge builds game keys out of whatever identified the game — "t:PPSA04622_00"
 * for a title ID, "c:234689" for a concept — so the key smuggles store IDs into
 * the page even once every versions[] field is stripped. The page only uses the
 * key to remember which row is open, so an opaque counter does the same job.
 */
function shareGame(g, i) {
  const { owners, lastPlayed, key, ...rest } = g;
  return { ...rest, key: `g${i}`, owners: (owners ?? []).map(shareOwner) };
}

export function redact(library) {
  return {
    ...library,
    accounts: (library.accounts ?? []).map(shareAccount),
    games: (library.games ?? []).map(shareGame),
  };
}
