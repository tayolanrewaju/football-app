(function () {
  const DATA = () => window.NINETY_DATA;

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

  function findTeam(q) {
    return DATA().teams.find((t) => q.includes(normalize(t.name)) || q.includes(normalize(t.short)));
  }

  function findPlayer(q) {
    const pool = [
      ...DATA().transfers.map((t) => t.player),
      ...DATA().teams.flatMap((t) => t.lineup?.xi || []),
    ];
    const unique = [...new Set(pool)];
    return (
      unique.find((name) => q.includes(normalize(name))) ||
      unique.find((name) => normalize(name).split(" ").some((part) => part.length > 3 && q.includes(part)))
    );
  }

  function transferLines(list) {
    return list
      .map((t) => `• ${t.player}: ${t.from} → ${t.to} (${t.fee}, ${t.status}) — ${t.note}`)
      .join("\n");
  }

  function answerQuestion(raw, ctx = {}) {
    const q = normalize(raw);
    if (!q) {
      return { text: "Ask me anything football — live scores, transfers, lineups, or your favourites.", source: "NINETY AI" };
    }

    const favorites = ctx.favorites || [];
    const team = findTeam(q);
    const player = findPlayer(q);

    if (includesAny(q, ["hello", "hi ", "hey", "who are you", "what can you"])) {
      return {
        text: "I'm NINETY AI. Ask about live scores across the big five + UCL, European transfers, club lineups, or your favourites' form.",
        source: "NINETY AI",
      };
    }

    if (includesAny(q, ["live", "score", "scores", "fixture", "fixtures", "match", "matches", "tonight"])) {
      let list = DATA().matches.filter((m) => m.status === "Live" || m.status === "Upcoming");
      if (includesAny(q, ["live"])) list = DATA().matches.filter((m) => m.status === "Live");
      if (team) list = DATA().matches.filter((m) => m.home === team.name || m.away === team.name);
      if (!list.length) return { text: "No matches match that filter right now.", source: "Scores" };
      const lines = list
        .slice(0, 10)
        .map((m) => {
          const league = DATA().leagueById[m.league]?.name || m.league;
          const score =
            m.status === "Upcoming" ? "vs" : `${m.homeScore ?? 0}-${m.awayScore ?? 0}`;
          const clock = m.status === "Live" ? ` ${m.minute}'` : ` ${m.status}`;
          return `• [${league}] ${m.home} ${score} ${m.away}${clock}`;
        })
        .join("\n");
      return { text: `Scores:\n${lines}`, source: "Scores" };
    }

    if (includesAny(q, ["transfer", "signing", "deal", "rumour", "rumor", "move"])) {
      let list = DATA().transfers;
      if (team) list = list.filter((t) => t.from === team.name || t.to === team.name);
      if (includesAny(q, ["big", "biggest", "season"])) {
        list = [...list].sort((a, b) => {
          const rank = (s) => (s === "Completed" ? 2 : s === "Hot" ? 1 : 0);
          return rank(b.status) - rank(a.status);
        });
      }
      return { text: `Europe transfers:\n${transferLines(list.slice(0, 8))}`, source: "Transfers" };
    }

    if (team && includesAny(q, ["lineup", "line up", "xi", "formation", "squad", "about", "info", "tell me"])) {
      const xi = (team.lineup?.xi || []).join(", ");
      const form = (team.form || []).join("-");
      return {
        text: `${team.name} (${DATA().leagueById[team.league]?.name})\nManager: ${team.manager}\nStadium: ${team.stadium}\nFormation: ${team.lineup?.formation}\nXI: ${xi}\nForm: ${form}\n${team.about}`,
        source: "Teams",
      };
    }

    if (includesAny(q, ["form", "favourite", "favorite", "following", "my team"])) {
      if (!favorites.length) {
        return { text: "Star clubs in Favourites and I'll summarise their last five games.", source: "Favourites" };
      }
      const lines = favorites
        .map((name) => {
          const t = DATA().teamByName[name] || DATA().teams.find((x) => x.name === name);
          if (!t) return `• ${name}`;
          const last = (t.lastFive || [])
            .map((g) => `${g.result} ${g.score} vs ${g.opp}`)
            .join(", ");
          return `• ${t.name}: ${(t.form || []).join("-")} — ${last}`;
        })
        .join("\n");
      return { text: `Your favourites:\n${lines}`, source: "Favourites" };
    }

    if (player) {
      const t = DATA().transfers.find((x) => normalize(x.player).includes(normalize(player)));
      if (t) return { text: transferLines([t]), source: "Transfers" };
      const club = DATA().teams.find((tm) => (tm.lineup?.xi || []).some((p) => normalize(p).includes(normalize(player))));
      if (club) {
        return { text: `${player} is in the ${club.name} squad (${club.lineup.formation}). ${club.about}`, source: "Teams" };
      }
    }

    if (team) {
      return {
        text: `${team.name}: ${team.about}\nForm ${(team.form || []).join("-")}. Ask for their lineup for the XI.`,
        source: "Teams",
      };
    }

    const tip = DATA().facts[Math.floor(Math.random() * DATA().facts.length)];
    return {
      text: `Try “live scores”, “biggest transfers”, “Arsenal lineup”, or “my form”.\n\nFact: ${tip}`,
      source: "NINETY AI",
    };
  }

  window.NINETY_AI = { answerQuestion, normalize };
})();
