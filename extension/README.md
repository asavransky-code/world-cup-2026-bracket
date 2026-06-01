# World Cup 2026 Bracket Pool — Phase 0 prototype

A no-build Firefox extension. Vanilla HTML/CSS/JS, data-driven engine.

## Load it in Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Select `manifest.json` in this folder
4. Open a new tab — the bracket pool takes over the new tab page
5. Optional: click the puzzle-piece (extensions) icon in the toolbar, then pin
   **World Cup 2026 Pool** to keep its trophy button visible. Clicking it opens the bracket.

(Temporary add-ons unload when Firefox restarts; just reload it.)

## What works in Phase 0

- Enter a display name (centered, responsive welcome screen, KITT chasing a soccer ball)
- Guided pick flow, in order, with a points hint on each step:
  1. **Group standings** — click teams 1st → 2nd → 3rd in each of 12 groups
  2. **Third-place order** — pick the 8 third-place teams you think advance, best first (stops at 8)
  3. **Knockout** — two-sided bracket converging on the final in the middle; pick winners, they auto-advance. Fits a full window; scrolls below ~1000px instead of compressing.
  4. **Review & lock** — scoring legend + full bracket; locks the bracket (logs picks to console; Phase 1 posts to a Google Form)
- **Dashboard** after locking:
  - **Quick links** — the user's pinned/most-visited sites (top 8, via the `topSites` permission), centered and floating under the header
  - **Empty state** (before any results): KITT + soccer ball, your champion pick, how-points-work legend
  - **Scored state** (results in): points, rank, **top-6 leaderboard** (sized to match the score-breakdown card), score breakdown, your bracket
  - Top-bar **"Sim: pre-tournament / show results"** toggle to preview both states
- Scoring uses the doubling back-load schedule (champion = 80) against **demo results**
- Responsive down to phone width; **Reset** / **Edit picks** in the top bar
- Pinnable **toolbar button** (gold trophy) that opens the bracket

## Icon
`images/trophy.svg` is Bootstrap Icons `trophy-fill` (MIT License,
https://github.com/twbs/icons), recolored gold. When distributing, include the
Bootstrap Icons MIT license text.

## Mascot
`images/firefox-mascot-ball-chase-rgb.svg` (used on the welcome + empty states) is an
original **CC0 soccer-ball** placeholder in this public repo. The privately distributed
build swaps in its own mascot art under the same filename. See the repo `LICENSE`.

## Known Phase 0 shortcuts (see REQUIREMENTS.md)

- **Placeholder teams/groups**, not the official 2026 draw
- **Fabricated results** in `data.js` (real ones come from a public Sheet CSV in Phase 1)
- **Fake teammates** on the leaderboard (real ones come from the Picks Sheet CSV in Phase 1)
- Flags load from `flagcdn.com` (Phase 1 bundles SVGs so it works offline / AMO-friendly)
- No publish step yet, no badge/notifications

## Files

- `manifest.json` — MV3: new tab override, toolbar action, `topSites` permission, background
- `background.js` — opens a new tab (the bracket) when the toolbar button is clicked
- `data.js` — teams, groups, scoring config, bracket template, demo results
- `engine.js` — bracket resolution + scoring (pure functions, source-agnostic)
- `app.js` — state (localStorage) + UI
- `newtab.html` / `app.css` — shell + styles
- `images/` — trophy icon, KITT mascot poses

## Status & what's next
Phase 0 (the full client experience on placeholder data) is built. The remaining critical
path to a usable team product — real 2026 draw + fixtures, the Google Form/Sheets shared
layer, lock enforcement, and signing — is tracked in `../REQUIREMENTS.md` section 11.
