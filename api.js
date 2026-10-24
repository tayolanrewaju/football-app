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
    if (["D", "DF", "CB", "LB", "RB", "LWB", "RWB", "DEF"].includes(p) || p.includes("BACK") || p.includes("DEF"))
      return "def";
    if (["M", "MF", "CM", "DM", "AM", "CDM", "CAM", "LM", "RM", "MID"].includes(p) || p.includes("MID"))
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
    const urls = [
      proxyUrl("site", `apis/site/v2/sports/soccer/${league.slug}/scoreboard`),
      ...dateKeys.map((d) =>
        proxyUrl("site", `apis/site/v2/sports/soccer/${league.slug}/scoreboard?dates=${d}`)
      ),
    ];
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

  /** Extend with the next few days (kept small for speed). */
  async function loadLeagueMatches(league, { days = 7 } = {}) {
    const dates = upcomingDateKeys(days);
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

  async function loadAll({ days = 7 } = {}) {
    const teams = [];
    const matches = [];
    const leagues = [];
    // Matches first (parallel), teams in parallel separately — don't block scores on squads
    const matchResults = await Promise.all(
      LEAGUES.map(async (league) => {
        try {
          const leagueMatches = await loadLeagueMatches(league, { days });
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
      base.nationality = athlete.citizenship || base.nationality;
      base.headshot =
        athlete.headshot?.href ||
        base.headshot ||
        `https://a.espncdn.com/i/headshots/soccer/players/full/${id}.png`;
      base.teamName = athlete.team?.displayName || base.teamName || "";
    }

    // Prefer overview season split stats when richer
    const splitStats = overview?.statistics?.splits?.categories
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
    } else if (overview?.statistics?.names && overview?.statistics?.splits) {
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

    base.seasonLabel = "This season";
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

  window.NINETY_API = {
    LEAGUES,
    LEAGUE_LOGOS,
    loadAll,
    loadMatchesQuick,
    loadTeamDetail,
    loadRoster,
    loadSchedule,
    loadPlayerStats,
    buildFormation,
    searchTeams,
    logoFrom,
  };
})();
