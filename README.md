# World Cup 2026 Bracket Pool

A Firefox new-tab extension for running a friendly World Cup 2026 prediction pool.
Pick group standings, choose which third-placed teams advance, fill in the knockout
bracket, and watch a shared leaderboard update as real results come in. No backend.

## How it works

Three pieces, all serverless:

- **The extension** (`extension/`) is a no-build MV3 add-on that takes over the new-tab
  page. It runs the whole pick flow, scores your bracket, and renders the leaderboard.
  Picks are saved locally first.
- **Picks** are published when you lock your bracket: the extension POSTs them to a
  Google Form (anonymous, no sign-in). The Form's responses Sheet, published as CSV, is
  the shared "database" the leaderboard reads.
- **Results** come from a daily GitHub Action (`scraper/` + `.github/workflows/`) that
  parses the official [2026 World Cup Wikipedia page](https://en.wikipedia.org/wiki/2026_FIFA_World_Cup)
  into `results.json` and commits it here. The extension reads it from
  `raw.githubusercontent.com`. No manual results entry.

### Scoring

Points climb each round, so the business end of the tournament matters most:

| Correct prediction            | Points |
|-------------------------------|:------:|
| Each group placing (1st/2nd/3rd) | 2   |
| Each third-place team that advances | 2 |
| Each team that reaches the Round of 16 | 5 |
| Each team that reaches the Quarterfinals | 10 |
| Each team that reaches the Semifinals | 20 |
| Each team that reaches the Final | 40 |
| Correct champion | 80 |

Knockout scoring is by "did this team reach this round," not exact matchups, so a
broken bracket can still recover.

## The knockout bracket

Group winners and runners-up use FIFA's official 2026 bracket slots and tree (matches
73-104). The eight third-placed teams use a simplified placement (FIFA assigns those
via a conditional lookup once the group stage ends); since scoring is by round reached,
this doesn't affect points.

## Install (development)

1. Open `about:debugging#/runtime/this-firefox`.
2. "Load Temporary Add-on" and pick `extension/manifest.json`.
3. Open a new tab.

## Run the results scraper locally

```bash
pip install -r scraper/requirements.txt
python scraper/main.py --validate          # print + sanity-check, don't write
python scraper/main.py --out results.json   # write the file
```

## Notes

- The mascot art here (`extension/images/firefox-mascot-ball-chase-rgb.svg`) is a CC0
  placeholder. See `LICENSE` for third-party asset credits.
- The Google Form / Sheet endpoints in `extension/data.js` are specific to one pool;
  fork and point them at your own Form to run your own.

Licensed under MIT. See `LICENSE`.
