/* Kickoff and match-event alerts for clubs the user follows. */
(function (root) {
  function involvesFavourite(match, favorites) {
    const names = (favorites || []).map((name) => String(name || "").trim().toLowerCase()).filter(Boolean);
    const home = String(match.home || "").toLowerCase();
    const away = String(match.away || "").toLowerCase();
    return names.some((name) => home.includes(name) || away.includes(name) || name.includes(home) || name.includes(away));
  }

  function eventKind(event) {
    const blob = `${event.type || ""} ${event.text || ""}`.toLowerCase();
    if (/substitution|replaces/.test(blob)) return "";
    if (blob.includes("own goal")) return "Own goal";
    if (blob.includes("red")) return "Red card";
    if (blob.includes("yellow")) return "Yellow card";
    if (blob.includes("penalty")) return "Penalty";
    if (blob.includes("goal") || event.scoring) return "Goal";
    return "";
  }

  function planAlerts({ matches, favorites, now, seen, settings, eventsByMatch, prime }) {
    const notify = [];
    const mark = [];
    const already = seen || new Set();
    if (!settings?.enabled || !favorites?.length) return { notify, mark };
    for (const match of matches || []) {
      if (!involvesFavourite(match, favorites)) continue;
      const start = new Date(match.start).getTime();
      const label = `${match.home} v ${match.away}`;
      const started =
        match.status === "Live" ||
        (match.status === "Upcoming" && Number.isFinite(start) && start <= now && now - start < 3 * 60 * 60 * 1000);
      if (settings.matchReminders !== false && match.status === "Upcoming" && Number.isFinite(start) && start > now) {
        const mins = Math.round((start - now) / 60000);
        if (mins > 0 && mins <= 15) {
          const key = `soon-${match.id}`;
          if (!already.has(key)) {
            if (!prime) notify.push({ key, title: "Kickoff soon", body: `${label} starts in ${mins} min` });
            mark.push(key);
          }
        }
      }
      if (settings.matchReminders !== false && started && match.status !== "FT") {
        const key = `live-${match.id}`;
        if (!already.has(key) && !prime) {
          const score =
            match.homeScore == null ? "" : ` · ${match.homeScore}-${match.awayScore}`;
          notify.push({ key, title: "Match on", body: `${label} is underway${score}` });
          mark.push(key);
        }
      }
      if (settings.eventAlerts !== false && (started || match.status === "FT")) {
        for (const event of eventsByMatch?.[match.id] || []) {
          const kind = eventKind(event);
          if (!kind) continue;
          const key = `ev-${match.id}-${event.minute || ""}-${kind}-${event.text || ""}`;
          if (already.has(key)) continue;
          if (!prime) {
            notify.push({
              key,
              title: kind,
              body: `${event.minute ? `${event.minute} ` : ""}${event.text || label}`,
            });
          }
          mark.push(key);
        }
      }
    }
    return { notify, mark };
  }

  root.NINETY_ALERTS = { involvesFavourite, eventKind, planAlerts };

  if (typeof process !== "undefined" && process.argv && process.argv.includes("--self-test")) {
    const now = Date.parse("2026-10-24T15:00:00Z");
    const matches = [
      { id: "1", home: "Arsenal", away: "Chelsea", status: "Live", start: "2026-10-24T14:00:00Z", homeScore: 1, awayScore: 0 },
      { id: "2", home: "Liverpool", away: "Everton", status: "Upcoming", start: "2026-10-24T15:10:00Z", homeScore: null, awayScore: null },
      { id: "3", home: "Milan", away: "Roma", status: "Live", start: "2026-10-24T14:00:00Z", homeScore: 0, awayScore: 0 },
    ];
    const events = {
      1: [
        { minute: "12'", type: "Goal", text: "Goal! Saka scores.", scoring: true },
        { minute: "40'", type: "Substitution", text: "Smith replaces Jones." },
        { minute: "55'", type: "Yellow Card", text: "Yellow card for Rice." },
      ],
    };
    const first = planAlerts({
      matches,
      favorites: ["Arsenal"],
      now,
      seen: new Set(),
      settings: { enabled: true, matchReminders: true, eventAlerts: true },
      eventsByMatch: events,
      prime: true,
    });
    if (first.notify.length) throw new Error("prime should stay quiet");
    if (!first.mark.some((key) => key.startsWith("ev-1"))) throw new Error("prime should mark events");
    const seen = new Set(first.mark);
    const next = planAlerts({
      matches,
      favorites: ["Arsenal"],
      now,
      seen,
      settings: { enabled: true, matchReminders: true, eventAlerts: true },
      eventsByMatch: {
        1: events[1].concat([{ minute: "70'", type: "Goal", text: "Goal! Havertz scores.", scoring: true }]),
      },
      prime: false,
    });
    if (next.notify.length !== 2) throw new Error(`expected live + new goal, got ${next.notify.map((n) => n.title).join(",")}`);
    if (next.notify.some((note) => note.body.includes("Smith"))) throw new Error("sub should not alert");
    const soon = planAlerts({
      matches,
      favorites: ["Liverpool"],
      now,
      seen: new Set(),
      settings: { enabled: true, matchReminders: true, eventAlerts: true },
      eventsByMatch: {},
      prime: false,
    });
    if (!soon.notify.some((note) => note.title === "Kickoff soon")) throw new Error("missing kickoff");
    console.log("alerts self-test ok", next.notify.map((note) => note.title));
  }
})(typeof window !== "undefined" ? window : globalThis);
