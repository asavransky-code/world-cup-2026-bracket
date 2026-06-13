// data.js — tournament data.
// TEAMS reflects the official 2026 FIFA World Cup final draw (drawn 2025-12-05,
// playoff spots resolved March 2026). Source: Wikipedia "2026 FIFA World Cup draw".
// `code` is an ISO 3166-1 alpha-2 (or flagcdn region) code used for flag images;
// all 48 verified to render at https://flagcdn.com/{code}.svg.

window.WCB_DATA = (function () {
  // 48 teams across 12 groups (A-L) — the real WC2026 draw.
  const TEAMS = [
    { code: "mx", name: "Mexico", group: "A" },
    { code: "za", name: "South Africa", group: "A" },
    { code: "kr", name: "South Korea", group: "A" },
    { code: "cz", name: "Czech Republic", group: "A" },

    { code: "ca", name: "Canada", group: "B" },
    { code: "ba", name: "Bosnia and Herzegovina", group: "B" },
    { code: "qa", name: "Qatar", group: "B" },
    { code: "ch", name: "Switzerland", group: "B" },

    { code: "br", name: "Brazil", group: "C" },
    { code: "ma", name: "Morocco", group: "C" },
    { code: "ht", name: "Haiti", group: "C" },
    { code: "gb-sct", name: "Scotland", group: "C" },

    { code: "us", name: "United States", group: "D" },
    { code: "py", name: "Paraguay", group: "D" },
    { code: "au", name: "Australia", group: "D" },
    { code: "tr", name: "Turkey", group: "D" },

    { code: "de", name: "Germany", group: "E" },
    { code: "cw", name: "Curacao", group: "E" },
    { code: "ci", name: "Ivory Coast", group: "E" },
    { code: "ec", name: "Ecuador", group: "E" },

    { code: "nl", name: "Netherlands", group: "F" },
    { code: "jp", name: "Japan", group: "F" },
    { code: "se", name: "Sweden", group: "F" },
    { code: "tn", name: "Tunisia", group: "F" },

    { code: "be", name: "Belgium", group: "G" },
    { code: "eg", name: "Egypt", group: "G" },
    { code: "ir", name: "Iran", group: "G" },
    { code: "nz", name: "New Zealand", group: "G" },

    { code: "es", name: "Spain", group: "H" },
    { code: "cv", name: "Cape Verde", group: "H" },
    { code: "sa", name: "Saudi Arabia", group: "H" },
    { code: "uy", name: "Uruguay", group: "H" },

    { code: "fr", name: "France", group: "I" },
    { code: "sn", name: "Senegal", group: "I" },
    { code: "iq", name: "Iraq", group: "I" },
    { code: "no", name: "Norway", group: "I" },

    { code: "ar", name: "Argentina", group: "J" },
    { code: "dz", name: "Algeria", group: "J" },
    { code: "at", name: "Austria", group: "J" },
    { code: "jo", name: "Jordan", group: "J" },

    { code: "pt", name: "Portugal", group: "K" },
    { code: "cd", name: "DR Congo", group: "K" },
    { code: "uz", name: "Uzbekistan", group: "K" },
    { code: "co", name: "Colombia", group: "K" },

    { code: "gb-eng", name: "England", group: "L" },
    { code: "hr", name: "Croatia", group: "L" },
    { code: "gh", name: "Ghana", group: "L" },
    { code: "pa", name: "Panama", group: "L" },
  ];

  const GROUP_IDS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];

  // Points config (the real-tournament schedule from REQUIREMENTS.md section 5.2).
  const SCORING = {
    groupPosition: 2,   // per correct 1st/2nd/3rd placement
    thirdQualifier: 2,  // per correct third-place team in the advancing 8
    r32: 5,             // per team correctly predicted to reach R16
    r16: 10,            // ... to reach QF
    qf: 20,             // ... to reach SF
    sf: 40,             // ... to reach Final
    champion: 80,       // correct champion
  };

  // 8 of the 12 third-place teams advance.
  const THIRDS_ADVANCING = 8;

  // Picks lock at the first match kickoff. Before this, brackets are editable;
  // at/after it the extension forces read-only even if a player never locked.
  // 2026 opener: Mexico vs South Africa, Estadio Azteca, Mexico City, kickoff
  // 1:00 PM local (UTC-6) on 2026-06-11 (= 2026-06-11T19:00:00Z).
  const LOCK_DATETIME = "2026-06-11T13:00:00-06:00";

  // Shared-layer endpoints. See ../ARTIFACTS.md for how these were created.
  const REMOTE = {
    // Picks WRITE: anonymous POST to the Google Form when a player locks.
    form: {
      postUrl:
        "https://docs.google.com/forms/d/e/1FAIpQLSda3AdrY2HUlm70MODprXBgI_ct3_OJP6fKUPJskP0vEKOufg/formResponse",
      entries: {
        displayName: "entry.1403638696",
        userId: "entry.1806105689",
        picksJSON: "entry.1281050263",
      },
    },
    // Picks READ (leaderboard): public CSV of the Form's responses tab
    // ("Form Responses 1", gid=2023503650). Linked 2026-05-31.
    picksCsvUrl:
      "https://docs.google.com/spreadsheets/d/1SfbP5jdZqPv39aCO9y_k49CQcSFl2xuMMDXqjWemgig/export?format=csv&gid=2023503650",
    // Results READ: public results.json from the scraper Action. Set when hosting is live.
    resultsJsonUrl:
      "https://raw.githubusercontent.com/asavransky-code/world-cup-2026-bracket/main/results.json",
  };

  // R32 bracket template: 16 matches. Slot codes resolve against a player's
  // predicted advancers. W_x = winner of group x, R_x = runner-up of group x,
  // T1..T8 = the player's ranked third-place qualifiers (top to bottom).
  //
  // Group winners/runners-up and the full bracket TREE are FIFA's official 2026
  // structure (source: Wikipedia "2026 FIFA World Cup knockout stage", matches
  // 73-104). The engine advances winners by adjacency (R16 match i = R32[2i] vs
  // R32[2i+1], and so on up), so the 16 matches below are listed in bracket-leaf
  // order — i.e. the order that makes that adjacency reproduce FIFA's exact R16/
  // QF/SF/Final feeds. The trailing comment on each row is its FIFA match number.
  //
  // ONLY the third-place slots are simplified: FIFA assigns the 8 third-placed
  // teams to specific matches via a conditional lookup that depends on which
  // groups' thirds qualify. We instead drop the player's ranked thirds (T1..T8)
  // into the third-place slots in bracket order. Cosmetic only: scoring is by
  // "round reached," and W/R slotting + tree are exact.
  const R32_TEMPLATE = [
    ["W_E", "T1"],   // M74: Winner E vs 3rd (A/B/C/D/F)
    ["W_I", "T2"],   // M77: Winner I vs 3rd (C/D/F/G/H)
    ["R_A", "R_B"],  // M73: Runner-up A vs Runner-up B
    ["W_F", "R_C"],  // M75: Winner F vs Runner-up C
    ["R_K", "R_L"],  // M83: Runner-up K vs Runner-up L
    ["W_H", "R_J"],  // M84: Winner H vs Runner-up J
    ["W_D", "T3"],   // M81: Winner D vs 3rd (B/E/F/I/J)
    ["W_G", "T4"],   // M82: Winner G vs 3rd (A/E/H/I/J)
    ["W_C", "R_F"],  // M76: Winner C vs Runner-up F
    ["R_E", "R_I"],  // M78: Runner-up E vs Runner-up I
    ["W_A", "T5"],   // M79: Winner A vs 3rd (C/E/F/H/I)
    ["W_L", "T6"],   // M80: Winner L vs 3rd (E/H/I/J/K)
    ["W_J", "R_H"],  // M86: Winner J vs Runner-up H
    ["R_D", "R_G"],  // M88: Runner-up D vs Runner-up G
    ["W_B", "T7"],   // M85: Winner B vs 3rd (E/F/G/I/J)
    ["W_K", "T8"],   // M87: Winner K vs 3rd (D/E/I/J/L)
  ];

  // ---- Demo "official results" to score against (fabricated; for previewing the
  // scored dashboard state only). In Phase 1 these come from the public Results
  // Sheet CSV. Codes match the real TEAMS above so the demo renders correctly. ----
  const byCode = Object.fromEntries(TEAMS.map((t) => [t.code, t]));

  // Actual final group order per group: [1st, 2nd, 3rd, 4th]
  const ACTUAL_GROUPS = {
    A: ["mx", "kr", "cz", "za"],
    B: ["ch", "ca", "ba", "qa"],
    C: ["br", "ma", "gb-sct", "ht"],
    D: ["us", "tr", "py", "au"],
    E: ["de", "ec", "ci", "cw"],
    F: ["nl", "jp", "se", "tn"],
    G: ["be", "ir", "eg", "nz"],
    H: ["es", "uy", "cv", "sa"],
    I: ["fr", "sn", "no", "iq"],
    J: ["ar", "at", "dz", "jo"],
    K: ["pt", "co", "uz", "cd"],
    L: ["gb-eng", "hr", "gh", "pa"],
  };

  // The 8 third-place teams that actually advance.
  const ACTUAL_THIRD_QUALIFIERS = [
    "cz", "ci", "se", "no", "dz", "cv", "eg", "gh",
  ];

  // Teams that actually reached each round (for "team advanced" scoring).
  const ACTUAL_R16 = [
    "mx", "ch", "br", "us", "de", "nl", "be", "es",
    "fr", "ar", "pt", "gb-eng", "kr", "uy", "hr", "sn",
  ];
  const ACTUAL_QF = ["us", "ar", "fr", "br", "gb-eng", "es", "de", "nl"];
  const ACTUAL_SF = ["ar", "fr", "es", "nl"];
  const ACTUAL_FINAL = ["ar", "es"];
  const ACTUAL_CHAMPION = "ar";

  // Provisional/live group standings (compare view). Shape mirrors the scraper's
  // results.json `groupStandings`: { g: { order:[codes], final:bool, played:int } }.
  // `groups` (above) stays FINAL-ONLY because it feeds scoring; `groupStandings`
  // carries every group with data (final or not) for display only. The demo
  // represents a finished tournament, so every group is final, played: 3.
  const ACTUAL_GROUP_STANDINGS = Object.fromEntries(
    Object.entries(ACTUAL_GROUPS).map(([g, order]) => [
      g,
      { order, final: true, played: 3 },
    ])
  );

  const ACTUAL = {
    // status mirrors the scraper's results.json: pre | live | complete. The demo
    // represents a finished tournament, so "complete". The live provider replaces
    // this whole object with the fetched results.json when resultsJsonUrl is set.
    status: "complete",
    groups: ACTUAL_GROUPS,
    groupStandings: ACTUAL_GROUP_STANDINGS,
    thirdQualifiers: ACTUAL_THIRD_QUALIFIERS,
    r16: ACTUAL_R16,
    qf: ACTUAL_QF,
    sf: ACTUAL_SF,
    final: ACTUAL_FINAL,
    champion: ACTUAL_CHAMPION,
  };

  // ---- Static pool roster (the 10 players; picks are locked) ----
  // Identity is fixed: when an install has no local picks (fresh install or wiped
  // storage) and kickoff has passed, the extension recovers identity from this
  // list (the "claim" screen) instead of generating a new userId and re-submitting
  // — which is exactly how "Umit" ended up with two userIds before this version.
  // `userId` is the canonical bracket (used for the leaderboard); `claims` lists the
  // dated options shown on the claim screen when a player submitted more than once
  // under different ids, so they can pick the right one. userIds verified against the
  // responses Sheet (2026-06-13).
  const ROSTER = [
    { name: "Alejandro", userId: "69134b3f-9a7f-4827-8ed3-a923580b7ca7" },
    { name: "Alex", userId: "0f4f72e4-fec8-45a1-b41c-e0779e13df26" },
    { name: "Dr. Ubino", userId: "22fac201-5261-4470-9007-5be9bf392617" },
    { name: "Farhan", userId: "2528f440-10a7-473a-aca2-9c775beda185" },
    { name: "Jeff P", userId: "3bea7f41-f5cb-49d6-9854-b2164c92f4b7" },
    { name: "Ray", userId: "e169b20d-dbf3-4e0b-96dc-e04f91348587" },
    { name: "SuAnn", userId: "13fcad41-9e3e-45dd-bef3-12e517e5864c" },
    {
      name: "Umit",
      userId: "b1094150-d40d-4b1f-8c97-d7adbea76bca",
      claims: [
        { userId: "b1094150-d40d-4b1f-8c97-d7adbea76bca", note: "submitted Jun 11" },
        { userId: "dc843865-2a69-4962-9600-01b396c483d6", note: "submitted Jun 3" },
      ],
    },
    { name: "Yazan", userId: "97b95046-d0d1-4302-b5f0-bcc5fbff983f" },
    { name: "hanna", userId: "5162da7f-d303-4283-a67d-29852836eff5" },
  ];

  // Demo teammates for the leaderboard (Phase 1: from the Picks Sheet CSV).
  const DEMO_TEAMMATES = [
    { name: "Carolyn", score: 196 },
    { name: "Sam", score: 154 },
    { name: "Priya", score: 121 },
  ];

  function groupTeams(groupId) {
    return TEAMS.filter((t) => t.group === groupId);
  }

  return {
    TEAMS,
    GROUP_IDS,
    SCORING,
    THIRDS_ADVANCING,
    LOCK_DATETIME,
    REMOTE,
    R32_TEMPLATE,
    ACTUAL,
    ROSTER,
    DEMO_TEAMMATES,
    byCode,
    groupTeams,
  };
})();
