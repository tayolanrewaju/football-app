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

  function buildContext(ctx = {}) {
    const matches = ctx.matches || [];
    const favorites = ctx.favorites || [];
    const transfers = ctx.transfers || window.NINETY_DATA?.transfers || [];
    const liveNow = matches.filter((m) => m.status === "Live").slice(0, 8);
    const upcoming = matches.filter((m) => m.status === "Upcoming").slice(0, 10);
    const bits = [];
    if (favorites.length) bits.push(`Favourites: ${favorites.join(", ")}`);
    if (liveNow.length) bits.push(`Live scores:\n${scoreLines(liveNow)}`);
    if (upcoming.length) bits.push(`Upcoming:\n${scoreLines(upcoming)}`);
    if (transfers.length) bits.push(`Transfer board:\n${transferLines(transfers.slice(0, 8))}`);
    return bits.join("\n\n");
  }

  async function askChatGPT(raw, ctx = {}) {
    const res = await fetch("/api/ai/chat", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        question: String(raw || "").trim(),
        context: buildContext(ctx),
      }),
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || `ChatGPT request failed (${res.status})`);
      err.needsKey = !!(data && data.needsKey);
      throw err;
    }
    return {
      text: data.text,
      source: data.source || "ChatGPT",
      model: data.model,
    };
  }

  async function researchLocal(raw, ctx = {}) {
    const q = normalize(raw);
    const favorites = ctx.favorites || [];
    const matches = ctx.matches || [];
    const teams = ctx.teams || [];
    const transfers = ctx.transfers || window.NINETY_DATA?.transfers || [];
    const API = window.NINETY_API;
    const notes = [];

    if (!q) {
      return {
        text: "Ask me anything football — with ChatGPT connected I’ll answer faster and smarter. Add your OpenAI API key in Account.",
        source: "Derby AI",
      };
    }

    const wantsLive = includesAny(q, ["live", "score", "scores", "fixture", "fixtures", "match", "matches", "playing", "upcoming", "next game", "kickoff"]);
    const wantsTransfers = includesAny(q, ["transfer", "signing", "window", "deal", "rumour", "rumor", "buy", "sold", "fee"]);
    const wantsSquad = includesAny(q, ["lineup", "squad", "roster", "xi", "players", "coach", "manager", "form", "about", "tell me"]);
    const wantsFavs = includesAny(q, ["favourite", "favorite", "following", "my team", "my clubs"]);

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

    const sections = [];

    if (includesAny(q, ["hello", "hi", "hey", "who are you", "help"])) {
      return {
        text: "I’m Derby Ask AI. Connect ChatGPT in Account for the best answers — otherwise I still check live ESPN scores, clubs, and the 2027 board.",
        source: "Derby AI",
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
        const fromSchedule = schedule?.upcoming || [];
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
      source: "Derby AI",
    };
  }

  async function research(raw, ctx = {}) {
    try {
      return await askChatGPT(raw, ctx);
    } catch (err) {
      const local = await researchLocal(raw, ctx);
      if (err.needsKey) {
        return {
          text: `${local.text}\n\n—\nChatGPT isn’t connected yet. Open Account → paste your OpenAI API key to route Ask AI through ChatGPT for better answers.`,
          source: local.source,
        };
      }
      return {
        text: `${local.text}\n\n—\nChatGPT fallback: ${err.message || err}`,
        source: local.source,
      };
    }
  }

  function answerQuestion(raw) {
    const q = normalize(raw);
    if (!q) return { text: "Ask me anything football.", source: "Derby AI" };
    return { text: "Thinking…", source: "Derby AI", async: true };
  }

  function localNewsOverview(articles) {
    if (!articles.length) {
      return "No fresh transfer briefs are on the wire right now. The board above is still the 2027 window inside Derby.";
    }
    const sentences = articles.slice(0, 5).map((article) => {
      const blurb = String(article.description || "").replace(/\s+/g, " ").trim();
      return blurb ? `${article.headline}. ${blurb}` : `${article.headline}.`;
    });
    return `Latest from the wire. ${sentences.join(" ")}`;
  }

  async function overviewNews(articles) {
    const list = articles || [];
    const brief = list
      .slice(0, 8)
      .map((article) => `- ${article.headline}. ${article.description || ""}`)
      .join("\n");
    if (!brief) return { text: localNewsOverview([]), source: "Derby AI" };
    try {
      const chat = await askChatGPT(
        `Write two short paragraphs overviewing the most recent football transfer news. Use only these reports. Plain sentences, no bullet list.\n${brief}`,
        {}
      );
      return chat;
    } catch {
      return { text: localNewsOverview(list), source: "Derby AI" };
    }
  }

  window.NINETY_AI = { answerQuestion, research, askChatGPT, overviewNews, normalize, findTeam };
})();
