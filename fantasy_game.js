/* Team rules, transfers, chips, deadlines, and achievements for Derby fantasy. */
(function (root) {
  const CORE = root.NINETY_FANTASY;
  const FORMATIONS = {
    "3-4-3": { D: 3, M: 4, A: 3 },
    "3-5-2": { D: 3, M: 5, A: 2 },
    "4-3-3": { D: 4, M: 3, A: 3 },
    "4-4-2": { D: 4, M: 4, A: 2 },
    "4-5-1": { D: 4, M: 5, A: 1 },
    "5-3-2": { D: 5, M: 3, A: 2 },
    "5-4-1": { D: 5, M: 4, A: 1 },
  };
  const CLUB_CAP = 3;
  const SQUAD = { G: 2, D: 5, M: 5, A: 3 };
  const HIT = 4;
  const KEY = "ninety-fantasy-v2";

  function blank(squad) {
    return {
      version: 2,
      teamName: "",
      favouriteClub: "",
      formation: "4-3-3",
      squad: Array.isArray(squad) ? squad : [],
      freeTransfers: 1,
      transfersThisWeek: 0,
      weekKey: "",
      chipThisWeek: null,
      chips: { wildcard1: null, wildcard2: null, freehit: null, bench: null, triple: null },
      freeHitBackup: null,
      history: [],
      transferLog: [],
      watchlist: [],
      compareIds: [],
      leagueCodes: [],
      achievements: [],
      mode: "classic",
      draftPool: [],
      draftSquad: [],
      planner: [],
      privacy: "public",
      notify: { deadline: true, lineup: true, price: true, rank: true, chip: true, invite: true, news: true },
      priceMarks: {},
      corrections: [],
      season: "2026/27",
      built: false,
      pending: null,
      country: "",
      region: "",
      theme: "dark",
      undo: null,
      rankHistory: [],
      archives: [],
      plannerWeeks: [],
      plannerChip: "",
      subLog: [],
    };
  }

  let rules = { deadlineOffsetMin: 90, seasonStart: "2026-08-10", seasonEnd: "2027-05-24", postponed: [], scoringNote: "" };

  function configure(patch) {
    rules = { ...rules, ...(patch || {}) };
    rules.deadlineOffsetMin = Number(rules.deadlineOffsetMin) || 90;
    rules.postponed = Array.isArray(rules.postponed) ? rules.postponed.map(String) : [];
    return rules;
  }

  function offset() {
    return Number(rules.deadlineOffsetMin) || 90;
  }

  function load() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(KEY) || "null");
    } catch {
      saved = null;
    }
    if (!saved) {
      try {
        const old = JSON.parse(localStorage.getItem("ninety-fantasy-v1") || "null");
        if (Array.isArray(old)) saved = blank(old);
      } catch {
        saved = null;
      }
    }
    const state = { ...blank(), ...(saved || {}) };
    state.squad = Array.isArray(state.squad) ? state.squad : [];
    state.chips = { ...blank().chips, ...(state.chips || {}) };
    state.notify = { ...blank().notify, ...(state.notify || {}) };
    return state;
  }

  function save(state) {
    localStorage.setItem(KEY, JSON.stringify(state));
    return state;
  }

  function spent(state) {
    return state.squad.reduce((sum, player) => sum + (Number(player.price) || 0), 0);
  }

  function clubCount(state, club, ignoreId) {
    const name = String(club || "").toLowerCase();
    if (!name) return 0;
    return state.squad.filter((player) => player.id !== ignoreId && String(player.club || "").toLowerCase() === name).length;
  }

  function weekNumber(now = new Date(), seasonStart = rules.seasonStart || "2026-08-10") {
    const start = Date.parse(`${seasonStart}T12:00:00Z`);
    const monday = Date.parse(`${CORE.weekKey(now)}T12:00:00Z`);
    if (!Number.isFinite(start) || !Number.isFinite(monday)) return 1;
    return Math.max(1, Math.floor((monday - start) / (7 * 86400000)) + 1);
  }

  function locked(matches, now = new Date(), offsetMin = offset()) {
    const deadline = CORE.deadlineMs(matches, now, offsetMin);
    if (deadline == null) return false;
    return now.getTime() > deadline;
  }

  function issues(state) {
    const notes = [];
    if (!state.teamName.trim()) notes.push("Name your team.");
    const counts = { G: 0, D: 0, M: 0, A: 0 };
    const clubs = {};
    state.squad.forEach((player) => {
      counts[player.slot] = (counts[player.slot] || 0) + 1;
      const club = player.club || "Unknown";
      clubs[club] = (clubs[club] || 0) + 1;
    });
    Object.entries(SQUAD).forEach(([slot, need]) => {
      if (state.built && counts[slot] !== need) notes.push(`Need ${need} ${slot}, you have ${counts[slot] || 0}.`);
    });
    Object.entries(clubs).forEach(([club, count]) => {
      if (count > CLUB_CAP) notes.push(`${club} has ${count} players. The limit is ${CLUB_CAP}.`);
    });
    if (spent(state) > CORE.BUDGET + 0.001) notes.push("Squad is over the £150m budget.");
    const shape = FORMATIONS[state.formation] || FORMATIONS["4-3-3"];
    const xi = state.squad.filter((player) => player.xi);
    if (state.squad.length === 15) {
      if (xi.filter((player) => player.slot === "G").length !== 1) notes.push("Pick 1 goalkeeper in the XI.");
      ["D", "M", "A"].forEach((slot) => {
        const have = xi.filter((player) => player.slot === slot).length;
        if (have !== shape[slot]) notes.push(`${state.formation} needs ${shape[slot]} ${slot}.`);
      });
      if (!xi.some((player) => player.captain)) notes.push("Choose a captain.");
      if (!state.squad.some((player) => player.vice)) notes.push("Choose a vice-captain.");
    }
    return notes;
  }

  function canSign(state, player, matches, now = new Date()) {
    if (state.squad.some((item) => item.id === player.id)) return "Already in the squad.";
    if ((SQUAD[player.slot] || 0) <= state.squad.filter((item) => item.slot === player.slot).length) return "That position is full.";
    if (clubCount(state, player.club) >= CLUB_CAP) return `Only ${CLUB_CAP} players from ${player.club}.`;
    if (spent(state) + Number(player.price) > CORE.BUDGET + 0.001) return "Not enough budget.";
    if (state.built && locked(matches, now) && !["wildcard1", "wildcard2", "freehit"].includes(state.chipThisWeek)) return "The deadline has passed.";
    return "";
  }

  function applyFormation(state) {
    const shape = FORMATIONS[state.formation] || FORMATIONS["4-3-3"];
    const picked = { G: 0, D: 0, M: 0, A: 0 };
    const order = [...state.squad.filter((player) => player.xi), ...state.squad.filter((player) => !player.xi)];
    order.forEach((player) => {
      const cap = player.slot === "G" ? 1 : shape[player.slot] || 0;
      player.xi = picked[player.slot] < cap;
      if (player.xi) picked[player.slot] += 1;
      if (!player.xi && player.captain) player.captain = false;
    });
  }

  function rememberUndo(state) {
    state.undo = {
      squad: JSON.parse(JSON.stringify(state.squad)),
      transfersThisWeek: state.transfersThisWeek,
      freeTransfers: state.freeTransfers,
      chipThisWeek: state.chipThisWeek,
    };
  }

  function rollback(state) {
    if (!state.undo) return "Nothing to undo.";
    state.squad = state.undo.squad;
    state.transfersThisWeek = state.undo.transfersThisWeek;
    state.freeTransfers = state.undo.freeTransfers;
    state.chipThisWeek = state.undo.chipThisWeek;
    state.undo = null;
    state.transferLog.unshift({ at: Date.now(), week: state.weekKey, in: "Rollback", out: "", price: 0 });
    return "";
  }

  function logSub(state, text) {
    state.subLog = [{ at: Date.now(), text }, ...(state.subLog || [])].slice(0, 20);
  }

  function sign(state, player) {
    rememberUndo(state);
    const starting = state.squad.filter((item) => item.xi && item.slot === player.slot).length;
    const shape = FORMATIONS[state.formation] || FORMATIONS["4-3-3"];
    const cap = player.slot === "G" ? 1 : shape[player.slot];
    state.squad.push({
      ...player,
      xi: starting < cap && state.squad.filter((item) => item.xi).length < 11,
      captain: state.squad.length === 0,
      vice: state.squad.length === 1,
    });
    if (state.built) state.transfersThisWeek += 1;
    if (state.squad.length >= 15) state.built = true;
    state.transferLog.unshift({ at: Date.now(), week: state.weekKey, in: player.name, out: "", price: player.price });
    unlock(state);
    return state;
  }

  function sell(state, id) {
    rememberUndo(state);
    const player = state.squad.find((item) => item.id === id);
    if (!player) return state;
    state.squad = state.squad.filter((item) => item.id !== id);
    if (state.built) state.transfersThisWeek += 1;
    state.transferLog.unshift({ at: Date.now(), week: state.weekKey, in: "", out: player.name, price: player.price });
    return state;
  }

  function hit(state) {
    if (["wildcard1", "wildcard2", "freehit"].includes(state.chipThisWeek)) return 0;
    if (!state.built) return 0;
    return Math.max(0, state.transfersThisWeek - state.freeTransfers) * HIT;
  }

  function chipAvailable(state, id, now = new Date()) {
    if (state.chips[id]) return false;
    if (state.chipThisWeek) return false;
    const week = weekNumber(now);
    if (id === "wildcard1" && week > 19) return false;
    if (id === "wildcard2" && week <= 19) return false;
    return true;
  }

  function playChip(state, id, matches, now = new Date()) {
    if (!chipAvailable(state, id, now)) return "That chip is not available.";
    if (locked(matches, now)) return "Chips must be played before the deadline.";
    if (id === "freehit") state.freeHitBackup = JSON.parse(JSON.stringify(state.squad));
    state.chipThisWeek = id;
    state.chips[id] = state.weekKey || CORE.weekKey(now);
    unlock(state);
    return "";
  }

  function roll(state, weekPoints, matches, now = new Date()) {
    const key = CORE.weekKey(now);
    if (!state.weekKey) {
      state.weekKey = key;
      return state;
    }
    if (state.weekKey === key) return state;
    const points = Math.max(0, (weekPoints || 0) - hit(state));
    state.history.unshift({
      week: state.weekKey,
      points,
      chip: state.chipThisWeek,
      captain: state.squad.find((player) => player.captain)?.name || "",
      transfers: state.transfersThisWeek,
      squad: state.squad.map((player) => ({
        name: player.name,
        slot: player.slot,
        price: player.price,
        xi: !!player.xi,
        captain: !!player.captain,
        vice: !!player.vice,
      })),
    });
    if (state.chipThisWeek === "freehit" && state.freeHitBackup) {
      state.squad = state.freeHitBackup;
      state.freeHitBackup = null;
    }
    const leftover = Math.max(0, state.freeTransfers - state.transfersThisWeek);
    state.freeTransfers = ["wildcard1", "wildcard2"].includes(state.chipThisWeek) ? 1 : Math.min(2, 1 + leftover);
    state.transfersThisWeek = 0;
    state.chipThisWeek = null;
    state.weekKey = key;
    unlock(state);
    return state;
  }

  function netPoints(state, raw) {
    return (Number(raw) || 0) - hit(state);
  }

  function suggest(state) {
    const xi = state.squad.filter((player) => player.xi);
    const captain = [...xi].sort((a, b) => (b.form || 0) - (a.form || 0) || (b.price || 0) - (a.price || 0))[0];
    const injured = state.squad.filter((player) => ["injured", "suspended", "unavailable"].includes(player.status));
    return {
      captain: captain ? captain.name : "",
      formation: state.formation,
      sell: injured.map((player) => player.name),
      note: injured.length ? `${injured[0].name} is ${injured[0].status}.` : "No flagged players in the squad.",
    };
  }

  function fixturesFor(matches, now = new Date()) {
    const keySet = new Set();
    const start = CORE.weekKey(now);
    for (let day = 0; day < 7; day += 1) {
      const date = new Date(Date.parse(`${start}T12:00:00Z`) + day * 86400000);
      keySet.add(date.toISOString().slice(0, 10));
    }
    return (matches || []).filter((match) => {
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(match.start));
      return keySet.has(day) || CORE.inThisWeek(match.start, now);
    });
  }

  const HARD_CLUBS = ["manchester city", "arsenal", "liverpool", "chelsea", "real madrid", "barcelona", "atletico", "bayern", "paris", "inter", "juventus", "napoli", "dortmund"];
  const EASY_CLUBS = ["southampton", "ipswich", "leicester", "valladolid", "leganes", "getafe", "cagliari", "empoli", "bochum", "holstein"];

  function rateOpponent(name) {
    const club = String(name || "").toLowerCase();
    if (HARD_CLUBS.some((hard) => club.includes(hard))) return 5;
    if (EASY_CLUBS.some((easy) => club.includes(easy))) return 2;
    return 3;
  }

  function difficulty(matches, club, now = new Date()) {
    const name = String(club || "").toLowerCase();
    const games = fixturesFor(matches, now).filter((match) => String(match.home).toLowerCase().includes(name) || String(match.away).toLowerCase().includes(name));
    if (!games.length) return { label: "Blank", games: 0, rating: 0, fixtures: [] };
    const fixtures = games.map((match) => {
      const home = String(match.home);
      const away = String(match.away);
      const atHome = home.toLowerCase().includes(name);
      const opponent = atHome ? away : home;
      let rating = rateOpponent(opponent);
      if (atHome) rating = Math.max(1, rating - 1);
      return { opponent, atHome, rating, status: match.status, id: match.id };
    });
    const rating = Math.max(1, Math.round(fixtures.reduce((sum, game) => sum + game.rating, 0) / fixtures.length));
    return { label: games.length > 1 ? "Double" : "Single", games: games.length, rating, fixtures };
  }

  function predict(player, rating) {
    const form = Number(player.form) || 0;
    const ease = rating ? (6 - rating) / 3 : 1;
    return Math.round(form * ease * 10) / 10;
  }

  function teamRating(state) {
    if (!state.squad.length) return 0;
    const total = state.squad.reduce((sum, player) => sum + (Number(player.price) || 0), 0);
    return Math.round((total / state.squad.length) * 10) / 10;
  }

  function notices(state, ctx) {
    const out = [];
    const now = Date.now();
    const deadline = CORE.deadlineMs(ctx?.matches || [], new Date(), offset());
    const soon = deadline && deadline > now && deadline - now < 2 * 3600000;
    if (state.notify?.deadline && soon) out.push({ key: `deadline-${state.weekKey}`, title: "Deadline", body: "The fantasy deadline is inside two hours." });
    if (state.notify?.chip && soon && state.built && !state.chipThisWeek) out.push({ key: `chip-${state.weekKey}`, title: "Chip reminder", body: "You can still play a chip before the deadline." });
    if (state.notify?.lineup && state.built && !state.squad.some((player) => player.captain)) out.push({ key: `captain-${state.weekKey}`, title: "Captain reminder", body: "Pick a captain before the deadline." });
    if (state.notify?.lineup && state.squad.length && state.squad.length < 15) out.push({ key: `squad-${state.squad.length}`, title: "Team submission", body: `${state.squad.length} of 15 players are in the squad.` });
    state.squad.forEach((player) => {
      if (state.notify?.news && ["injured", "suspended", "unavailable", "doubt"].includes(player.status)) {
        out.push({ key: `flag-${player.id}-${player.status}`, title: player.status === "suspended" ? "Suspension" : "Injury", body: `${player.name} is ${player.status}.${player.news ? ` ${player.news}` : ""}` });
      }
      const change = Number(player.priceChange) || 0;
      if (state.notify?.price && change) {
        out.push({ key: `price-${player.id}-${change}`, title: change > 0 ? "Price rise" : "Price fall", body: `${player.name} ${change > 0 ? "rose" : "fell"} ${Math.abs(change).toFixed(1)}.` });
      }
    });
    (ctx?.postponed || rules.postponed || []).forEach((id) => {
      if (state.notify?.news) out.push({ key: `postponed-${id}`, title: "Fixture change", body: `A match on your list was marked postponed (${id}).` });
    });
    return out;
  }

  function unlock(state) {
    const have = new Set(state.achievements.map((item) => item.id));
    const add = (id, name) => {
      if (have.has(id)) return;
      state.achievements.unshift({ id, name, at: Date.now() });
    };
    if (state.squad.length) add("first", "First signing");
    if (state.squad.length >= 15) add("full", "Full squad");
    if (state.squad.some((player) => player.captain)) add("captain", "Captain chosen");
    if (state.history.some((week) => week.points >= 50)) add("fifty", "50-point week");
    if (state.leagueCodes.length) add("league", "Joined a league");
    if (Object.values(state.chips).some(Boolean)) add("chip", "Chip played");
    if (state.history.length >= 2) add("streak", "Back to back weeks");
    const best = state.history.reduce((max, week) => Math.max(max, week.points || 0), 0);
    if (best >= 70) add("huge", "Huge gameweek");
    if ((state.watchlist || []).length) add("watch", "Watchlist started");
    if ((state.compareIds || []).length >= 2) add("compare", "Players compared");
    if ((state.planner || []).length) add("plan", "Planner used");
    if ((state.draftSquad || []).length >= 15) add("draft", "Draft completed");
    if ((state.corrections || []).length) add("correct", "Points correction filed");
    if (state.privacy === "private") add("private", "Private manager");
    if ((state.transferLog || []).length >= 5) add("market", "Active in the market");
  }

  function records(state) {
    const scores = state.history.map((week) => week.points || 0);
    const total = scores.reduce((sum, value) => sum + value, 0);
    return {
      total,
      weeks: scores.length,
      average: scores.length ? Math.round((total / scores.length) * 10) / 10 : 0,
      best: scores.length ? Math.max(...scores) : 0,
      captainPoints: state.history.filter((week) => week.captain).length,
    };
  }

  root.NINETY_FANTASY_GAME = {
    FORMATIONS,
    CLUB_CAP,
    SQUAD,
    HIT,
    blank,
    load,
    save,
    spent,
    issues,
    canSign,
    sign,
    sell,
    hit,
    chipAvailable,
    playChip,
    applyFormation,
    roll,
    netPoints,
    suggest,
    fixturesFor,
    difficulty,
    unlock,
    records,
    weekNumber,
    locked,
    configure,
    offset,
    rollback,
    logSub,
    predict,
    teamRating,
    notices,
    rules: () => rules,
  };

  if (typeof process !== "undefined" && process.argv?.includes("--self-test")) {
    const state = blank();
    state.teamName = "North Bank";
    state.built = true;
    state.freeTransfers = 1;
    const player = { id: "1", name: "A", club: "Arsenal", slot: "M", price: 10 };
    if (canSign(state, player, [], new Date())) throw new Error("sign should be allowed");
    sign(state, player);
    if (state.transfersThisWeek !== 1) throw new Error("transfer count");
    sign(state, { id: "2", name: "B", club: "Arsenal", slot: "M", price: 10 });
    sign(state, { id: "3", name: "C", club: "Arsenal", slot: "M", price: 10 });
    const blocked = canSign(state, { id: "4", name: "D", club: "Arsenal", slot: "D", price: 8 }, [], new Date());
    if (!blocked.includes("3")) throw new Error(blocked);
    if (hit(state) !== 8) throw new Error(`hit ${hit(state)}`);
    state.chipThisWeek = "wildcard1";
    if (hit(state) !== 0) throw new Error("wildcard hit");
    console.log("fantasy game self-test ok");
  }
})(typeof window !== "undefined" ? window : globalThis);
