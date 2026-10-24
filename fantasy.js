/* Derby fantasy scoring. Points follow the position table agreed for the world game. */
(function (root) {
  const BUDGET = 150;
  const LIMITS = { G: 2, D: 5, M: 5, A: 3 };
  const XI_MAX = { G: 1, D: 5, M: 5, A: 3 };
  const XI_MIN = { G: 1, D: 3, M: 2, A: 1 };
  const GOAL = { G: 6, D: 6, M: 5, A: 4 };
  const CLEAN = { G: 4, D: 4, M: 1, A: 0 };

  function slotOf(position) {
    const raw = String(position || "").toUpperCase().trim();
    if (!raw) return "M";
    if (/GOAL|KEEPER|\bGKP\b|\bGK\b/.test(raw) || raw === "G") return "G";
    if (/WING[\s-]?BACK|FULL[\s-]?BACK|DEF|BACK|\bCB\b|\bLB\b|\bRB\b|\bWB\b|\bLWB\b|\bRWB\b/.test(raw)) return "D";
    if (/MID/.test(raw)) return "M";
    if (/FORWARD|STRIK|ATTACK|WING|\bFW\b|\bFWD\b|\bST\b|\bCF\b|\bSS\b/.test(raw) || raw === "F" || raw === "A") return "A";
    const token = raw.split(/[\s/-]/)[0];
    if (token === "G" || token === "GK" || token === "GKP") return "G";
    if (["D", "DF", "DEF", "CB", "LB", "RB", "WB", "LWB", "RWB"].includes(token)) return "D";
    if (["F", "FW", "FWD", "ST", "CF", "SS", "A"].includes(token)) return "A";
    return "M";
  }

  function add(lines, label, points) {
    if (!points) return;
    lines.push({ label, points });
  }

  function scorePlayer(row) {
    const slot = row.slot || "M";
    const lines = [];
    const minutes = Number(row.minutes) || 0;
    if (minutes <= 0) return { points: 0, lines: [], minutes: 0 };
    add(lines, minutes >= 60 ? "60 minutes or more" : "Played under 60 minutes", minutes >= 60 ? 2 : 1);
    const goals = Number(row.goals) || 0;
    add(lines, "Goals", goals * GOAL[slot]);
    add(lines, "Goals from outside the box", (Number(row.outsideBox) || 0) * 1);
    add(lines, "Assists", (Number(row.assists) || 0) * 3);
    if ((row.cleanSheet || minutes >= 60) && minutes >= 60 && !Number(row.goalsConceded)) {
      add(lines, "Clean sheet", CLEAN[slot]);
    }
    add(lines, "Saves", Math.floor((Number(row.saves) || 0) / 3) * (slot === "G" ? 1 : 0));
    add(lines, "Penalty saves", (Number(row.penaltySaves) || 0) * (slot === "G" ? 5 : 0));
    if (slot === "G" || slot === "D") {
      add(lines, "Goals conceded", -Math.floor((Number(row.goalsConceded) || 0) / 2));
    }
    const actions = Number(row.defensiveActions) || 0;
    const need = slot === "D" ? 10 : 12;
    if ((slot === "D" || slot === "M" || slot === "A") && actions >= need) add(lines, "Defensive contribution", 2);
    add(lines, "Shots on target", Math.floor((Number(row.shotsOnTarget) || 0) / 2));
    add(lines, "Woodwork", Number(row.woodwork) || 0);
    add(lines, "Penalty won", (Number(row.penaltyWon) || 0) * 2);
    add(lines, "Yellow cards", -(Number(row.yellow) || 0));
    add(lines, "Red cards", -(Number(row.red) || 0) * 3);
    add(lines, "Own goals", -(Number(row.ownGoals) || 0) * 2);
    add(lines, "Penalty misses", -(Number(row.penaltyMiss) || 0) * 2);
    add(lines, "Penalties conceded", -(Number(row.penaltyConceded) || 0));
    const points = lines.reduce((sum, line) => sum + line.points, 0);
    return { points, lines, minutes };
  }

  function bonusMetric(row) {
    const slot = row.slot || "M";
    let score = 0;
    if ((Number(row.minutes) || 0) >= 60) score += 2;
    score += (Number(row.goals) || 0) * GOAL[slot];
    score += (Number(row.assists) || 0) * 3;
    score += Number(row.shotsOnTarget) || 0;
    score += Number(row.woodwork) || 0;
    score += Number(row.saves) || 0;
    score += (Number(row.penaltySaves) || 0) * 3;
    if ((slot === "G" || slot === "D") && (Number(row.minutes) || 0) >= 60 && !Number(row.goalsConceded)) score += 2;
    const need = slot === "D" ? 10 : 12;
    if ((slot === "D" || slot === "M" || slot === "A") && (Number(row.defensiveActions) || 0) >= need) score += 2;
    score -= Number(row.yellow) || 0;
    score -= (Number(row.red) || 0) * 3;
    score -= (Number(row.ownGoals) || 0) * 2;
    score -= (Number(row.penaltyMiss) || 0) * 2;
    return score;
  }

  function applyBonus(rows) {
    const ranked = rows
      .filter((row) => (Number(row.minutes) || 0) > 0)
      .map((row) => ({ ...row, metric: bonusMetric(row), bonus: 0 }))
      .sort((a, b) => b.metric - a.metric || String(a.name).localeCompare(String(b.name)));
    const prizes = [3, 2, 1];
    let index = 0;
    while (index < ranked.length && prizes.length) {
      let end = index;
      while (end < ranked.length && ranked[end].metric === ranked[index].metric) end += 1;
      const prize = prizes.shift();
      for (let cursor = index; cursor < end; cursor += 1) ranked[cursor].bonus = prize;
      for (let extra = 1; extra < end - index && prizes.length; extra += 1) prizes.shift();
      index = end;
    }
    const bonusById = new Map(ranked.map((row) => [String(row.id), row.bonus || 0]));
    return rows.map((row) => {
      const bonus = bonusById.get(String(row.id)) || 0;
      if (!bonus) return row;
      const lines = [...(row.lines || []), { label: "Bonus", points: bonus }];
      return { ...row, lines, points: (row.points || 0) + bonus, bonus };
    });
  }

  function londonDayKey(iso) {
    if (!iso) return "";
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  }

  function weekKeys(now = new Date()) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/London",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        weekday: "short",
      })
        .formatToParts(now)
        .map((part) => [part.type, part.value])
    );
    const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday);
    const noon = new Date(`${parts.year}-${parts.month}-${parts.day}T12:00:00Z`);
    const monday = new Date(noon.getTime() - Math.max(0, weekday) * 86400000);
    const keys = [];
    for (let day = 0; day < 7; day += 1) keys.push(londonDayKey(new Date(monday.getTime() + day * 86400000).toISOString()));
    return new Set(keys);
  }

  function inThisWeek(iso, now = new Date()) {
    return weekKeys(now).has(londonDayKey(iso));
  }

  function sheetRows(sheet) {
    const scored = (sheet.players || []).map((player) => {
      const row = scorePlayer(player);
      return { ...player, ...row, slot: player.slot || slotOf(player.position) };
    });
    return applyBonus(scored);
  }

  function autosub(squad, minutesById) {
    const xi = squad.filter((player) => player.xi);
    const bench = squad.filter((player) => !player.xi);
    const used = new Set();
    const counted = [];
    xi.forEach((player) => {
      const minutes = minutesById.get(String(player.id)) || 0;
      if (minutes > 0) {
        counted.push(player);
        used.add(player.id);
        return;
      }
      const cover = bench.find((sub) => !used.has(sub.id) && sub.slot === player.slot && (minutesById.get(String(sub.id)) || 0) > 0);
      if (cover) {
        counted.push(cover);
        used.add(cover.id);
      } else {
        counted.push(player);
        used.add(player.id);
      }
    });
    return counted;
  }

  function weekPoints(squad, sheets, options) {
    const opts = options || {};
    const byId = new Map();
    (sheets || []).forEach((sheet) => {
      sheetRows(sheet).forEach((row) => {
        const id = String(row.id);
        if (!byId.has(id)) byId.set(id, { points: 0, minutes: 0, lines: [] });
        const acc = byId.get(id);
        acc.points += row.points || 0;
        acc.minutes += row.minutes || 0;
        if (row.lines?.length) {
          acc.lines.push({ match: sheet.label || "Match", points: row.points, lines: row.lines });
        }
      });
    });
    const minutesById = new Map([...byId.entries()].map(([id, row]) => [id, row.minutes]));
    const counted = opts.benchBoost ? squad.filter((player) => (minutesById.get(String(player.id)) || 0) > 0) : autosub(squad, minutesById);
    const countedIds = new Set(counted.map((player) => player.id));
    const captainPlayed = counted.some((player) => player.captain && (minutesById.get(String(player.id)) || 0) > 0);
    const multiplier = opts.triple ? 3 : 2;
    let total = 0;
    const players = squad.map((player) => {
      const row = byId.get(String(player.id)) || { points: 0, minutes: 0, lines: [] };
      const active = countedIds.has(player.id);
      const doubled = active && ((player.captain && captainPlayed) || (player.vice && !captainPlayed && row.minutes > 0));
      const points = active ? row.points * (doubled ? multiplier : 1) : 0;
      if (active) total += points;
      return { ...player, active, doubled, multiplier: doubled ? multiplier : 1, points, minutes: row.minutes, breakdown: row.lines };
    });
    return { total, players, benchBoost: !!opts.benchBoost, triple: !!opts.triple };
  }

  function canAdd(squad, slot) {
    return squad.filter((player) => player.slot === slot).length < LIMITS[slot];
  }

  function canStart(squad, slot) {
    const xi = squad.filter((player) => player.xi);
    if (xi.length >= 11) return false;
    return xi.filter((player) => player.slot === slot).length < XI_MAX[slot];
  }

  function weekKey(now = new Date()) {
    return [...weekKeys(now)][0];
  }

  function deadlineMs(matches, now = new Date(), offsetMin = 90) {
    const keys = weekKeys(now);
    const times = (matches || [])
      .filter((match) => keys.has(londonDayKey(match.start)))
      .map((match) => new Date(match.start).getTime())
      .filter((time) => Number.isFinite(time));
    if (!times.length) return null;
    return Math.min(...times) - offsetMin * 60 * 1000;
  }

  root.NINETY_FANTASY = {
    BUDGET,
    LIMITS,
    XI_MIN,
    XI_MAX,
    slotOf,
    scorePlayer,
    applyBonus,
    weekPoints,
    inThisWeek,
    weekKey,
    deadlineMs,
    canAdd,
    canStart,
  };

  const selfTest = typeof process !== "undefined" && process.argv && process.argv.includes("--self-test");
  if (selfTest) {
    const forward = scorePlayer({ slot: "A", minutes: 80, goals: 2, assists: 1, shotsOnTarget: 3, goalsConceded: 1 });
    if (forward.points !== 2 + 8 + 3 + 1) throw new Error(`forward ${forward.points}`);
    const keeper = scorePlayer({ slot: "G", minutes: 90, saves: 3, goalsConceded: 0 });
    if (keeper.points !== 2 + 4 + 1) throw new Error(`keeper ${keeper.points}`);
    const defender = scorePlayer({ slot: "D", minutes: 90, goalsConceded: 2, defensiveActions: 10 });
    if (defender.points !== 2 + 2 - 1) throw new Error(`defender ${defender.points}`);
    const bonus = applyBonus([
      { id: "1", name: "A", slot: "A", minutes: 90, goals: 2, assists: 0, shotsOnTarget: 0, goalsConceded: 1, lines: [], points: 10 },
      { id: "2", name: "B", slot: "M", minutes: 90, goals: 0, assists: 0, shotsOnTarget: 0, goalsConceded: 1, lines: [], points: 2 },
      { id: "3", name: "C", slot: "D", minutes: 90, goals: 0, assists: 0, shotsOnTarget: 0, goalsConceded: 0, lines: [], points: 6 },
      { id: "4", name: "D", slot: "D", minutes: 20, goals: 0, assists: 0, shotsOnTarget: 0, goalsConceded: 0, lines: [], points: 1 },
    ]);
    const top = bonus.find((row) => row.id === "1");
    if (!top.bonus) throw new Error("bonus missing");
    const squad = [
      { id: "c", slot: "A", xi: true, captain: true, name: "Cap" },
      { id: "b", slot: "A", xi: false, name: "Bench" },
    ];
    const sheets = [{ label: "Test", players: [
      { id: "c", slot: "A", minutes: 90 },
      { id: "b", slot: "A", minutes: 90 },
    ] }];
    const plain = weekPoints(squad, sheets);
    const triple = weekPoints(squad, sheets, { triple: true });
    const boost = weekPoints(squad, sheets, { benchBoost: true });
    const captain = plain.players.find((player) => player.id === "c");
    const benched = plain.players.find((player) => player.id === "b");
    if (benched.points !== 0) throw new Error("bench should not score");
    if (triple.players.find((player) => player.id === "c").points !== (captain.points / 2) * 3) throw new Error("triple captain");
    if (boost.players.find((player) => player.id === "b").points <= 0) throw new Error("bench boost");
    const cover = weekPoints(
      [
        { id: "s", slot: "M", xi: true, captain: true, name: "Starter" },
        { id: "u", slot: "M", xi: false, name: "Sub" },
      ],
      [{ players: [{ id: "u", slot: "M", minutes: 90 }] }]
    );
    if (!cover.players.find((player) => player.id === "u").active) throw new Error("autosub");
    if (cover.players.find((player) => player.id === "s").points !== 0) throw new Error("starter should sit");
    const seats = {
      Goalkeeper: "G",
      "Centre-Back": "D",
      "Wing Back": "D",
      "Attacking Midfielder": "M",
      "Left Wing": "A",
      F: "A",
    };
    Object.entries(seats).forEach(([position, slot]) => {
      if (slotOf(position) !== slot) throw new Error(`${position} landed in ${slotOf(position)}`);
    });
    console.log("fantasy self-test ok", { forward: forward.points, keeper: keeper.points, defender: defender.points, bonus: top.bonus, triple: triple.total, boost: boost.total });
  }
})(typeof window !== "undefined" ? window : globalThis);
