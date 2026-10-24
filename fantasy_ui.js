/* Fantasy pages: team, transfers, points, fixtures, leagues, rankings, and the rest of the game. */
(function (root) {
  const GAME = () => root.NINETY_FANTASY_GAME;
  const CORE = () => root.NINETY_FANTASY;
  const PAGES = [
    ["home", "Home"],
    ["team", "Pick Team"],
    ["transfers", "Transfers"],
    ["players", "Players"],
    ["points", "Points"],
    ["fixtures", "Fixtures"],
    ["live", "Live"],
    ["leagues", "Leagues"],
    ["ranks", "Ranks"],
    ["stats", "Stats"],
    ["news", "News"],
    ["history", "History"],
    ["achievements", "Badges"],
    ["rules", "Rules"],
    ["settings", "Settings"],
  ];
  let screen = "home";
  let state = null;
  let ctx = null;
  let focusId = "";
  let leagueCode = "";
  let playerRows = [];
  let playerNote = "";
  let busy = false;
  let weekShift = 0;
  let pointsTab = "pitch";
  let pointsStat = "points";
  let pickTab = "pitch";
  let pickStat = "fixture";
  let transferTab = "pitch";
  let transferStat = "fixture";
  let transferFocus = false;
  let badgeBusy = false;
  let renderStamp = 0;
  let rulesLoaded = false;
  let menuDismissBound = false;

  function esc(value) {
    return ctx.escapeHtml(value ?? "");
  }

  function go(next) {
    screen = next;
    render(ctx);
    root.updateNav?.();
  }

  function persist() {
    const before = new Set((state.achievements || []).map((item) => item.id));
    GAME().unlock(state);
    GAME().save(state);
    (state.achievements || [])
      .filter((item) => !before.has(item.id))
      .forEach((badge) => ctx.onNotice?.({ key: `badge-${badge.id}`, title: "Achievement", body: badge.name }));
    publish();
  }

  function managerId() {
    const user = ctx.user;
    if (user?.id) return user.id;
    let id = localStorage.getItem("ninety-manager-id");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("ninety-manager-id", id);
    }
    return id;
  }

  async function publish() {
    const raw = ctx.points?.total || 0;
    const weekPoints = GAME().netPoints(state, raw);
    const total = GAME().records(state).total + weekPoints;
    try {
      await fetch("/api/fantasy/entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: managerId(),
          name: ctx.user?.displayName || ctx.user?.name || "Manager",
          teamName: state.teamName || "Fantasy",
          points: total,
          weekPoints,
          week: state.weekKey,
          captain: state.squad.find((player) => player.captain)?.name || "",
          chip: state.chipThisWeek,
          country: state.country || ctx.user?.country || "",
          region: state.region || ctx.user?.region || "",
          squadNames: state.squad.map((player) => player.name),
          transfers: (state.transferLog || []).slice(0, 8),
        }),
      });
    } catch {
      /* The table updates the next time the server is reachable. */
    }
  }

  function nav() {
    return `<div class="fantasy-nav">${PAGES.map(
      ([id, label]) => `<button type="button" class="seg-btn ${screen === id ? "is-on" : ""}" data-screen="${id}" title="${label}" aria-current="${screen === id ? "page" : "false"}">${label}</button>`
    ).join("")}</div>`;
  }

  function shell(inner, options) {
    const bar = options?.bare ? "" : nav();
    ctx.list.innerHTML = `${bar}<div class="fantasy-page${options?.bare ? " is-home" : ""}">${inner}</div>`;
    ctx.list.querySelectorAll("[data-screen]").forEach((button) => {
      button.addEventListener("click", () => go(button.dataset.screen));
    });
  }

  function deadlineLine() {
    const deadline = CORE().deadlineMs(ctx.matches || [], new Date(), GAME().offset());
    if (!deadline) return "No fixture in this gameweek yet, so the squad stays open.";
    const remaining = deadline - Date.now();
    if (remaining <= 0) return "Deadline passed. The team is locked until the next gameweek.";
    const hours = Math.floor(remaining / 3600000);
    const mins = Math.floor((remaining % 3600000) / 60000);
    return `Deadline in ${hours}h ${mins}m`;
  }

  const FLAGS = {
    england: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
    "united kingdom": "🇬🇧",
    uk: "🇬🇧",
    spain: "🇪🇸",
    france: "🇫🇷",
    germany: "🇩🇪",
    italy: "🇮🇹",
    nigeria: "🇳🇬",
    portugal: "🇵🇹",
    netherlands: "🇳🇱",
    brazil: "🇧🇷",
    argentina: "🇦🇷",
    usa: "🇺🇸",
    "united states": "🇺🇸",
  };
  const BADGE_COLORS = ["#102a52", "#0057b8", "#1a1a1a", "#6b4e16", "#7a1f3d"];
  let homeTab = "leagues";
  let boardFocus = "overall";

  function flagFor(country) {
    return FLAGS[String(country || "").trim().toLowerCase()] || "";
  }

  function commas(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "–";
    return new Intl.NumberFormat("en-GB").format(number);
  }

  function deadlineStamp() {
    const offset = GAME().offset();
    const now = new Date();
    const currentWeek = GAME().weekNumber(now);
    let deadline = CORE().deadlineMs(ctx.matches || [], now, offset);
    let week = currentWeek;
    if (!deadline || deadline <= Date.now()) {
      const next = new Date(Date.parse(`${CORE().weekKey(now)}T12:00:00Z`) + 7 * 86400000);
      const upcoming = CORE().deadlineMs(ctx.matches || [], next, offset);
      week = currentWeek + 1;
      deadline = upcoming;
    }
    return { deadline, week, currentWeek };
  }

  function formatDeadline(ms) {
    if (!ms) return "No kickoff in the loaded list yet";
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      weekday: "long",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(ms));
    const get = (type) => parts.find((part) => part.type === type)?.value || "";
    return `${get("weekday")} ${get("day")} ${get("month")} at ${get("hour")}:${get("minute")}`;
  }

  function shortDeadline(ms) {
    if (!ms) return "no kickoff yet";
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(ms));
    const get = (type) => parts.find((part) => part.type === type)?.value || "";
    return `${get("weekday")} ${get("day")} ${get("month")} at ${get("hour")}:${get("minute")}`;
  }

  function moveMark(current, previous) {
    if (previous == null || previous === current) return `<span class="rank-flat">–</span>`;
    if (current < previous) return `<span class="rank-up">▲</span>`;
    return `<span class="rank-down">▼</span>`;
  }

  function pageHome() {
    const raw = ctx.points?.total || 0;
    const net = GAME().netPoints(state, raw);
    const stamp = deadlineStamp();
    const country = state.country || ctx.user?.country || "";
    const manager = ctx.user?.displayName || ctx.user?.name || "Manager";
    const initials = (state.teamName || "FC")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0])
      .join("")
      .toUpperCase() || "FC";
    const color = BADGE_COLORS[(state.badgeColor || 0) % BADGE_COLORS.length];
    const left = ctx.money(CORE().BUDGET - GAME().spent(state));
    shell(
      `
      <section class="fpl-card">
        <div class="fpl-top">
          <button type="button" class="fpl-badge${state.badgeImage ? " has-image" : ""}" id="gen-badge" style="--badge:${color}" title="Generate team badge">
            ${state.badgeImage ? `<img src="${esc(state.badgeImage)}" alt="" />` : `<strong>${esc(initials)}</strong><small>${badgeBusy ? "Drawing…" : "Generate team badge"}</small>`}
          </button>
          <div class="fpl-id">
            <h2>${esc(state.teamName || "Name your team")}</h2>
            <p>${flagFor(country) ? `${flagFor(country)} ` : ""}${esc(manager)}</p>
            <p class="fpl-bank">${left} left</p>
          </div>
          <button type="button" class="fpl-go" data-screen="team" aria-label="Open team">›</button>
        </div>
        <div class="fpl-split"></div>
        <p class="fpl-kicker">Gameweek ${stamp.currentWeek}</p>
        <div class="fpl-stats">
          <button type="button" data-screen="stats"><span class="fpl-stat-num" id="gw-average">–</span><span class="fpl-stat-label">Average</span></button>
          <button type="button" data-screen="points"><span class="fpl-stat-num is-hero">${net}</span><span class="fpl-stat-label">Points ›</span></button>
          <button type="button" data-screen="ranks"><span class="fpl-stat-num" id="gw-high">–</span><span class="fpl-stat-label">Highest ›</span></button>
        </div>
        <div class="fpl-split"></div>
        <div class="fpl-deadline">
          <p class="fpl-kicker">Gameweek ${stamp.week}</p>
          <strong>Deadline: ${esc(formatDeadline(stamp.deadline))}</strong>
        </div>
        <div class="fpl-actions">
          <button type="button" class="fpl-action" data-screen="team"><span aria-hidden="true">👕</span> Pick Team</button>
          <button type="button" class="fpl-action" data-screen="transfers"><span aria-hidden="true">⇄</span> Transfers</button>
        </div>
      </section>
      <div class="fpl-menu">
        <button type="button" class="fpl-row" data-screen="fixtures"><span>Fixtures</span><span>›</span></button>
        <button type="button" class="fpl-row" data-screen="prices"><span>Price Changes</span><span>›</span></button>
        <button type="button" class="fpl-row" data-screen="fixtures"><span>Fixture Difficulty Rating</span><span>›</span></button>
        <button type="button" class="fpl-row" data-screen="stats"><span>Player Statistics</span><span>›</span></button>
        <button type="button" class="fpl-row" data-screen="pieces"><span>Set Piece Takers</span><span>›</span></button>
      </div>
      <section class="fpl-section">
        <h3>Leagues &amp; Cups</h3>
        <div class="fpl-switch" role="tablist">
          <button type="button" class="${homeTab === "leagues" ? "is-on" : ""}" data-home-tab="leagues">Leagues</button>
          <button type="button" class="${homeTab === "cups" ? "is-on" : ""}" data-home-tab="cups">Cups</button>
        </div>
        <div class="fpl-pair">
          <button type="button" class="fpl-pill" data-screen="leagues">+ Join Leagues</button>
          <button type="button" class="fpl-pill" data-screen="leagues">⚙ Configure Leagues</button>
        </div>
        <h4 id="home-league-title">${homeTab === "cups" ? "Cups" : "Invitational Classic Leagues"}</h4>
        <div id="home-leagues"><div class="empty">Loading your leagues…</div></div>
        <h4>General Leagues</h4>
        <div id="home-general"><div class="empty">Loading ranks…</div></div>
        <button type="button" class="fpl-row fpl-more" data-screen="more"><span>More</span><span>›</span></button>
      </section>
    `,
      { bare: true }
    );
    ctx.list.querySelector("#gen-badge")?.addEventListener("click", () => {
      generateBadge();
    });
    ctx.list.querySelectorAll("[data-home-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        homeTab = button.dataset.homeTab;
        render(ctx);
      });
    });
    loadHomeBoard(renderStamp);
  }

  async function loadHomeBoard(stamp) {
    const codes = state.leagueCodes || [];
    const leagues = [];
    for (const code of codes) {
      const league = await fetch(`/api/fantasy/league?code=${encodeURIComponent(code)}`).then((res) => res.json()).catch(() => null);
      if (league?.code) leagues.push(league);
    }
    const country = state.country || ctx.user?.country || "";
    const [overall, week, local] = await Promise.all([
      fetch("/api/fantasy/rankings").then((res) => res.json()).catch(() => ({ rankings: [] })),
      fetch("/api/fantasy/rankings?sort=week").then((res) => res.json()).catch(() => ({ rankings: [] })),
      country
        ? fetch(`/api/fantasy/rankings?country=${encodeURIComponent(country)}`).then((res) => res.json()).catch(() => ({ rankings: [] }))
        : Promise.resolve({ rankings: [] }),
    ]);
    if (stamp !== renderStamp || screen !== "home") return;
    const scores = (week.rankings || []).map((row) => Number(row.weekPoints) || 0);
    const average = scores.length ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length) : 0;
    const highest = scores.length ? Math.max(...scores) : 0;
    const averageNode = ctx.list.querySelector("#gw-average");
    const highNode = ctx.list.querySelector("#gw-high");
    if (averageNode) averageNode.textContent = commas(average);
    if (highNode) highNode.textContent = commas(highest);
    const mine = managerId();
    const marks = { ...(state.leagueMarks || {}) };
    const shown = leagues.filter((league) => (homeTab === "cups" ? league.kind === "cup" : league.kind !== "cup"));
    const leagueBox = ctx.list.querySelector("#home-leagues");
    if (leagueBox) {
      leagueBox.innerHTML = shown.length
        ? shown
            .map((league) => {
              const member = (league.members || []).find((item) => item.userId === mine);
              const rank = member?.rank || league.members?.length || "–";
              const previous = marks[league.code];
              marks[league.code] = typeof rank === "number" ? rank : marks[league.code];
              return `<button type="button" class="fpl-league" data-league="${esc(league.code)}"><span>${esc(league.name)}</span><span class="fpl-rank">${rank} ${moveMark(rank, previous)}</span></button>`;
            })
            .join("")
        : `<div class="empty">${homeTab === "cups" ? "No cups yet. Create one from Join Leagues." : "Join a league to see it here."}</div>`;
      leagueBox.querySelectorAll("[data-league]").forEach((button) => {
        button.addEventListener("click", () => {
          leagueCode = button.dataset.league;
          go("league");
        });
      });
    }
    const me = (overall.rankings || []).find((row) => row.userId === mine);
    const meWeek = (week.rankings || []).find((row) => row.userId === mine);
    const meLocal = (local.rankings || []).find((row) => row.userId === mine);
    const previousOverall = state.boardMarks?.overall;
    const previousWeek = state.boardMarks?.week;
    const previousLocal = state.boardMarks?.country;
    const general = [
      ["overall", "Overall", me?.rank, overall.rankings?.length, previousOverall],
      country ? ["country", country, meLocal?.rank, local.rankings?.length, previousLocal] : null,
      ["week", `Gameweek ${GAME().weekNumber()}`, meWeek?.rank, week.rankings?.length, previousWeek],
    ].filter(Boolean);
    const generalBox = ctx.list.querySelector("#home-general");
    if (generalBox) {
      generalBox.innerHTML = general
        .map(([board, label, rank, total, previous]) => {
          const place = rank ? commas(rank) : "–";
          const ofTotal = total ? ` <small>of ${commas(total)}</small>` : "";
          return `<button type="button" class="fpl-league" data-board="${board}"><span>${esc(label)}</span><span class="fpl-rank">${place}${ofTotal} ${rank ? moveMark(rank, previous) : `<span class="rank-flat">–</span>`}</span></button>`;
        })
        .join("");
      generalBox.querySelectorAll("[data-board]").forEach((button) => {
        button.addEventListener("click", () => {
          boardFocus = button.dataset.board;
          go("ranks");
        });
      });
    }
    state.leagueMarks = marks;
    state.boardMarks = { overall: me?.rank || null, week: meWeek?.rank || null, country: meLocal?.rank || null };
    GAME().save(state);
  }

  function pageMore() {
    const links = [
      ["live", "Live"],
      ["players", "Players"],
      ["points", "Points"],
      ["history", "History"],
      ["season", "Season history"],
      ["achievements", "Badges"],
      ["news", "News"],
      ["alerts", "Notifications"],
      ["rules", "Rules"],
      ["settings", "Settings"],
      ["draft", "Draft"],
      ["planner", "Planner"],
      ["compare", "Compare"],
      ["h2h", "Head to head"],
      ["admin", "Admin"],
    ];
    shell(`<div class="fpl-menu">${links.map(([id, label]) => `<button type="button" class="fpl-row" data-screen="${id}"><span>${label}</span><span>›</span></button>`).join("")}</div>`);
  }

  async function pagePrices() {
    const stamp = renderStamp;
    shell(`<p class="group-title">Price changes</p><div class="group" id="price-box"><div class="loading">Loading price moves…</div></div>`);
    const data = await fetch("/api/fantasy/players?sort=change&limit=40").then((res) => res.json()).catch(() => ({ players: [] }));
    if (stamp !== renderStamp) return;
    const box = ctx.list.querySelector("#price-box");
    if (!box) return;
    const rows = (data.players || []).filter((player) => Number(player.priceChange));
    box.innerHTML = rows
      .map((player) => {
        const up = Number(player.priceChange) > 0;
        return `<button type="button" class="player-row" data-open-db="${esc(player.id)}"><div><div class="team-name">${esc(player.name)}</div><div class="team-meta">${esc(player.club)} · ${ctx.money(player.price)}</div></div><span class="${up ? "rank-up" : "rank-down"}">${up ? "+" : ""}${player.priceChange}</span></button>`;
      })
      .join("") || `<div class="empty">No price moves in the book right now.</div>`;
    box.querySelectorAll("[data-open-db]").forEach((button) => {
      button.addEventListener("click", () => {
        focusId = button.dataset.openDb;
        state.pending = (data.players || []).find((player) => player.id === focusId) || null;
        go("profile");
      });
    });
  }

  async function pagePieces() {
    const stamp = renderStamp;
    shell(`<p class="group-title">Set piece takers</p><div class="group" id="piece-box"><div class="loading">Loading takers…</div></div>`);
    const data = await fetch("/api/fantasy/players?sort=points&limit=80").then((res) => res.json()).catch(() => ({ players: [] }));
    if (stamp !== renderStamp) return;
    const box = ctx.list.querySelector("#piece-box");
    if (!box) return;
    const rows = (data.players || []).filter((player) => player.penalties || player.setPieces).slice(0, 30);
    box.innerHTML = rows
      .map(
        (player) => `<button type="button" class="player-row" data-open-db="${esc(player.id)}"><div><div class="team-name">${esc(player.name)}</div><div class="team-meta">${esc(player.club)} · ${esc(player.penalties || player.setPieces)}</div></div><span>${ctx.money(player.price)}</span></button>`
      )
      .join("") || `<div class="empty">No penalty or set-piece notes in this slice of the book.</div>`;
    box.querySelectorAll("[data-open-db]").forEach((button) => {
      button.addEventListener("click", () => {
        focusId = button.dataset.openDb;
        state.pending = rows.find((player) => player.id === focusId) || null;
        go("profile");
      });
    });
  }

  function ticker() {
    const clubs = state.squad.map((player) => String(player.club || "").toLowerCase()).filter(Boolean);
    const games = GAME().fixturesFor(ctx.matches || []).filter((match) => clubs.some((club) => String(match.home).toLowerCase().includes(club) || String(match.away).toLowerCase().includes(club)));
    return games.slice(0, 8).map((match) => `<span>${esc(match.home)} v ${esc(match.away)}</span>`).join("") || "<span>No squad fixtures in this gameweek</span>";
  }

  function pitchHtml() {
    const lines = ["A", "M", "D", "G"];
    const xi = state.squad.filter((player) => player.xi);
    const body = lines
      .map((slot) => {
        const players = xi.filter((player) => player.slot === slot);
        if (!players.length) return "";
        return `<div class="pitch-line">${players
          .map((player) => {
            const scored = ctx.points?.players?.find((item) => item.id === player.id);
            return `<button type="button" class="pitch-player" draggable="true" data-drag="${esc(player.id)}" data-open="${esc(player.id)}">
              ${ctx.faceMarkup(faceOf(player).url, player.name, "pitch-face", faceOf(player).fallback)}
              <span class="pitch-name">${esc(player.name.split(" ").slice(-1)[0])}${player.captain ? " (C)" : ""}${player.vice ? " (V)" : ""}</span>
              <span class="pitch-meta">${scored ? `${scored.points} pts` : ctx.money(player.price)}</span>
            </button>`;
          })
          .join("")}</div>`;
      })
      .join("");
    return `<div class="group pitch-wrap"><div class="pitch pitch-portrait"><div class="pitch-markings" aria-hidden="true"><span class="pitch-box pitch-box-top"></span><span class="pitch-box pitch-box-bottom"></span></div><p class="pitch-shape">${esc(state.formation)}</p>${body || `<p class="pitch-empty">Sign players to fill the pitch.</p>`}</div></div>`;
  }

  function bindPitch() {
    ctx.list.querySelectorAll("[data-open]").forEach((button) => {
      button.addEventListener("click", () => {
        focusId = button.dataset.open;
        go("profile");
      });
    });
    let from = "";
    ctx.list.querySelectorAll("[data-drag]").forEach((button) => {
      button.addEventListener("dragstart", () => {
        from = button.dataset.drag;
      });
      button.addEventListener("dragover", (event) => event.preventDefault());
      button.addEventListener("drop", () => {
        const left = state.squad.find((player) => player.id === from);
        const right = state.squad.find((player) => player.id === button.dataset.drag);
        if (!left || !right || left.slot !== right.slot) return;
        const xi = left.xi;
        left.xi = right.xi;
        right.xi = xi;
        const captain = left.captain;
        left.captain = right.captain;
        right.captain = captain;
        persist();
        render(ctx);
      });
    });
  }

  function chipGlyph(kind) {
    const art = {
      bench: `<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#3b82f6" d="M24 4 41 14v20L24 44 7 34V14z"/><circle cx="18" cy="18" r="3" fill="#fff"/><circle cx="30" cy="19" r="3" fill="#dbeafe"/><path fill="#fff" d="M11.5 31.5c1.3-4.2 4.2-6.3 7.6-6.3 2.6 0 4.8 1.2 6.2 3.4-1.8 1.1-3 2.4-3.6 4-1.7-1.6-3.8-2.4-6.4-2.4-1.4 0-2.6.2-3.8.6z"/><path fill="#eff6ff" d="M25 30.2c1.2-3.2 3.4-5 6.4-5 3 0 5.4 1.8 6.6 5.4-1.6.7-3.8 1.2-6.4 1.2-2.6 0-4.8-.6-6.6-1.6z"/></svg>`,
      triple: `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="18" fill="#22d3ee"/><path d="M16 16.5a12.5 12.5 0 1 1 1.2 16.2" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/><path d="M14.2 14.2 16.4 19.2 11.6 18.2" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="24" cy="24" r="9" fill="#fff"/><path d="M27.2 19.2a6.2 6.2 0 1 0 .2 9.6" fill="none" stroke="#0891b2" stroke-width="2.3" stroke-linecap="round"/></svg>`,
      wildcard: `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="8" y="10" width="22" height="30" rx="3" fill="#93c5fd" transform="rotate(-10 19 25)"/><rect x="17" y="8" width="22" height="30" rx="3" fill="#2563eb"/><path fill="#fff" d="m28 16.2 1.5 4.2h4.4l-3.5 2.6 1.3 4.2L28 24.6l-3.7 2.6 1.3-4.2-3.5-2.6h4.4z"/></svg>`,
      freehit: `<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#a855f7" d="M24 5 42 24 24 19z"/><path fill="#38bdf8" d="M24 5 6 24 24 19z"/><path fill="#f59e0b" d="M6 24 24 43 24 27z"/><path fill="#fb7185" d="M42 24 24 43 24 27z"/></svg>`,
    };
    return art[kind] || art.bench;
  }

  function chipFace(id) {
    if (state.chipThisWeek === id || state.chipQueued === id) return { text: "Playing", used: true };
    const used = state.chips?.[id];
    if (!used) return { text: "Play", used: false };
    const week = GAME().weekNumber(new Date(`${used}T12:00:00Z`));
    return { text: `Played in GW${week}`, used: true };
  }

  function startBenchPlayer(id) {
    const player = state.squad.find((item) => item.id === id);
    if (!player || player.xi) return;
    const shape = GAME().FORMATIONS[state.formation];
    const xi = state.squad.filter((item) => item.xi && item.slot === player.slot);
    if (player.slot !== "G" && xi.length >= shape[player.slot]) {
      const drop = xi[xi.length - 1];
      drop.xi = false;
    }
    if (player.slot === "G") state.squad.filter((item) => item.slot === "G").forEach((item) => (item.xi = false));
    player.xi = true;
    GAME().logSub(state, `${player.name} moved into the XI.`);
    persist();
    render(ctx);
  }

  function pageTeam() {
    const stamp = deadlineStamp();
    const pickWhen = stamp.deadline ? new Date(stamp.deadline) : new Date();
    const shape = GAME().FORMATIONS[state.formation] || GAME().FORMATIONS["4-3-3"];
    const rank = { G: 0, D: 1, M: 2, A: 3 };
    const xi = state.squad.filter((player) => player.xi);
    const bench = state.squad.filter((player) => !player.xi).slice().sort((a, b) => (rank[a.slot] ?? 9) - (rank[b.slot] ?? 9));
    const card = (player, extra) => shirtCard(player, { mode: pickStat, when: pickWhen, drag: true, ...extra });
    const lines = ["G", "D", "M", "A"].map((slot) => {
      const need = slot === "G" ? 1 : shape[slot] || 0;
      const players = xi.filter((player) => player.slot === slot);
      const cells = players.map((player) => card(player));
      while (cells.length < need) {
        cells.push(`<button type="button" class="shirt-card is-empty is-add" data-add-slot="${slot}" aria-label="Add ${SLOT_LABEL[slot] || "player"}"><span class="shirt-photo"><span class="shirt-plus" aria-hidden="true">+</span></span><span class="shirt-name"></span></button>`);
      }
      return `<div class="gw-line" data-line="${slot}">${cells.join("")}</div>`;
    });
    const crest = state.badgeImage
      ? `<img src="${esc(state.badgeImage)}" alt="" />`
      : `<span class="gw-crest-mark" style="--badge:${BADGE_COLORS[(state.badgeColor || 0) % BADGE_COLORS.length]}"></span>`;
    const wildcardId = GAME().weekNumber(pickWhen) <= 19 ? "wildcard1" : "wildcard2";
    const chips = [
      ["bench", "Bench Boost", "bench"],
      ["triple", "Triple Captain", "triple"],
      [wildcardId, "Wildcard", "wildcard"],
      ["freehit", "Free Hit", "freehit"],
    ];
    const statName = pickStat === "price" ? "Price" : pickStat === "points" ? "Points" : "Opponent";
    const opponentIcon = `<svg class="pick-opp" viewBox="0 0 20 16" aria-hidden="true"><rect x="0.5" y="3" width="11" height="12" rx="1.6" fill="#7c5cff"/><rect x="8" y="0.5" width="11" height="12" rx="1.6" fill="#3b82f6" stroke="#fff" stroke-width="1"/></svg>`;
    const listBody = ["G", "D", "M", "A"]
      .map((slot) => {
        const players = state.squad.filter((player) => player.slot === slot);
        if (!players.length) return "";
        return `<p class="gw-list-label">${SLOT_LABEL[slot]}</p><div class="gw-list">${players
          .map((player) => {
            const photo = faceOf(player);
            return `<div class="gw-list-row">${ctx.faceMarkup(photo.url, player.name, "shirt-face", photo.fallback)}<span><button type="button" class="gw-list-open" data-open="${esc(player.id)}"><strong>${esc(player.name)}${player.captain ? " (C)" : ""}${player.vice ? " (V)" : ""}</strong></button><small>${player.xi ? "Starting" : "Bench"} · ${esc(player.club || "")}</small>${player.xi ? "" : `<button type="button" class="mini-btn" data-xi="${esc(player.id)}">Start</button>`}</span><b>${esc(playerStat(player, pickStat, pickWhen))}</b></div>`;
          })
          .join("")}</div>`;
      })
      .join("");
    const manage = `
      <div class="pick-manage">
        <form class="team-search" id="team-name-form">
          <input name="team" value="${esc(state.teamName)}" placeholder="Team name" />
          <button class="search-go" type="submit">Save</button>
        </form>
        <div class="fantasy-nav">${Object.keys(GAME().FORMATIONS)
          .map((form) => `<button type="button" class="seg-btn ${state.formation === form ? "is-on" : ""}" data-form="${form}">${form}</button>`)
          .join("")}</div>
        <p class="group-title">${state.squad.length}/15 · max ${GAME().CLUB_CAP} per club · ${esc(state.formation)}</p>
        ${listBody || `<div class="empty">Sign players to fill the pitch.</div>`}
        <div class="group">${GAME().issues(state).map((note) => `<div class="setting-row"><span>${esc(note)}</span></div>`).join("") || `<div class="empty">Valid for this formation.</div>`}</div>
        <div class="fantasy-actions"><button type="button" class="mini-btn" id="share-team" title="Copy a text team sheet">Share team</button></div>
        <p class="group-title">Substitution history</p>
        <div class="group">${(state.subLog || []).slice(0, 8).map((row) => `<div class="setting-row"><span>${esc(row.text)}</span></div>`).join("") || `<div class="empty">Bench changes are kept here.</div>`}</div>
      </div>`;
    shell(
      `
      <div class="gw-screen is-pick">
        <header class="gw-head">
          <button type="button" class="gw-back" id="pick-back" aria-label="Back">‹</button>
          <div class="gw-titles"><h2>Pick Team</h2></div>
          <div class="gw-crest">${crest}</div>
        </header>
        <p class="pick-deadline">Gameweek ${stamp.week} • Deadline: ${esc(stamp.deadline ? shortDeadline(stamp.deadline) : "no kickoff yet")}</p>
        <div class="pick-chips">
          ${chips
            .map(([id, label, kind]) => {
              const face = chipFace(id);
              const status = face.used
                ? `<span class="pick-chip-status">${esc(face.text)}</span>`
                : `<button type="button" data-chip="${id}">Play</button>`;
              return `<div class="pick-chip${face.used ? " is-used" : ""}">${chipGlyph(kind)}<strong>${esc(label)}</strong>${status}</div>`;
            })
            .join("")}
        </div>
        <div class="gw-tools">
          <div class="gw-switch" role="tablist">
            <button type="button" data-pick-tab="pitch" class="${pickTab === "pitch" ? "is-on" : ""}">Pitch</button>
            <button type="button" data-pick-tab="list" class="${pickTab === "list" ? "is-on" : ""}">List</button>
          </div>
          <div class="gw-menu">
            <button type="button" id="pick-stat" aria-expanded="false" aria-haspopup="menu">${opponentIcon}${statName} <span class="gw-chevron" aria-hidden="true"></span></button>
            <div class="gw-menu-pop" id="pick-stat-pop" role="menu" hidden>
              <button type="button" data-pick-stat="fixture" class="${pickStat === "fixture" ? "is-on" : ""}">Opponent</button>
              <button type="button" data-pick-stat="points" class="${pickStat === "points" ? "is-on" : ""}">Points</button>
              <button type="button" data-pick-stat="price" class="${pickStat === "price" ? "is-on" : ""}">Price</button>
              <button type="button" data-close-menu>Close</button>
            </div>
          </div>
        </div>
        ${
          pickTab === "list"
            ? manage
            : `<div class="gw-pitch">
                <div class="gw-sky"><span>Fantasy</span><i class="gw-goal"></i><span>Fantasy</span></div>
                ${lines.join("")}
              </div>
              <div class="gw-bench">
                ${
                  bench.length
                    ? bench.map((player) => `<div class="gw-bench-slot"><span>${SLOT_LABEL[player.slot] || player.slot}</span>${card(player, { bench: true })}</div>`).join("")
                    : `<p class="gw-bench-empty">Bench is empty.</p>`
                }
              </div>`
        }
      </div>
    `,
      { bare: true }
    );
    ctx.list.querySelector("#pick-back")?.addEventListener("click", () => go("home"));
    ctx.list.querySelectorAll("[data-pick-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        pickTab = button.dataset.pickTab;
        render(ctx);
      });
    });
    bindStatMenu(ctx.list.querySelector("#pick-stat"), ctx.list.querySelector("#pick-stat-pop"));
    ctx.list.querySelectorAll("[data-pick-stat]").forEach((button) => {
      button.addEventListener("click", () => {
        pickStat = button.dataset.pickStat;
        render(ctx);
      });
    });
    ctx.list.querySelectorAll("[data-chip]").forEach((button) => {
      button.addEventListener("click", () => {
        const name = chipName(button.dataset.chip).replace(", first half", "").replace(", second half", "");
        if (!window.confirm(`Play ${name} this gameweek?`)) return;
        const error = GAME().playChip(state, button.dataset.chip, ctx.matches || []);
        if (error) window.alert(error);
        persist();
        render(ctx);
      });
    });
    ctx.list.querySelector("#team-name-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      state.teamName = new FormData(event.target).get("team").toString();
      state.built = state.squad.length >= 15 || state.built;
      persist();
      render(ctx);
    });
    ctx.list.querySelectorAll("[data-form]").forEach((button) => {
      button.addEventListener("click", () => {
        state.formation = button.dataset.form;
        GAME().applyFormation(state);
        persist();
        render(ctx);
      });
    });
    ctx.list.querySelectorAll("[data-xi]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        startBenchPlayer(button.dataset.xi);
      });
    });
    ctx.list.querySelectorAll("[data-add-slot]").forEach((button) => {
      button.addEventListener("click", () => {
        transferTab = "list";
        transferFocus = true;
        go("transfers");
      });
    });
    ctx.list.querySelector("#share-team")?.addEventListener("click", async () => {
      const lines = [`${state.teamName || "Fantasy"} · ${state.formation}`, ...state.squad.map((player) => `${player.xi ? "XI" : "Bench"} ${player.slot} ${player.name}${player.captain ? " (C)" : ""}${player.vice ? " (V)" : ""}`)];
      const text = lines.join("\n");
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        /* The sheet is still shown if the clipboard is blocked. */
      }
      window.alert(text);
    });
    bindPitch();
    queueFaces(renderStamp);
  }

  function pageTransfers() {
    const idea = GAME().suggest(state);
    const stamp = deadlineStamp();
    const when = stamp.deadline ? new Date(stamp.deadline) : new Date();
    const hit = GAME().hit(state);
    const left = CORE().BUDGET - GAME().spent(state);
    const wildcardId = GAME().weekNumber(when) <= 19 ? "wildcard1" : "wildcard2";
    const chips = [
      [wildcardId, "Wildcard", "wildcard"],
      ["freehit", "Free Hit", "freehit"],
    ];
    const caps = GAME().SQUAD;
    const lines = ["G", "D", "M", "A"].map((slot) => {
      const players = state.squad.filter((player) => player.slot === slot);
      const cells = players.map((player) => shirtCard(player, { mode: transferStat, when, price: ctx.money(player.price), sell: true }));
      const need = caps[slot] || 0;
      while (cells.length < need) cells.push(`<button type="button" class="shirt-card is-empty" data-add aria-label="Add player"><span class="shirt-photo"><span class="shirt-sub"></span></span><span class="shirt-name"></span></button>`);
      return `<div class="gw-line" data-line="${slot}">${cells.join("")}</div>`;
    });
    const crest = state.badgeImage
      ? `<img src="${esc(state.badgeImage)}" alt="" />`
      : `<span class="gw-crest-mark"></span>`;
    const statName = transferStat === "price" ? "Price" : transferStat === "points" ? "Points" : "Opponent";
    const opponentIcon = `<svg class="pick-opp" viewBox="0 0 20 16" aria-hidden="true"><rect x="0.5" y="3" width="11" height="12" rx="1.6" fill="#7c5cff"/><rect x="8" y="0.5" width="11" height="12" rx="1.6" fill="#3b82f6" stroke="#fff" stroke-width="1"/></svg>`;
    const listBody = `
      <div class="pick-manage">
        <p class="group-title">${esc(idea.note)}</p>
        <div class="fantasy-actions"><button type="button" class="mini-btn" id="undo-transfer">Undo last transfer</button><button type="button" class="mini-btn" id="ask-transfer">Ask Derby</button></div>
        <form class="team-search" id="sign-form">
          <input name="q" placeholder="Search a player to buy" ${transferFocus ? "autofocus" : ""} />
          <button class="search-go" type="submit">Search</button>
        </form>
        <div id="sign-results"></div>
        <p class="group-title">Squad</p>
        <div class="group">${state.squad
          .map(
            (player) => `<div class="setting-row"><strong>${esc(player.name)}</strong><span>${ctx.money(player.price)} <button type="button" class="mini-btn" data-sell="${esc(player.id)}">Sell</button></span></div>`
          )
          .join("") || `<div class="empty">No players yet.</div>`}</div>
        <p class="group-title">Transfer history</p>
        <div class="group">${(state.transferLog || [])
          .slice(0, 12)
          .map((row) => `<div class="setting-row"><strong>${esc(row.in || "Sold")}</strong><span>${esc(row.out || row.in)} ${ctx.money(row.price)}</span></div>`)
          .join("") || `<div class="empty">No transfers yet.</div>`}</div>
      </div>`;
    shell(
      `
      <div class="gw-screen is-transfer">
        <header class="gw-head">
          <button type="button" class="gw-back" id="xfer-back" aria-label="Back">‹</button>
          <div class="gw-titles"><h2>Transfers</h2></div>
          <div class="gw-crest">${crest}</div>
        </header>
        <p class="pick-deadline">Gameweek ${stamp.week} • Deadline: ${esc(stamp.deadline ? shortDeadline(stamp.deadline) : "no kickoff yet")}</p>
        <div class="xfer-stats">
          <div class="xfer-stat"><strong>${state.freeTransfers}</strong><span>Free Transfers</span></div>
          <div class="xfer-stat"><strong>${hit ? `-${hit} pts` : "0 pts"}</strong><span>Cost</span></div>
          <div class="xfer-stat xfer-budget"><strong>${esc(ctx.money(left))}</strong><span>Budget</span></div>
          ${chips
            .map(([id, label, kind]) => {
              const face = chipFace(id);
              const status = face.used ? `<span class="pick-chip-status">${esc(face.text)}</span>` : `<button type="button" data-chip="${id}">Play</button>`;
              return `<div class="pick-chip xfer-chip${face.used ? " is-used" : ""}">${chipGlyph(kind)}<strong>${esc(label)}</strong>${status}</div>`;
            })
            .join("")}
        </div>
        <div class="gw-tools">
          <div class="gw-switch" role="tablist">
            <button type="button" data-xfer-tab="pitch" class="${transferTab === "pitch" ? "is-on" : ""}">Pitch</button>
            <button type="button" data-xfer-tab="list" class="${transferTab === "list" ? "is-on" : ""}">List</button>
          </div>
          <div class="gw-menu">
            <button type="button" id="xfer-stat" aria-expanded="false" aria-haspopup="menu">${opponentIcon}${statName} <span class="gw-chevron" aria-hidden="true"></span></button>
            <div class="gw-menu-pop" id="xfer-stat-pop" role="menu" hidden>
              <button type="button" data-xfer-stat="fixture" class="${transferStat === "fixture" ? "is-on" : ""}">Opponent</button>
              <button type="button" data-xfer-stat="points" class="${transferStat === "points" ? "is-on" : ""}">Points</button>
              <button type="button" data-xfer-stat="price" class="${transferStat === "price" ? "is-on" : ""}">Price</button>
              <button type="button" data-close-menu>Close</button>
            </div>
          </div>
        </div>
        ${
          transferTab === "list"
            ? listBody
            : `<div class="gw-pitch">
                <div class="gw-sky"><span>Fantasy</span><i class="gw-goal"></i><span>Fantasy</span></div>
                ${lines.join("")}
              </div>`
        }
        <div class="xfer-bar">
          <button type="button" id="add-player">Add Player</button>
          <button type="button" id="xfer-next">Next</button>
        </div>
      </div>
    `,
      { bare: true }
    );
    ctx.list.querySelector("#xfer-back")?.addEventListener("click", () => go("home"));
    ctx.list.querySelectorAll("[data-xfer-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        transferTab = button.dataset.xferTab;
        render(ctx);
      });
    });
    bindStatMenu(ctx.list.querySelector("#xfer-stat"), ctx.list.querySelector("#xfer-stat-pop"));
    ctx.list.querySelectorAll("[data-xfer-stat]").forEach((button) => {
      button.addEventListener("click", () => {
        transferStat = button.dataset.xferStat;
        render(ctx);
      });
    });
    const openSearch = () => {
      transferTab = "list";
      transferFocus = true;
      render(ctx);
    };
    ctx.list.querySelector("#add-player")?.addEventListener("click", openSearch);
    ctx.list.querySelectorAll("[data-add]").forEach((button) => button.addEventListener("click", openSearch));
    ctx.list.querySelector("#xfer-next")?.addEventListener("click", () => go("team"));
    ctx.list.querySelector("#undo-transfer")?.addEventListener("click", () => {
      const error = GAME().rollback(state);
      if (error) return window.alert(error);
      persist();
      render(ctx);
    });
    ctx.list.querySelector("#ask-transfer")?.addEventListener("click", () => {
      ctx.ask(`Suggest transfers for my Derby fantasy team ${state.teamName}. Squad: ${state.squad.map((player) => `${player.name} ${player.slot} ${player.price}`).join(", ")}. ${idea.note}`);
    });
    ctx.list.querySelector("#sign-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const query = new FormData(event.target).get("q").toString();
      const box = ctx.list.querySelector("#sign-results");
      box.innerHTML = `<div class="group"><div class="loading">Searching…</div></div>`;
      const hits = await ctx.api.searchPlayers(query).catch(() => []);
      const priced = await Promise.all(
        hits.slice(0, 8).map(async (hit) => ({ ...hit, quote: await ctx.api.quoteFantasy(hit).catch(() => null) }))
      );
      box.innerHTML = `<div class="group">${priced
        .map((hit, index) => {
          const price = hit.quote?.price;
          const photo = hit.quote?.headshot || "";
          return `<div class="player-row">${ctx.faceMarkup(photo, hit.name)}<div><div class="team-name">${esc(hit.name)}</div><div class="team-meta">${esc(hit.teamName || "")} · ${esc((!hit.quote?.estimated && hit.quote?.slot) || CORE().slotOf(hit.positionName || hit.position))} · ${price == null ? "—" : ctx.money(price)}</div></div><button type="button" class="mini-btn" data-buy="${index}">Buy</button></div>`;
        })
        .join("")}</div>`;
      box.querySelectorAll("[data-buy]").forEach((button) => {
        button.addEventListener("click", () => {
          const hit = priced[Number(button.dataset.buy)];
          const player = {
            id: hit.id,
            name: hit.name,
            club: hit.teamName || "",
            slot: (!hit.quote?.estimated && hit.quote?.slot) || CORE().slotOf(hit.positionName || hit.position),
            position: hit.positionName || hit.position || "",
            price: Number(hit.quote?.price),
            headshot: hit.quote?.headshot || "",
            espnHeadshot: "",
            status: "available",
            sources: hit.quote?.sources || [],
            form: 0,
          };
          const reason = GAME().canSign(state, player, ctx.matches || []);
          if (reason) {
            window.alert(reason);
            return;
          }
          if (!window.confirm(`Buy ${player.name} for ${ctx.money(player.price)}?`)) return;
          GAME().sign(state, player);
          persist();
          render(ctx);
        });
      });
    });
    ctx.list.querySelectorAll("[data-sell]").forEach((button) => {
      button.addEventListener("click", () => {
        const player = state.squad.find((item) => item.id === button.dataset.sell);
        if (!player || !window.confirm(`Sell ${player.name}?`)) return;
        if (GAME().locked(ctx.matches || []) && state.built && !["wildcard1", "wildcard2", "freehit"].includes(state.chipThisWeek)) {
          window.alert("The deadline has passed.");
          return;
        }
        GAME().sell(state, player.id);
        persist();
        render(ctx);
      });
    });
    ctx.list.querySelectorAll("[data-chip]").forEach((button) => {
      button.addEventListener("click", () => {
        const name = chipName(button.dataset.chip).replace(", first half", "").replace(", second half", "");
        if (!window.confirm(`Play ${name} this gameweek?`)) return;
        const error = GAME().playChip(state, button.dataset.chip, ctx.matches || []);
        if (error) window.alert(error);
        persist();
        render(ctx);
      });
    });
    if (transferFocus) {
      transferFocus = false;
      ctx.list.querySelector("#sign-form input")?.focus();
    }
    queueFaces(renderStamp);
  }

  function chipName(id) {
    return { wildcard1: "Wildcard, first half", wildcard2: "Wildcard, second half", freehit: "Free Hit", bench: "Bench Boost", triple: "Triple Captain" }[id] || id;
  }

  async function pagePlayers() {
    shell(`
      <form class="team-search" id="db-form">
        <input name="q" placeholder="Name" />
        <input name="club" placeholder="Club" />
        <input name="max" placeholder="Max £m" inputmode="decimal" />
        <input name="min" placeholder="Min points" inputmode="decimal" />
        <input name="form" placeholder="Min form" inputmode="decimal" />
        <select name="status" aria-label="Status"><option value="">Any status</option><option>available</option><option>doubt</option><option>injured</option><option>suspended</option><option>unavailable</option></select>
        <button class="search-go" type="submit">Filter</button>
      </form>
      <div class="fantasy-nav">
        ${["", "G", "D", "M", "A"].map((slot) => `<button type="button" class="seg-btn" data-slot="${slot}">${slot || "All"}</button>`).join("")}
        ${["price", "points", "form", "owned", "name"].map((sort) => `<button type="button" class="seg-btn" data-sort="${sort}">${sort}</button>`).join("")}
      </div>
      <p class="group-title" id="db-note">${esc(playerNote || "Loading the player list…")}</p>
      <div class="group" id="db-list"></div>
    `);
    const form = ctx.list.querySelector("#db-form");
    let slot = "";
    let sort = "points";
    let loadToken = 0;
    const draw = () => {
      ctx.list.querySelector("#db-list").innerHTML = playerRows
        .map(
          (player) => `<button type="button" class="player-row" data-open-db="${esc(player.id)}">
            ${ctx.faceMarkup(player.headshot, player.name)}
            ${player.badge ? `<img class="club-badge" alt="" src="${esc(player.badge)}" />` : ""}
            <div><div class="team-name">${esc(player.name)}</div><div class="team-meta">${esc(player.club)} · ${esc(player.slot)} · ${ctx.money(player.price)} · ${player.priceChange ? `${player.priceChange > 0 ? "+" : ""}${player.priceChange}` : "price steady"} · ${esc(player.status)} · form ${esc(player.form ?? "—")} · ${player.points || 0} pts · owned ${esc(player.selected ?? player.owned ?? "—")}%</div></div>
          </button>`
        )
        .join("") || `<div class="empty">No players for that filter.</div>`;
      ctx.list.querySelectorAll("[data-open-db]").forEach((button) => {
        button.addEventListener("click", () => {
          focusId = button.dataset.openDb;
          const found = playerRows.find((player) => player.id === focusId);
          if (found) state.pending = found;
          go("profile");
        });
      });
    };
    const load = async () => {
      const token = ++loadToken;
      const stamp = renderStamp;
      const fields = new FormData(form);
      const params = new URLSearchParams({
        q: fields.get("q")?.toString() || "",
        club: fields.get("club")?.toString() || "",
        slot,
        sort,
        limit: "40",
        maxPrice: fields.get("max")?.toString() || "",
        minPoints: fields.get("min")?.toString() || "",
        minForm: fields.get("form")?.toString() || "",
        status: fields.get("status")?.toString() || "",
      });
      const data = await fetch(`/api/fantasy/players?${params}`).then((res) => res.json());
      if (token !== loadToken || stamp !== renderStamp) return;
      playerRows = data.players || [];
      playerRows.forEach((player) => {
        const previous = state.priceMarks?.[player.id];
        if (!previous || previous.price !== player.price) state.priceMarks[player.id] = { price: player.price, at: Date.now(), prev: previous?.price ?? null };
        const owned = state.squad.find((item) => item.id === player.id || item.name === player.name);
        if (owned) {
          Object.assign(owned, { status: player.status, news: player.news, form: player.form, xg: player.xg, xa: player.xa, xgi: player.xgi, chance: player.chance, owned: player.owned, priceChange: player.priceChange, badge: player.badge, penalties: player.penalties, setPieces: player.setPieces, cleanSheets: player.cleanSheets });
          if (!owned.headshot && player.headshot) owned.headshot = player.headshot;
          if (!["G", "D", "M", "A"].includes(owned.slot) && player.slot) owned.slot = player.slot;
        }
      });
      GAME().save(state);
      playerNote = data.error ? data.error : `${data.total || 0} players`;
      const note = ctx.list.querySelector("#db-note");
      if (note) note.textContent = playerNote;
      if (ctx.list.querySelector("#db-list")) draw();
    };
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      load();
    });
    ctx.list.querySelectorAll("[data-slot]").forEach((button) => button.addEventListener("click", () => {
      slot = button.dataset.slot;
      load();
    }));
    ctx.list.querySelectorAll("[data-sort]").forEach((button) => button.addEventListener("click", () => {
      sort = button.dataset.sort;
      load();
    }));
    load();
  }

  function pageProfile() {
    const owned = state.squad.find((player) => player.id === focusId);
    const listed = playerRows.find((player) => player.id === focusId) || state.pending;
    const player = owned || listed;
    if (!player) {
      shell(`<div class="group"><div class="empty">Open a player from the list or the pitch.</div></div>`);
      return;
    }
    const scored = ctx.points?.players?.find((item) => item.id === player.id);
    const rating = GAME().difficulty(ctx.matches || [], player.club || "").rating;
    const predicted = GAME().predict(player, rating);
    const mark = state.priceMarks?.[player.id];
    const lines = (scored?.breakdown || [])
      .map(
        (match) => `<div class="setting-row"><strong>${esc(match.match)}</strong><span>${match.points}</span></div>${(match.lines || [])
          .map((line) => `<div class="setting-row fantasy-line"><span>${esc(line.label)}</span><span>${line.points}</span></div>`)
          .join("")}`
      )
      .join("");
    shell(`
      <div class="group player-hero"><div class="player-hero-top">
        ${ctx.faceMarkup(faceOf(player).url, player.name, "player-hero-face", faceOf(player).fallback)}
        <div>
          <h2 class="player-hero-name">${esc(player.name)}</h2>
          <p class="intel-note">${esc(player.club || "")} · ${esc(player.slot)} · ${ctx.money(player.price)}</p>
          <p class="intel-note">${esc(player.status || "available")}${player.news ? ` · ${esc(player.news)}` : ""}${player.chance != null ? ` · ${esc(player.chance)}% chance` : ""}</p>
          <p class="intel-note">${player.points || 0} pts · form ${esc(player.form ?? "—")} · owned ${esc(player.owned ?? "—")}%</p>
          <p class="intel-note">xG ${esc(player.xg ?? "—")} · xA ${esc(player.xa ?? "—")} · xGI ${esc(player.xgi ?? "—")} · ${esc(player.minutes ?? "—")} min · clean sheets ${esc(player.cleanSheets ?? "—")}</p>
          <p class="intel-note">${esc(player.penalties || "No penalty note")} · ${esc(player.setPieces || "No set-piece note")}</p>
          <p class="intel-note">Predicted ${predicted} · FDR ${rating || "—"} · selected ${esc(player.selected ?? player.owned ?? "—")}%${player.chance != null ? ` · ${esc(player.chance)}% to start` : ""}</p>
          <p class="intel-note">${player.news ? esc(player.news) : "No expected return in the latest news."}${mark?.prev != null ? ` · price was ${ctx.money(mark.prev)}` : ""}</p>
        </div>
      </div></div>
      <div class="group fantasy-actions">
        <button type="button" class="mini-btn" id="watch">Watchlist</button>
        <button type="button" class="mini-btn" id="compare-add">Compare</button>
        ${owned ? `<button type="button" class="mini-btn" id="make-c">Captain</button><button type="button" class="mini-btn" id="make-v">Vice</button>` : `<button type="button" class="mini-btn" id="buy-one">Sign</button>`}
      </div>
      <div class="group">${lines || `<div class="empty">No match points in this gameweek yet.</div>`}</div>
      ${(player.sources || []).map((source) => `<div class="setting-row"><strong>${esc(source.game)}</strong><span>${esc(source.cost)}</span></div>`).join("")}
    `);
    ctx.list.querySelector("#watch").addEventListener("click", () => {
      if (!state.watchlist.some((item) => item.id === player.id)) state.watchlist.unshift(player);
      persist();
      window.alert(`${player.name} is on your watchlist.`);
    });
    ctx.list.querySelector("#compare-add").addEventListener("click", () => {
      state.compareIds = [...new Set([...(state.compareIds || []), player.id])].slice(-2);
      if (!playerRows.some((item) => item.id === player.id)) playerRows.push(player);
      persist();
      go("compare");
    });
    ctx.list.querySelector("#make-c")?.addEventListener("click", () => {
      state.squad.forEach((item) => {
        item.captain = item.id === player.id;
        if (item.captain) item.vice = false;
      });
      player.xi = true;
      persist();
      render(ctx);
    });
    ctx.list.querySelector("#make-v")?.addEventListener("click", () => {
      state.squad.forEach((item) => {
        item.vice = item.id === player.id;
        if (item.vice) item.captain = false;
      });
      persist();
      render(ctx);
    });
    ctx.list.querySelector("#buy-one")?.addEventListener("click", () => {
      const reason = GAME().canSign(state, player, ctx.matches || []);
      if (reason) return window.alert(reason);
      if (!window.confirm(`Sign ${player.name}?`)) return;
      GAME().sign(state, player);
      persist();
      go("team");
    });
  }

  function pageCompare() {
    const ids = state.compareIds || [];
    const rows = ids.map((id) => playerRows.find((player) => player.id === id) || state.squad.find((player) => player.id === id) || state.watchlist.find((player) => player.id === id)).filter(Boolean);
    shell(`<div class="group">${rows.length < 2 ? `<div class="empty">Add two players from a profile.</div>` : `<div class="stat-grid">${rows
      .map(
        (player) => `<div class="stat-card"><span class="stat-value">${esc(player.name.split(" ").slice(-1)[0])}</span><span class="stat-label">${ctx.money(player.price)} · ${player.points || 0} pts · form ${esc(player.form ?? "—")}</span></div>`
      )
      .join("")}</div>`}</div>
      <div class="group">${(state.watchlist || []).slice(0, 8).map((player) => `<div class="setting-row"><strong>${esc(player.name)}</strong><span>${ctx.money(player.price)}</span></div>`).join("")}</div>`);
  }

  const CLUB_COLORS = [
    ["manchester city", "#6cabdd"],
    ["man city", "#6cabdd"],
    ["manchester united", "#da291c"],
    ["man united", "#da291c"],
    ["nottingham", "#dd0000"],
    ["tottenham", "#132257"],
    ["west ham", "#7a263a"],
    ["wolverhampton", "#fdb913"],
    ["crystal palace", "#1b458f"],
    ["aston villa", "#94bee5"],
    ["newcastle", "#241f20"],
    ["brighton", "#0057b8"],
    ["bournemouth", "#da291c"],
    ["brentford", "#e30613"],
    ["liverpool", "#c8102e"],
    ["arsenal", "#ef0107"],
    ["chelsea", "#034694"],
    ["everton", "#003399"],
    ["fulham", "#111111"],
    ["barcelona", "#a50044"],
    ["real madrid", "#febe10"],
    ["atletico", "#cb3524"],
    ["bayern", "#dc052d"],
    ["dortmund", "#fde100"],
    ["juventus", "#111111"],
    ["napoli", "#12a0d7"],
  ];
  const CLUB_CODES = [
    ["manchester city", "MCI"],
    ["manchester united", "MUN"],
    ["nottingham", "NFO"],
    ["tottenham", "TOT"],
    ["west ham", "WHU"],
    ["wolverhampton", "WOL"],
    ["crystal palace", "CRY"],
    ["aston villa", "AVL"],
    ["newcastle", "NEW"],
    ["brighton", "BHA"],
    ["bournemouth", "BOU"],
    ["brentford", "BRE"],
    ["coventry", "COV"],
    ["ipswich", "IPS"],
    ["leicester", "LEI"],
    ["southampton", "SOU"],
    ["sunderland", "SUN"],
    ["leeds", "LEE"],
    ["hull", "HUL"],
    ["burnley", "BUR"],
    ["luton", "LUT"],
    ["bayern", "BAY"],
    ["dortmund", "BVB"],
    ["villarreal", "VIL"],
    ["stuttgart", "VFB"],
    ["liverpool", "LIV"],
    ["arsenal", "ARS"],
    ["chelsea", "CHE"],
    ["everton", "EVE"],
    ["fulham", "FUL"],
    ["barcelona", "BAR"],
    ["real madrid", "RMA"],
    ["atletico", "ATM"],
  ];
  const SLOT_LABEL = { G: "GKP", D: "DEF", M: "MID", A: "FWD" };

  function faceOf(player) {
    const espn = player?.espnHeadshot || "";
    const book = player?.headshot || "";
    if (espn && book && espn !== book) return { url: espn, fallback: book };
    return { url: espn || book, fallback: "" };
  }

  function clubColor(club) {
    const name = String(club || "").toLowerCase();
    for (const [needle, color] of CLUB_COLORS) {
      if (name.includes(needle)) return color;
    }
    let hash = 0;
    for (const ch of name) hash = (hash * 33 + ch.charCodeAt(0)) >>> 0;
    return `hsl(${hash % 360} 62% 36%)`;
  }

  function inkFor(color) {
    if (String(color).startsWith("hsl")) return "#fff";
    const hex = String(color).replace("#", "");
    if (hex.length < 6) return "#fff";
    const channel = (start) => Number.parseInt(hex.slice(start, start + 2), 16);
    const y = (channel(0) * 299 + channel(2) * 587 + channel(4) * 114) / 1000;
    return y > 165 ? "#1a1a1a" : "#fff";
  }

  function shortClub(name) {
    const key = String(name || "").toLowerCase();
    for (const [needle, code] of CLUB_CODES) {
      if (key.includes(needle)) return code;
    }
    const parts = String(name || "").replace(/[^A-Za-z ]/g, "").split(/\s+/).filter(Boolean);
    if (!parts.length) return "—";
    if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1].slice(0, 2)).toUpperCase();
  }

  function viewedWhen() {
    return new Date(Date.parse(`${CORE().weekKey()}T12:00:00Z`) + weekShift * 7 * 86400000);
  }

  function fixtureText(player, when = viewedWhen()) {
    const info = GAME().difficulty(ctx.matches || [], player.club, when);
    const games = info.fixtures || [];
    const game = games.find((item) => item.league === "pl") || games[0];
    if (!game) return "—";
    return `${shortClub(game.opponent)} (${game.atHome ? "H" : "A"})`;
  }

  function playerStat(player, mode = pointsStat, when) {
    if (mode === "price") return ctx.money(player.price);
    if (mode === "fixture") return fixtureText(player, when);
    if (weekShift !== 0 && screen === "points") return "–";
    const scored = (ctx.points?.players || []).find((item) => item.id === player.id);
    return String(scored ? scored.points : 0);
  }

  function lastName(name) {
    const particles = new Set(["van", "de", "der", "den", "da", "dos", "di", "del", "la", "le"]);
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "Player";
    if (parts.length >= 3) {
      const second = parts[1];
      if (/^mac$/i.test(second) && parts[2]) return `${second} ${parts[2]}`;
      if (particles.has(second.toLowerCase())) return parts.slice(1).join(" ");
      return second;
    }
    const usable = parts.filter((part) => !particles.has(part.toLowerCase()));
    return usable[usable.length - 1] || parts[parts.length - 1];
  }

  function closeStatMenus() {
    ctx.list?.querySelectorAll(".gw-menu.is-open").forEach((menu) => {
      const pop = menu.querySelector(".gw-menu-pop");
      const trigger = menu.querySelector("button[aria-haspopup]");
      if (pop) pop.hidden = true;
      trigger?.setAttribute("aria-expanded", "false");
      menu.classList.remove("is-open");
    });
  }

  function bindStatMenu(trigger, pop) {
    if (!trigger || !pop) return;
    const menu = trigger.closest(".gw-menu");
    const setOpen = (open) => {
      pop.hidden = !open;
      trigger.setAttribute("aria-expanded", open ? "true" : "false");
      menu?.classList.toggle("is-open", open);
    };
    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      setOpen(pop.hidden);
    });
    pop.querySelector("[data-close-menu]")?.addEventListener("click", (event) => {
      event.stopPropagation();
      setOpen(false);
    });
    if (menuDismissBound) return;
    menuDismissBound = true;
    document.addEventListener("click", () => closeStatMenus());
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeStatMenus();
    });
  }

  function shirtCard(player, options = {}) {
    if (!player) {
      return `<div class="shirt-card is-empty" aria-hidden="true"><span class="shirt-photo"><span class="shirt-sub"></span></span><span class="shirt-name"></span></div>`;
    }
    const photo = faceOf(player);
    const color = clubColor(player.club);
    const flagged = ["injured", "suspended", "unavailable", "doubt"].includes(player.status);
    const mark = player.captain ? `<span class="shirt-mark">C</span>` : player.vice ? `<span class="shirt-mark is-v">V</span>` : "";
    const mode = options.mode || pointsStat;
    const action = options.sell ? `data-sell="${esc(player.id)}"` : options.bench ? `data-xi="${esc(player.id)}"` : `data-open="${esc(player.id)}"`;
    const drag = options.drag ? ` draggable="true" data-drag="${esc(player.id)}"` : "";
    const price = options.price ? `<span class="shirt-price">${esc(options.price)}</span>` : "";
    return `<button type="button" class="shirt-card" ${action}${drag}>
      ${price}
      <span class="shirt-photo">${mark}${flagged ? `<span class="shirt-flag" title="${esc(player.status)}">!</span>` : ""}${ctx.faceMarkup(photo.url, player.name, "shirt-face", photo.fallback)}<span class="shirt-sub">${esc(playerStat(player, mode, options.when))}</span></span>
      <span class="shirt-name" style="background:${color};color:${inkFor(color)}">${esc(lastName(player.name))}</span>
    </button>`;
  }

  function queueFaces(stamp) {
    const names = state.squad.map((player) => player.name).filter(Boolean);
    if (!names.length) return;
    const wanted = names.join("|");
    fetch(`/api/fantasy/faces?names=${encodeURIComponent(wanted)}`)
      .then((res) => res.json())
      .then((data) => {
        if (stamp !== renderStamp) return;
        let changed = false;
        for (const player of state.squad) {
          const hit = data.faces?.[player.name];
          if (!hit) continue;
          if (hit.espnHeadshot && player.espnHeadshot !== hit.espnHeadshot) {
            player.espnHeadshot = hit.espnHeadshot;
            changed = true;
          }
          const guessed = /headshots\/soccer\/players\/full/.test(player.headshot || "");
          if (hit.headshot && (!player.headshot || (guessed && player.headshot !== hit.espnHeadshot))) {
            if (player.headshot !== hit.headshot) {
              player.headshot = hit.headshot;
              changed = true;
            }
          }
          if (!["G", "D", "M", "A"].includes(player.slot) && ["G", "D", "M", "A"].includes(hit.slot)) {
            player.slot = hit.slot;
            changed = true;
          }
        }
        if (!changed) return;
        GAME().save(state);
        render(ctx);
      })
      .catch(() => {});
  }

  async function generateBadge() {
    if (badgeBusy) return;
    badgeBusy = true;
    const button = ctx.list.querySelector("#gen-badge");
    const note = button?.querySelector("small");
    if (button) button.disabled = true;
    if (note) note.textContent = "Drawing…";
    try {
      const res = await fetch("/api/fantasy/badge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamName: state.teamName || "Fantasy",
          favouriteClub: state.favouriteClub || ctx.user?.favouriteClub || "",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.image) {
        window.alert(data.error || "Could not draw a badge.");
        badgeBusy = false;
        if (button) button.disabled = false;
        if (note) note.textContent = "Generate team badge";
        return;
      }
      state.badgeImage = await shrinkBadge(data.image);
      badgeBusy = false;
      try {
        persist();
      } catch {
        state.badgeImage = "";
        try {
          persist();
        } catch {
          /* The squad is still in memory if storage rejects the image. */
        }
        window.alert("The badge was drawn, but it was too large to keep on this device.");
      }
      render(ctx);
    } catch (err) {
      badgeBusy = false;
      window.alert(err?.message || "Could not draw a badge.");
      if (button) button.disabled = false;
      if (note) note.textContent = "Generate team badge";
    }
  }

  function shrinkBadge(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 256;
        const pen = canvas.getContext("2d");
        pen.fillStyle = "#f4f1e8";
        pen.fillRect(0, 0, 256, 256);
        pen.drawImage(img, 0, 0, 256, 256);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  function pagePoints() {
    const when = viewedWhen();
    const week = Math.max(1, GAME().weekNumber(when));
    const raw = ctx.points?.total || 0;
    const net = GAME().netPoints(state, raw);
    const season = GAME().records(state).total + (weekShift === 0 ? net : 0);
    const past = (state.history || []).find((row) => row.week === CORE().weekKey(when));
    const totalShown = weekShift === 0 ? net : past?.points ?? "–";
    const shape = GAME().FORMATIONS[state.formation] || GAME().FORMATIONS["4-3-3"];
    const xi = state.squad.filter((player) => player.xi);
    const rank = { G: 0, D: 1, M: 2, A: 3 };
    const bench = state.squad.filter((player) => !player.xi).slice().sort((a, b) => (rank[a.slot] ?? 9) - (rank[b.slot] ?? 9));
    const lines = ["G", "D", "M", "A"].map((slot) => {
      const need = slot === "G" ? 1 : shape[slot] || 0;
      const players = xi.filter((player) => player.slot === slot);
      const cells = players.map((player) => shirtCard(player));
      while (cells.length < need) cells.push(shirtCard(null));
      return `<div class="gw-line" data-line="${slot}">${cells.join("")}</div>`;
    });
    const crest = state.badgeImage
      ? `<img src="${esc(state.badgeImage)}" alt="" />`
      : `<span class="gw-crest-mark" style="--badge:${BADGE_COLORS[(state.badgeColor || 0) % BADGE_COLORS.length]}"></span>`;
    const listBody = ["G", "D", "M", "A"]
      .map((slot) => {
        const players = state.squad.filter((player) => player.slot === slot);
        if (!players.length) return "";
        return `<p class="gw-list-label">${SLOT_LABEL[slot]}</p><div class="gw-list">${players
          .map((player) => {
            const photo = faceOf(player);
            return `<button type="button" class="gw-list-row" data-open="${esc(player.id)}">${ctx.faceMarkup(photo.url, player.name, "shirt-face", photo.fallback)}<span><strong>${esc(player.name)}${player.captain ? " (C)" : ""}${player.vice ? " (V)" : ""}</strong><small>${player.xi ? "Starting" : "Bench"} · ${esc(player.club || "")}</small></span><b>${esc(playerStat(player))}</b></button>`;
          })
          .join("")}</div>`;
      })
      .join("");
    shell(
      `
      <div class="gw-screen is-points">
        <header class="gw-head">
          <button type="button" class="gw-back" id="gw-back" aria-label="Back">‹</button>
          <div class="gw-titles">
            <h2>${esc(state.teamName || "Your team")}</h2>
            <div class="gw-week">
              <button type="button" data-shift="-1" aria-label="Previous gameweek">‹</button>
              <span>Gameweek ${week}</span>
              <button type="button" data-shift="1" aria-label="Next gameweek">›</button>
            </div>
          </div>
          <div class="gw-crest">${crest}</div>
        </header>
        <div class="gw-scores">
          <div><strong id="gw-avg">–</strong><span>Average</span></div>
          <div class="gw-total"><strong>${esc(totalShown)}</strong><span>Total Pts</span></div>
          <div><strong id="gw-high">–</strong><span>Highest</span></div>
        </div>
        <p class="gw-season">${season} this season${GAME().hit(state) && weekShift === 0 ? ` · hit -${GAME().hit(state)}` : ""}</p>
        <div class="gw-tools">
          <div class="gw-switch" role="tablist">
            <button type="button" data-tab="pitch" class="${pointsTab === "pitch" ? "is-on" : ""}">Pitch</button>
            <button type="button" data-tab="list" class="${pointsTab === "list" ? "is-on" : ""}">List</button>
          </div>
          <div class="gw-menu">
            <button type="button" id="gw-stat" aria-expanded="false" aria-haspopup="menu">${pointsStat === "price" ? "Price" : pointsStat === "fixture" ? "Fixture" : "Points"} <span class="gw-chevron" aria-hidden="true"></span></button>
            <div class="gw-menu-pop" id="gw-stat-pop" role="menu" hidden>
              <button type="button" data-stat="points" class="${pointsStat === "points" ? "is-on" : ""}">Points</button>
              <button type="button" data-stat="fixture" class="${pointsStat === "fixture" ? "is-on" : ""}">Fixture</button>
              <button type="button" data-stat="price" class="${pointsStat === "price" ? "is-on" : ""}">Price</button>
              <button type="button" data-close-menu>Close</button>
            </div>
          </div>
        </div>
        ${
          pointsTab === "list"
            ? `${listBody || `<div class="empty">Sign players to see them here.</div>`}
               <div class="gw-extra"><button type="button" class="mini-btn" id="correct">Add a points correction</button></div>`
            : `<div class="gw-pitch">
                <div class="gw-sky"><span>Fantasy</span><i class="gw-goal"></i><span>Fantasy</span></div>
                ${lines.join("")}
              </div>
              <div class="gw-bench">
                ${
                  bench.length
                    ? bench
                        .map(
                          (player) => `<div class="gw-bench-slot"><span>${SLOT_LABEL[player.slot] || player.slot}</span>${shirtCard(player)}</div>`
                        )
                        .join("")
                    : `<p class="gw-bench-empty">Bench is empty.</p>`
                }
              </div>`
        }
      </div>
    `,
      { bare: true }
    );
    ctx.list.querySelector("#gw-back")?.addEventListener("click", () => go("home"));
    ctx.list.querySelectorAll("[data-shift]").forEach((button) => {
      button.addEventListener("click", () => {
        weekShift += Number(button.dataset.shift);
        render(ctx);
      });
    });
    ctx.list.querySelectorAll("[data-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        pointsTab = button.dataset.tab;
        render(ctx);
      });
    });
    bindStatMenu(ctx.list.querySelector("#gw-stat"), ctx.list.querySelector("#gw-stat-pop"));
    ctx.list.querySelectorAll("[data-stat]").forEach((button) => {
      button.addEventListener("click", () => {
        pointsStat = button.dataset.stat;
        render(ctx);
      });
    });
    ctx.list.querySelectorAll("[data-open]").forEach((button) => {
      button.addEventListener("click", () => {
        focusId = button.dataset.open;
        go("profile");
      });
    });
    ctx.list.querySelector("#correct")?.addEventListener("click", () => {
      const note = window.prompt("Correction note");
      const value = Number(window.prompt("Points to add or remove", "0"));
      if (!note || !Number.isFinite(value)) return;
      state.corrections.unshift({ note, value, at: Date.now() });
      persist();
      render(ctx);
    });
    loadPointsBoard(renderStamp);
    queueFaces(renderStamp);
  }

  async function loadPointsBoard(stamp) {
    const week = await fetch("/api/fantasy/rankings?sort=week").then((res) => res.json()).catch(() => ({ rankings: [] }));
    if (stamp !== renderStamp || screen !== "points") return;
    const scores = (week.rankings || []).map((row) => Number(row.weekPoints) || 0);
    const average = scores.length ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length) : 0;
    const highest = scores.length ? Math.max(...scores) : 0;
    const averageNode = ctx.list.querySelector("#gw-avg");
    const highNode = ctx.list.querySelector("#gw-high");
    if (averageNode) averageNode.textContent = weekShift === 0 ? commas(average) : "–";
    if (highNode) highNode.textContent = weekShift === 0 ? commas(highest) : "–";
  }

  function pageFixtures() {
    const when = new Date(Date.parse(`${CORE().weekKey()}T12:00:00Z`) + weekShift * 7 * 86400000);
    const games = GAME().fixturesFor(ctx.matches || [], when);
    const clubs = [...new Set(state.squad.map((player) => player.club).filter(Boolean))];
    const postponed = new Set(GAME().rules().postponed || []);
    shell(`
      <div class="fantasy-actions"><button type="button" class="mini-btn" data-shift="-1">Previous</button><button type="button" class="mini-btn" data-shift="1">Next</button></div>
      <p class="group-title">${esc(CORE().weekKey(when))}</p>
      <div class="group">${clubs.map((club) => {
        const rate = GAME().difficulty(ctx.matches || [], club, when);
        const detail = (rate.fixtures || []).map((game) => `${game.atHome ? "H" : "A"} ${game.opponent} ${game.rating}`).join(", ");
        return `<div class="setting-row"><strong>${esc(club)}</strong><span>${esc(rate.label)} · FDR ${rate.rating || "—"} ${esc(detail)}</span></div>`;
      }).join("") || `<div class="empty">Sign players to see blank and double weeks.</div>`}</div>
      <p class="group-title">Fixtures</p>
      <div class="group">${games
        .slice(0, 30)
        .map((match) => {
          const moved = postponed.has(String(match.id)) || /postpon|abandon|cancel/i.test(match.status || "");
          return `<div class="setting-row"><strong>${esc(match.home)} v ${esc(match.away)}</strong><span>${moved ? "Postponed" : esc(match.status)} ${match.homeScore ?? ""}-${match.awayScore ?? ""}</span></div>`;
        })
        .join("") || `<div class="empty">No fixtures in the loaded list for that week.</div>`}</div>
    `);
    ctx.list.querySelectorAll("[data-shift]").forEach((button) => button.addEventListener("click", () => {
      weekShift += Number(button.dataset.shift);
      render(ctx);
    }));
  }

  function pageLive() {
    const clubs = state.squad.map((player) => String(player.club || "").toLowerCase());
    const live = (ctx.matches || []).filter((match) => match.status === "Live" && clubs.some((club) => club && (match.home.toLowerCase().includes(club) || match.away.toLowerCase().includes(club))));
    const rows = ctx.points?.players || [];
    shell(`<p class="group-title">Live points refresh with the match list. Bonus already on the sheet is included. Rankings update when the team is saved.</p>
      <div class="group">${live.map((match) => `<div class="setting-row"><strong>${esc(match.home)} ${match.homeScore}-${match.awayScore} ${esc(match.away)}</strong><span>Live</span></div>`).join("") || `<div class="empty">None of your clubs are live right now.</div>`}</div>
      <div class="group">${rows.map((player) => `<div class="setting-row"><strong>${esc(player.name)}${player.captain ? " (C)" : ""}</strong><span>${player.points} pts · ${player.minutes || 0} min</span></div>`).join("") || `<div class="empty">Player points appear after a signed club plays.</div>`}</div>`);
  }

  function squadLabel(player) {
    if (!player) return "";
    if (typeof player === "string") return player;
    return `${player.xi ? "XI" : "Bench"} ${player.name || ""}`;
  }

  function pageHistory() {
    const rows = state.history || [];
    shell(`<div class="group">${rows.map((week, index) => `<div class="setting-row"><strong>${esc(week.week)}</strong><span>${week.points} pts · ${esc(week.captain || "")} ${esc(week.chip || "")} <button type="button" class="mini-btn" data-recreate="${index}">Recreate</button></span></div>`).join("") || `<div class="empty">Finished gameweeks will be kept here.</div>`}</div>
      <button type="button" class="mini-btn" id="archive">Archive this season</button>`);
    ctx.list.querySelector("#archive").addEventListener("click", () => {
      state.archives = state.archives || [];
      state.archives.unshift({ season: state.season, history: state.history, total: GAME().records(state).total, at: Date.now() });
      persist();
      go("season");
    });
    ctx.list.querySelectorAll("[data-recreate]").forEach((button) => button.addEventListener("click", () => {
      const week = rows[Number(button.dataset.recreate)];
      state.planner = (week.squad || []).map((player) => (typeof player === "string" ? { name: player, xi: true, slot: "" } : player));
      state.mode = "planner";
      persist();
      go("planner");
    }));
  }

  function pageSeason() {
    const rec = GAME().records(state);
    const archives = state.archives || [];
    shell(`<div class="stat-grid"><div class="stat-card"><span class="stat-value">${rec.best}</span><span class="stat-label">Best week</span></div><div class="stat-card"><span class="stat-value">${rec.total}</span><span class="stat-label">Career points on this device</span></div></div>
      <div class="group">${archives.map((season) => `<div class="setting-row"><strong>${esc(season.season || "Season")}</strong><span>${season.total || 0} pts · ${(season.history || []).length} weeks</span></div>`).join("") || `<div class="empty">Archive a season from History.</div>`}</div>
      <div class="group">${(state.history || []).map((week) => `<div class="setting-row"><span>${(week.squad || []).map(squadLabel).join(", ")}</span></div>`).join("")}</div>`);
  }

  async function pageLeagues() {
    const stamp = renderStamp;
    shell(`
      <form class="team-search" id="league-create"><input name="name" placeholder="New league name" /><button class="search-go" type="submit">Create</button></form>
      <form class="team-search" id="league-join"><input name="code" value="${esc(sessionStorage.getItem("ninety-league-invite") || "")}" placeholder="Invite code" /><button class="search-go" type="submit">Join</button></form>
      <form class="team-search" id="league-find"><input name="q" placeholder="Search public leagues" /><button class="search-go" type="submit">Search</button></form>
      <div id="league-box" class="group"><div class="loading">Your leagues…</div></div>
    `);
    const box = ctx.list.querySelector("#league-box");
    const paint = (leagues) => {
      box.innerHTML = leagues.map((league) => `<button type="button" class="setting-row" data-code="${esc(league.code)}"><strong>${esc(league.name)}</strong><span>${esc(league.code)} · ${league.members.length}</span></button>`).join("") || `<div class="empty">Create a league or join with a code.</div>`;
      box.querySelectorAll("[data-code]").forEach((button) => button.addEventListener("click", () => {
        leagueCode = button.dataset.code;
        go("league");
      }));
    };
    const mine = [];
    for (const code of state.leagueCodes) {
      const league = await fetch(`/api/fantasy/league?code=${encodeURIComponent(code)}`).then((res) => res.json()).catch(() => null);
      if (league?.code) mine.push(league);
    }
    if (stamp !== renderStamp) return;
    paint(mine);
    ctx.list.querySelector("#league-create").addEventListener("submit", async (event) => {
      event.preventDefault();
      const name = new FormData(event.target).get("name").toString();
      const asked = (window.prompt("League type: classic, h2h, or cup", "classic") || "classic").toLowerCase();
      const kind = ["h2h", "cup", "classic"].includes(asked) ? asked : "classic";
      const privacy = window.confirm("Public league? Cancel makes it invite-only.") ? "public" : "private";
      const league = await fetch("/api/fantasy/league", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, kind, privacy, userId: managerId(), manager: ctx.user?.name || "Manager", teamName: state.teamName }) }).then((res) => res.json());
      if (league.code) {
        state.leagueCodes = [...new Set([...state.leagueCodes, league.code])];
        persist();
        const link = `${location.origin}/?league=${league.code}`;
        window.alert(`Invite code ${league.code}\n${link}`);
        leagueCode = league.code;
        go("league");
      }
    });
    ctx.list.querySelector("#league-join").addEventListener("submit", async (event) => {
      event.preventDefault();
      const code = new FormData(event.target).get("code").toString();
      const league = await fetch("/api/fantasy/league/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, userId: managerId(), manager: ctx.user?.name || "Manager", teamName: state.teamName }) }).then((res) => res.json());
      if (!league.code) return window.alert("No league with that code.");
      state.leagueCodes = [...new Set([...state.leagueCodes, league.code])];
      persist();
      leagueCode = league.code;
      go("league");
    });
    ctx.list.querySelector("#league-find").addEventListener("submit", async (event) => {
      event.preventDefault();
      const q = new FormData(event.target).get("q").toString();
      const data = await fetch(`/api/fantasy/leagues?q=${encodeURIComponent(q)}`).then((res) => res.json());
      paint(data.leagues || []);
    });
  }

  async function pageLeague() {
    const stamp = renderStamp;
    const league = await fetch(`/api/fantasy/league?code=${encodeURIComponent(leagueCode)}`).then((res) => res.json()).catch(() => null);
    if (stamp !== renderStamp) return;
    if (!league?.code) {
      shell(`<div class="group"><div class="empty">Pick a league first.</div></div>`);
      return;
    }
    const mine = managerId();
    const admin = league.adminId === mine;
    const table = [...(league.members || [])].sort((a, b) => (a.rank || 99) - (b.rank || 99));
    shell(`
      <p class="group-title">${esc(league.name)} · ${esc(league.code)}</p>
      <h3 class="standings-title">Standings</h3>
      <div class="standings">${table
        .map(
          (member) => `<div class="standing${member.userId === mine ? " is-me" : ""}"><b>${member.rank}</b><span><strong>${esc(member.teamName || "Team")}</strong><small>${esc(member.name || "")}</small></span><span><strong>${member.weekPoints ?? 0}</strong><small>GW</small></span><span><strong>${member.points ?? 0}</strong><small>Pts</small></span></div>`
        )
        .join("") || `<div class="empty">No managers in this league yet.</div>`}</div>
      ${admin ? `<div class="group">${table.filter((member) => member.userId !== mine).map((member) => `<div class="setting-row"><span>${esc(member.teamName)}</span><button type="button" class="mini-btn" data-remove="${esc(member.userId)}">Remove</button></div>`).join("")}</div>` : ""}
      <div class="fantasy-actions">
        <button type="button" class="mini-btn" id="share">Copy invite</button>
        <button type="button" class="mini-btn" id="leave">Leave</button>
        <button type="button" class="mini-btn" id="to-h2h">Head to head</button>
        <button type="button" class="mini-btn" id="to-cup">Cup</button>
        ${admin ? `<button type="button" class="mini-btn" id="delete-league">Delete league</button>` : ""}
      </div>
      ${
        league.cup?.rounds?.length
          ? league.cup.rounds
              .map(
                (round) => `<p class="group-title">${esc(round.name || league.cup.round || "Cup")}</p><div class="group">${(round.ties || []).map((tie) => `<div class="setting-row"><strong>${esc(tie.home)} v ${esc(tie.away)}</strong><span>${esc(tie.winner || "")}</span></div>`).join("")}</div>`
              )
              .join("")
          : ""
      }
      <p class="group-title">League chat</p>
      <form class="team-search" id="chat-form"><input name="text" placeholder="Message the league" /><button class="search-go" type="submit">Send</button></form>
      <div class="group">${(league.messages || []).map((message) => `<div class="setting-row"><strong>${esc(message.name)}</strong><span>${esc(message.text)}</span></div>`).join("") || `<div class="empty">No messages yet.</div>`}</div>
      <p class="group-title">Polls</p>
      ${admin ? `<form class="team-search" id="poll-form"><input name="question" placeholder="Question" /><input name="options" placeholder="Yes, No" /><button class="search-go" type="submit">Poll</button></form>` : ""}
      <div class="group">${(league.polls || []).map((poll) => `<div class="setting-row"><strong>${esc(poll.question)}</strong><span>${(poll.options || []).map((option, index) => `<button type="button" class="mini-btn" data-vote="${esc(poll.id)}:${index}">${esc(option.label)} ${option.votes}</button>`).join(" ")}</span></div>`).join("") || `<div class="empty">No polls yet.</div>`}</div>
    `);
    ctx.list.querySelector("#share").addEventListener("click", () => {
      const link = `${location.origin}/?league=${league.code}`;
      navigator.clipboard?.writeText(link);
      window.alert(link);
    });
    ctx.list.querySelector("#leave").addEventListener("click", async () => {
      if (!window.confirm("Leave this league?")) return;
      await fetch("/api/fantasy/league/leave", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: league.code, userId: managerId() }) });
      state.leagueCodes = state.leagueCodes.filter((code) => code !== league.code);
      persist();
      go("leagues");
    });
    ctx.list.querySelector("#delete-league")?.addEventListener("click", async () => {
      if (!window.confirm("Delete this league?")) return;
      await fetch("/api/fantasy/league/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: league.code, userId: managerId() }) });
      state.leagueCodes = state.leagueCodes.filter((code) => code !== league.code);
      persist();
      go("leagues");
    });
    ctx.list.querySelectorAll("[data-remove]").forEach((button) => button.addEventListener("click", async () => {
      await fetch("/api/fantasy/league/leave", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: league.code, userId: managerId(), removeId: button.dataset.remove }) });
      render(ctx);
    }));
    ctx.list.querySelector("#chat-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const text = new FormData(event.target).get("text").toString();
      await fetch("/api/fantasy/league/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: league.code, text, userId: managerId(), manager: ctx.user?.name || "Manager" }) });
      ctx.onNotice?.({ key: `chat-${league.code}-${Date.now()}`, title: "League message", body: "Your message was posted." });
      render(ctx);
    });
    ctx.list.querySelector("#poll-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(event.target);
      await fetch("/api/fantasy/league/poll", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: league.code, question: data.get("question"), options: String(data.get("options") || "").split(","), userId: managerId() }) });
      render(ctx);
    });
    ctx.list.querySelectorAll("[data-vote]").forEach((button) => button.addEventListener("click", async () => {
      const [pollId, option] = button.dataset.vote.split(":");
      await fetch("/api/fantasy/league/vote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: league.code, pollId, option: Number(option), userId: managerId() }) });
      render(ctx);
    }));
    ctx.list.querySelector("#to-h2h").addEventListener("click", () => go("h2h"));
    ctx.list.querySelector("#to-cup").addEventListener("click", () => go("cup"));
  }

  async function pageH2H() {
    const league = leagueCode ? await fetch(`/api/fantasy/league?code=${encodeURIComponent(leagueCode)}`).then((res) => res.json()) : null;
    const pairs = league?.h2h || [];
    const table = league?.h2hTable || [];
    shell(`<p class="group-title">This gameweek. A tie on week points goes to the first paired manager. Wins below count every saved week.</p><div class="group">${pairs.map((pair) => `<div class="setting-row"><strong>${esc(pair.home.name)} v ${esc(pair.away.name)}</strong><span>${pair.home.weekPoints}-${pair.away.weekPoints}</span></div>`).join("") || `<div class="empty">Open a league with two managers.</div>`}</div>
      <div class="group">${table.map((row) => `<div class="setting-row"><strong>${esc(row.home)} v ${esc(row.away)}</strong><span>${row.homeWins}-${row.awayWins} wins</span></div>`).join("")}</div>`);
  }

  async function pageCup() {
    const league = leagueCode ? await fetch(`/api/fantasy/league?code=${encodeURIComponent(leagueCode)}`).then((res) => res.json()) : null;
    const rounds = league?.cup?.rounds || [];
    shell(`<p class="group-title">${esc(league?.cup?.round || "Cup")}. Highest season points advance. An odd manager receives a bye.</p>${rounds.map((round) => `<p class="group-title">${esc(round.name)}</p><div class="group">${round.ties.map((tie) => `<div class="setting-row"><strong>${esc(tie.home)} v ${esc(tie.away)}</strong><span>${esc(tie.winner)}</span></div>`).join("")}</div>`).join("") || `<div class="group"><div class="empty">The cup needs two managers in a league.</div></div>`}`);
  }

  async function pageRanks() {
    const stamp = renderStamp;
    const country = state.country || "";
    const [overall, week, local, stats] = await Promise.all([
      fetch("/api/fantasy/rankings").then((res) => res.json()).catch(() => ({ rankings: [] })),
      fetch("/api/fantasy/rankings?sort=week").then((res) => res.json()).catch(() => ({ rankings: [] })),
      fetch(`/api/fantasy/rankings?country=${encodeURIComponent(country)}`).then((res) => res.json()).catch(() => ({ rankings: [] })),
      fetch("/api/fantasy/stats").then((res) => res.json()).catch(() => ({})),
    ]);
    if (stamp !== renderStamp) return;
    const me = (overall.rankings || []).find((row) => row.userId === managerId());
    if (me) {
      state.rankHistory = [{ week: state.weekKey, rank: me.rank, at: Date.now() }, ...(state.rankHistory || []).filter((row) => row.week !== state.weekKey)].slice(0, 20);
      const previous = (state.rankHistory || [])[1];
      if (previous && previous.rank !== me.rank && state.notify?.rank) ctx.onNotice?.({ key: `rank-${state.weekKey}-${me.rank}`, title: "Rank change", body: `Overall rank is ${me.rank}.` });
      GAME().save(state);
    }
    const standings = (rows, field) =>
      (rows || []).slice(0, 30).map((row) => `<div class="standing${row.userId === managerId() ? " is-me" : ""}"><b>${row.rank}</b><span><strong>${esc(row.teamName || "Team")}</strong><small>${esc(row.name || row.country || "")}</small></span><span><strong>${row[field] ?? 0}</strong><small>${field === "weekPoints" ? "GW" : "Pts"}</small></span></div>`).join("") || `<div class="empty">Standings appear after a team is saved.</div>`;
    const names = (rows) => (rows || []).map((row) => `${esc(row.name)} · ${row.count}`).join(", ") || "None yet";
    const focusTitle = boardFocus === "week" ? "Gameweek standings" : boardFocus === "country" ? `${country || "Country"} standings` : "Overall standings";
    const focusRows = boardFocus === "week" ? week.rankings : boardFocus === "country" ? local.rankings : overall.rankings;
    const focusField = boardFocus === "week" ? "weekPoints" : "points";
    shell(`
      <h3 class="standings-title">${esc(focusTitle)}${me && boardFocus === "overall" ? ` · you are ${me.rank}` : ""}</h3>
      <div class="standings">${boardFocus === "country" && !country ? `<div class="empty">Set a country in Settings for a country table.</div>` : standings(focusRows, focusField)}</div>
      <p class="group-title">Overall</p>
      <div class="standings">${standings(overall.rankings, "points")}</div>
      <p class="group-title">This gameweek</p>
      <div class="standings">${standings(week.rankings, "weekPoints")}</div>
      <p class="group-title">${country ? esc(country) : "Country"}</p>
      <div class="standings">${country ? standings(local.rankings, "points") : `<div class="empty">Country rank uses the country on your fantasy settings.</div>`}</div>
      <p class="group-title">Rank history</p>
      <div class="group">${(state.rankHistory || []).map((row) => `<div class="setting-row"><strong>${esc(row.week)}</strong><span class="bar" title="Rank ${row.rank}"><i style="width:${Math.max(8, 100 - row.rank)}%"></i></span></div>`).join("")}</div>
      <div class="group">
        <div class="setting-row"><strong>Popular captains</strong><span>${names(stats.captains)}</span></div>
        <div class="setting-row"><strong>Transferred in</strong><span>${names(stats.in)}</span></div>
        <div class="setting-row"><strong>Transferred out</strong><span>${names(stats.out)}</span></div>
      </div>
    `);
  }

  function pageStats() {
    const rec = GAME().records(state);
    const bars = (state.history || []).slice(0, 8);
    const max = Math.max(1, ...bars.map((week) => week.points || 0));
    shell(`
      <div class="stat-grid">
        <div class="stat-card"><span class="stat-value">${rec.total}</span><span class="stat-label">Total</span></div>
        <div class="stat-card"><span class="stat-value">${rec.average}</span><span class="stat-label">Average</span></div>
        <div class="stat-card"><span class="stat-value">${rec.best}</span><span class="stat-label">Best week</span></div>
        <div class="stat-card"><span class="stat-value">${rec.weeks}</span><span class="stat-label">Weeks</span></div>
      </div>
      <div class="group">${bars.map((week) => `<div class="setting-row"><strong>${esc(week.week)}</strong><span class="bar"><i style="width:${Math.round(((week.points || 0) / max) * 100)}%"></i></span></div>`).join("")}</div>
      <div class="group">${state.squad.map((player) => {
        const scored = ctx.points?.players?.find((item) => item.id === player.id)?.points || 0;
        const rate = GAME().difficulty(ctx.matches || [], player.club || "");
        const per = player.price ? (scored / player.price).toFixed(1) : "0";
        return `<div class="setting-row"><strong>${esc(player.name)}</strong><span>${per} pts/£m · xGI ${esc(player.xgi ?? "—")} · predicted ${GAME().predict(player, rate.rating)} · FDR ${rate.rating || "—"}</span></div>`;
      }).join("")}</div>
      <p class="group-title">Hits ${GAME().hit(state)} · captain weeks ${GAME().records(state).captainPoints} · chip ${esc(state.chipThisWeek || "none")}</p>
    `);
  }

  async function pageNews() {
    shell(`<div class="group" id="news-box"><div class="loading">Loading news…</div></div>`);
    const articles = await ctx.api.loadTransferNews().catch(() => []);
    const clubs = state.squad.map((player) => player.club).filter(Boolean);
    const mine = articles.filter((article) => clubs.some((club) => `${article.headline} ${article.description}`.toLowerCase().includes(String(club).toLowerCase())));
    const rows = (mine.length ? mine : articles).slice(0, 12);
    const box = ctx.list.querySelector("#news-box");
    if (!box) return;
    box.innerHTML = rows.map((article) => `<div class="setting-row"><strong>${esc(article.headline)}</strong><span>${esc((article.description || "").slice(0, 120))} · ESPN · ${esc(article.published || "")}</span></div>`).join("") || `<div class="empty">No news yet.</div>`;
  }

  function pageAchievements() {
    shell(`<div class="group">${(state.achievements || []).map((badge) => `<div class="setting-row"><strong>${esc(badge.name)}</strong><span>Unlocked</span></div>`).join("") || `<div class="empty">Badges unlock as you play.</div>`}</div>`);
  }

  function pageRules() {
    const rows = [
      ["Played under 60 minutes", "1", "1", "1", "1"],
      ["60 minutes or more", "2", "2", "2", "2"],
      ["Goal", "6", "6", "5", "4"],
      ["Goal from outside the box", "+1", "+1", "+1", "+1"],
      ["Assist", "3", "3", "3", "3"],
      ["Clean sheet", "4", "4", "1", "0"],
      ["Every 3 saves", "1", "0", "0", "0"],
      ["Penalty save", "5", "0", "0", "0"],
      ["Every 2 goals conceded", "-1", "-1", "0", "0"],
      ["Defensive contribution", "0", "2", "2", "2"],
      ["Every 2 shots on target", "1", "1", "1", "1"],
      ["Woodwork", "1", "1", "1", "1"],
      ["Penalty won", "2", "2", "2", "2"],
      ["Yellow / red / own goal", "-1 / -3 / -2", "-1 / -3 / -2", "-1 / -3 / -2", "-1 / -3 / -2"],
      ["Penalty miss / conceded", "-2 / -1", "-2 / -1", "-2 / -1", "-2 / -1"],
    ];
    shell(`<p class="group-title">GK, DEF, MID, ATT. Captain points are doubled. Triple Captain makes them three times. A vice-captain steps in if the captain does not play. The bench comes on for a starter on 0 minutes, in bench order. Bonus is 3, 2, 1 for the top three in the match. Tied players share the higher prize.</p>
      <div class="group">${rows.map((row) => `<div class="setting-row"><strong>${esc(row[0])}</strong><span>${row.slice(1).join(" · ")}</span></div>`).join("")}</div>
      <div class="group"><div class="setting-row"><span>Squad is 2 goalkeepers, 5 defenders, 5 midfielders, 3 attackers. Budget £150m. At most 3 from one club. One free transfer each week, two can be saved. Each extra transfer is -4. Wildcard and Free Hit remove the hit. Bench Boost scores every player who played. Chips are once each. The first wildcard is weeks 1–19 and the second is week 20 onward. Deadline is ${GAME().offset()} minutes before the first kickoff of the London week. Ties on a league table break by manager name. Head-to-head uses gameweek points. The cup uses season points. A postponed or abandoned match scores nothing until the data feed plays it. Corrections are added on the Points page. ${esc(GAME().rules().scoringNote || "")}</span></div></div>`);
  }

  function pageSettings() {
    shell(`
      <div class="group">
        <div class="setting-row"><strong>Team</strong><span><input id="set-name" value="${esc(state.teamName)}" /></span></div>
        <div class="setting-row"><strong>Favourite club</strong><span><input id="set-club" value="${esc(state.favouriteClub)}" /></span></div>
        <div class="setting-row"><strong>Country</strong><span><input id="set-country" value="${esc(state.country || "")}" placeholder="England" /></span></div>
        <div class="setting-row"><strong>Region</strong><span><input id="set-region" value="${esc(state.region || "")}" placeholder="London" /></span></div>
        <div class="setting-row"><strong>Privacy</strong><span><button type="button" class="mini-btn" id="privacy">${esc(state.privacy)}</button></span></div>
        <div class="setting-row"><strong>Appearance</strong><span><button type="button" class="mini-btn" id="theme">${esc(state.theme || "dark")}</button></span></div>
        <div class="setting-row"><strong>Mode</strong><span><button type="button" class="mini-btn" id="mode">${esc(state.mode)}</button></span></div>
        ${Object.keys(state.notify || {}).map((key) => `<div class="setting-row"><label><strong>${esc(key)}</strong></label><input type="checkbox" data-note="${key}" ${state.notify[key] ? "checked" : ""} /></div>`).join("")}
      </div>
      <div class="fantasy-actions"><button type="button" class="mini-btn" id="save-settings">Save settings</button><button type="button" class="mini-btn" id="export-team">Download team</button></div>
    `);
    ctx.list.querySelector("#privacy").addEventListener("click", () => {
      state.privacy = state.privacy === "public" ? "private" : "public";
      render(ctx);
    });
    ctx.list.querySelector("#theme").addEventListener("click", () => {
      state.theme = state.theme === "light" ? "dark" : "light";
      document.documentElement.dataset.theme = state.theme;
      persist();
      render(ctx);
    });
    ctx.list.querySelector("#mode").addEventListener("click", () => {
      state.mode = state.mode === "classic" ? "draft" : state.mode === "draft" ? "planner" : "classic";
      render(ctx);
    });
    ctx.list.querySelector("#save-settings").addEventListener("click", () => {
      state.teamName = ctx.list.querySelector("#set-name").value;
      state.favouriteClub = ctx.list.querySelector("#set-club").value;
      state.country = ctx.list.querySelector("#set-country").value;
      state.region = ctx.list.querySelector("#set-region").value;
      ctx.list.querySelectorAll("[data-note]").forEach((input) => {
        state.notify[input.dataset.note] = input.checked;
      });
      persist();
      if (state.favouriteClub && ctx.follow) ctx.follow(state.favouriteClub);
      render(ctx);
    });
    ctx.list.querySelector("#export-team").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "derby-fantasy.json";
      link.click();
      URL.revokeObjectURL(url);
    });
  }

  function pageNotices() {
    const notes = GAME().notices(state, { matches: ctx.matches || [] });
    let log = [];
    try {
      log = JSON.parse(localStorage.getItem("ninety-alert-log-v1") || "[]");
    } catch {
      log = [];
    }
    shell(`<p class="group-title">Deadline, price, injury, and chip reminders use the toggles in Settings. Match goals and cards use the follow alerts. Browser notifications need permission. Email codes are shown in the app because Derby has no mail server.</p>
      <div class="group">${notes.map((note) => `<div class="setting-row"><strong>${esc(note.title)}</strong><span>${esc(note.body)}</span></div>`).join("") || `<div class="empty">Nothing is waiting.</div>`}</div>
      <p class="group-title">Recent alerts</p>
      <div class="group">${log.map((note) => `<div class="setting-row"><strong>${esc(note.title)}</strong><span>${esc(note.body)}</span></div>`).join("") || `<div class="empty">No alerts yet.</div>`}</div>`);
  }

  function pageDraft() {
    shell(`
      <p class="group-title">Draft mode keeps a separate squad. Add names, then auto-pick fills 15 spots from the pool.</p>
      <form class="team-search" id="draft-add"><input name="name" placeholder="Add a player to the pool" /><button class="search-go" type="submit">Add</button></form>
      <button type="button" class="mini-btn" id="draft-run">Auto-pick</button>
      <div class="group">${(state.draftSquad || []).map((player) => `<div class="setting-row"><strong>${esc(player.name)}</strong><span>${esc(player.slot)}</span></div>`).join("") || `<div class="empty">${(state.draftPool || []).length} in the pool.</div>`}</div>
    `);
    ctx.list.querySelector("#draft-add").addEventListener("submit", (event) => {
      event.preventDefault();
      const name = new FormData(event.target).get("name").toString().trim();
      if (!name) return;
      state.draftPool.push({ id: `draft-${state.draftPool.length}`, name, slot: "M", price: 0 });
      persist();
      render(ctx);
    });
    ctx.list.querySelector("#draft-run").addEventListener("click", async () => {
      const data = await fetch("/api/fantasy/players?sort=form&limit=80").then((res) => res.json()).catch(() => ({ players: [] }));
      const pool = data.players || [];
      const need = { G: 2, D: 5, M: 5, A: 3 };
      const picked = [];
      ["G", "D", "M", "A"].forEach((slot) => picked.push(...pool.filter((player) => player.slot === slot).slice(0, need[slot])));
      state.mode = "draft";
      state.draftPool = pool.slice(0, 40);
      state.draftSquad = picked.slice(0, 15);
      persist();
      render(ctx);
    });
  }

  function pagePlanner() {
    shell(`
      <p class="group-title">The planner stores a next-week squad without changing the live team.</p>
      <div class="fantasy-actions"><button type="button" class="mini-btn" id="plan-copy">Copy current squad</button><button type="button" class="mini-btn" id="plan-chip">Plan a wildcard</button><button type="button" class="mini-btn" id="plan-apply">Apply to the live team</button></div>
      <div class="group">${(state.planner || []).map((player) => `<div class="setting-row"><strong>${esc(player.name)}</strong><span>${player.xi ? "XI" : "Bench"}</span></div>`).join("") || `<div class="empty">Nothing planned.</div>`}</div>
      <div class="group">${(state.plannerWeeks || []).map((week) => `<div class="setting-row"><strong>${esc(week.week)}</strong><span>${esc(week.chip || "no chip")} · ${(week.squad || []).length} players</span></div>`).join("")}</div>
    `);
    ctx.list.querySelector("#plan-copy").addEventListener("click", () => {
      state.mode = "planner";
      state.planner = state.squad.map((player) => ({ id: player.id, name: player.name, xi: player.xi, slot: player.slot, price: player.price, club: player.club }));
      state.plannerWeeks = [{ week: state.weekKey, chip: state.plannerChip, squad: state.planner }, ...(state.plannerWeeks || [])].slice(0, 6);
      persist();
      render(ctx);
    });
    ctx.list.querySelector("#plan-chip").addEventListener("click", () => {
      state.plannerChip = state.plannerChip ? "" : "wildcard";
      persist();
      render(ctx);
    });
    ctx.list.querySelector("#plan-apply").addEventListener("click", () => {
      if (GAME().locked(ctx.matches || []) && !["wildcard1", "wildcard2", "freehit"].includes(state.chipThisWeek)) return window.alert("The deadline has passed.");
      if (!state.planner.length || !window.confirm("Replace the live squad with the planned names that are already fully stored?")) return;
      const full = state.planner.filter((player) => player.id && player.price != null);
      if (full.length !== state.planner.length) return window.alert("This plan only has names. Copy the current squad before applying it.");
      state.squad = full.map((player) => ({ ...player }));
      state.mode = "classic";
      persist();
      go("team");
    });
  }

  async function pageAdmin() {
    if (ctx.user?.role !== "admin") {
      shell(`<div class="group"><div class="empty">The admin tools open for the first account, which is the admin.</div></div>`);
      return;
    }
    const config = await fetch("/api/fantasy/config").then((res) => res.json()).catch(() => ({}));
    shell(`
      <form class="group" id="admin-form">
        <div class="setting-row"><label>Season start<input name="seasonStart" value="${esc(config.seasonStart || "")}" /></label></div>
        <div class="setting-row"><label>Season end<input name="seasonEnd" value="${esc(config.seasonEnd || "")}" /></label></div>
        <div class="setting-row"><label>Deadline offset minutes<input name="deadlineOffsetMin" value="${esc(config.deadlineOffsetMin || 90)}" /></label></div>
        <div class="setting-row"><label>Scoring note<input name="scoringNote" value="${esc(config.scoringNote || "")}" /></label></div>
        <div class="setting-row"><label>Price override name<input name="overrideName" placeholder="Bukayo Saka" /></label></div>
        <div class="setting-row"><label>Override Derby price<input name="overridePrice" placeholder="14.2" /></label></div>
        <div class="setting-row"><label>Postponed match ids<input name="postponed" value="${esc((config.postponed || []).join(", "))}" /></label></div>
        <button class="mini-btn" type="submit">Save competition</button>
      </form>
      <button type="button" class="mini-btn" id="reset-season">Archive and reset tables</button>
      <p class="intel-note" id="admin-health"></p>
    `);
    fetch("/api/fantasy/health").then((res) => res.json()).then((health) => {
      const note = ctx.list.querySelector("#admin-health");
      if (note) note.textContent = `${health.managers || 0} managers · ${health.leagues || 0} leagues · backup ${health.backup ? "yes" : "no"} · last beat ${health.lastBeat || "pending"}`;
    }).catch(() => {});
    ctx.list.querySelector("#admin-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.target).entries());
      const overrides = { ...(config.priceOverrides || {}) };
      if (data.overrideName && data.overridePrice) overrides[String(data.overrideName).toLowerCase()] = Number(data.overridePrice);
      await fetch("/api/fantasy/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seasonStart: data.seasonStart,
          seasonEnd: data.seasonEnd,
          deadlineOffsetMin: Number(data.deadlineOffsetMin),
          scoringNote: data.scoringNote,
          postponed: String(data.postponed || "").split(",").map((item) => item.trim()).filter(Boolean),
          priceOverrides: overrides,
        }),
      });
      GAME().configure(await fetch("/api/fantasy/config").then((res) => res.json()));
      window.alert("Saved.");
    });
    ctx.list.querySelector("#reset-season").addEventListener("click", async () => {
      if (!window.confirm("Archive every table and set scores back to zero?")) return;
      const result = await fetch("/api/fantasy/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then((res) => res.json());
      window.alert(result.error || "Season tables were reset.");
    });
  }

  const views = {
    home: pageHome,
    team: pageTeam,
    pick: pageTeam,
    transfers: pageTransfers,
    players: pagePlayers,
    profile: pageProfile,
    compare: pageCompare,
    points: pagePoints,
    fixtures: pageFixtures,
    live: pageLive,
    history: pageHistory,
    season: pageSeason,
    leagues: pageLeagues,
    league: pageLeague,
    h2h: pageH2H,
    cup: pageCup,
    ranks: pageRanks,
    stats: pageStats,
    news: pageNews,
    alerts: pageNotices,
    prices: pagePrices,
    pieces: pagePieces,
    more: pageMore,
    achievements: pageAchievements,
    rules: pageRules,
    settings: pageSettings,
    admin: pageAdmin,
    draft: pageDraft,
    planner: pagePlanner,
  };

  function render(next) {
    ctx = next;
    renderStamp += 1;
    state = GAME().load();
    state.priceMarks = state.priceMarks || {};
    state.notify = state.notify || {};
    if (state.theme) document.documentElement.dataset.theme = state.theme;
    if (!rulesLoaded) {
      rulesLoaded = true;
      fetch("/api/fantasy/config").then((res) => res.json()).then((cfg) => {
        GAME().configure(cfg);
        if (ctx) render(ctx);
      }).catch(() => {});
    }
    GAME().roll(state, ctx.points?.total || 0, ctx.matches || []);
    GAME().save(state);
    const view = views[screen] || pageHome;
    const result = view();
    if (result && typeof result.then === "function") result.catch(() => shell(`<div class="group"><div class="empty">That page could not load.</div></div>`));
  }

  root.NINETY_FANTASY_UI = {
    render,
    screen: () => screen,
    title: () => ({ compare: "Compare", h2h: "Head to head", cup: "Cup", draft: "Draft", planner: "Planner", admin: "Admin", alerts: "Notifications", season: "Season", profile: "Player", league: "League", pick: "Pick Team", prices: "Price Changes", pieces: "Set Piece Takers", more: "More" }[screen] || PAGES.find((page) => page[0] === screen)?.[1] || "Fantasy"),
    back() {
      if (screen === "home") return false;
      screen = "home";
      if (ctx) render(ctx);
      root.updateNav?.();
      return true;
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
