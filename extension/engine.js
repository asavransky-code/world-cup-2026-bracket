// engine.js — bracket resolution + scoring. Pure functions, source-agnostic.

window.WCB_ENGINE = (function () {
  const D = window.WCB_DATA;

  // Knockout round metadata, in order. Each round's matches feed the next.
  const ROUNDS = [
    { id: "r32", label: "Round of 32", matches: 16 },
    { id: "r16", label: "Round of 16", matches: 8 },
    { id: "qf", label: "Quarterfinals", matches: 4 },
    { id: "sf", label: "Semifinals", matches: 2 },
    { id: "final", label: "Final", matches: 1 },
  ];

  // From a player's group picks + third ranking, compute advancers.
  // groupPicks: { A: [1st,2nd,3rd,4th codes], ... }  thirdRanking: [12 codes top->bottom]
  function advancers(groupPicks, thirdRanking) {
    const winners = {};
    const runners = {};
    D.GROUP_IDS.forEach((g) => {
      const order = groupPicks[g] || [];
      winners[g] = order[0] || null;
      runners[g] = order[1] || null;
    });
    const qualifiedThirds = (thirdRanking || []).slice(0, D.THIRDS_ADVANCING);
    return { winners, runners, qualifiedThirds };
  }

  function resolveSlot(slot, adv) {
    if (slot.startsWith("W_")) return adv.winners[slot.slice(2)] || null;
    if (slot.startsWith("R_")) return adv.runners[slot.slice(2)] || null;
    if (slot.startsWith("T")) {
      const idx = parseInt(slot.slice(1), 10) - 1;
      return adv.qualifiedThirds[idx] || null;
    }
    return null;
  }

  // Build the full knockout bracket as resolved so far from the player's picks.
  // knockoutPicks: { matchId: winnerCode }. matchId = `${roundId}-${index}`.
  // Returns: { rounds: [{ id, label, matches: [{ id, a, b, winner }] }], champion }
  function buildBracket(groupPicks, thirdRanking, knockoutPicks) {
    const adv = advancers(groupPicks, thirdRanking);
    const picks = knockoutPicks || {};
    const rounds = [];

    // Round of 32 from the template.
    const r32Matches = D.R32_TEMPLATE.map((pair, i) => {
      const id = `r32-${i}`;
      return {
        id,
        a: resolveSlot(pair[0], adv),
        b: resolveSlot(pair[1], adv),
        winner: picks[id] || null,
      };
    });
    rounds.push({ id: "r32", label: ROUNDS[0].label, matches: r32Matches });

    // Subsequent rounds: each match fed by two prior winners.
    for (let r = 1; r < ROUNDS.length; r++) {
      const prev = rounds[r - 1].matches;
      const meta = ROUNDS[r];
      const matches = [];
      for (let i = 0; i < meta.matches; i++) {
        const id = `${meta.id}-${i}`;
        const a = prev[i * 2] ? prev[i * 2].winner : null;
        const b = prev[i * 2 + 1] ? prev[i * 2 + 1].winner : null;
        matches.push({ id, a, b, winner: picks[id] || null });
      }
      rounds.push({ id: meta.id, label: meta.label, matches });
    }

    const finalMatch = rounds[rounds.length - 1].matches[0];
    const champion = finalMatch ? finalMatch.winner : null;
    return { rounds, champion };
  }

  // Validity: a winner pick is only valid if it's one of the two teams in the match.
  // Clears downstream picks that no longer make sense (used after edits).
  function pruneInvalidPicks(groupPicks, thirdRanking, knockoutPicks) {
    const cleaned = { ...knockoutPicks };
    // Iterate to a fixed point since clearing a round invalidates the next.
    for (let pass = 0; pass < ROUNDS.length; pass++) {
      const { rounds } = buildBracket(groupPicks, thirdRanking, cleaned);
      let changed = false;
      rounds.forEach((round) => {
        round.matches.forEach((m) => {
          if (m.winner && m.winner !== m.a && m.winner !== m.b) {
            delete cleaned[m.id];
            changed = true;
          }
        });
      });
      if (!changed) break;
    }
    return cleaned;
  }

  // ---- Scoring ----
  function setOf(arr) {
    return new Set((arr || []).filter(Boolean));
  }

  function intersectionCount(arrA, arrB) {
    const b = setOf(arrB);
    let n = 0;
    setOf(arrA).forEach((x) => {
      if (b.has(x)) n++;
    });
    return n;
  }

  // Teams a player predicted to REACH a given round = winners of the previous round.
  function predictedReaching(bracket, roundId) {
    const idx = ROUNDS.findIndex((r) => r.id === roundId);
    if (idx <= 0) return [];
    return bracket.rounds[idx - 1].matches.map((m) => m.winner).filter(Boolean);
  }

  function score(groupPicks, thirdRanking, knockoutPicks, actual) {
    const S = D.SCORING;
    const bracket = buildBracket(groupPicks, thirdRanking, knockoutPicks);
    const lines = [];
    let total = 0;

    // Group positions: 1st/2nd/3rd exact matches.
    let groupPts = 0;
    let groupCorrect = 0;
    D.GROUP_IDS.forEach((g) => {
      const pred = groupPicks[g] || [];
      const act = actual.groups[g] || [];
      for (let pos = 0; pos < 3; pos++) {
        if (pred[pos] && pred[pos] === act[pos]) {
          groupPts += S.groupPosition;
          groupCorrect++;
        }
      }
    });
    total += groupPts;
    lines.push({ label: "Group standings", detail: `${groupCorrect}/36 correct`, points: groupPts });

    // Third-place qualifiers (set intersection).
    const adv = advancers(groupPicks, thirdRanking);
    const thirdCorrect = intersectionCount(adv.qualifiedThirds, actual.thirdQualifiers);
    const thirdPts = thirdCorrect * S.thirdQualifier;
    total += thirdPts;
    lines.push({ label: "Third-place qualifiers", detail: `${thirdCorrect}/8 correct`, points: thirdPts });

    // Knockout rounds by "team reached round".
    const koRounds = [
      { id: "r16", from: "r32", value: S.r32, actualSet: actual.r16, label: "Reached Round of 16" },
      { id: "qf", from: "r16", value: S.r16, actualSet: actual.qf, label: "Reached Quarterfinals" },
      { id: "sf", from: "qf", value: S.qf, actualSet: actual.sf, label: "Reached Semifinals" },
      { id: "final", from: "sf", value: S.sf, actualSet: actual.final, label: "Reached Final" },
    ];
    koRounds.forEach((kr) => {
      const predicted = predictedReaching(bracket, kr.id);
      const correct = intersectionCount(predicted, kr.actualSet);
      const pts = correct * kr.value;
      total += pts;
      lines.push({
        label: kr.label,
        detail: `${correct}/${(kr.actualSet || []).length} correct × ${kr.value}`,
        points: pts,
      });
    });

    // Champion.
    const championRight = bracket.champion && bracket.champion === actual.champion;
    const champPts = championRight ? S.champion : 0;
    total += champPts;
    lines.push({
      label: "Champion",
      detail: championRight ? "correct" : "missed",
      points: champPts,
    });

    return { total, lines, bracket };
  }

  return { ROUNDS, advancers, buildBracket, pruneInvalidPicks, score };
})();
