(function () {
  function normalize(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[’']/g, "'")
      .replace(/[^a-z0-9£€$+\s.-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function includesAny(hay, needles) {
    return needles.some((n) => hay.includes(n));
  }

  function findTeam(q, teams) {
    const list = teams || [];
    return (
      list.find((t) => q.includes(normalize(t.name))) ||
      list.find((t) => t.short && q.includes(normalize(t.short))) ||
      list.find((t) => normalize(t.name).split(" ").some((p) => p.length > 3 && q.includes(p)))
    );
  }

  function transferLines(list) {
    return list
      .map((t) => `• ${t.player}: ${t.from} → ${t.to} (${t.fee}, ${t.status}, ${t.window}) — ${t.note}`)
      .join("\n");
  }

  function scoreLines(list) {
    return list
      .slice(0, 10)
      .map((m) => {
        const score = m.status === "Upcoming" ? "vs" : `${m.homeScore}-${m.awayScore}`;
        const clock = m.status === "Live" ? ` ${m.minute || "Live"}` : ` · ${m.kickoff || m.status}`;
        return `• ${m.home} ${score} ${m.away}${clock}`;
      })
      .join("\n");
  }

  async function research(raw, ctx = {}) {
    const q = normalize(raw);
    const favorites = ctx.favorites || [];
    const matches = ctx.matches || [];
    const teams = ctx.teams || [];
    const transfers = ctx.transfers || window.NINETY_DATA?.transfers || [];
    const API = window.NINETY_API;
    const notes = [];

    if (!q) {
      return {
        text: "Ask me anything football — I’ll check live scores, world clubs, squads, and the 2027 transfer board together.",
        source: "NINETY AI",
      };
    }

    // Intent flags
    const wantsLive = includesAny(q, ["live", "score", "scores", "fixture", "fixtures", "match", "matches", "playing", "upcoming", "next game", "kickoff"]);
    const wantsTransfers = includesAny(q, ["transfer", "signing", "window", "deal", "rumour", "rumor", "buy", "sold", "fee"]);
    const wantsSquad = includesAny(q, ["lineup", "squad", "roster", "xi", "players", "coach", "manager", "form", "about", "tell me"]);
    const wantsFavs = includesAny(q, ["favourite", "favorite", "following", "my team", "my clubs"]);

    // Resolve club mentions via local list OR world search
    let team = findTeam(q, teams);
    let searched = [];
    if (!team && API?.searchTeams) {
      const tokens = q
        .replace(/\b(tell me about|what about|how is|who's|who is|show|squad|lineup|form|transfers?|of|the|a|an)\b/g, " ")
        .trim()
        .split(/\s+/)
        .filter((t) => t.length > 2);
      const guess = tokens.slice(0, 3).join(" ");
      if (guess) {
        try {
          searched = await API.searchTeams(guess);
          if (searched.length) {
            team = searched[0];
            notes.push(`world club search (“${guess}”)`);
          }
        } catch {
          /* ignore */
        }
      }
    }

    // Enrich from multiple DBs when we have a club
    let detail = null;
    let roster = null;
    let schedule = null;
    if (team && (wantsSquad || wantsLive || wantsTransfers || includesAny(q, ["who", "what", "how"]))) {
      try {
        const slug = team.slug || "eng.1";
        const id = team.espnId || team.id;
        [detail, roster, schedule] = await Promise.all([
          API.loadTeamDetail(slug, id),
          API.loadRoster(slug, id),
          API.loadSchedule(slug, id),
        ]);
        notes.push("club profile", "roster feed", "schedule/form feed");
      } catch {
        notes.push("club feeds partially unavailable");
      }
    }

    // Build a composed answer like an assistant, not a single-index lookup
    const sections = [];

    if (includesAny(q, ["hello", "hi", "hey", "who are you", "help"])) {
      return {
        text: "I’m NINETY AI. I don’t just keyword-match — I check live ESPN scores, world club search, squads/form, your favourites, and the 2027 transfer board, then stitch an answer. Try “What’s coming up in the Premier League?” or “Tell me about Ajax”.",
        source: "NINETY AI",
      };
    }

    if (wantsLive || (!wantsTransfers && !wantsSquad && !wantsFavs && team)) {
      let list = matches.slice();
      if (includesAny(q, ["live"])) list = list.filter((m) => m.status === "Live");
      else if (includesAny(q, ["upcoming", "next", "coming"])) {
        list = list.filter((m) => m.status === "Upcoming" || m.status === "Live");
      }
      if (team) {
        const local = matches.filter((m) => m.home === team.name || m.away === team.name);
        const fromSchedule = (schedule?.upcoming || []).map((m) => ({ ...m, home: m.home, away: m.away }));
        list = local.length ? local : fromSchedule;
        if (!list.length && schedule?.lastFive?.length) {
          sections.push(
            `Recent ${team.name} results:\n` +
              schedule.lastFive.map((g) => `• ${g.home ? "vs" : "@"} ${g.opp} ${g.score} (${g.result})`).join("\n")
          );
        }
      }
      if (list.length) {
        sections.push(`${team ? `${team.name} fixtures` : "Fixtures I’m seeing"}:\n${scoreLines(list)}`);
        notes.push("live/upcoming scoreboard");
      }
    }

    if (wantsTransfers || includesAny(q, ["2027", "summer", "january", "jan"])) {
      let list = transfers.slice();
      if (team) {
        const name = normalize(team.name);
        list = list.filter(
          (t) =>
            normalize(t.from).includes(name) ||
            normalize(t.to).includes(name) ||
            name.includes(normalize(t.from)) ||
            name.includes(normalize(t.to))
        );
      }
      if (!list.length) list = transfers.slice(0, 8);
      sections.push(`2027-window transfer board:\n${transferLines(list.slice(0, 8))}`);
      notes.push("2027 transfer database");
    }

    if (team && (wantsSquad || sections.length === 0)) {
      const bits = [`Here’s what I found on ${team.name}:`];
      if (detail?.record) bits.push(`• Record: ${detail.record}${detail.points != null ? ` · ${detail.points} pts` : ""}`);
      if (detail?.standingSummary) bits.push(`• ${detail.standingSummary}`);
      if (schedule?.form?.length) bits.push(`• Form: ${schedule.form.join("-")}`);
      if (roster?.coach) bits.push(`• Coach: ${roster.coach}`);
      if (roster?.players?.length) {
        bits.push(
          `• Squad sample: ${roster.players
            .slice(0, 11)
            .map((p) => (p.number ? `#${p.number} ` : "") + p.name)
            .join(", ")}`
        );
      }
      if (team.label || team.league) bits.push(`• Competition context: ${team.label || team.league}`);
      sections.push(bits.join("\n"));
    }

    if (wantsFavs) {
      if (!favorites.length) {
        sections.push("Your favourites list is empty — star clubs in Teams and I’ll personalise scores and transfers.");
      } else {
        sections.push(`You’re following: ${favorites.join(", ")}.`);
        const favMatches = matches.filter((m) => favorites.includes(m.home) || favorites.includes(m.away));
        if (favMatches.length) sections.push(`Favourites’ slate:\n${scoreLines(favMatches)}`);
        notes.push("favourites graph");
      }
    }

    if (!sections.length) {
      // Broad multi-source fallback
      const liveNow = matches.filter((m) => m.status === "Live").slice(0, 5);
      const upcoming = matches.filter((m) => m.status === "Upcoming").slice(0, 5);
      if (liveNow.length) sections.push(`Live right now:\n${scoreLines(liveNow)}`);
      if (upcoming.length) sections.push(`Coming up:\n${scoreLines(upcoming)}`);
      sections.push(`On the 2027 board:\n${transferLines(transfers.slice(0, 5))}`);
      if (searched.length) {
        sections.push(`World search hits: ${searched.slice(0, 5).map((t) => t.name).join(", ")}`);
      }
      notes.push("multi-source sweep");
    }

    const footer = notes.length ? `\n\nSources checked: ${[...new Set(notes)].join(", ")}.` : "";
    return {
      text: sections.join("\n\n") + footer,
      source: "NINETY AI",
    };
  }

  // Back-compat sync wrapper
  function answerQuestion(raw, ctx = {}) {
    // sync fallback if caller doesn't await
    const q = normalize(raw);
    if (!q) return { text: "Ask me anything football.", source: "NINETY AI" };
    return {
      text: "Thinking across live scores, clubs, and transfers…",
      source: "NINETY AI",
      async: true,
    };
  }

  window.NINETY_AI = { answerQuestion, research, normalize, findTeam };
})();
