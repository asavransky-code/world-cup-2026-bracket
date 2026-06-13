// app.js — state + UI controller for the Phase 0 prototype.
(function () {
  const D = window.WCB_DATA;
  const E = window.WCB_ENGINE;
  const S = D.SCORING;
  const STORE_KEY = "wcb_state_v1";
  const THIRDS_ADVANCING = D.THIRDS_ADVANCING; // 8

  const STEPS = ["groups", "thirds", "knockout", "review"];
  const STEP_LABELS = {
    groups: "1. Group standings",
    thirds: "2. Third-place order",
    knockout: "3. Knockout",
    review: "4. Review & lock",
  };

  // ---------- state ----------
  // Stable per-player id, used to dedup submissions (keep latest per user).
  function genId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "u-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }
  function defaultState() {
    return {
      userId: genId(),
      displayName: null,
      groupPicks: {}, // g -> [1st, 2nd, 3rd] codes
      thirdRanking: [], // codes, top -> bottom (up to 8)
      knockoutPicks: {}, // matchId -> winner code
      locked: false,
      lockedAt: null, // ISO timestamp of manual lock (tiebreaker: earliest wins)
      step: "groups",
      devHideResults: false, // Phase 0: preview the pre-tournament empty state
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return Object.assign(defaultState(), JSON.parse(raw));
    } catch (e) {}
    return defaultState();
  }
  function save() {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  }
  let state = load();

  // In-memory navigation (NOT persisted): every new tab is a fresh page load, so
  // this resets to the dashboard each time — the dashboard stays the default view.
  let view = { name: "dashboard", playerId: null };

  // ---------- roster (static pool of known players) ----------
  // Identity is hardcoded in data.js so a reinstall recovers via the claim screen
  // instead of minting a new userId. KNOWN_UIDS = every canonical + claim userId,
  // used to collapse duplicates (one "Umit") and hide orphan/unknown rows.
  const ROSTER = D.ROSTER || [];
  const KNOWN_UIDS = new Set();
  ROSTER.forEach((r) => {
    KNOWN_UIDS.add(r.userId);
    (r.claims || []).forEach((c) => KNOWN_UIDS.add(c.userId));
  });
  function rosterUidsOf(entry) {
    return [entry.userId, ...((entry.claims || []).map((c) => c.userId))];
  }
  function rosterEntryForUid(uid) {
    return ROSTER.find((r) => rosterUidsOf(r).includes(uid)) || null;
  }

  // ---------- helpers ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }
  function team(code) {
    return D.byCode[code];
  }
  function flag(code) {
    return `<img class="flag" src="https://flagcdn.com/${code}.svg" alt="" />`;
  }
  function teamLabel(code) {
    const t = team(code);
    if (!t) return "";
    return `${flag(code)}<span class="name">${esc(t.name)}</span>`;
  }

  function groupsComplete() {
    return D.GROUP_IDS.every((g) => (state.groupPicks[g] || []).length >= 3);
  }
  function predictedThirds() {
    return D.GROUP_IDS.map((g) => (state.groupPicks[g] || [])[2]).filter(Boolean);
  }
  function thirdsComplete() {
    return groupsComplete() && state.thirdRanking.length >= THIRDS_ADVANCING;
  }
  function knockoutComplete() {
    if (!thirdsComplete()) return false;
    const { rounds, champion } = E.buildBracket(
      state.groupPicks,
      state.thirdRanking,
      state.knockoutPicks
    );
    if (!champion) return false;
    return rounds.every((r) => r.matches.every((m) => m.winner));
  }
  function stepDone(step) {
    if (step === "groups") return groupsComplete();
    if (step === "thirds") return thirdsComplete();
    if (step === "knockout") return knockoutComplete();
    return false;
  }
  function stepReachable(step) {
    if (step === "groups") return true;
    if (step === "thirds") return groupsComplete();
    if (step === "knockout") return thirdsComplete();
    if (step === "review") return knockoutComplete();
    return false;
  }
  function resultsAvailable() {
    // Dev toggle forces the pre-tournament empty state for previewing.
    if (state.devHideResults) return false;
    // When a remote results feed is configured, only trust it once it has
    // actually loaded. Until then (and if the fetch fails) show the
    // pre-tournament view rather than briefly flashing the demo fallback's
    // "complete" scored state. With no remote URL (pure local dev), fall
    // through and let the demo D.ACTUAL drive the preview.
    const hasRemote = !!(D.REMOTE && D.REMOTE.resultsJsonUrl);
    if (hasRemote && results.state !== "done") return false;
    // Otherwise derive from the results feed status: scores exist once the
    // tournament is underway ("live") or finished ("complete").
    const status = getActual().status;
    return status === "live" || status === "complete";
  }

  // ---------- scoring explainer ----------
  function scoringLegendHTML() {
    const rows = [
      ["Each group placing (1st / 2nd / 3rd)", S.groupPosition],
      ["Each third-place team you send through", S.thirdQualifier],
      ["Each team you send to the Round of 16", S.r32],
      ["Each team you send to the Quarterfinals", S.r16],
      ["Each team you send to the Semifinals", S.qf],
      ["Each team you send to the Final", S.sf],
      ["Picking the Champion", S.champion],
    ];
    return `<div class="card legend">
      <h2>How points work</h2>
      <p class="subtle" style="margin-bottom:12px">Points climb every round, so nailing the business end of the tournament can win the pool even after a rough group stage.</p>
      ${rows
        .map(
          (r) =>
            `<div class="legend-row"><span>${r[0]}</span><span class="pts">${r[1]} pt${
              r[1] === 1 ? "" : "s"
            }</span></div>`
        )
        .join("")}
    </div>`;
  }

  // ---------- lock enforcement ----------
  function lockMsAt() {
    const t = Date.parse(D.LOCK_DATETIME);
    return isNaN(t) ? null : t;
  }
  function editingClosed() {
    const t = lockMsAt();
    return t !== null && Date.now() >= t;
  }
  // A bracket is locked if the player locked it manually OR kickoff has passed.
  function picksLocked() {
    return state.locked || editingClosed();
  }
  function fmtCountdown(ms) {
    if (ms <= 0) return "now";
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (d > 0) return `${d}d ${h}h ${m}m ${sec}s`;
    if (h > 0) return `${h}h ${m}m ${sec}s`;
    return `${m}m ${sec}s`;
  }
  // Live-update the header countdown; when it hits zero, re-render to flip the UI
  // into the locked (read-only) state.
  let lockTicker = null;
  function startLockTicker() {
    if (lockTicker) { clearInterval(lockTicker); lockTicker = null; }
    const t = lockMsAt();
    if (t === null || editingClosed()) return;
    lockTicker = setInterval(() => {
      const el = document.getElementById("lock-countdown");
      if (!el) { clearInterval(lockTicker); lockTicker = null; return; }
      const rem = t - Date.now();
      if (rem <= 0) { clearInterval(lockTicker); lockTicker = null; render(); return; }
      el.textContent = "Your bracket locks in " + fmtCountdown(rem);
    }, 1000);
  }

  // ---------- render ----------
  const appEl = document.getElementById("app");
  const actionsEl = document.getElementById("topbar-actions");

  function render() {
    document.body.classList.toggle("on-name", !state.displayName);
    if (picksLocked()) state.step = "dashboard";
    // No identity yet: after kickoff there's nothing to fill out, so recover via
    // the claim screen (pick who you are) rather than the first-run pick flow —
    // this is what prevents a wiped install from re-submitting under a new userId.
    if (!state.displayName) return editingClosed() ? renderClaim() : renderName();
    if (state.step === "dashboard") {
      if (view.name === "player") return renderPlayerDetail(view.playerId);
      return renderDashboard();
    }
    if (!STEPS.includes(state.step)) state.step = "groups";
    renderWizard();
  }

  function setView(name, playerId) {
    view = { name, playerId: playerId || null };
    window.scrollTo(0, 0);
    render();
  }

  // The topbar now shows only the Firefox brand (static in newtab.html). The
  // functional controls (countdown, Edit picks, Reset) moved into the page body
  // alongside the section title — see controlsHTML().
  function renderTopbar() {
    actionsEl.innerHTML = "";
  }

  // Countdown + Edit picks + Reset, right-aligned. Rendered into the content
  // (dashboard section row + wizard head), not the topbar.
  function controlsHTML() {
    if (!state.displayName) return "";
    const parts = [];
    const open = !editingClosed();
    const t = lockMsAt();
    if (open && t !== null) {
      parts.push(
        `<span class="lock-countdown" id="lock-countdown" title="Time left to edit your bracket">Your bracket locks in ${fmtCountdown(
          t - Date.now()
        )}</span>`
      );
    }
    if (picksLocked()) {
      // "Edit picks" only while editing is open; after kickoff it's frozen.
      if (open) parts.push(`<button data-action="unlock">Edit picks</button>`);
      else parts.push(`<span class="lock-countdown locked" title="Editing closed at kickoff">🔒 Picks locked</span>`);
    }
    parts.push(`<button class="ghost danger" data-action="reset">Reset</button>`);
    return `<div class="header-controls">${parts.join("")}</div>`;
  }

  function renderName() {
    renderTopbar();
    appEl.innerHTML = `
      <div class="center-screen">
        <div class="card name-entry">
          <img class="kitt" src="images/firefox-mascot-ball-chase-rgb.svg" alt="" />
          <h1>Welcome to the Growth Team 2026 World Cup Pool!</h1>
          <p class="subtle">Enter the name your teammates will see on the leaderboard.</p>
          <input id="name-input" type="text" placeholder="Your name" maxlength="24" />
          <button class="primary block" data-action="set-name">Start picking</button>
        </div>
      </div>`;
    wireKitt();
    const input = document.getElementById("name-input");
    input.focus();
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") setName();
    });
  }

  // Recovery / identity screen, shown after kickoff when there's no local identity
  // (fresh install or wiped storage). Tapping a name adopts that player's existing
  // userId and bracket — no new submission, no duplicate player.
  function renderClaim() {
    renderTopbar();
    loadPicksOnce(); // so the chosen bracket can hydrate once the CSV lands
    const buttons = ROSTER.map((r) => {
      const opts = r.claims && r.claims.length > 1 ? r.claims : [{ userId: r.userId }];
      return opts
        .map((o) => {
          const note = o.note ? `<span class="claim-note">${esc(o.note)}</span>` : "";
          return `<button class="claim-btn" data-action="claim" data-uid="${o.userId}" data-name="${esc(
            r.name
          )}"><span class="claim-name">${esc(r.name)}</span>${note}</button>`;
        })
        .join("");
    }).join("");
    appEl.innerHTML = `
      <div class="center-screen">
        <div class="card name-entry claim">
          <img class="kitt" src="images/firefox-mascot-ball-chase-rgb.svg" alt="" />
          <h1>Welcome back to the Growth Team World Cup Pool</h1>
          <p class="subtle">Picks are locked, so there's nothing to fill out — just tap your name to load your bracket and the live pool. Tapping the wrong one won't submit anything.</p>
          <div class="claim-grid">${buttons}</div>
        </div>
      </div>`;
    wireKitt();
  }

  function wireKitt() {
    document.querySelectorAll("img.kitt").forEach((img) => {
      img.addEventListener("error", () => {
        img.style.display = "none";
      });
    });
  }

  function stepPills() {
    return `<div class="steps">${STEPS.map((s) => {
      const cls = s === state.step ? "active" : stepDone(s) ? "done" : "";
      const reach = stepReachable(s);
      return `<button class="step-pill ${cls}" data-action="goto" data-step="${s}" ${
        reach ? "" : "disabled"
      }>${STEP_LABELS[s]}</button>`;
    }).join("")}</div>`;
  }

  function navRow() {
    const idx = STEPS.indexOf(state.step);
    const back =
      idx > 0
        ? `<button data-action="goto" data-step="${STEPS[idx - 1]}">Back</button>`
        : `<span></span>`;
    let next = "<span></span>";
    if (state.step === "review") {
      next = `<button class="primary" data-action="lock" ${
        knockoutComplete() ? "" : "disabled"
      }>Lock in my bracket</button>`;
    } else {
      const nextStep = STEPS[idx + 1];
      next = `<button class="primary" data-action="goto" data-step="${nextStep}" ${
        stepDone(state.step) ? "" : "disabled"
      }>Next</button>`;
    }
    return `<div class="navrow">${back}${next}</div>`;
  }

  // Re-render the wizard without losing scroll position. Picking a team
  // re-renders #app; without this the bracket would snap back to the left
  // (and the page to the top), which is disorienting mid-pick.
  function rerenderWizard() {
    const bw = document.querySelector(".bracket-wrap");
    const sl = bw ? bw.scrollLeft : 0;
    const wy = window.scrollY;
    renderWizard();
    const nbw = document.querySelector(".bracket-wrap");
    if (nbw) nbw.scrollLeft = sl;
    window.scrollTo(0, wy);
  }

  function renderWizard() {
    renderTopbar();
    let body = "";
    if (state.step === "groups") body = viewGroups();
    else if (state.step === "thirds") body = viewThirds();
    else if (state.step === "knockout") body = viewKnockout();
    else if (state.step === "review") body = viewReview();
    appEl.innerHTML =
      `<div class="wizard-head">${stepPills()}${controlsHTML()}</div>` + body + navRow();
    startLockTicker();
  }

  function hint(text) {
    return `<p class="hint">🏅 ${text}</p>`;
  }

  function viewGroups() {
    const grid = D.GROUP_IDS.map((g) => {
      const order = state.groupPicks[g] || [];
      const chips = D.groupTeams(g)
        .map((t) => {
          const rank = order.indexOf(t.code);
          let badge = "";
          let cls = "";
          if (rank >= 0) {
            badge = `<span class="rank">${rank + 1}</span>`;
            cls = "ranked";
          } else if (order.length >= 3) {
            badge = `<span class="rank r4">4</span>`;
          }
          return `<div class="chip ${cls}" data-action="group-pick" data-group="${g}" data-code="${t.code}">
              ${teamLabel(t.code)}${badge}</div>`;
        })
        .join("");
      return `<div class="group"><h3>GROUP ${g}</h3>${chips}</div>`;
    }).join("");
    return `
      <h1>Group standings</h1>
      <p class="subtle">Click teams in each group in finishing order: 1st, then 2nd, then 3rd. The remaining team is 4th. Click a ranked team to redo from there.</p>
      ${hint(`${S.groupPosition} pts for each team you place correctly.`)}
      <div class="groups-grid">${grid}</div>`;
  }

  function viewThirds() {
    const thirds = predictedThirds();
    const ranked = state.thirdRanking.length;
    const list = thirds
      .map((code) => {
        const rank = state.thirdRanking.indexOf(code);
        let badge = "";
        let cls = "";
        if (rank >= 0) {
          badge = `<span class="rank">${rank + 1}</span>`;
          cls = "ranked advancing";
        } else if (ranked >= THIRDS_ADVANCING) {
          cls = "cut"; // the 8 slots are full; this team is out
        }
        return `<div class="chip ${cls}" data-action="third-pick" data-code="${code}">
            ${teamLabel(code)}${badge}</div>`;
      })
      .join("");
    return `
      <h1>Third-place order</h1>
      <p class="subtle">Eight of the twelve third-place teams advance. Click the <strong>8 you think go through</strong>, best first, in the order they'll rank. The rest are out. You're done at 8. Click a ranked team to redo from there.</p>
      ${hint(`${S.thirdQualifier} pts for each third-place team you send through. (${ranked}/${THIRDS_ADVANCING} picked)`)}
      <div class="thirds-list">${list}</div>`;
  }

  // ---- two-sided bracket ----
  function matchHTML(m, readOnly) {
    const slot = (code) => {
      if (!code) return `<div class="slot empty">TBD</div>`;
      const isWin = m.winner === code;
      const action = readOnly
        ? ""
        : `data-action="ko-pick" data-match="${m.id}" data-code="${code}"`;
      return `<div class="slot ${isWin ? "winner" : ""}" ${action}>${teamLabel(code)}</div>`;
    };
    return `<div class="match">${slot(m.a)}${slot(m.b)}</div>`;
  }

  function roundCol(label, matches, readOnly) {
    const body = matches.map((m) => matchHTML(m, readOnly)).join("");
    return `<div class="round"><h4>${label}</h4><div class="round-matches">${body}</div></div>`;
  }

  function bracketHTML(readOnly) {
    const { rounds, champion } = E.buildBracket(
      state.groupPicks,
      state.thirdRanking,
      state.knockoutPicks
    );
    return bracketLayoutHTML(rounds, champion, readOnly);
  }

  // Render any bracket (from given picks) read-only — used by the player-compare view.
  function bracketHTMLFrom(groupPicks, thirdRanking, knockoutPicks) {
    const { rounds, champion } = E.buildBracket(
      groupPicks || {},
      thirdRanking || [],
      knockoutPicks || {}
    );
    return bracketLayoutHTML(rounds, champion, true);
  }

  function bracketLayoutHTML(rounds, champion, readOnly) {
    const byId = {};
    rounds.forEach((r) => (byId[r.id] = r.matches));
    const r32 = byId.r32,
      r16 = byId.r16,
      qf = byId.qf,
      sf = byId.sf,
      final = byId.final;

    const left = [
      roundCol("R32", r32.slice(0, 8), readOnly),
      roundCol("R16", r16.slice(0, 4), readOnly),
      roundCol("QF", qf.slice(0, 2), readOnly),
      roundCol("SF", sf.slice(0, 1), readOnly),
    ].join("");

    const right = [
      roundCol("SF", sf.slice(1, 2), readOnly),
      roundCol("QF", qf.slice(2, 4), readOnly),
      roundCol("R16", r16.slice(4, 8), readOnly),
      roundCol("R32", r32.slice(8, 16), readOnly),
    ].join("");

    const champBlock = `
      <div class="champ-block">
        <div class="champ-label">CHAMPION</div>
        <div class="chip picked champ">${champion ? teamLabel(champion) : "TBD"}</div>
      </div>`;

    const center = `<div class="final-col">
        <div class="round"><h4>FINAL</h4><div class="round-matches">${matchHTML(
          final[0],
          readOnly
        )}</div></div>
        ${champBlock}
      </div>`;

    return `<div class="bracket-wrap"><div class="bracket2">
        <div class="side left">${left}</div>
        ${center}
        <div class="side right">${right}</div>
      </div></div>`;
  }

  function viewKnockout() {
    return `
      <h1>Knockout bracket</h1>
      <p class="subtle">Click the team you think wins each match. Winners advance toward the final in the middle. Pick all the way through to your champion.</p>
      <p class="subtle">This is FIFA's real bracket: group winners and runners-up are in their official slots and advance through the exact tree. Only the third-place teams use a simplified placement (FIFA assigns those once the group stage ends). Either way, scoring is by which round a team reaches, so it doesn't affect your points.</p>
      ${hint(
        `Send a team further, earn more: R16 ${S.r32} · QF ${S.r16} · SF ${S.qf} · Final ${S.sf} · Champion ${S.champion}.`
      )}
      ${bracketHTML(false)}`;
  }

  function viewReview() {
    const { champion } = E.buildBracket(
      state.groupPicks,
      state.thirdRanking,
      state.knockoutPicks
    );
    const champHTML = champion
      ? `<div class="chip picked" style="max-width:260px">${teamLabel(champion)}</div>`
      : `<p class="subtle">Finish the knockout to pick a champion.</p>`;
    return `
      <h1>Review &amp; lock</h1>
      <p class="subtle">Once you lock, your bracket is published to the pool and can't be changed. Make sure you're happy with it.</p>
      <div class="two-col">
        <div class="card"><h2>Your champion</h2>${champHTML}</div>
        ${scoringLegendHTML()}
      </div>
      <div class="card"><h2>Full bracket</h2>${bracketHTML(true)}</div>`;
  }

  // ---------- dashboard ----------
  function quickLinksHTML() {
    // Filled async by loadTopSites(). No card: floats centered on the page.
    return `<div class="quicklinks"><div class="ql-grid" id="ql-grid"></div></div>`;
  }

  // Section heading above the pool content (mirrors New Tab's "Popular Today"),
  // with the lock/edit/reset controls right-aligned on the same line.
  function poolSectionTitleHTML() {
    return `<div class="section-head">
      <h2 class="section-title">Growth Team 2026 World Cup Pool</h2>
      <div class="section-actions">
        ${controlsHTML()}
      </div>
    </div>`;
  }

  function loadTopSites() {
    const api = (window.browser || window.chrome || {}).topSites;
    const grid = document.getElementById("ql-grid");
    if (!grid || !api || !api.get) {
      if (grid) grid.parentElement.style.display = "none";
      return;
    }
    let opts = { includeFavicon: true };
    try {
      const p = api.get(opts);
      if (p && p.then) p.then(renderTiles, () => api.get(renderTiles));
      else api.get(opts, renderTiles);
    } catch (e) {
      try {
        api.get(renderTiles);
      } catch (e2) {}
    }
    function renderTiles(sites) {
      if (!sites || !sites.length) {
        grid.parentElement.style.display = "none";
        return;
      }
      grid.innerHTML = sites
        .slice(0, 8)
        .map((s) => {
          const host = (() => {
            try {
              return new URL(s.url).hostname.replace(/^www\./, "");
            } catch (e) {
              return s.url;
            }
          })();
          const label = esc(s.title || host);
          const icon = s.favicon
            ? `<img class="ql-fav" src="${esc(s.favicon)}" alt="" />`
            : `<span class="ql-fav ql-letter">${esc((label[0] || "?").toUpperCase())}</span>`;
          return `<a class="ql-tile" href="${esc(s.url)}" title="${label}">
              <span class="ql-box">${icon}</span>
              <span class="ql-title">${label}</span></a>`;
        })
        .join("");
    }
  }

  // ---------- live results provider (read results.json) ----------
  // results.actual is the fetched results.json (same shape as D.ACTUAL). Until it
  // loads (or if no remote URL is configured), scoring uses the demo D.ACTUAL.
  const results = { state: "idle", actual: null };

  function getActual() {
    return results.actual || D.ACTUAL;
  }

  function loadResultsOnce() {
    // No remote URL configured -> stay on demo D.ACTUAL (local dev).
    const url = D.REMOTE && D.REMOTE.resultsJsonUrl;
    if (!url || results.state !== "idle") return;
    results.state = "loading";
    fetch(url, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j) => {
        results.actual = j;
        results.state = "done";
        // results change scores, so the cached leaderboard must be recomputed
        picks.state = "idle";
        picks.board = null;
        render();
      })
      .catch(() => { results.state = "failed"; }); // fall back to demo D.ACTUAL
  }

  // ---------- shared leaderboard (read picks from the responses Sheet) ----------
  // picks.state: idle -> loading -> done | failed. board: [{userId,name,score}].
  const picks = { state: "idle", board: null };

  // Minimal RFC-4180-ish CSV parser (handles quoted fields, commas, newlines,
  // and "" escapes) — picksJSON contains commas/quotes/braces.
  function parseCSV(text) {
    const rows = [];
    let row = [], field = "", i = 0, inQ = false;
    while (i < text.length) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQ = false;
        } else field += c;
      } else if (c === '"') inQ = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c !== "\r") field += c;
      i++;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  // The two finalists in a bracket = the teams in the final match.
  function finalistsOf(bracket) {
    const fr = bracket.rounds.find((r) => r.id === "final");
    const fm = fr && fr.matches[0];
    return fm ? [fm.a, fm.b].filter(Boolean) : [];
  }

  // Score a player's picks and capture the tiebreaker fields (champion correct,
  // count of correct finalists). lockedAt is the third tiebreaker, carried separately.
  function evalPicks(picksObj) {
    const actual = getActual();
    try {
      const res = E.score(
        picksObj.groupPicks || {},
        picksObj.thirdRanking || [],
        picksObj.knockoutPicks || {},
        actual
      );
      const af = actual.final || [];
      return {
        score: res.total,
        championRight: !!(res.bracket.champion && res.bracket.champion === actual.champion),
        finalistsCorrect: finalistsOf(res.bracket).filter((t) => af.includes(t)).length,
      };
    } catch (e) {
      return { score: 0, championRight: false, finalistsCorrect: 0 };
    }
  }

  // Tiebreakers (REQUIREMENTS): score, then champion correct, then more correct
  // finalists, then earliest lock.
  function lockMsOf(p) {
    const t = p.lockedAt ? Date.parse(p.lockedAt) : NaN;
    return isNaN(t) ? Infinity : t;
  }
  function cmpBoard(a, b) {
    return (
      b.score - a.score ||
      (b.championRight ? 1 : 0) - (a.championRight ? 1 : 0) ||
      (b.finalistsCorrect || 0) - (a.finalistsCorrect || 0) ||
      lockMsOf(a) - lockMsOf(b)
    );
  }

  // Fetch + parse the responses CSV once. Dedup to the latest row per userId,
  // skip test rows, score each player. On completion, re-render.
  function loadPicksOnce() {
    if (picks.state !== "idle") return;
    const url = D.REMOTE && D.REMOTE.picksCsvUrl;
    if (!url) { picks.state = "failed"; return; }
    picks.state = "loading";
    fetch(url, { cache: "no-store" })
      .then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
      .then((text) => {
        const rows = parseCSV(text);
        if (!rows.length) { picks.board = []; picks.state = "done"; return render(); }
        const head = rows[0].map((h) => h.trim().toLowerCase());
        const col = (name) => head.indexOf(name.toLowerCase());
        const ci = { name: col("displayName"), uid: col("userId"), json: col("picksJSON") };
        const byUser = new Map(); // userId -> latest {name, picks}
        for (let r = 1; r < rows.length; r++) {
          const cells = rows[r];
          const uid = (cells[ci.uid] || "").trim();
          if (!uid || uid.startsWith("test-")) continue;
          let parsed;
          try { parsed = JSON.parse(cells[ci.json]); } catch (e) { continue; }
          byUser.set(uid, { name: (cells[ci.name] || "Player").trim(), picks: parsed });
        }
        picks.board = Array.from(byUser, ([userId, v]) => ({
          userId,
          name: v.name,
          lockedAt: v.picks.lockedAt || null,
          raw: v.picks, // kept so the compare view + identity recovery can read picks
          ...evalPicks(v.picks),
        }));
        picks.state = "done";
        hydrateFromBoardIfNeeded();
        render();
      })
      .catch(() => { picks.state = "failed"; });
  }

  // Collapse the raw CSV rows to the static roster: one entry per player (prefer
  // the canonical userId, else the most recent of their claim ids), roster name,
  // orphan/unknown userIds dropped. This is what de-duplicates "Umit" (two ids)
  // and keeps the board to the known players. Returns null if no live rows yet.
  function reconciledRows() {
    if (!(picks.board && picks.board.length)) return null;
    const byUid = new Map(picks.board.map((p) => [p.userId, p]));
    const out = [];
    ROSTER.forEach((entry) => {
      const uids = rosterUidsOf(entry);
      const found = uids.map((u) => byUid.get(u)).filter(Boolean);
      if (!found.length) return; // this player has no submission in the Sheet
      const row =
        byUid.get(entry.userId) ||
        found.slice().sort((a, b) => lockMsOf(b) - lockMsOf(a))[0];
      out.push(
        Object.assign({}, row, {
          userId: entry.userId,
          name: entry.name,
          me: uids.includes(state.userId),
        })
      );
    });
    return out;
  }

  // If we just recovered identity (claim screen) and have no local picks, pull the
  // player's locked bracket out of the board so their dashboard/compare render. Never
  // clobbers a non-empty local bracket (a normal user with intact storage).
  function hydrateFromBoardIfNeeded() {
    if (!(picks.board && picks.board.length)) return;
    const hasLocal = state.groupPicks && Object.keys(state.groupPicks).length > 0;
    if (hasLocal) return;
    const entry = rosterEntryForUid(state.userId);
    const uids = entry ? rosterUidsOf(entry) : [state.userId];
    const row = picks.board.find((p) => uids.includes(p.userId) && p.raw);
    if (!row) return;
    state.groupPicks = row.raw.groupPicks || {};
    state.thirdRanking = row.raw.thirdRanking || [];
    state.knockoutPicks = row.raw.knockoutPicks || {};
    state.lockedAt = row.raw.lockedAt || state.lockedAt;
    state.locked = true;
    if (entry) state.userId = entry.userId; // normalize to the canonical id
    save();
  }

  // Build the leaderboard to display: reconciled roster rows if we have live data,
  // otherwise the demo teammates so local dev still looks populated. Always includes
  // "me". `me` is a full entry {name, score, championRight, finalistsCorrect, lockedAt}.
  function buildBoard(me) {
    const live = reconciledRows();
    let board = live
      ? live.map((p) => ({
          name: p.name,
          score: p.score,
          championRight: p.championRight,
          finalistsCorrect: p.finalistsCorrect,
          lockedAt: p.lockedAt,
          me: p.me,
        }))
      : D.DEMO_TEAMMATES.map((p) => ({ name: p.name, score: p.score, me: false }));
    if (!board.some((p) => p.me)) board.push(Object.assign({ me: true }, me));
    return board.sort(cmpBoard);
  }

  function renderDashboard() {
    renderTopbar();
    loadResultsOnce();
    loadPicksOnce();
    hydrateFromBoardIfNeeded(); // covers the case where the board was already cached
    const { champion } = E.buildBracket(
      state.groupPicks,
      state.thirdRanking,
      state.knockoutPicks
    );
    // Unified home: your status (left) + the full pool leaderboard (right).
    // Both cards adapt to pre-tournament vs. scored; the leaderboard is the only
    // path to a player's bracket (tap "View"), so it always lists all 10.
    appEl.innerHTML = `
      ${quickLinksHTML()}
      ${poolSectionTitleHTML()}
      <div class="two-col">
        ${statusCardHTML(champion)}
        ${leaderboardCardHTML()}
      </div>
      ${scoringLegendHTML()}`;
    wireKitt();
    loadTopSites();
    startLockTicker();
  }

  // Left card: the player's own status. Pre-tournament it's the "you're locked in"
  // hero (champion pick + how many have locked in); once scoring is live it shows
  // points / rank / champion. The full breakdown + bracket live behind the player's
  // own "View" on the leaderboard, same path as viewing anyone else.
  function statusCardHTML(champion) {
    const playerCount = (reconciledRows() || ROSTER).length;
    if (!resultsAvailable()) {
      return `<div class="card hero">
        <img class="kitt" src="images/firefox-mascot-ball-chase-rgb.svg" alt="" />
        <div class="hero-text">
          <h1>You're locked in, ${esc(state.displayName)}</h1>
          <p class="subtle">The group stage is underway. Nothing counts toward points until a group finishes, so the board sits at zero for now. Track how your bracket stacks up against the pool on the right — tap any name to see their full bracket and how their picks line up with the live group standings.</p>
          <div class="hero-champ">
            <span class="label">Your champion pick</span>
            <div class="chip picked champ">${champion ? teamLabel(champion) : "—"}</div>
          </div>
          <p class="subtle">${playerCount} players locked in.</p>
        </div>
      </div>`;
    }
    const actual = getActual();
    const result = E.score(
      state.groupPicks,
      state.thirdRanking,
      state.knockoutPicks,
      actual
    );
    const af = actual.final || [];
    const board = buildBoard({
      name: state.displayName,
      score: result.total,
      championRight: !!(result.bracket.champion && result.bracket.champion === actual.champion),
      finalistsCorrect: finalistsOf(result.bracket).filter((t) => af.includes(t)).length,
      lockedAt: state.lockedAt,
    });
    const myRank = board.findIndex((p) => p.me) + 1;
    return `<div class="card status-card">
      <h2>You're locked in, ${esc(state.displayName)}</h2>
      <div class="statgrid">
        <div class="stat"><div class="bignum">${result.total}</div><div class="label">points</div></div>
        <div class="stat"><div class="bignum">#${myRank}</div><div class="label">of ${board.length}</div></div>
        <div class="stat"><div class="label">your champion</div>
          <div class="chip picked champ" style="justify-content:center;margin-top:8px">${
            champion ? teamLabel(champion) : "—"
          }</div></div>
      </div>
      <p class="subtle" style="margin-top:16px">Tap your name on the leaderboard for your full score breakdown and bracket.</p>
    </div>`;
  }

  // Right card: the whole pool, every player a tap-through to their bracket. Before
  // scores exist it's a neutral list (no ranks, 0 pts for everyone); once results
  // are live it sorts by score and numbers the standings. Reuses the roster-row UI.
  function leaderboardCardHTML() {
    const showScores = resultsAvailable();
    const live = reconciledRows();
    // Live reconciled rows when the Sheet has loaded; otherwise the static roster
    // so all 10 still show (scores fill in on the re-render once picks load).
    const rows = (
      live ||
      ROSTER.map((r) => ({
        userId: r.userId,
        name: r.name,
        score: 0,
        me: rosterUidsOf(r).includes(state.userId),
      }))
    ).slice();
    rows.sort(showScores ? cmpBoard : (a, b) => a.name.localeCompare(b.name));
    let list = rows
      .map(
        (p, i) => `
        <button class="roster-row ${p.me ? "me" : ""}" data-action="view-player" data-uid="${p.userId}">
          <span class="roster-rank">${showScores ? i + 1 : "•"}</span>
          <span class="roster-name">${esc(p.name)}${p.me ? " (you)" : ""}</span>
          <span class="roster-score">${showScores ? p.score : "0 pts"}</span>
          <span class="roster-go">View ›</span>
        </button>`
      )
      .join("");
    // Any roster player with no submission in the Sheet: degrade visibly rather
    // than silently dropping them (shouldn't happen for the locked pool).
    if (live) {
      const present = new Set(rows.map((p) => p.name));
      ROSTER.filter((r) => !present.has(r.name)).forEach((r) => {
        list += `<div class="roster-row missing"><span class="roster-rank">•</span><span class="roster-name">${esc(
          r.name
        )}</span><span class="roster-score">no picks found</span></div>`;
      });
    }
    const note = showScores
      ? "Standings so far. Tap anyone for their full bracket."
      : "No scores yet — they start once a group is final. Group standings aren't final until each group plays its three matches, so nothing here counts toward points yet.";
    return `<div class="card lb-card">
      <h2>Leaderboard</h2>
      <p class="subtle lb-note">${note}</p>
      <div class="roster-list">${list}</div>
    </div>`;
  }

  // ---------- player compare view ----------
  // Read a player's raw picks: from the Sheet board if present, else local state
  // (covers "me" before the CSV loads).
  function rawPicksForUid(uid) {
    const entry = rosterEntryForUid(uid);
    const uids = entry ? rosterUidsOf(entry) : [uid];
    if (picks.board) {
      const row = picks.board.find((p) => uids.includes(p.userId) && p.raw);
      if (row) return row.raw;
    }
    if (uids.includes(state.userId)) {
      return {
        groupPicks: state.groupPicks,
        thirdRanking: state.thirdRanking,
        knockoutPicks: state.knockoutPicks,
        lockedAt: state.lockedAt,
      };
    }
    return null;
  }

  // One group's predicted finishing order vs. the live standings, with markers.
  function groupCompareHTML(g, pred, st) {
    const order = st && st.order ? st.order : [];
    const final = !!(st && st.final);
    const played = st ? st.played || 0 : 0;
    const tag = !st
      ? `<span class="gtag none">not started</span>`
      : final
      ? `<span class="gtag final">final</span>`
      : `<span class="gtag prov">not final · ${played}/3 played</span>`;
    const rows = [0, 1, 2]
      .map((pos) => {
        const p = pred[pos];
        const a = order[pos];
        let mark = "";
        if (p && final) mark = p === a ? `<span class="mk ok">✓</span>` : `<span class="mk no">✗</span>`;
        else if (p && a) mark = p === a ? `<span class="mk prov">•</span>` : `<span class="mk dot">·</span>`;
        const predCell = p ? teamLabel(p) : `<span class="subtle">—</span>`;
        const actCell = a ? teamLabel(a) : `<span class="subtle">—</span>`;
        return `<tr><td class="pos">${pos + 1}</td><td>${predCell}</td><td class="mkcell">${mark}</td><td>${actCell}</td></tr>`;
      })
      .join("");
    return `<div class="gcmp"><div class="gcmp-head">GROUP ${g} ${tag}</div>
      <table class="gcmp-tbl"><thead><tr><th></th><th>Pick</th><th></th><th>Live</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function renderPlayerDetail(uid) {
    renderTopbar();
    loadResultsOnce();
    loadPicksOnce();
    const entry = rosterEntryForUid(uid);
    const name = entry ? entry.name : "Player";
    const raw = rawPicksForUid(uid);
    if (!raw) {
      appEl.innerHTML = `
        ${quickLinksHTML()}
        <div class="section-head">
          <h2 class="section-title">${esc(name)}</h2>
          <div class="section-actions"><button data-action="view-dashboard">‹ Back to dashboard</button></div>
        </div>
        <div class="card"><p class="subtle">Loading this bracket…</p></div>`;
      wireKitt();
      loadTopSites();
      return;
    }
    const actual = getActual();
    const result = E.score(
      raw.groupPicks || {},
      raw.thirdRanking || [],
      raw.knockoutPicks || {},
      actual
    );
    const lines = result.lines
      .map(
        (l) => `
        <div class="score-line">
          <div><strong>${l.label}</strong> <span class="detail">${l.detail}</span></div>
          <div class="pts">${l.points}</div>
        </div>`
      )
      .join("");
    const standings = actual.groupStandings || {};
    const groupCmp = D.GROUP_IDS.map((g) =>
      groupCompareHTML(g, raw.groupPicks ? raw.groupPicks[g] || [] : [], standings[g])
    ).join("");
    const koStarted = (actual.r16 || []).length > 0;
    const koNote = koStarted
      ? ""
      : `<p class="subtle">Knockout results start after the group stage. For now this is ${esc(
          name
        )}'s predicted bracket.</p>`;
    appEl.innerHTML = `
      ${quickLinksHTML()}
      <div class="section-head">
        <h2 class="section-title">${esc(name)}'s bracket</h2>
        <div class="section-actions"><button data-action="view-dashboard">‹ Back to dashboard</button></div>
      </div>
      <p class="subtle">Group standings below are live and <strong>not final</strong> until each group plays its three matches. Points are awarded only once a group is final, so these numbers can still change.</p>
      <div class="two-col">
        <div class="card"><h2>Score so far</h2>${lines}
          <div class="score-total"><div>Total</div><div>${result.total}</div></div></div>
        <div class="card"><h2>Group picks vs. live standings</h2><div class="group-cmp">${groupCmp}</div></div>
      </div>
      <div class="card"><h2>Full bracket</h2>${koNote}${bracketHTMLFrom(
      raw.groupPicks,
      raw.thirdRanking,
      raw.knockoutPicks
    )}</div>`;
    wireKitt();
    loadTopSites();
  }

  // ---------- actions ----------
  function setName() {
    const input = document.getElementById("name-input");
    const v = (input.value || "").trim();
    if (!v) return input.focus();
    state.displayName = v;
    state.step = "groups";
    save();
    render();
  }

  // Adopt an existing player's identity (claim screen). No new submission: we take
  // their userId so the leaderboard attributes the right row, and their bracket
  // hydrates from the Sheet once it loads.
  function claim(uid, name) {
    state.userId = uid;
    state.displayName = name;
    state.locked = true;
    view = { name: "dashboard", playerId: null };
    save();
    hydrateFromBoardIfNeeded(); // in case the board was already loaded
    render();
  }

  function groupPick(g, code) {
    const order = (state.groupPicks[g] || []).slice();
    const idx = order.indexOf(code);
    if (idx >= 0) state.groupPicks[g] = order.slice(0, idx);
    else if (order.length < 3) {
      order.push(code);
      state.groupPicks[g] = order;
    }
    state.thirdRanking = state.thirdRanking.filter((c) => predictedThirds().includes(c));
    state.knockoutPicks = E.pruneInvalidPicks(
      state.groupPicks,
      state.thirdRanking,
      state.knockoutPicks
    );
    save();
    rerenderWizard();
  }

  function thirdPick(code) {
    const order = state.thirdRanking.slice();
    const idx = order.indexOf(code);
    if (idx >= 0) state.thirdRanking = order.slice(0, idx);
    else if (order.length < THIRDS_ADVANCING) {
      order.push(code);
      state.thirdRanking = order;
    }
    state.knockoutPicks = E.pruneInvalidPicks(
      state.groupPicks,
      state.thirdRanking,
      state.knockoutPicks
    );
    save();
    rerenderWizard();
  }

  function koPick(matchId, code) {
    state.knockoutPicks[matchId] = code;
    state.knockoutPicks = E.pruneInvalidPicks(
      state.groupPicks,
      state.thirdRanking,
      state.knockoutPicks
    );
    save();
    rerenderWizard();
  }

  function goto(step) {
    if (!stepReachable(step)) return;
    state.step = step;
    save();
    render();
  }

  function lock() {
    if (!knockoutComplete()) return;
    state.locked = true;
    state.lockedAt = new Date().toISOString();
    state.step = "dashboard";
    save();
    publishPicks();
    render();
  }

  // Publish a copy of the locked bracket to the shared Google Form. The bracket is
  // already saved locally; this is fire-and-forget. The Form accepts anonymous
  // no-cors POSTs (opaque response), so we can't read status, which is fine.
  function publishPicks() {
    const cfg = D.REMOTE && D.REMOTE.form;
    if (!cfg || !cfg.postUrl) return;
    const payload = JSON.stringify({
      groupPicks: state.groupPicks,
      thirdRanking: state.thirdRanking,
      knockoutPicks: state.knockoutPicks,
      lockedAt: state.lockedAt || new Date().toISOString(),
    });
    const body = new URLSearchParams();
    body.append(cfg.entries.displayName, state.displayName || "");
    body.append(cfg.entries.userId, state.userId);
    body.append(cfg.entries.picksJSON, payload);
    fetch(cfg.postUrl, { method: "POST", mode: "no-cors", body }).catch((e) =>
      console.warn("[WCB] picks publish failed (saved locally regardless):", e)
    );
  }

  function unlock() {
    // Once kickoff passes, editing is closed for everyone, manual lock or not.
    if (editingClosed()) return render();
    state.locked = false;
    state.step = "review";
    save();
    render();
  }

  function toggleResults() {
    state.devHideResults = !state.devHideResults;
    save();
    render();
  }

  function reset() {
    if (!confirm("Reset everything and start over?")) return;
    // Keep the same userId so a reset doesn't orphan the player's existing
    // leaderboard entry. Re-locking then updates that entry (latest row wins)
    // instead of creating a duplicate player.
    const keepUserId = state.userId;
    state = defaultState();
    state.userId = keepUserId;
    save();
    render();
  }

  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const a = el.dataset.action;
    if (a === "set-name") setName();
    else if (a === "claim") claim(el.dataset.uid, el.dataset.name);
    else if (a === "view-player") setView("player", el.dataset.uid);
    else if (a === "view-dashboard") setView("dashboard");
    else if (a === "group-pick") groupPick(el.dataset.group, el.dataset.code);
    else if (a === "third-pick") thirdPick(el.dataset.code);
    else if (a === "ko-pick") koPick(el.dataset.match, el.dataset.code);
    else if (a === "goto") goto(el.dataset.step);
    else if (a === "lock") lock();
    else if (a === "unlock") unlock();
    else if (a === "toggle-results") toggleResults();
    else if (a === "reset") reset();
  });

  render();
})();
