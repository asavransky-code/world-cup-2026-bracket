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
    if (d > 0) return `${d}d ${h}h ${m}m`;
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
      el.textContent = "Locks in " + fmtCountdown(rem);
    }, 1000);
  }

  // ---------- render ----------
  const appEl = document.getElementById("app");
  const actionsEl = document.getElementById("topbar-actions");

  function render() {
    document.body.classList.toggle("on-name", !state.displayName);
    if (picksLocked()) state.step = "dashboard";
    if (!state.displayName) return renderName();
    if (state.step === "dashboard") return renderDashboard();
    if (!STEPS.includes(state.step)) state.step = "groups";
    renderWizard();
  }

  function renderTopbar() {
    if (!state.displayName) {
      actionsEl.innerHTML = "";
      return;
    }
    const parts = [`<span class="progress-note">${esc(state.displayName)}</span>`];
    const open = !editingClosed();
    const t = lockMsAt();
    // Countdown to lock, shown whenever editing is still open (wizard + dashboard).
    if (open && t !== null) {
      parts.push(
        `<span class="lock-countdown" id="lock-countdown" title="Time left to edit your bracket">Locks in ${fmtCountdown(
          t - Date.now()
        )}</span>`
      );
    }
    if (picksLocked()) {
      parts.push(
        `<button data-action="toggle-results" class="ghost">${
          state.devHideResults ? "Sim: show results" : "Sim: pre-tournament"
        }</button>`
      );
      // "Edit picks" only while editing is open; after kickoff it's frozen.
      if (open) parts.push(`<button data-action="unlock">Edit picks</button>`);
      else parts.push(`<span class="lock-countdown locked" title="Editing closed at kickoff">🔒 Picks locked</span>`);
    }
    parts.push(`<button class="ghost danger" data-action="reset">Reset</button>`);
    actionsEl.innerHTML = parts.join("");
    startLockTicker();
  }

  function renderName() {
    renderTopbar();
    appEl.innerHTML = `
      <div class="center-screen">
        <div class="card name-entry">
          <img class="kitt" src="images/firefox-mascot-ball-chase-rgb.svg" alt="" />
          <h1>Welcome to the pool</h1>
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
    appEl.innerHTML = stepPills() + body + navRow();
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
              ${icon}<span class="ql-title">${label}</span></a>`;
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
          ...evalPicks(v.picks),
        }));
        picks.state = "done";
        render();
      })
      .catch(() => { picks.state = "failed"; });
  }

  // Build the leaderboard to display: real submissions if we have any, otherwise
  // the demo teammates so local dev still looks populated. Always includes "me".
  // `me` is a full entry {name, score, championRight, finalistsCorrect, lockedAt}.
  function buildBoard(me) {
    const live = picks.board && picks.board.length ? picks.board.slice() : null;
    let board = live
      ? live.map((p) => ({
          name: p.name,
          score: p.score,
          championRight: p.championRight,
          finalistsCorrect: p.finalistsCorrect,
          lockedAt: p.lockedAt,
          me: p.userId === state.userId,
        }))
      : D.DEMO_TEAMMATES.map((p) => ({ name: p.name, score: p.score, me: false }));
    if (!board.some((p) => p.me)) board.push(Object.assign({ me: true }, me));
    return board.sort(cmpBoard);
  }

  function renderDashboard() {
    renderTopbar();
    loadResultsOnce();
    loadPicksOnce();
    const { champion } = E.buildBracket(
      state.groupPicks,
      state.thirdRanking,
      state.knockoutPicks
    );

    if (!resultsAvailable()) {
      renderEmptyDashboard(champion);
    } else {
      renderScoredDashboard(champion);
    }
    wireKitt();
    loadTopSites();
  }

  function renderEmptyDashboard(champion) {
    const others = buildBoard({ name: state.displayName, score: 0 }).length;
    appEl.innerHTML = `
      ${quickLinksHTML()}
      <div class="card hero">
        <img class="kitt" src="images/firefox-mascot-ball-chase-rgb.svg" alt="" />
        <div class="hero-text">
          <h1>You're locked in, ${esc(state.displayName)}</h1>
          <p class="subtle">The tournament hasn't kicked off yet. Scores start landing once teams finish the group stage, then this board comes alive after each round.</p>
          <div class="hero-champ">
            <span class="label">Your champion pick</span>
            <div class="chip picked champ">${champion ? teamLabel(champion) : "—"}</div>
          </div>
          <p class="subtle">${others} players locked in so far.</p>
        </div>
      </div>
      ${scoringLegendHTML()}`;
  }

  function renderScoredDashboard(champion) {
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

    // Show the top 6 only, so the card stays a fixed size as players are added.
    const lbRows = board
      .slice(0, 6)
      .map(
        (p, i) => `
        <div class="lb-row ${p.me ? "me" : ""}">
          <div class="lb-rank">${i + 1}</div>
          <div class="lb-name">${esc(p.name)}${p.me ? " (you)" : ""}</div>
          <div class="lb-score">${p.score}</div>
        </div>`
      )
      .join("");

    const lines = result.lines
      .map(
        (l) => `
        <div class="score-line">
          <div><strong>${l.label}</strong> <span class="detail">${l.detail}</span></div>
          <div class="pts">${l.points}</div>
        </div>`
      )
      .join("");

    appEl.innerHTML = `
      ${quickLinksHTML()}
      <div class="card">
        <div class="statgrid">
          <div class="stat"><div class="bignum">${result.total}</div><div class="label">points</div></div>
          <div class="stat"><div class="bignum">#${myRank}</div><div class="label">of ${board.length}</div></div>
          <div class="stat"><div class="label">your champion</div>
            <div class="chip picked champ" style="justify-content:center;margin-top:8px">${
              champion ? teamLabel(champion) : "—"
            }</div></div>
        </div>
      </div>
      <div class="two-col">
        <div class="card"><h2>Leaderboard</h2>${lbRows}</div>
        <div class="card"><h2>Your score breakdown</h2>${lines}
          <div class="score-total"><div>Total</div><div>${result.total}</div></div></div>
      </div>
      <div class="card"><h2>Your bracket</h2>${bracketHTML(true)}</div>`;
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
