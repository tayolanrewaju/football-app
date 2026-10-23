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
  };

  function proxyUrl(kind, pathAndQuery) {
    const clean = String(pathAndQuery).replace(/^\//, "");
    return `/proxy/espn/${kind}/${clean}`;
  }

  function logoFrom(entity, { preferColor = true } = {}) {
    if (!entity?.logos?.length) return null;
    const def = entity.logos.find((l) => l.rel?.includes("default") && !l.rel?.includes("dark"));
    const anyDef = entity.logos.find((l) => l.rel?.includes("default"));
    const dark = entity.logos.find((l) => l.rel?.includes("dark"));
    if (preferColor) return (def || anyDef || entity.logos[0] || dark)?.href || null;
    return (dark || def || anyDef || entity.logos[0])?.href || null;
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

  function mapEvent(event, leagueId) {
    const comp = event.competitions?.[0];
    const home = (comp?.competitors || []).find((c) => c.homeAway === "home");
    const away = (comp?.competitors || []).find((c) => c.homeAway === "away");
    const status = mapStatus(event.status);
    return {
      id: String(event.id),
      league: leagueId,
      home: home?.team?.displayName || "Home",
      away: away?.team?.displayName || "Away",
      homeId: String(home?.team?.id || ""),
      awayId: String(away?.team?.id || ""),
      homeLogo: logoFrom(home?.team),
      awayLogo: logoFrom(away?.team),
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
        logo: logoFrom(t) || `https://a.espncdn.com/i/teamlogos/soccer/500/${t.id}.png`,
        slug: league.slug,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    cache.teamsByLeague[league.id] = teams;
    return teams;
  }

  async function loadLeagueMatches(league) {
    const dates = upcomingDateKeys(18);
    // Today without dates + explicit future days
    const urls = [
      proxyUrl("site", `apis/site/v2/sports/soccer/${league.slug}/scoreboard`),
      ...dates.map((d) =>
        proxyUrl("site", `apis/site/v2/sports/soccer/${league.slug}/scoreboard?dates=${d}`)
      ),
    ];

    const bags = await Promise.all(
      urls.map(async (url) => {
        try {
          return await fetchJson(url);
        } catch {
          return null;
        }
      })
    );

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

    // Ensure league logo even if scoreboard empty
    cache.leagueMeta[league.id] = {
      ...league,
      ...(cache.leagueMeta[league.id] || {}),
      logo: LEAGUE_LOGOS[league.id] || cache.leagueMeta[league.id]?.logo || null,
    };

    const matches = [...byId.values()].sort((a, b) => {
      const rank = (s) => (s === "Live" ? 0 : s === "Upcoming" ? 1 : 2);
      const ra = rank(a.status) - rank(b.status);
      if (ra) return ra;
      return String(a.start || "").localeCompare(String(b.start || ""));
    });
    cache.matchesByLeague[league.id] = matches;
    return matches;
  }

  async function loadAll() {
    const teams = [];
    const matches = [];
    const leagues = [];
    const results = await Promise.all(
      LEAGUES.map(async (league) => {
        try {
          const [leagueTeams, leagueMatches] = await Promise.all([
            loadLeagueTeams(league),
            loadLeagueMatches(league),
          ]);
          return {
            league: cache.leagueMeta[league.id] || { ...league, logo: LEAGUE_LOGOS[league.id] },
            teams: leagueTeams,
            matches: leagueMatches,
          };
        } catch (err) {
          console.warn("Failed league", league.id, err);
          return {
            league: { ...league, logo: LEAGUE_LOGOS[league.id] },
            teams: [],
            matches: [],
          };
        }
      })
    );

    for (const row of results) {
      leagues.push(row.league);
      teams.push(...row.teams);
      matches.push(...row.matches);
    }
    return { leagues, teams, matches };
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
      logo: logoFrom(t),
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
    if (athletes.length && athletes[0]?.items) {
      flat = athletes.flatMap((g) =>
        (g.items || []).map((p) => ({
          name: p.displayName || p.fullName,
          number: p.jersey || p.displayJersey || "",
          position: p.position?.abbreviation || p.position?.displayName || g.position || "",
        }))
      );
    } else {
      flat = athletes.map((p) => ({
        name: p.displayName || p.fullName,
        number: p.jersey || p.displayJersey || "",
        position: p.position?.abbreviation || p.position?.displayName || p.position?.name || "",
      }));
    }
    const coachEntry = Array.isArray(data.coach) ? data.coach[0] : data.coach;
    const coach =
      coachEntry?.displayName ||
      [coachEntry?.firstName, coachEntry?.lastName].filter(Boolean).join(" ") ||
      "—";
    const roster = { players: flat.filter((p) => p.name), coach };
    cache.rosters[key] = roster;
    return roster;
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
        logo: logoFrom(item) || `https://a.espncdn.com/i/teamlogos/soccer/500/${item.id}.png`,
        label: item.label || item.league || "World",
      }));
  }

  window.NINETY_API = {
    LEAGUES,
    LEAGUE_LOGOS,
    loadAll,
    loadTeamDetail,
    loadRoster,
    loadSchedule,
    searchTeams,
    logoFrom,
  };
})();
