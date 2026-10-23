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

  function findClub(q) {
    return DATA().clubs.find((c) => q.includes(normalize(c)));
  }

  function findPlayer(q) {
    const pool = [
      ...DATA().transfers.map((t) => t.player),
      ...DATA().market.map((p) => p.player),
    ];
    const unique = [...new Set(pool)];
    return unique.find((name) => q.includes(normalize(name))) ||
      unique.find((name) => normalize(name).split(" ").some((part) => part.length > 3 && q.includes(part)));
  }

  function transferLines(list) {
    return list
      .map(
        (t) =>
          `• ${t.player}: ${t.from} → ${t.to} (${t.fee}, ${t.likelihood}, ${t.window}) — ${t.note}`
      )
      .join("\n");
  }

  function marketLines(list) {
    return list
      .map((p) => `• ${p.player} (${p.club}, ${p.pos}) — ${p.value}, trend ${p.trend}. ${p.note}`)
      .join("\n");
  }

  function answerQuestion(raw, ctx = {}) {
    const q = normalize(raw);
    if (!q) {
      return {
        text: "Ask me anything football — transfers, market values, your favourites, or tonight's fixtures.",
        source: "NINETY AI",
      };
    }

    const favorites = ctx.favorites || [];
    const matches = ctx.matches || [];
    const club = findClub(q);
    const player = findPlayer(q);

    if (includesAny(q, ["hello", "hi ", "hey", "who are you", "what can you"])) {
      return {
        text:
          "I'm NINETY AI — your matchday brain. I can brief big transfers, player market values, favourite-team fixtures, and general football questions. Try “biggest transfers”, “value of Saka”, or “when do Arsenal play?”.",
        source: "NINETY AI",
      };
    }

    const aboutFavoritesOnly =
      includesAny(q, ["favorite", "favourite", "my teams", "my clubs"]) &&
      !includesAny(q, ["play", "fixture", "match", "kickoff", "kick off", "transfer", "market", "worth", "value"]);

    if (aboutFavoritesOnly) {
      if (!favorites.length) {
        return {
          text: "You haven't starred any clubs yet. Open Favourites, tap a few teams, and I'll tailor transfer and match alerts around them.",
          source: "NINETY AI",
        };
      }
      return {
        text: `Your favourites: ${favorites.join(", ")}. I'll highlight their fixtures, related transfers, and market movers.`,
        source: "NINETY AI",
      };
    }

    if (includesAny(q, ["transfer", "signing", "rumour", "rumor", "deal", "move"])) {
      let list = DATA().transfers;
      if (club) {
        list = list.filter(
          (t) => normalize(t.from) === normalize(club) || normalize(t.to) === normalize(club)
        );
        if (!list.length) {
          return {
            text: `No hot lines linked to ${club} in the current board. Watch Favourites + Alerts — I'll ping you when something big lands.`,
            source: "Transfer desk",
          };
        }
        return {
          text: `Transfer picture for ${club}:\n${transferLines(list)}`,
          source: "Transfer desk",
        };
      }
      if (player) {
        list = list.filter((t) => normalize(t.player).includes(normalize(player).split(" ").pop()));
        if (list.length) {
          return { text: transferLines(list), source: "Transfer desk" };
        }
      }
      if (includesAny(q, ["big", "biggest", "hot", "top"])) {
        list = list.filter((t) => t.likelihood === "Hot" || t.likelihood === "Rising" || t.likelihood === "Done-ish");
      }
      if (favorites.length && includesAny(q, ["my", "fav", "watch"])) {
        list = DATA().transfers.filter(
          (t) => favorites.includes(t.from) || favorites.includes(t.to)
        );
      }
      return {
        text: `Here's the transfer board:\n${transferLines(list.slice(0, 6))}`,
        source: "Transfer desk",
      };
    }

    if (includesAny(q, ["market", "value", "worth", "price", "valuation", "fee"])) {
      if (player) {
        const hit = DATA().market.find((p) => normalize(p.player) === normalize(player) || normalize(p.player).includes(normalize(player)));
        if (hit) {
          return {
            text: `${hit.player} is valued around ${hit.value} (${hit.pos}, ${hit.club}, age ${hit.age}). Trend: ${hit.trend}. ${hit.note}`,
            source: "Player market",
          };
        }
        const t = DATA().transfers.find((x) => normalize(x.player).includes(normalize(player)));
        if (t) {
          return {
            text: `${t.player} is being talked at about ${t.fee} (${t.from} → ${t.to}, ${t.likelihood}). ${t.note}`,
            source: "Player market",
          };
        }
      }
      if (club) {
        const list = DATA().market.filter((p) => normalize(p.club) === normalize(club));
        if (list.length) {
          return {
            text: `Market names at ${club}:\n${marketLines(list)}`,
            source: "Player market",
          };
        }
      }
      const risers = DATA().market.filter((p) => p.trend === "up").slice(0, 6);
      return {
        text: `Players with rising valuations:\n${marketLines(risers)}`,
        source: "Player market",
      };
    }

    if (includesAny(q, ["fixture", "fixtures", "match", "matches", "play", "kickoff", "kick off", "when", "tonight", "upcoming"])) {
      let list = matches.filter((m) => m.status === "Upcoming" || m.status === "Live");
      if (club) {
        list = list.filter((m) => m.home === club || m.away === club);
      } else if (favorites.length && includesAny(q, ["my", "fav", "favourite", "favorite"])) {
        list = list.filter((m) => favorites.includes(m.home) || favorites.includes(m.away));
      }
      if (!list.length) {
        return {
          text: club
            ? `No upcoming fixtures listed for ${club} right now. Add one on the Add tab or check back after the next slate.`
            : "No upcoming fixtures on the board. Add a match or star clubs in Favourites.",
          source: "Fixtures",
        };
      }
      const lines = list
        .map((m) => `• ${m.home} vs ${m.away} — ${m.kickoff} (${m.status})`)
        .join("\n");
      return { text: `Fixtures:\n${lines}`, source: "Fixtures" };
    }

    if (includesAny(q, ["table", "standing", "standings", "league", "points", "top"])) {
      const rows = ctx.standings ? ctx.standings() : [];
      if (!rows.length) {
        return {
          text: "The table is empty until some results are logged. Mark matches live or FT and I'll rank them.",
          source: "Table",
        };
      }
      const lines = rows
        .slice(0, 8)
        .map((r, i) => `${i + 1}. ${r.team} — ${r.points} pts (GD ${r.gf - r.ga})`)
        .join("\n");
      return { text: `Current table snapshot:\n${lines}`, source: "Table" };
    }

    if (includesAny(q, ["notif", "alert", "remind", "ping"])) {
      return {
        text: "Turn on Alerts to allow browser notifications. I'll nudge you before favourite-team kickoffs and when a hot transfer hits clubs you follow.",
        source: "Alerts",
      };
    }

    if (includesAny(q, ["offside", "var", "points", "window", "clean sheet", "rule", "rules", "how does"])) {
      const facts = DATA().facts;
      const hit = facts.find((f) => normalize(f).split(" ").some((w) => w.length > 4 && q.includes(w)));
      return {
        text: hit || facts[Math.floor(Math.random() * facts.length)],
        source: "Rules & facts",
      };
    }

    if (player) {
      const m = DATA().market.find((p) => normalize(p.player).includes(normalize(player)));
      const t = DATA().transfers.find((x) => normalize(x.player).includes(normalize(player)));
      const bits = [];
      if (m) bits.push(`${m.player} plays for ${m.club} (${m.pos}), valued ~${m.value}. ${m.note}`);
      if (t) bits.push(`Transfer line: ${t.from} → ${t.to} at ${t.fee} (${t.likelihood}). ${t.note}`);
      if (bits.length) return { text: bits.join("\n"), source: "NINETY AI" };
    }

    if (club) {
      const relatedTransfers = DATA().transfers.filter(
        (t) => t.from === club || t.to === club
      );
      const relatedMarket = DATA().market.filter((p) => p.club === club);
      const bits = [`Here's what I have on ${club}:`];
      if (relatedMarket.length) bits.push(marketLines(relatedMarket));
      if (relatedTransfers.length) bits.push(transferLines(relatedTransfers));
      if (bits.length > 1) return { text: bits.join("\n"), source: "NINETY AI" };
    }

    const tip = DATA().facts[Math.floor(Math.random() * DATA().facts.length)];
    return {
      text: `I couldn't pin that to a specific transfer or valuation. Try naming a player, club, or ask “biggest transfers”, “rising market values”, or “my fixtures”.\n\nQuick fact: ${tip}`,
      source: "NINETY AI",
    };
  }

  window.NINETY_AI = { answerQuestion, normalize };
})();
