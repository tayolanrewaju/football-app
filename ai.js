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

  function answerQuestion(raw, ctx = {}) {
    const q = normalize(raw);
    const favorites = ctx.favorites || [];
    const matches = ctx.matches || [];
    const teams = ctx.teams || [];
    const transfers = ctx.transfers || window.NINETY_DATA?.transfers || [];
    const facts = window.NINETY_DATA?.facts || [];

    if (!q) {
      return {
        text: "Ask about live scores, 2026 transfers, a club’s squad, or your favourites.",
        source: "NINETY AI",
      };
    }

    const team = findTeam(q, teams);

    if (includesAny(q, ["hello", "hi", "hey", "who are you", "help"])) {
      return {
        text: "I'm NINETY AI. I can summarise live ESPN scores, 2026-window transfers, squads, and your favourites. Try “what’s live?”, “biggest transfers 2026”, or a club name.",
        source: "NINETY AI",
      };
    }

    if (includesAny(q, ["live", "score", "scores", "fixture", "match", "playing", "tonight", "today"])) {
      let list = matches.slice();
      if (includesAny(q, ["live"])) list = list.filter((m) => m.status === "Live");
      else if (includesAny(q, ["upcoming", " tonight", "today"])) {
        list = list.filter((m) => m.status === "Live" || m.status === "Upcoming");
      }
      if (team) list = matches.filter((m) => m.home === team.name || m.away === team.name);
      if (!list.length) {
        return {
          text: team
            ? `No matches currently listed for ${team.name}. Pull to refresh on Matches or try again later.`
            : "No matches matched that. Open Matches to see today’s ESPN slate, or ask “what’s live?”.",
          source: "Scores",
        };
      }
      const lines = list
        .slice(0, 12)
        .map((m) => {
          const score = m.status === "Upcoming" ? "vs" : `${m.homeScore}-${m.awayScore}`;
          const clock = m.status === "Live" ? ` ${m.minute || "Live"}` : ` ${m.status}`;
          return `• ${m.home} ${score} ${m.away}${clock}`;
        })
        .join("\n");
      return { text: `Latest scores:\n${lines}`, source: "Live scores" };
    }

    if (includesAny(q, ["transfer", "signing", "window", "deal", "rumour", "rumor", "buy", "sold"])) {
      let list = transfers.slice();
      if (team) {
        const name = normalize(team.name);
        list = list.filter(
          (t) => normalize(t.from).includes(name) || normalize(t.to).includes(name) || name.includes(normalize(t.from)) || name.includes(normalize(t.to))
        );
      }
      if (includesAny(q, ["2026", "summer", "january", "jan", "window"])) {
        list = list.filter((t) => /2026|ongoing/i.test(t.window));
      }
      if (!list.length) {
        return {
          text: team
            ? `No 2026-window deals stored for ${team.name}.`
            : "No matching 2026 transfers. Ask “biggest transfers 2026”.",
          source: "Transfers",
        };
      }
      return {
        text: `Transfers from the 2026 window onwards:\n${transferLines(list.slice(0, 10))}`,
        source: "Transfers",
      };
    }

    if (team && includesAny(q, ["lineup", "squad", "roster", "xi", "players", "about", "info", "form", "tell me"])) {
      const detail = ctx.teamDetail;
      const roster = ctx.roster;
      const schedule = ctx.schedule;
      const bits = [`${team.name}`];
      if (detail?.record) bits.push(`Record: ${detail.record}${detail.points != null ? ` · ${detail.points} pts` : ""}`);
      if (detail?.standingSummary) bits.push(detail.standingSummary);
      if (schedule?.form?.length) bits.push(`Form: ${schedule.form.join("-")}`);
      if (roster?.coach) bits.push(`Coach: ${roster.coach}`);
      if (roster?.players?.length) {
        bits.push(
          `Squad sample: ${roster.players
            .slice(0, 11)
            .map((p) => (p.number ? `#${p.number} ` : "") + p.name)
            .join(", ")}`
        );
      } else {
        bits.push("Open the club page in Teams for the full roster.");
      }
      return { text: bits.join("\n"), source: "Teams" };
    }

    if (includesAny(q, ["favourite", "favorite", "following", "my team", "my clubs", "form"])) {
      if (!favorites.length) {
        return {
          text: "Your favourites list is empty. Open Favourites or a club page and tap the star.",
          source: "Favourites",
        };
      }
      return {
        text: `You’re following: ${favorites.join(", ")}. Open Favourites for last-five form from this season.`,
        source: "Favourites",
      };
    }

    if (team) {
      return {
        text: `${team.name} (${team.short || "club"}). Ask for their squad, form, or today’s score.`,
        source: "Teams",
      };
    }

    const tip = facts[Math.floor(Math.random() * facts.length)] || "";
    return {
      text: `I can help with live scores, 2026 transfers, and club squads. Try naming a team or asking “what’s live?”.\n\n${tip}`,
      source: "NINETY AI",
    };
  }

  window.NINETY_AI = { answerQuestion, normalize, findTeam };
})();
