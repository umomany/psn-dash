# Game shelf

One page that lists the games on all your PlayStation accounts, whatever region each one is in.

`node sync.mjs` signs in to each account, pulls its games, and writes `dashboard.html`. Open that file in a browser. Nothing is uploaded anywhere: the script talks to PlayStation Network from your machine and the dashboard is a single local file.

## What you see for each game

- Which accounts own it, shown as coloured region tabs, and whether it was bought or came from PS Plus
- Which regional store sold it (Americas, Europe, Japan, Asia, Korea)
- Platforms (PS5, PS4)
- Time played, number of sessions, first and last played, per account
- Trophy progress, counts by grade, platinum
- Title ID and product ID, plus a store link when `storeLocale` is set
- Games you own on more than one account
- Release date, publisher, genres and player count, from the PlayStation Store
- The store's own star rating and how many people rated it
- Age rating per region, so a game can show ESRB Mature and PEGI 18 side by side

You can search, filter by account or platform, sort, switch between a list and covers, and download the current view as CSV.

## Set up

Needs Node 18 or newer.

```
npm install
cp accounts.example.json accounts.json
```

Then, for each account, get its sign-in token (called an NPSSO):

1. Open an **isolated browser profile** for that account and sign in at https://www.playstation.com.
2. In the same profile, open https://ca.account.sony.com/api/v1/ssocookie
3. Copy the 64-character `npsso` value into `accounts.json`.
4. **Close the window. Do not click Sign Out** — signing out invalidates the token you just copied.

Repeat in a separate profile for each account.

> **Private/incognito windows do not work for more than one account.** Every incognito
> window in a browser shares one session, so signing in as the second account evicts
> the first, and the npsso you already copied for it is dead. Use genuinely separate
> cookie jars instead: Firefox Multi-Account Containers, separate Chrome profiles
> (`chrome://profile-picker`), or simply a different browser per account.

`accounts.json` fields:

| Field | Required | What it does |
| --- | --- | --- |
| `id` | yes | Short unique name, for example `us` or `tr` |
| `label` | no | Name shown on the dashboard |
| `npsso` | yes | The token from step 3 |
| `storeLocale` | no | Store address for this account's region, for example `en-us`, `en-gb`, `ja-jp`, `tr-tr`. Adds an "Open in store" link per game |
| `region` | no | Two-letter country code. Only needed if the detected region is wrong |

## Run

```
node sync.mjs            # fetch everything and rebuild dashboard.html
node sync.mjs --fast     # skip the slower trophy matching for odd-named games
node sync.mjs --offline  # rebuild the page from the last fetch, no network
node sync.mjs --demo     # build the page from made-up sample data
node sync.mjs --check    # only test that each account can sign in, and say why not
node sync.mjs --no-meta  # skip the store lookup for release dates, scores and age ratings
node sync.mjs --share    # also write share.html: same shelf, nothing identifying in it
```

After the first run the script keeps a renewable session per account in `.tokens.json`, so you do not need a new NPSSO each time. A session lasts about two months and is renewed on every run. If an account stops signing in, repeat the four steps above for it. Until you do, the dashboard keeps showing that account's last good data and says so.

To keep it fresh, schedule it:

```
0 6 * * *  cd /path/to/psn-dash && node sync.mjs >> sync.log 2>&1
```

The exit code is non-zero when any account fails to sign in.

## If an account will not sign in

Run `node sync.mjs --check`. It only signs in and prints Sony's actual reason:

- **login_required**: the npsso is expired or was cancelled. Signing out of playstation.com, or signing in to another account in the same browser session, does this. Get a fresh one in a separate browser profile and close the window without signing out.
- **should be 64 letters and digits**: something extra was pasted. Copy only the value between the quotes.
- **blocked from this network (HTTP 403)**: Sony refused the request because of where it came from. Turn off any VPN or proxy and run it from your home connection.

## Limits

- PlayStation only reports PS4 and PS5 purchases. PS3 and Vita purchases do not appear, though games with trophies on those systems still show up as played.
- No prices, purchase dates, wallet balances or subscription renewal dates. PSN does not expose them here.
- "Played, not in purchases" covers disc games, games shared from another account, and PS Plus games you no longer have.
- Play time only exists for PS4 and PS5.
- This uses the same unofficial interface as the PlayStation app, through the `psn-api` library. It is read-only, but Sony does not document or support it and it can change without notice.

## Sharing your shelf

`node sync.mjs --share` writes `share.html` next to `dashboard.html`. It is the same
page with everything identifying removed: no PSN handles, avatars or trophy levels, no
title/product IDs, no record of which store a copy came from, and no played-on dates or
session counts. Accounts are labelled by region instead of by name. Hours played, trophy
progress and all the store details stay, so it still reads as a shelf.

Covers and age-rating badges are hot-linked to Sony's CDN, so the page needs an internet
connection to look right.

## Keep the tokens private

`accounts.json` and `.tokens.json` let anyone holding them act as your accounts. Both are in `.gitignore`. Do not commit them or share them, and keep the folder on a machine you trust. Changing an account's password invalidates its tokens.

## Tests

```
npm test
```

## License

MIT — see [LICENSE](LICENSE).
