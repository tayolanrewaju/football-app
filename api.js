(function () {
  const LEAGUES = [
    { id: "pl", name: "Premier League", slug: "eng.1", country: "England" },
    { id: "ll", name: "La Liga", slug: "esp.1", country: "Spain" },
    { id: "sa", name: "Serie A", slug: "ita.1", country: "Italy" },
    { id: "bl", name: "Bundesliga", slug: "ger.1", country: "Germany" },
    { id: "l1", name: "Ligue 1", slug: "fra.1", country: "France" },
    { id: "ucl", name: "Champions League", slug: "uefa.champions", country: "Europe" },
  ];

  // Forced coloured league marks (dark variants vanish on black UI)
  const LEAGUE_LOGOS = {
    pl: "https://a.espncdn.com/i/leaguelogos/soccer/500/23.png",
    ll: "https://a.espncdn.com/i/leaguelogos/soccer/500/15.png",
    sa: "https://a.espncdn.com/i/leaguelogos/soccer/500/12.png",
    bl: "https://a.espncdn.com/i/leaguelogos/soccer/500/10.png",
    l1: "https://a.espncdn.com/i/leaguelogos/soccer/500/9.png",
    ucl: "https://a.espncdn.com/i/leaguelogos/soccer/500/2.png",
  };

  const cache = {
    teamsByLeague: {},
    matchesByLeague: {},
    leagueMeta: {},
    teamDetails: {},
    rosters: {},
    schedules: {},
    players: {},
  };

  function proxyUrl(kind, pathAndQuery) {
    const clean = String(pathAndQuery).replace(/^\//, "");
    return `/proxy/espn/${kind}/${clean}`;
  }

  function logoFrom(entity, { preferColor = true } = {}) {
    if (!entity) return null;
    if (typeof entity.logo === "string" && entity.logo) return entity.logo;
    if (!entity.logos?.length) {
      if (entity.id) return `https://a.espncdn.com/i/teamlogos/soccer/500/${entity.id}.png`;
      return null;
    }
    const def = entity.logos.find((l) => l.rel?.includes("default") && !l.rel?.includes("dark"));
    const anyDef = entity.logos.find((l) => l.rel?.includes("default"));
    const dark = entity.logos.find((l) => l.rel?.includes("dark"));
    if (preferColor) return (def || anyDef || entity.logos[0] || dark)?.href || null;
    return (dark || def || anyDef || entity.logos[0])?.href || null;
  }

  function teamLogo(team) {
    if (!team) return null;
    return (
      logoFrom(team) ||
      (team.id ? `https://a.espncdn.com/i/teamlogos/soccer/500/${team.id}.png` : null)
    );
  }

  function mapStatus(espnStatus) {
    const name = espnStatus?.type?.name || "";
    const state = espnStatus?.type?.state || "";
    if (state === "in" || name.includes("STATUS_IN_PROGRESS") || name.includes("STATUS_HALFTIME")) {
      return "Live";
    }
    if (state === "post" || name.includes("STATUS_FULL_TIME") || name.includes("STATUS_FINAL")) {
      return "FT";
    }
    return "Upcoming";
  }

  function clockFrom(espnStatus, status, dateIso) {
    if (status === "Live") {
      return espnStatus?.displayClock || espnStatus?.type?.shortDetail || espnStatus?.type?.detail || "Live";
    }
    if (status === "FT") return "FT";
    if (dateIso) {
      try {
        return new Intl.DateTimeFormat("en-GB", {
          weekday: "short",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Europe/London",
        }).format(new Date(dateIso));
      } catch {
        /* fall through */
      }
    }
    return espnStatus?.type?.shortDetail || espnStatus?.type?.detail || "Scheduled";
  }

  async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  function yyyymmdd(date) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    const d = String(date.getUTCDate()).padStart(2, "0");
    return `${y}${m}${d}`;
  }

  function upcomingDateKeys(days = 21) {
    const keys = [];
    const start = new Date();
    for (let i = 0; i < days; i += 1) {
      const dt = new Date(start);
      dt.setUTCDate(start.getUTCDate() + i);
      keys.push(yyyymmdd(dt));
    }
    return keys;
  }

  function dateWindowKeys(past = 7, future = 7) {
    const keys = [];
    const start = new Date();
    for (let i = -past; i <= future; i += 1) {
      const dt = new Date(start);
      dt.setUTCDate(start.getUTCDate() + i);
      keys.push(yyyymmdd(dt));
    }
    return keys;
  }

  function flattenStats(statistics) {
    const out = [];
    const cats = statistics?.splits?.categories || [];
    for (const cat of cats) {
      for (const s of cat.stats || []) {
        out.push({
          category: cat.displayName || cat.name || "",
          name: s.name,
          label: s.displayName || s.shortDisplayName || s.abbreviation || s.name,
          short: s.abbreviation || s.shortDisplayName || s.name,
          value: s.displayValue != null ? s.displayValue : s.value,
          raw: typeof s.value === "number" ? s.value : Number(s.value) || 0,
        });
      }
    }
    return out;
  }

  function pickStat(stats, names) {
    const list = Array.isArray(names) ? names : [names];
    for (const name of list) {
      const hit = stats.find((s) => s.name === name);
      if (hit) return hit.raw;
    }
    return 0;
  }

  function mapPlayer(p, groupPos = "") {
    const stats = flattenStats(p.statistics);
    const position =
      p.position?.abbreviation || p.position?.displayName || p.position?.name || groupPos || "";
    const headshot =
      p.headshot?.href ||
      p.headshot?.href ||
      (p.id ? `https://a.espncdn.com/i/headshots/soccer/players/full/${p.id}.png` : null);
    return {
      id: String(p.id || ""),
      name: p.displayName || p.fullName || p.name,
      number: p.jersey || p.displayJersey || "",
      position,
      positionName: p.position?.displayName || position,
      age: p.age || null,
      height: p.displayHeight || "",
      nationality: p.citizenship || p.flag?.alt || "",
      headshot,
      stats,
      appearances: pickStat(stats, "appearances"),
      goals: pickStat(stats, "totalGoals"),
      assists: pickStat(stats, ["goalAssists", "assists"]),
      yellowCards: pickStat(stats, "yellowCards"),
      redCards: pickStat(stats, "redCards"),
      saves: pickStat(stats, "saves"),
      shots: pickStat(stats, "totalShots"),
      shotsOnTarget: pickStat(stats, "shotsOnTarget"),
    };
  }

  function positionLine(pos) {
    const p = String(pos || "").toUpperCase();
    if (p === "G" || p === "GK" || p.includes("GOAL")) return "gk";
    if (p === "DM" || p.startsWith("DM") || p.includes("CDM")) return "mid";
    if (
      ["D", "DF", "CB", "LB", "RB", "LWB", "RWB", "DEF", "LCB", "RCB"].includes(p) ||
      p.startsWith("CD") ||
      p.includes("BACK") ||
      p.includes("DEF")
    )
      return "def";
    if (/^(CM|LM|RM|AM|DM|CAM|CDM|MF|MID)\b/.test(p) || ["M", "MF", "CM", "DM", "AM", "CDM", "CAM", "LM", "RM", "MID"].includes(p) || p.includes("MID"))
      return "mid";
    return "fwd";
  }

  function buildFormation(players) {
    const pools = { gk: [], def: [], mid: [], fwd: [] };
    for (const p of players || []) {
      pools[positionLine(p.position)].push(p);
    }
    const byApps = (a, b) => (b.appearances || 0) - (a.appearances || 0) || String(a.name).localeCompare(b.name);
    Object.values(pools).forEach((arr) => arr.sort(byApps));

    const take = (key, n) => pools[key].splice(0, n);
    let gk = take("gk", 1);
    let def = take("def", 4);
    let mid = take("mid", 3);
    let fwd = take("fwd", 3);

    // Fill gaps from remaining players by appearances
    const leftover = [...pools.gk, ...pools.def, ...pools.mid, ...pools.fwd].sort(byApps);
    const need = (arr, n) => {
      while (arr.length < n && leftover.length) arr.push(leftover.shift());
    };
    need(gk, 1);
    need(def, 4);
    need(mid, 3);
    need(fwd, 3);

    return {
      shape: "4-3-3",
      lines: [
        { key: "fwd", label: "Forwards", players: fwd },
        { key: "mid", label: "Midfield", players: mid },
        { key: "def", label: "Defence", players: def },
        { key: "gk", label: "Goalkeeper", players: gk },
      ],
      xi: [...fwd, ...mid, ...def, ...gk],
    };
  }

  function sideRank(position) {
    const p = String(position || "").toUpperCase();
    const wideLeft = ["LB", "LWB", "LM", "LW", "LF"].includes(p);
    const wideRight = ["RB", "RWB", "RM", "RW", "RF"].includes(p);
    if (p.includes("-L") || wideLeft) return wideLeft ? 0 : 1;
    if (p.includes("-R") || wideRight) return wideRight ? 4 : 3;
    return 2;
  }

  function depthRank(position) {
    const p = String(position || "").toUpperCase();
    if (positionLine(p) === "gk") return -1;
    if (/^(DM|CDM)/.test(p)) return 1;
    if (/^(AM|CAM|SS)/.test(p)) return 3;
    if (positionLine(p) === "def") return 0;
    if (/^(LW|RW|LF|RF)/.test(p)) return 4;
    if (/^(CM|LM|RM)/.test(p) || positionLine(p) === "mid") return 2;
    return 5;
  }

  function pitchFromLineup(lineup) {
    const starters = (lineup?.players || []).filter((player) => player.starter);
    if (!starters.length) return null;
    const shape = String(lineup.formation || "").trim();
    const parts = shape.split("-").map((part) => Number(part)).filter((count) => count > 0);
    const gk = starters.filter((player) => depthRank(player.position) < 0);
    const outfield = starters.filter((player) => depthRank(player.position) >= 0);
    outfield.sort((a, b) => depthRank(a.position) - depthRank(b.position) || sideRank(a.position) - sideRank(b.position) || String(a.name).localeCompare(String(b.name)));
    const expected = parts.reduce((sum, count) => sum + count, 0);
    const rows = [];
    if (parts.length && expected === outfield.length) {
      let cursor = 0;
      parts.forEach((count) => {
        rows.push(outfield.slice(cursor, cursor + count));
        cursor += count;
      });
    } else {
      const bands = new Map();
      outfield.forEach((player) => {
        const depth = depthRank(player.position);
        if (!bands.has(depth)) bands.set(depth, []);
        bands.get(depth).push(player);
      });
      [...bands.keys()].sort((a, b) => a - b).forEach((depth) => rows.push(bands.get(depth)));
    }
    rows.forEach((row) => row.sort((a, b) => sideRank(a.position) - sideRank(b.position) || String(a.name).localeCompare(String(b.name))));
    const attackFirst = [...rows].reverse();
    const lines = attackFirst.map((players, index) => ({
      key: index === 0 ? "fwd" : index === attackFirst.length - 1 ? "def" : "mid",
      players,
    }));
    if (gk.length) lines.push({ key: "gk", players: gk.slice(0, 1) });
    return { shape: shape || "XI", lines };
  }

  function mapEvent(event, leagueId) {
    const comp = event.competitions?.[0];
    const home = (comp?.competitors || []).find((c) => c.homeAway === "home");
    const away = (comp?.competitors || []).find((c) => c.homeAway === "away");
    const status = mapStatus(event.status);
    const homeTeam = home?.team || {};
    const awayTeam = away?.team || {};
    return {
      id: String(event.id),
      league: leagueId,
      home: homeTeam.displayName || "Home",
      away: awayTeam.displayName || "Away",
      homeId: String(homeTeam.id || ""),
      awayId: String(awayTeam.id || ""),
      homeLogo: teamLogo(homeTeam),
      awayLogo: teamLogo(awayTeam),
      homeColor: homeTeam.color ? `#${homeTeam.color}` : "#333",
      awayColor: awayTeam.color ? `#${awayTeam.color}` : "#333",
      homeScore: status === "Upcoming" ? null : Number(home?.score ?? 0),
      awayScore: status === "Upcoming" ? null : Number(away?.score ?? 0),
      status,
      minute: status === "Live" ? clockFrom(event.status, status) : null,
      kickoff: clockFrom(event.status, status, event.date),
      start: event.date,
    };
  }

  async function loadLeagueTeams(league) {
    if (cache.teamsByLeague[league.id]?.length) return cache.teamsByLeague[league.id];
    const data = await fetchJson(proxyUrl("site", `apis/site/v2/sports/soccer/${league.slug}/teams`));
    const raw = data.sports?.[0]?.leagues?.[0]?.teams?.map((t) => t.team) || [];
    cache.leagueMeta[league.id] = {
      ...league,
      logo: LEAGUE_LOGOS[league.id] || logoFrom(data.sports?.[0]?.leagues?.[0]) || null,
    };
    const teams = raw
      .map((t) => ({
        id: String(t.id),
        espnId: String(t.id),
        name: t.displayName || t.name,
        short: t.abbreviation || t.shortDisplayName || "",
        league: league.id,
        color: t.color ? `#${t.color}` : "#888",
        logo: teamLogo(t),
        slug: league.slug,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    cache.teamsByLeague[league.id] = teams;
    return teams;
  }

  function sortMatches(list) {
    return [...list].sort((a, b) => {
      const rank = (s) => (s === "Live" ? 0 : s === "Upcoming" ? 1 : 2);
      const ra = rank(a.status) - rank(b.status);
      if (ra) return ra;
      return String(a.start || "").localeCompare(String(b.start || ""));
    });
  }

  function enrichMatchLogos(leagueId, matches) {
    const teams = cache.teamsByLeague[leagueId] || [];
    const byTeamId = new Map(teams.map((t) => [t.id, t]));
    for (const match of matches) {
      const home = byTeamId.get(match.homeId);
      const away = byTeamId.get(match.awayId);
      if (!match.homeLogo && home) match.homeLogo = home.logo;
      if (!match.awayLogo && away) match.awayLogo = away.logo;
      if (!match.homeLogo && match.homeId) {
        match.homeLogo = `https://a.espncdn.com/i/teamlogos/soccer/500/${match.homeId}.png`;
      }
      if (!match.awayLogo && match.awayId) {
        match.awayLogo = `https://a.espncdn.com/i/teamlogos/soccer/500/${match.awayId}.png`;
      }
      if (home?.color) match.homeColor = home.color;
      if (away?.color) match.awayColor = away.color;
    }
    return matches;
  }

  async function fetchScoreboardBags(league, dateKeys) {
    const urls = dateKeys.length
      ? dateKeys.map((d) =>
          proxyUrl("site", `apis/site/v2/sports/soccer/${league.slug}/scoreboard?dates=${d}`)
        )
      : [proxyUrl("site", `apis/site/v2/sports/soccer/${league.slug}/scoreboard`)];
    return Promise.all(
      urls.map(async (url) => {
        try {
          return await fetchJson(url);
        } catch {
          return null;
        }
      })
    );
  }

  function collectEvents(league, bags) {
    const byId = new Map();
    for (const data of bags) {
      if (!data) continue;
      if (!cache.leagueMeta[league.id]?.logo) {
        cache.leagueMeta[league.id] = {
          ...league,
          logo: LEAGUE_LOGOS[league.id] || logoFrom(data.leagues?.[0]) || null,
        };
      }
      for (const event of data.events || []) {
        byId.set(String(event.id), mapEvent(event, league.id));
      }
    }
    cache.leagueMeta[league.id] = {
      ...league,
      ...(cache.leagueMeta[league.id] || {}),
      logo: LEAGUE_LOGOS[league.id] || cache.leagueMeta[league.id]?.logo || null,
    };
    return enrichMatchLogos(league.id, sortMatches([...byId.values()]));
  }

  /** Fast path: today's board only (one request per league). */
  async function loadLeagueMatchesToday(league) {
    const bags = await fetchScoreboardBags(league, []);
    const matches = collectEvents(league, bags);
    cache.matchesByLeague[league.id] = matches;
    return matches;
  }

  /** Last week through next week, one board per day. */
  async function loadLeagueMatches(league, { past = 7, future = 7, days } = {}) {
    const dates = dateWindowKeys(past, days != null ? days : future);
    const bags = await fetchScoreboardBags(league, dates);
    const matches = collectEvents(league, bags);
    cache.matchesByLeague[league.id] = matches;
    return matches;
  }

  async function loadMatchesQuick() {
    const leagues = [];
    const matches = [];
    const results = await Promise.all(
      LEAGUES.map(async (league) => {
        try {
          const leagueMatches = await loadLeagueMatchesToday(league);
          return {
            league: cache.leagueMeta[league.id] || { ...league, logo: LEAGUE_LOGOS[league.id] },
            matches: leagueMatches,
          };
        } catch (err) {
          console.warn("Failed quick matches", league.id, err);
          return { league: { ...league, logo: LEAGUE_LOGOS[league.id] }, matches: [] };
        }
      })
    );
    for (const row of results) {
      leagues.push(row.league);
      matches.push(...row.matches);
    }
    return { leagues, matches, teams: [] };
  }

  async function loadAll({ past = 7, future = 7, days } = {}) {
    const teams = [];
    const matches = [];
    const leagues = [];
    // Matches first (parallel), teams in parallel separately — don't block scores on squads
    const matchResults = await Promise.all(
      LEAGUES.map(async (league) => {
        try {
          const leagueMatches = await loadLeagueMatches(league, { past, future: days != null ? days : future });
          return {
            league: cache.leagueMeta[league.id] || { ...league, logo: LEAGUE_LOGOS[league.id] },
            matches: leagueMatches,
          };
        } catch (err) {
          console.warn("Failed league matches", league.id, err);
          return { league: { ...league, logo: LEAGUE_LOGOS[league.id] }, matches: [] };
        }
      })
    );
    for (const row of matchResults) {
      leagues.push(row.league);
      matches.push(...row.matches);
    }

    const teamResults = await Promise.all(
      LEAGUES.map(async (league) => {
        try {
          return await loadLeagueTeams(league);
        } catch (err) {
          console.warn("Failed league teams", league.id, err);
          return [];
        }
      })
    );
    for (const leagueTeams of teamResults) teams.push(...leagueTeams);

    // Re-enrich logos now that teams are warm
    for (const league of LEAGUES) {
      const list = cache.matchesByLeague[league.id];
      if (list) enrichMatchLogos(league.id, list);
    }

    const byId = new Map();
    for (const m of matches) byId.set(m.id, m);
    for (const league of LEAGUES) {
      for (const m of cache.matchesByLeague[league.id] || []) byId.set(m.id, m);
    }
    return { leagues, teams, matches: sortMatches([...byId.values()]) };
  }

  async function loadTeamDetail(slug, teamId) {
    const key = `${slug}:${teamId}`;
    if (cache.teamDetails[key]) return cache.teamDetails[key];
    const data = await fetchJson(
      proxyUrl("site", `apis/site/v2/sports/soccer/${slug}/teams/${teamId}`)
    );
    const t = data.team || {};
    const stats = t.record?.items?.[0]?.stats || [];
    const get = (name) => stats.find((s) => s.name === name)?.value;
    const detail = {
      id: String(t.id || teamId),
      name: t.displayName || t.name,
      short: t.abbreviation,
      logo: teamLogo(t),
      color: t.color ? `#${t.color}` : "#888",
      record: t.record?.items?.[0]?.summary || "",
      rank: get("rank"),
      played: get("gamesPlayed"),
      wins: get("wins"),
      draws: get("ties"),
      losses: get("losses"),
      points: get("points"),
      gf: get("pointsFor"),
      ga: get("pointsAgainst"),
      stadium: t.franchise?.venue?.fullName || t.nextEvent?.[0]?.competitions?.[0]?.venue?.fullName || "—",
      standingSummary: t.standingSummary || "",
      slug: t.defaultLeagueSlug || slug,
    };
    cache.teamDetails[key] = detail;
    return detail;
  }

  async function loadRoster(slug, teamId) {
    const key = `${slug}:${teamId}`;
    if (cache.rosters[key]) return cache.rosters[key];
    const data = await fetchJson(
      proxyUrl("site", `apis/site/v2/sports/soccer/${slug}/teams/${teamId}/roster`)
    );
    const athletes = data.athletes || [];
    let flat = [];
    const grouped = athletes.length && Array.isArray(athletes[0]?.items) && athletes[0].items.length;
    if (grouped) {
      flat = athletes.flatMap((g) =>
        (g.items || []).map((p) => mapPlayer(p, g.position || g.displayName || ""))
      );
    } else {
      flat = athletes.map((p) => mapPlayer(p));
    }
    const coachEntry = Array.isArray(data.coach) ? data.coach[0] : data.coach;
    const coach =
      coachEntry?.displayName ||
      [coachEntry?.firstName, coachEntry?.lastName].filter(Boolean).join(" ") ||
      "—";
    const players = flat.filter((p) => p.name);
    const roster = { players, coach, formation: buildFormation(players) };
    cache.rosters[key] = roster;
    return roster;
  }

  async function loadPlayerStats(playerId, fallbackPlayer = null) {
    const id = String(playerId || "");
    if (!id) return fallbackPlayer;
    if (cache.players[id]) return cache.players[id];

    let overview = null;
    let athlete = null;
    try {
      overview = await fetchJson(
        proxyUrl("site", `apis/common/v3/sports/soccer/athletes/${id}/overview`)
      );
    } catch {
      overview = null;
    }
    try {
      const data = await fetchJson(
        proxyUrl("web", `apis/common/v3/sports/soccer/athletes/${id}`)
      );
      athlete = data.athlete || null;
    } catch {
      athlete = null;
    }

    const base = fallbackPlayer ? { ...fallbackPlayer } : { id, name: "Player", stats: [] };
    if (athlete) {
      base.name = athlete.displayName || athlete.fullName || base.name;
      base.number = athlete.jersey || base.number;
      base.position = athlete.position?.abbreviation || base.position;
      base.positionName = athlete.position?.displayName || base.positionName;
      base.age = athlete.age || base.age;
      base.height = athlete.displayHeight || base.height;
      base.weight = athlete.displayWeight || base.weight;
      base.nationality = athlete.citizenship || base.nationality;
      base.headshot =
        athlete.headshot?.href ||
        base.headshot ||
        `https://a.espncdn.com/i/headshots/soccer/players/full/${id}.png`;
      base.teamName = athlete.team?.displayName || base.teamName || "";
    }

    const clubSlugs = ["eng.1", "esp.1", "ita.1", "ger.1", "fra.1", "usa.1", "ned.1", "por.1"];
    const splitList = Array.isArray(overview?.statistics?.splits) ? overview.statistics.splits : [];
    const chosenSplit =
      splitList.find((split) => clubSlugs.includes(split.leagueSlug)) ||
      [...splitList].sort((a, b) => Number(b.stats?.[0] || 0) - Number(a.stats?.[0] || 0))[0];
    if (chosenSplit?.stats?.length && overview?.statistics?.names) {
      const names = overview.statistics.names;
      const labels = overview.statistics.displayNames || overview.statistics.labels || names;
      base.stats = names.map((name, i) => ({
        category: chosenSplit.displayName || "Season",
        name,
        label: labels[i] || name,
        short: overview.statistics.labels?.[i] || name,
        value: chosenSplit.stats[i],
        raw: Number(chosenSplit.stats[i]) || 0,
      }));
      base.seasonLabel = chosenSplit.displayName || "This season";
      base.appearances = pickStat(base.stats, ["appearances", "starts"]) || base.appearances;
      base.goals = pickStat(base.stats, "totalGoals") || base.goals;
      base.assists = pickStat(base.stats, ["goalAssists", "assists"]) || base.assists;
      base.yellowCards = pickStat(base.stats, "yellowCards") || base.yellowCards;
      base.redCards = pickStat(base.stats, "redCards") || base.redCards;
      base.saves = pickStat(base.stats, "saves") || base.saves;
      base.shots = pickStat(base.stats, "totalShots") || base.shots;
      base.shotsOnTarget = pickStat(base.stats, ["shotsOnTarget", "shotsOnGoal"]) || base.shotsOnTarget;
    }

    // Prefer overview season split stats when richer
    const splitStats = !base.stats?.length && overview?.statistics?.splits?.categories
      ? flattenStats(overview.statistics)
      : null;
    if (splitStats?.length) {
      base.stats = splitStats;
      base.appearances = pickStat(splitStats, "appearances") || base.appearances;
      base.goals = pickStat(splitStats, "totalGoals") || base.goals;
      base.assists = pickStat(splitStats, ["goalAssists", "assists"]) || base.assists;
      base.yellowCards = pickStat(splitStats, "yellowCards") || base.yellowCards;
      base.redCards = pickStat(splitStats, "redCards") || base.redCards;
      base.saves = pickStat(splitStats, "saves") || base.saves;
      base.shots = pickStat(splitStats, "totalShots") || base.shots;
      base.shotsOnTarget = pickStat(splitStats, "shotsOnTarget") || base.shotsOnTarget;
    } else if (!base.stats?.length && overview?.statistics?.names && overview?.statistics?.splits) {
      // Compact overview format: names + splits.categories[].stats as parallel arrays sometimes
      const names = overview.statistics.names || [];
      const labels = overview.statistics.displayNames || overview.statistics.labels || names;
      const split = overview.statistics.splits?.categories?.[0] || overview.statistics.splits;
      const values = split?.stats || split?.statistics || [];
      if (Array.isArray(values) && values.length && typeof values[0] !== "object") {
        base.stats = names.map((name, i) => ({
          category: "Season",
          name,
          label: labels[i] || name,
          short: overview.statistics.labels?.[i] || name,
          value: values[i],
          raw: Number(values[i]) || 0,
        }));
      }
    }

    if (!base.stats?.length && fallbackPlayer?.stats?.length) {
      base.stats = fallbackPlayer.stats;
    }

    if (!base.seasonLabel) base.seasonLabel = "This season";
    cache.players[id] = base;
    return base;
  }

  async function loadSchedule(slug, teamId) {
    const key = `${slug}:${teamId}`;
    if (cache.schedules[key]) return cache.schedules[key];
    try {
      const data = await fetchJson(
        proxyUrl("site", `apis/site/v2/sports/soccer/${slug}/teams/${teamId}/schedule`)
      );
      const events = data.events || [];
      const played = events
        .filter((e) => e.competitions?.[0]?.status?.type?.state === "post")
        .slice(-5)
        .reverse();
      const lastFive = played.map((e) => {
        const comp = e.competitions[0];
        const home = comp.competitors.find((c) => c.homeAway === "home");
        const away = comp.competitors.find((c) => c.homeAway === "away");
        const self = comp.competitors.find((c) => String(c.team.id) === String(teamId));
        const opp = comp.competitors.find((c) => String(c.team.id) !== String(teamId));
        const hs = Number(home.score);
        const as = Number(away.score);
        let result = "D";
        if (self.homeAway === "home") result = hs > as ? "W" : hs < as ? "L" : "D";
        else result = as > hs ? "W" : as < hs ? "L" : "D";
        return {
          opp: opp.team.displayName,
          result,
          score: `${hs}-${as}`,
          home: self.homeAway === "home",
        };
      });
      const form = lastFive.map((g) => g.result).reverse();
      const upcoming = events
        .filter((e) => e.competitions?.[0]?.status?.type?.state === "pre")
        .slice(0, 5)
        .map((e) => mapEvent(e, "search"));
      const schedule = { lastFive, form, upcoming };
      cache.schedules[key] = schedule;
      return schedule;
    } catch {
      return { lastFive: [], form: [], upcoming: [] };
    }
  }

  async function loadMatchDetail(leagueId, eventId) {
    const league = LEAGUES.find((l) => l.id === leagueId) || COMPETITIONS.find((item) => item.id === leagueId);
    const slug = league?.slug || "eng.1";
    const data = await fetchJson(
      proxyUrl("site", `apis/site/v2/sports/soccer/${slug}/summary?event=${encodeURIComponent(eventId)}`)
    );
    const comp = data.header?.competitions?.[0] || {};
    const status = mapStatus(comp.status);
    const sides = {};
    for (const competitor of comp.competitors || []) {
      const team = competitor.team || {};
      const records = competitor.record || [];
      sides[competitor.homeAway] = {
        id: String(team.id || ""),
        name: team.displayName || competitor.homeAway,
        short: team.abbreviation || "",
        score: competitor.score == null || competitor.score === "" ? null : Number(competitor.score),
        logo: teamLogo(team),
        color: team.color ? `#${team.color}` : "#888",
        record: records.find((r) => r.type === "total")?.summary || "",
        points: records.find((r) => r.type === "points")?.summary || "",
        slug,
      };
    }
    const lineups = {};
    for (const block of data.rosters || []) {
      lineups[block.homeAway] = {
        formation: block.formation || "",
        players: (block.roster || []).map((p) => ({
          id: String(p.athlete?.id || ""),
          name: p.athlete?.displayName || p.athlete?.fullName || "Player",
          number: p.jersey || "",
          position: p.position?.abbreviation || "",
          positionName: p.position?.displayName || "",
          starter: !!p.starter,
          formationPlace: Number(p.formationPlace) || 0,
          headshot: p.athlete?.headshot?.href || "",
        })),
      };
    }
    const events = (data.keyEvents || [])
      .filter((event) => /goal|card|sub/i.test(event.type?.text || "") || event.scoringPlay)
      .map((event) => ({
        minute: event.clock?.displayValue || "",
        text: event.text || event.type?.text || "",
        type: event.type?.text || "",
        team: event.team?.displayName || "",
        scoring: !!event.scoringPlay,
      }))
      .filter((event) => event.text);
    const homeStats = data.boxscore?.teams?.find((t) => t.homeAway === "home")?.statistics || [];
    const awayStats = data.boxscore?.teams?.find((t) => t.homeAway === "away")?.statistics || [];
    const awayByName = new Map(awayStats.map((s) => [s.name, s.displayValue]));
    const wanted = ["possessionPct", "totalShots", "shotsOnTarget", "wonCorners", "foulsCommitted", "yellowCards", "redCards", "offsides", "saves"];
    const stats = homeStats
      .filter((s) => wanted.includes(s.name) && awayByName.has(s.name))
      .map((s) => ({ label: s.label || s.name, home: s.displayValue, away: awayByName.get(s.name) }));
    return {
      id: String(eventId),
      leagueId,
      leagueName: data.header?.league?.name || league?.name || "",
      status,
      clock: clockFrom(comp.status, status, comp.date),
      start: comp.date,
      venue: data.gameInfo?.venue?.fullName || "",
      city: data.gameInfo?.venue?.address?.city || "",
      attendance: data.gameInfo?.attendance || null,
      home: sides.home,
      away: sides.away,
      lineups,
      events,
      stats,
      article: data.article?.headline
        ? { headline: data.article.headline, description: data.article.description || "" }
        : null,
    };
  }

  async function loadTransferNews() {
    const bags = await Promise.all(
      LEAGUES.map(async (league) => {
        try {
          return await fetchJson(proxyUrl("site", `apis/site/v2/sports/soccer/${league.slug}/news?limit=8`));
        } catch {
          return null;
        }
      })
    );
    const seen = new Set();
    const articles = [];
    for (const bag of bags) {
      for (const article of bag?.articles || []) {
        const headline = article.headline || "";
        if (!headline || seen.has(headline)) continue;
        seen.add(headline);
        articles.push({
          headline,
          description: article.description || "",
          published: article.published || article.lastModified || "",
        });
      }
    }
    const isTransfer = (article) =>
      /transfer|rumour|rumor|sign|signing|bid|deal|contract|target|loan/i.test(
        `${article.headline} ${article.description}`
      );
    const hot = articles.filter(isTransfer);
    const pool = hot.length ? hot : articles;
    pool.sort((a, b) => String(b.published).localeCompare(String(a.published)));
    return pool.slice(0, 8);
  }

  async function searchTeams(query) {
    const q = String(query || "").trim();
    if (q.length < 2) return [];
    const data = await fetchJson(
      proxyUrl(
        "site",
        `apis/common/v3/search?query=${encodeURIComponent(q)}&limit=20&type=team`
      )
    );
    return (data.items || [])
      .filter((item) => item.type === "team" && (item.sport === "soccer" || !item.sport))
      .map((item) => ({
        id: String(item.id),
        espnId: String(item.id),
        name: item.displayName || item.name,
        short: item.abbreviation || "",
        league: item.defaultLeagueSlug || item.league || "",
        slug: item.defaultLeagueSlug || item.league || "eng.1",
        color: item.color ? `#${item.color}` : "#888",
        logo: teamLogo(item),
        label: item.label || item.league || "World",
      }));
  }

  async function searchPlayers(query) {
    const q = String(query || "").trim();
    if (q.length < 2) return [];
    const data = await fetchJson(
      proxyUrl("site", `apis/common/v3/search?query=${encodeURIComponent(q)}&limit=12&type=player`)
    );
    return (data.items || [])
      .filter((item) => item.type === "player" && (item.sport === "soccer" || !item.sport))
      .map((item) => {
        const team = item.teamRelationships?.[0]?.core || {};
        return {
          id: String(item.id),
          name: item.displayName || item.shortName || "Player",
          short: item.shortName || "",
          number: item.jersey || "",
          position: item.position?.abbreviation || "",
          positionName: item.position?.displayName || item.position?.name || "",
          teamId: team.id ? String(team.id) : "",
          teamName: team.displayName || team.name || "",
          teamShort: team.abbreviation || "",
          teamLogo: teamLogo(team),
          teamColor: team.color ? `#${String(team.color).replace("#", "")}` : "#888",
          leagueSlug: String(item.defaultLeagueSlug || "eng.1").toLowerCase(),
          label: item.label || team.displayName || "",
          headshot: `https://a.espncdn.com/i/headshots/soccer/players/full/${item.id}.png`,
        };
      });
  }

  function statMap(stats) {
    const out = {};
    for (const stat of stats || []) out[stat.name] = Number(stat.value) || 0;
    return out;
  }

  function minuteFromClock(clock) {
    const shown = String(clock?.displayValue || "");
    const match = shown.match(/(\d+)/);
    if (match) return Number(match[1]);
    if (clock?.value != null) return Math.round(Number(clock.value) / 60);
    return null;
  }

  function eventKind(event) {
    const type = String(event.type?.text || "");
    const text = String(event.text || "");
    const blob = `${type} ${text}`.toLowerCase();
    if (type.toLowerCase().includes("substitution") || /replaces/.test(blob)) return "sub";
    if (blob.includes("own goal")) return "own-goal";
    if (blob.includes("penalty") && blob.includes("save")) return "penalty-save";
    if (blob.includes("penalty") && (blob.includes("miss") || blob.includes("off target"))) return "penalty-miss";
    if (blob.includes("penalty") && (blob.includes("conced") || blob.includes("gives away"))) return "penalty-conceded";
    if (blob.includes("penalty") && (blob.includes("wins") || blob.includes("earns"))) return "penalty-won";
    if (type.toLowerCase().includes("goal") || event.scoringPlay) return "goal";
    if (blob.includes("woodwork") || blob.includes("crossbar") || blob.includes("the post") || blob.includes("the bar")) return "woodwork";
    return "";
  }

  async function loadMatchSheets(leagueId, eventId) {
    const league = LEAGUES.find((item) => item.id === leagueId);
    const slug = league?.slug || "eng.1";
    const data = await fetchJson(
      proxyUrl("site", `apis/site/v2/sports/soccer/${slug}/summary?event=${encodeURIComponent(eventId)}`)
    );
    const comp = data.header?.competitions?.[0] || {};
    const home = (comp.competitors || []).find((side) => side.homeAway === "home");
    const away = (comp.competitors || []).find((side) => side.homeAway === "away");
    const label = `${away?.team?.shortDisplayName || away?.team?.abbreviation || "Away"} ${away?.score ?? ""}–${home?.score ?? ""} ${home?.team?.shortDisplayName || home?.team?.abbreviation || "Home"}`;
    const events = (data.keyEvents || [])
      .map((event) => {
        const kind = eventKind(event);
        if (!kind) return null;
        const people = (event.participants || [])
          .map((person) => ({
            id: String(person.athlete?.id || ""),
            name: person.athlete?.displayName || "",
          }))
          .filter((person) => person.id);
        return {
          kind,
          minute: minuteFromClock(event.clock),
          text: event.text || "",
          outside: /outside (?:the |of the )?(?:penalty )?(?:box|area)/i.test(event.text || ""),
          penalty: /penalty/i.test(`${event.type?.text || ""} ${event.text || ""}`),
          people,
        };
      })
      .filter(Boolean);

    const players = [];
    for (const block of data.rosters || []) {
      for (const person of block.roster || []) {
        const stats = statMap(person.stats);
        const id = String(person.athlete?.id || "");
        if (!id) continue;
        let on = person.starter ? 0 : null;
        let off = null;
        for (const event of events) {
          if (event.kind !== "sub" || event.minute == null) continue;
          const [coming, going] = event.people;
          if (coming?.id === id) on = event.minute;
          if (going?.id === id) off = event.minute;
        }
        let minutes = 0;
        if (on != null) minutes = Math.max(0, (off == null ? 90 : off) - on);
        else if ((stats.appearances || 0) > 0) minutes = person.starter ? 90 : 1;
        const name = person.athlete?.displayName || person.athlete?.fullName || "Player";
        let assists = stats.goalAssists || 0;
        let penaltyWon = 0;
        let outsideBox = 0;
        let woodwork = 0;
        let penaltySaves = 0;
        let penaltyMiss = 0;
        let penaltyConceded = 0;
        const lowerName = name.toLowerCase();
        for (const event of events) {
          if (event.kind === "goal" && event.penalty) {
            const assisted = ((event.text.match(/assisted by ([^.]+)/i) || [])[1] || "").trim().toLowerCase();
            if (assisted && (lowerName === assisted || lowerName.endsWith(` ${assisted}`) || assisted.endsWith(lowerName))) {
              if (assists > 0) {
                assists -= 1;
                penaltyWon += 1;
              }
            }
          }
          const involved = event.people.some((one) => one.id === id);
          if (!involved) continue;
          if (event.kind === "goal" && event.outside && event.people[0]?.id === id) outsideBox += 1;
          if (event.kind === "woodwork") woodwork += 1;
          if (event.kind === "penalty-save") penaltySaves += 1;
          if (event.kind === "penalty-miss") penaltyMiss += 1;
          if (event.kind === "penalty-conceded") penaltyConceded += 1;
          if (event.kind === "penalty-won") penaltyWon += 1;
        }
        const defensiveActions =
          (stats.tackles || 0) +
          (stats.interceptions || 0) +
          (stats.totalClearances || 0) +
          (stats.clearances || 0) +
          (stats.blocks || 0) +
          (stats.blockedShots || 0) +
          (stats.recoveries || 0);
        players.push({
          id,
          name,
          position: person.position?.abbreviation || "",
          slot: null,
          headshot: person.athlete?.headshot?.href || `https://a.espncdn.com/i/headshots/soccer/players/full/${id}.png`,
          starter: !!person.starter,
          minutes,
          goals: stats.totalGoals || 0,
          assists,
          saves: stats.saves || 0,
          goalsConceded: stats.goalsConceded || 0,
          shotsOnTarget: stats.shotsOnTarget || 0,
          yellow: stats.yellowCards || 0,
          red: stats.redCards || 0,
          ownGoals: stats.ownGoals || 0,
          outsideBox,
          woodwork,
          penaltySaves,
          penaltyWon,
          penaltyMiss,
          penaltyConceded,
          defensiveActions,
        });
      }
    }
    return {
      id: String(eventId),
      start: comp.date,
      status: mapStatus(comp.status),
      label,
      players,
    };
  }

  async function quoteFantasy(player) {
    const params = new URLSearchParams({
      name: player?.name || "",
      club: player?.teamName || player?.club || "",
      position: player?.position || player?.positionName || "",
    });
    return fetchJson(`/api/fantasy/quote?${params.toString()}`);
  }

  const COMPETITIONS = [
    { id: "ucl", region: "Europe", country: "Europe", name: "Champions League", slug: "uefa.champions", kind: "cup", rank: 0 },
    { id: "uel", region: "Europe", country: "Europe", name: "Europa League", slug: "uefa.europa", kind: "cup", rank: 0 },
    { id: "uecl", region: "Europe", country: "Europe", name: "Conference League", slug: "uefa.europa.conf", kind: "cup", rank: 0 },
    { id: "usc", region: "Europe", country: "Europe", name: "Super Cup", slug: "uefa.super_cup", kind: "cup", rank: 0 },
    { id: "euro", region: "Europe", country: "Europe", name: "European Championship", slug: "uefa.euro", kind: "cup", rank: 0 },
    { id: "unl", region: "Europe", country: "Europe", name: "Nations League", slug: "uefa.nations", kind: "cup", rank: 0 },
    { id: "pl", region: "England", country: "England", name: "Premier League", slug: "eng.1", kind: "league", rank: 4 },
    { id: "efl", region: "England", country: "England", name: "Championship", slug: "eng.2", kind: "league", rank: 4 },
    { id: "fac", region: "England", country: "England", name: "FA Cup", slug: "eng.fa", kind: "cup", rank: 4 },
    { id: "carabao", region: "England", country: "England", name: "Carabao Cup", slug: "eng.league_cup", kind: "cup", rank: 4 },
    { id: "shield", region: "England", country: "England", name: "Community Shield", slug: "eng.charity", kind: "cup", rank: 4 },
    { id: "arg", region: "Argentina", country: "Argentina", name: "Liga Profesional", slug: "arg.1", kind: "league", rank: 1 },
    { id: "fra", region: "France", country: "France", name: "Ligue 1", slug: "fra.1", kind: "league", rank: 2 },
    { id: "esp", region: "Spain", country: "Spain", name: "La Liga", slug: "esp.1", kind: "league", rank: 3 },
    { id: "bra", region: "Brazil", country: "Brazil", name: "Brasileirão", slug: "bra.1", kind: "league", rank: 5 },
    { id: "por", region: "Portugal", country: "Portugal", name: "Primeira Liga", slug: "por.1", kind: "league", rank: 6 },
    { id: "ned", region: "Netherlands", country: "Netherlands", name: "Eredivisie", slug: "ned.1", kind: "league", rank: 7 },
    { id: "bel", region: "Belgium", country: "Belgium", name: "Pro League", slug: "bel.1", kind: "league", rank: 8 },
    { id: "ita", region: "Italy", country: "Italy", name: "Serie A", slug: "ita.1", kind: "league", rank: 9 },
    { id: "ger", region: "Germany", country: "Germany", name: "Bundesliga", slug: "ger.1", kind: "league", rank: 10 },
    { id: "uru", region: "Uruguay", country: "Uruguay", name: "Primera División", slug: "uru.1", kind: "league", rank: 14 },
    { id: "usa", region: "United States", country: "United States", name: "MLS", slug: "usa.1", kind: "league", rank: 15 },
    { id: "mex", region: "Mexico", country: "Mexico", name: "Liga MX", slug: "mex.1", kind: "league", rank: 16 },
    { id: "jpn", region: "Japan", country: "Japan", name: "J1 League", slug: "jpn.1", kind: "league", rank: 17 },
    { id: "sui", region: "Switzerland", country: "Switzerland", name: "Super League", slug: "sui.1", kind: "league", rank: 18 },
    { id: "den", region: "Denmark", country: "Denmark", name: "Superliga", slug: "den.1", kind: "league", rank: 21 },
    { id: "aut", region: "Austria", country: "Austria", name: "Bundesliga", slug: "aut.1", kind: "league", rank: 22 },
    { id: "aus", region: "Australia", country: "Australia", name: "A-League", slug: "aus.1", kind: "league", rank: 24 },
    { id: "ecu", region: "Ecuador", country: "Ecuador", name: "LigaPro", slug: "ecu.1", kind: "league", rank: 25 },
    { id: "tur", region: "Turkey", country: "Turkey", name: "Süper Lig", slug: "tur.1", kind: "league", rank: 27 },
    { id: "nor", region: "Norway", country: "Norway", name: "Eliteserien", slug: "nor.1", kind: "league", rank: 30 },
    { id: "sco", region: "Scotland", country: "Scotland", name: "Premiership", slug: "sco.1", kind: "league", rank: 34 },
    { id: "gre", region: "Greece", country: "Greece", name: "Super League", slug: "gre.1", kind: "league", rank: 38 },
    { id: "swe", region: "Sweden", country: "Sweden", name: "Allsvenskan", slug: "swe.1", kind: "league", rank: 39 },
    { id: "wal", region: "Wales", country: "Wales", name: "Cymru Premier", slug: "wal.1", kind: "league", rank: 41 },
    { id: "rou", region: "Romania", country: "Romania", name: "Liga 1", slug: "rou.1", kind: "league", rank: 42 },
    { id: "cze", region: "Czechia", country: "Czechia", name: "Czech First League", slug: "cze.1", kind: "league", rank: 37 },
    { id: "irl", region: "Ireland", country: "Ireland", name: "Premier Division", slug: "irl.1", kind: "league", rank: 52 },
    { id: "fin", region: "Finland", country: "Finland", name: "Veikkausliiga", slug: "fin.1", kind: "league", rank: 60 },
    { id: "nir", region: "Northern Ireland", country: "Northern Ireland", name: "Premiership", slug: "nir.1", kind: "league", rank: 62 },
    { id: "col", region: "Colombia", country: "Colombia", name: "Primera A", slug: "col.1", kind: "league", rank: 13 },
    { id: "chi", region: "Chile", country: "Chile", name: "Primera División", slug: "chi.1", kind: "league", rank: 45 },
    { id: "per", region: "Peru", country: "Peru", name: "Liga 1", slug: "per.1", kind: "league", rank: 46 },
    { id: "par", region: "Paraguay", country: "Paraguay", name: "Primera División", slug: "par.1", kind: "league", rank: 44 },
    { id: "crc", region: "Costa Rica", country: "Costa Rica", name: "Primera División", slug: "crc.1", kind: "league", rank: 51 },
    { id: "bol", region: "Bolivia", country: "Bolivia", name: "División Profesional", slug: "bol.1", kind: "league", rank: 55 },
    { id: "ven", region: "Venezuela", country: "Venezuela", name: "Primera División", slug: "ven.1", kind: "league", rank: 56 },
    { id: "hon", region: "Honduras", country: "Honduras", name: "Liga Nacional", slug: "hon.1", kind: "league", rank: 70 },
    { id: "gua", region: "Guatemala", country: "Guatemala", name: "Liga Nacional", slug: "gua.1", kind: "league", rank: 80 },
    { id: "slv", region: "El Salvador", country: "El Salvador", name: "Primera División", slug: "slv.1", kind: "league", rank: 82 },
    { id: "ksa", region: "Saudi Arabia", country: "Saudi Arabia", name: "Pro League", slug: "ksa.1", kind: "league", rank: 56 },
    { id: "chn", region: "China", country: "China", name: "Super League", slug: "chn.1", kind: "league", rank: 75 },
    { id: "ind", region: "India", country: "India", name: "Super League", slug: "ind.1", kind: "league", rank: 100 },
    { id: "isr", region: "Israel", country: "Israel", name: "Premier League", slug: "isr.1", kind: "league", rank: 72 },
    { id: "cyp", region: "Cyprus", country: "Cyprus", name: "First Division", slug: "cyp.1", kind: "league", rank: 68 },
    { id: "nga", region: "Nigeria", country: "Nigeria", name: "NPFL", slug: "nga.1", kind: "league", rank: 29 },
    { id: "gha", region: "Ghana", country: "Ghana", name: "Premier League", slug: "gha.1", kind: "league", rank: 70 },
    { id: "rsa", region: "South Africa", country: "South Africa", name: "Premiership", slug: "rsa.1", kind: "league", rank: 57 },
    { id: "ken", region: "Kenya", country: "Kenya", name: "Premier League", slug: "ken.1", kind: "league", rank: 100 },
    { id: "tha", region: "Thailand", country: "Thailand", name: "Thai League", slug: "tha.1", kind: "league", rank: 100 },
    { id: "idn", region: "Indonesia", country: "Indonesia", name: "Super League", slug: "idn.1", kind: "league", rank: 120 },
    { id: "mys", region: "Malaysia", country: "Malaysia", name: "Super League", slug: "mys.1", kind: "league", rank: 130 },
    { id: "sgp", region: "Singapore", country: "Singapore", name: "Premier League", slug: "sgp.1", kind: "league", rank: 140 },
    { id: "lib", region: "South America", country: "South America", name: "Copa Libertadores", slug: "conmebol.libertadores", kind: "cup", rank: 200 },
    { id: "sud", region: "South America", country: "South America", name: "Copa Sudamericana", slug: "conmebol.sudamericana", kind: "cup", rank: 200 },
    { id: "copa", region: "South America", country: "South America", name: "Copa América", slug: "conmebol.america", kind: "cup", rank: 200 },
    { id: "caf", region: "Africa", country: "Africa", name: "CAF Champions League", slug: "caf.champions", kind: "cup", rank: 200 },
    { id: "afc", region: "Asia", country: "Asia", name: "AFC Champions League", slug: "afc.champions", kind: "cup", rank: 200 },
    { id: "wc", region: "World", country: "World", name: "World Cup", slug: "fifa.world", kind: "cup", rank: 200 },
  ];

  cache.competitions = {};
  cache.teamComps = {};

  function competitionById(id) {
    return COMPETITIONS.find((item) => item.id === id || item.slug === id) || null;
  }

  function standingRow(entry, slug) {
    const stats = entry.stats || [];
    const read = (name) => stats.find((stat) => stat.name === name)?.displayValue || "";
    const team = entry.team || {};
    return {
      rank: Number(read("rank")) || 0,
      id: String(team.id || ""),
      espnId: String(team.id || ""),
      name: team.displayName || team.name || "Club",
      short: team.abbreviation || "",
      logo: teamLogo(team),
      color: team.color ? `#${String(team.color).replace("#", "")}` : "#888",
      played: read("gamesPlayed"),
      gd: read("pointDifferential"),
      points: read("points"),
      note: entry.note?.description || "",
      slug,
    };
  }

  async function loadCompetition(id) {
    const comp = competitionById(id);
    if (!comp) throw new Error("Unknown competition");
    if (cache.competitions[comp.slug]) return cache.competitions[comp.slug];
    const [table, board] = await Promise.all([
      fetchJson(proxyUrl("site", `apis/v2/sports/soccer/${comp.slug}/standings`)).catch(() => null),
      fetchJson(proxyUrl("site", `apis/site/v2/sports/soccer/${comp.slug}/scoreboard`)).catch(() => null),
    ]);
    const tables = [];
    for (const child of table?.children || []) {
      const entries = child.standings?.entries || [];
      if (!entries.length) continue;
      const rows = entries.map((entry) => standingRow(entry, comp.slug)).sort((a, b) => a.rank - b.rank);
      const knockout = /round|knock|final|quarter|semi|play-?off|playoff/i.test(child.name || "");
      tables.push({ name: child.name || comp.name, rows, knockout });
    }
    const fixtures = [];
    for (const event of board?.events || []) {
      const mapped = mapEvent(event, comp.id);
      const note = event.competitions?.[0]?.notes?.[0]?.headline || event.season?.type?.name || event.seasonType?.name || "";
      fixtures.push({ ...mapped, note, leagueName: event.league?.name || comp.name });
    }
    const result = { ...comp, tables, fixtures };
    cache.competitions[comp.slug] = result;
    return result;
  }

  async function loadTeamCompetitions(team) {
    const teamId = String(team?.espnId || team?.id || "");
    const slug = team?.slug || "eng.1";
    if (!teamId) return [];
    const cacheKey = `${slug}:${teamId}`;
    if (cache.teamComps[cacheKey]) return cache.teamComps[cacheKey];
    const prefix = slug.split(".")[0];
    const domestic = {
      eng: ["eng.1", "eng.2", "eng.fa", "eng.league_cup", "eng.charity"],
      esp: ["esp.1", "esp.copa_del_rey"],
      ita: ["ita.1", "ita.coppa_italia"],
      ger: ["ger.1", "ger.dfb_pokal"],
      fra: ["fra.1", "fra.coupe_de_france"],
    };
    const slugs = [...new Set([slug, ...(domestic[prefix] || []), "uefa.champions", "uefa.europa", "uefa.europa.conf"])];
    const found = [];
    await Promise.all(
      slugs.map(async (item) => {
        try {
          const data = await fetchJson(proxyUrl("site", `apis/site/v2/sports/soccer/${item}/teams/${teamId}/schedule`));
          const events = data.events || [];
          if (!events.length) return;
          const league = events.find((event) => event.league?.name)?.league || {};
          const known = COMPETITIONS.find((comp) => comp.slug === item);
          found.push({
            id: known?.id || item,
            slug: item,
            name: league.name || known?.name || item,
            kind: league.isTournament || known?.kind === "cup" ? "cup" : "league",
          });
        } catch {
          /* This club is not in that competition. */
        }
      })
    );
    found.sort((a, b) => Number(b.kind === "league") - Number(a.kind === "league") || a.name.localeCompare(b.name));
    cache.teamComps[cacheKey] = found;
    return found;
  }

  window.NINETY_API = {
    LEAGUES,
    LEAGUE_LOGOS,
    COMPETITIONS,
    loadAll,
    loadMatchesQuick,
    loadTeamDetail,
    loadRoster,
    loadSchedule,
    loadPlayerStats,
    loadMatchDetail,
    loadMatchSheets,
    loadCompetition,
    loadTeamCompetitions,
    quoteFantasy,
    loadTransferNews,
    buildFormation,
    pitchFromLineup,
    searchTeams,
    searchPlayers,
    logoFrom,
  };
})();
