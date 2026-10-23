(function () {
  const LEAGUES = [
    { id: "pl", name: "Premier League", slug: "eng.1", country: "England" },
    { id: "ll", name: "La Liga", slug: "esp.1", country: "Spain" },
    { id: "sa", name: "Serie A", slug: "ita.1", country: "Italy" },
    { id: "bl", name: "Bundesliga", slug: "ger.1", country: "Germany" },
    { id: "l1", name: "Ligue 1", slug: "fra.1", country: "France" },
    { id: "ucl", name: "Champions League", slug: "uefa.champions", country: "Europe" },
  ];

  const cache = {
    teamsByLeague: {},
    matchesByLeague: {},
    leagueMeta: {},
    teamDetails: {},
    rosters: {},
    schedules: {},
  };

  function logoFrom(entity) {
    if (!entity?.logos?.length) return null;
    const dark = entity.logos.find((l) => l.rel?.includes("dark"));
    const def = entity.logos.find((l) => l.rel?.includes("default"));
    return (dark || def || entity.logos[0])?.href || null;
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

  function clockFrom(espnStatus, status) {
    if (status === "Live") {
      return espnStatus?.displayClock || espnStatus?.type?.shortDetail || espnStatus?.type?.detail || "Live";
    }
    if (status === "FT") return "FT";
    return espnStatus?.type?.shortDetail || espnStatus?.type?.detail || "";
  }

  async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function loadLeagueTeams(league) {
    if (cache.teamsByLeague[league.id]) return cache.teamsByLeague[league.id];
    const data = await fetchJson(
      `https://site.api.espn.com/apis/site/v2/sports/soccer/${league.slug}/teams`
    );
    const raw = data.sports?.[0]?.leagues?.[0]?.teams?.map((t) => t.team) || [];
    const leagueLogo = logoFrom(data.sports?.[0]?.leagues?.[0]) || null;
    cache.leagueMeta[league.id] = {
      ...league,
      logo: leagueLogo,
    };
    const teams = raw.map((t) => ({
      id: String(t.id),
      espnId: String(t.id),
      name: t.displayName || t.name,
      short: t.abbreviation || t.shortDisplayName || "",
      league: league.id,
      color: t.color ? `#${t.color}` : "#888",
      logo: logoFrom(t) || `https://a.espncdn.com/i/teamlogos/soccer/500/${t.id}.png`,
      slug: league.slug,
    }));
    cache.teamsByLeague[league.id] = teams;
    return teams;
  }

  async function loadLeagueMatches(league) {
    const data = await fetchJson(
      `https://site.api.espn.com/apis/site/v2/sports/soccer/${league.slug}/scoreboard`
    );
    if (!cache.leagueMeta[league.id]?.logo) {
      cache.leagueMeta[league.id] = {
        ...league,
        logo: logoFrom(data.leagues?.[0]) || cache.leagueMeta[league.id]?.logo || null,
      };
    }
    const matches = (data.events || []).map((event) => {
      const comp = event.competitions?.[0];
      const home = (comp?.competitors || []).find((c) => c.homeAway === "home");
      const away = (comp?.competitors || []).find((c) => c.homeAway === "away");
      const status = mapStatus(event.status);
      return {
        id: String(event.id),
        league: league.id,
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
        kickoff: clockFrom(event.status, status),
        start: event.date,
      };
    });
    cache.matchesByLeague[league.id] = matches;
    return matches;
  }

  async function loadAll() {
    const teams = [];
    const matches = [];
    const leagues = [];
    for (const league of LEAGUES) {
      try {
        const [leagueTeams, leagueMatches] = await Promise.all([
          loadLeagueTeams(league),
          loadLeagueMatches(league),
        ]);
        teams.push(...leagueTeams);
        matches.push(...leagueMatches);
        leagues.push(cache.leagueMeta[league.id] || league);
      } catch (err) {
        console.warn("Failed league", league.id, err);
        leagues.push(cache.leagueMeta[league.id] || league);
      }
    }
    return { leagues, teams, matches };
  }

  async function loadTeamDetail(slug, teamId) {
    const key = `${slug}:${teamId}`;
    if (cache.teamDetails[key]) return cache.teamDetails[key];
    const data = await fetchJson(
      `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/teams/${teamId}`
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
    };
    cache.teamDetails[key] = detail;
    return detail;
  }

  async function loadRoster(slug, teamId) {
    const key = `${slug}:${teamId}`;
    if (cache.rosters[key]) return cache.rosters[key];
    const data = await fetchJson(
      `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/teams/${teamId}/roster`
    );
    const groups = data.athletes || [];
    const players = [];
    for (const group of groups) {
      const items = group.items || (group.displayName ? [] : null);
      if (Array.isArray(group)) {
        players.push(...group);
      } else if (items) {
        for (const p of items) players.push({ ...p, positionGroup: group.position || group.displayName });
      } else if (group.displayName || group.fullName) {
        players.push(group);
      }
    }
    // ESPN sometimes returns athletes as array of position groups
    let flat = [];
    if (groups.length && groups[0]?.items) {
      flat = groups.flatMap((g) =>
        (g.items || []).map((p) => ({
          name: p.displayName || p.fullName,
          number: p.jersey || p.displayJersey || "",
          position: p.position?.abbreviation || p.position?.displayName || g.position || "",
        }))
      );
    } else {
      flat = (Array.isArray(groups) ? groups : []).map((p) => ({
        name: p.displayName || p.fullName,
        number: p.jersey || "",
        position: p.position?.abbreviation || "",
      }));
    }
    const coach = data.coach?.[0]?.displayName || data.coach?.displayName || "—";
    const roster = { players: flat.filter((p) => p.name), coach };
    cache.rosters[key] = roster;
    return roster;
  }

  async function loadSchedule(slug, teamId) {
    const key = `${slug}:${teamId}`;
    if (cache.schedules[key]) return cache.schedules[key];
    try {
      const data = await fetchJson(
        `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/teams/${teamId}/schedule`
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
      const schedule = { lastFive, form };
      cache.schedules[key] = schedule;
      return schedule;
    } catch {
      return { lastFive: [], form: [] };
    }
  }

  window.NINETY_API = {
    LEAGUES,
    loadAll,
    loadTeamDetail,
    loadRoster,
    loadSchedule,
    logoFrom,
  };
})();
