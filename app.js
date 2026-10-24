const KEYS = {
  favorites: "ninety-favorites-v3",
  alerts: "ninety-alerts-v1",
};

const TITLES = {
  matches: "Matches",
  transfers: "Transfers",
  ask: "Ask AI",
  teams: "Teams",
  favourites: "Favourites",
  account: "Account",
};

const API = window.NINETY_API;
const AI = window.NINETY_AI;
const AUTH = window.NINETY_AUTH;
const TRANSFERS = window.NINETY_DATA.transfers;

let matchLeague = "all";
let currentView = "matches";
let teamsLeagueId = null;
let selectedTeam = null;
let selectedPlayer = null;
let accountMode = "signin";
let live = {
  leagues: API.LEAGUES.map((l) => ({ ...l, logo: null })),
  teams: [],
  matches: [],
  ready: false,
  error: null,
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function loadJson(key, fallback) {
  const saved = localStorage.getItem(key);
  if (!saved) return structuredClone(fallback);
  try {
    return JSON.parse(saved);
  } catch {
    return structuredClone(fallback);
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function loadFavorites() {
  const user = AUTH.currentUser();
  if (user && Array.isArray(user.favorites)) return [...user.favorites];
  const local = loadJson(KEYS.favorites, []);
  return Array.isArray(local) ? local : [];
}

let favorites = loadFavorites();

let alertSettings = loadJson(KEYS.alerts, {
  enabled: false,
  matchReminders: true,
  transferAlerts: true,
});

let teamSearchQuery = "";
let teamSearchResults = [];
let teamSearchLoading = false;

const els = {
  matchLeagues: document.querySelector("#match-leagues"),
  matchesList: document.querySelector("#matches-list"),
  transfersList: document.querySelector("#transfers-list"),
  teamsList: document.querySelector("#teams-list"),
  favouritesList: document.querySelector("#favourites-list"),
  accountList: document.querySelector("#account-list"),
  askForm: document.querySelector("#ask-form"),
  askLog: document.querySelector("#ask-log"),
  askInput: document.querySelector("#ask-input"),
  navTitle: document.querySelector("#nav-title"),
  navDate: document.querySelector("#nav-date"),
  navBack: document.querySelector("#nav-back"),
  accountBtn: document.querySelector("#account-btn"),
  accountAvatar: document.querySelector("#account-avatar"),
  teamSearchForm: document.querySelector("#team-search-form"),
  teamSearchInput: document.querySelector("#team-search-input"),
};

function persist() {
  saveJson(KEYS.favorites, favorites);
  saveJson(KEYS.alerts, alertSettings);
  if (AUTH.currentUser()) AUTH.updateFavorites(favorites);
}

function syncFromAccount() {
  const user = AUTH.currentUser();
  if (user && Array.isArray(user.favorites)) {
    favorites = [...user.favorites];
    saveJson(KEYS.favorites, favorites);
  }
}

function logoMarkup(url, fallbackText, color = "#333", sizeClass = "") {
  const initials = String(fallbackText || "?")
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
  const cls = `crest${sizeClass ? ` ${sizeClass}` : ""}${url ? " crest-img" : ""}`;
  if (url) {
    return `<span class="${cls}" style="--crest-fallback:${color}"><img src="${escapeHtml(url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.parentElement.classList.add('is-fallback');this.remove();" /><span class="crest-fallback">${escapeHtml(initials)}</span></span>`;
  }
  return `<span class="${cls}" style="background:${color}">${escapeHtml(initials)}</span>`;
}

function findClub(name) {
  const key = String(name || "").trim().toLowerCase();
  if (!key) return null;
  const aliases = {
    "man city": "manchester city",
    "man united": "manchester united",
    "man utd": "manchester united",
    psg: "paris saint-germain",
    tottenham: "tottenham hotspur",
    spurs: "tottenham hotspur",
    barca: "barcelona",
    bayern: "bayern munich",
  };
  const needle = aliases[key] || key;
  const teams = live.teams || [];
  return (
    teams.find((t) => t.name.toLowerCase() === needle || t.name.toLowerCase() === key) ||
    teams.find((t) => t.short && t.short.toLowerCase() === key) ||
    teams.find((t) => {
      const club = t.name.toLowerCase();
      return needle.length >= 4 && club.length >= 4 && (club.includes(needle) || needle.includes(club));
    }) ||
    null
  );
}

function crest(nameOrTeam, sizeClass = "") {
  if (!nameOrTeam) return logoMarkup(null, "?", "#333", sizeClass);
  if (typeof nameOrTeam === "object") {
    return logoMarkup(nameOrTeam.logo, nameOrTeam.short || nameOrTeam.name, nameOrTeam.color, sizeClass);
  }
  const team = findClub(nameOrTeam);
  const matchLogo =
    live.matches.find((m) => m.home === nameOrTeam)?.homeLogo ||
    live.matches.find((m) => m.away === nameOrTeam)?.awayLogo;
  const matchColor =
    live.matches.find((m) => m.home === nameOrTeam)?.homeColor ||
    live.matches.find((m) => m.away === nameOrTeam)?.awayColor;
  return logoMarkup(
    team?.logo || matchLogo,
    team?.short || nameOrTeam,
    team?.color || matchColor || "#333",
    sizeClass
  );
}

function leagueLogo(league, sizeClass = "") {
  if (!league) return "";
  return logoMarkup(league.logo, league.flag || league.name, "#1a5cff", sizeClass);
}

function statusClass(status) {
  if (status === "Live") return "live";
  if (status === "FT") return "ft";
  return "upcoming";
}

function isFavName(name) {
  return favorites.includes(name);
}

function toggleFavorite(name) {
  if (!name) return;
  if (favorites.includes(name)) favorites = favorites.filter((t) => t !== name);
  else favorites = [...favorites, name];
  persist();
  render();
  refreshAccountButton();
}

function showView(name) {
  currentView = name;
  if (name !== "teams") {
    teamsLeagueId = null;
    selectedTeam = null;
    selectedPlayer = null;
  }
  document.querySelectorAll(".tab-bar .tab").forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.view === name);
  });
  document.querySelectorAll(".screen").forEach((screen) => {
    screen.classList.toggle("is-active", screen.id === name);
  });
  updateNav();
  render();
}

function updateNav() {
  const deepTeams = currentView === "teams" && (teamsLeagueId || selectedTeam || selectedPlayer);
  els.navBack.hidden = !deepTeams;
  if (currentView === "teams" && selectedPlayer) {
    els.navTitle.textContent = selectedPlayer.name || "Player";
  } else if (currentView === "teams" && selectedTeam) {
    els.navTitle.textContent = selectedTeam.name;
  } else if (currentView === "teams" && teamsLeagueId) {
    els.navTitle.textContent = live.leagues.find((l) => l.id === teamsLeagueId)?.name || "Teams";
  } else {
    els.navTitle.textContent = TITLES[currentView] || "Derby";
  }
}

function refreshAccountButton() {
  const user = AUTH.currentUser();
  if (user) {
    els.accountAvatar.classList.add("is-user");
    if (user.picture) {
      els.accountAvatar.innerHTML = `<img src="${escapeHtml(user.picture)}" alt="" referrerpolicy="no-referrer" />`;
    } else {
      els.accountAvatar.textContent = (user.name || "U").trim().charAt(0).toUpperCase();
    }
  } else {
    els.accountAvatar.classList.remove("is-user");
    els.accountAvatar.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="8" r="3.4" stroke="currentColor" stroke-width="1.8" />
        <path d="M5.5 18.2c1.4-3 3.7-4.5 6.5-4.5s5.1 1.5 6.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
      </svg>`;
  }
}

async function bootstrapLive() {
  if (!live.matches.length) {
    els.matchesList.innerHTML = `<div class="loading">Loading live scores…</div>`;
  }
  try {
    // Paint today first so Matches never feels stuck
    const quick = await API.loadMatchesQuick();
    live.leagues = quick.leagues.length ? quick.leagues : live.leagues;
    live.matches = quick.matches;
    live.ready = true;
    live.error = null;
    if (currentView === "matches") {
      renderMatchLeagueSeg();
      renderMatches();
    }

    const data = await API.loadAll({ days: 7 });
    live.leagues = data.leagues;
    live.teams = data.teams;
    live.matches = data.matches;
    live.ready = true;
    live.error = null;
  } catch (err) {
    if (!live.matches.length) {
      live.error = String(err?.message || err);
      live.ready = false;
    }
  }
  render();
}

function renderMatchLeagueSeg() {
  const items = [
    { id: "all", name: "All", logoHtml: "" },
    { id: "live", name: "Live", logoHtml: `<span class="live-dot"></span>` },
    { id: "fav", name: "Following", logoHtml: "" },
    ...live.leagues.map((l) => ({ ...l, logoHtml: leagueLogo(l, "crest-xs") })),
  ];
  els.matchLeagues.innerHTML = items
    .map(
      (l) =>
        `<button type="button" class="seg-btn${matchLeague === l.id ? " is-on" : ""}" data-league="${l.id}">${l.logoHtml || ""}<span>${escapeHtml(l.name)}</span></button>`
    )
    .join("");
  els.matchLeagues.querySelectorAll("[data-league]").forEach((btn) => {
    btn.addEventListener("click", () => {
      matchLeague = btn.dataset.league;
      renderMatchLeagueSeg();
      renderMatches();
    });
  });
}

function resolveMatchCrest(match, side) {
  const name = side === "home" ? match.home : match.away;
  const id = side === "home" ? match.homeId : match.awayId;
  const logo = side === "home" ? match.homeLogo : match.awayLogo;
  const color = side === "home" ? match.homeColor : match.awayColor;
  const team = live.teams.find((t) => t.id === id || t.name === name);
  return logoMarkup(
    logo || team?.logo || (id ? `https://a.espncdn.com/i/teamlogos/soccer/500/${id}.png` : null),
    team?.short || name,
    color || team?.color || "#333"
  );
}

function renderMatches() {
  if (!live.ready && !live.matches.length) {
    els.matchesList.innerHTML = live.error
      ? `<div class="group"><div class="empty">Couldn’t load live scores.<br>${escapeHtml(live.error)}</div></div>`
      : `<div class="loading">Loading live scores…</div>`;
    return;
  }

  let list = [...live.matches];
  if (matchLeague === "live") list = list.filter((m) => m.status === "Live");
  else if (matchLeague === "fav") list = list.filter((m) => isFavName(m.home) || isFavName(m.away));
  else if (matchLeague !== "all") list = list.filter((m) => m.league === matchLeague);

  list.sort((a, b) => {
    const rank = (s) => (s === "Live" ? 0 : s === "Upcoming" ? 1 : 2);
    return rank(a.status) - rank(b.status);
  });

  if (!list.length) {
    els.matchesList.innerHTML = `<div class="group"><div class="empty">No matches in this filter right now.</div></div>`;
    return;
  }

  const byLeague = new Map();
  for (const match of list) {
    if (!byLeague.has(match.league)) byLeague.set(match.league, []);
    byLeague.get(match.league).push(match);
  }

  const frag = document.createDocumentFragment();
  for (const [leagueId, matches] of byLeague) {
    const league = live.leagues.find((l) => l.id === leagueId);
    const title = document.createElement("p");
    title.className = "group-title league-heading";
    title.innerHTML = `${leagueLogo(league, "crest-xs")}<span>${escapeHtml(league?.name || leagueId)}</span>`;
    const group = document.createElement("div");
    group.className = "group match-group";
    matches.forEach((match) => {
      const row = document.createElement("article");
      row.className = `match-row${match.status === "Live" ? " is-live" : ""}`;
      row.style.setProperty("--home-tint", match.homeColor || "#0a84ff");
      row.style.setProperty("--away-tint", match.awayColor || "#30d158");
      const scoreHome = match.status === "Upcoming" ? "–" : match.homeScore;
      const scoreAway = match.status === "Upcoming" ? "–" : match.awayScore;
      const clock =
        match.status === "Live"
          ? match.minute || "Live"
          : match.status === "Upcoming"
            ? match.kickoff || "Scheduled"
            : "FT";
      row.innerHTML = `
        <div class="match-meta">
          <span class="status ${statusClass(match.status)}">${
            match.status === "Live"
              ? `<span class="live-dot"></span>${escapeHtml(clock)}`
              : escapeHtml(match.status === "Upcoming" ? clock : "FT")
          }</span>
          <span>${isFavName(match.home) || isFavName(match.away) ? "★ Following" : ""}</span>
        </div>
        <div class="match-teams">
          <div class="club-line">${resolveMatchCrest(match, "home")}<span>${escapeHtml(match.home)}</span></div>
          <div class="club-line">${resolveMatchCrest(match, "away")}<span>${escapeHtml(match.away)}</span></div>
        </div>
        <div class="score-stack"><span>${scoreHome}</span><span>${scoreAway}</span></div>
      `;
      group.appendChild(row);
    });
    frag.append(title, group);
  }

  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.className = "primary-action secondary";
  refresh.textContent = "Refresh live scores";
  refresh.addEventListener("click", () => bootstrapLive());
  frag.appendChild(refresh);
  els.matchesList.replaceChildren(frag);
}

function transferStatusClass(status) {
  const s = String(status || "").toLowerCase();
  if (s.includes("hot")) return "hot";
  if (s.includes("completed")) return "warm";
  return "cold";
}

function renderTransfers() {
  const done = TRANSFERS.filter((t) => t.status === "Completed");
  const hot = TRANSFERS.filter((t) => t.status !== "Completed");
  const frag = document.createDocumentFragment();

  const note = document.createElement("p");
  note.className = "group-title";
  note.textContent = "From the 2027 window onwards";
  frag.appendChild(note);

  const makeGroup = (label, items) => {
    if (!items.length) return;
    const title = document.createElement("p");
    title.className = "group-title";
    title.textContent = label;
    const group = document.createElement("div");
    group.className = "group";
    items.forEach((t) => {
      const related = isFavName(t.from) || isFavName(t.to);
      const row = document.createElement("article");
      row.className = "intel-row transfer-row";
      row.innerHTML = `
        <div class="transfer-clubs">${crest(t.from, "crest-sm")}<span class="transfer-arrow">→</span>${crest(t.to, "crest-sm")}</div>
        <div>
          <p class="intel-title">${escapeHtml(t.player)}</p>
          <p class="intel-sub">${escapeHtml(t.from)} → ${escapeHtml(t.to)}</p>
          <p class="intel-note">${escapeHtml(t.fee)} · ${escapeHtml(t.window)}${related ? " · Following" : ""}</p>
          <p class="intel-note">${escapeHtml(t.note)}</p>
        </div>
        <span class="pill ${transferStatusClass(t.status)}">${escapeHtml(t.status)}</span>
      `;
      group.appendChild(row);
    });
    frag.append(title, group);
  };

  makeGroup("Completed", done);
  makeGroup("Still cooking", hot);
  els.transfersList.replaceChildren(frag);
}

function teamRowButton(team, meta = "") {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "team-row";
  btn.innerHTML = `
    ${crest(team)}
    <div>
      <div class="team-name">${escapeHtml(team.name)}${isFavName(team.name) ? " ★" : ""}</div>
      <div class="team-meta">${escapeHtml(meta || team.short || team.label || "")}</div>
    </div>
    <span class="chev">›</span>
  `;
  btn.addEventListener("click", () => {
    selectedTeam = team;
    selectedPlayer = null;
    teamSearchQuery = "";
    teamSearchResults = [];
    if (els.teamSearchInput) els.teamSearchInput.value = "";
    renderTeams();
  });
  return btn;
}

function renderTeams() {
  updateNav();
  if (selectedPlayer && selectedTeam) {
    renderPlayerDetail(selectedPlayer, selectedTeam);
    return;
  }
  if (selectedTeam) {
    renderTeamDetail(selectedTeam);
    return;
  }

  const frag = document.createDocumentFragment();

  if (teamSearchLoading) {
    els.teamsList.innerHTML = `<div class="loading">Searching the world…</div>`;
    return;
  }

  if (teamSearchQuery && teamSearchResults.length) {
    const title = document.createElement("p");
    title.className = "group-title";
    title.textContent = `Results for “${teamSearchQuery}”`;
    const group = document.createElement("div");
    group.className = "group";
    teamSearchResults.forEach((team) => group.appendChild(teamRowButton(team, team.label || team.slug)));
    frag.append(title, group);
    els.teamsList.replaceChildren(frag);
    return;
  }

  if (teamSearchQuery && !teamSearchResults.length) {
    els.teamsList.innerHTML = `<div class="group"><div class="empty">No clubs found for “${escapeHtml(teamSearchQuery)}”.</div></div>`;
    return;
  }

  if (teamsLeagueId) {
    const league = live.leagues.find((l) => l.id === teamsLeagueId);
    const teams = live.teams.filter((t) => t.league === teamsLeagueId);
    const title = document.createElement("p");
    title.className = "group-title league-heading";
    title.innerHTML = `${leagueLogo(league, "crest-xs")}<span>${escapeHtml(league?.name || "League")}</span>`;
    const group = document.createElement("div");
    group.className = "group";
    teams.forEach((team) => group.appendChild(teamRowButton(team)));
    frag.append(title, group);
    els.teamsList.replaceChildren(frag);
    return;
  }

  const title = document.createElement("p");
  title.className = "group-title";
  title.textContent = "Browse leagues";
  const group = document.createElement("div");
  group.className = "group";
  live.leagues.forEach((league) => {
    const count = live.teams.filter((t) => t.league === league.id).length;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "team-row";
    btn.innerHTML = `
      ${leagueLogo(league)}
      <div>
        <div class="team-name">${escapeHtml(league.name)}</div>
        <div class="team-meta">${count} clubs · ${escapeHtml(league.country || "")}</div>
      </div>
      <span class="chev">›</span>
    `;
    btn.addEventListener("click", () => {
      teamsLeagueId = league.id;
      renderTeams();
    });
    group.appendChild(btn);
  });
  frag.append(title, group);
  els.teamsList.replaceChildren(frag);
}

function playerRowButton(player, team) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "player-row";
  const face = player.headshot
    ? `<span class="player-face"><img src="${escapeHtml(player.headshot)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentElement.classList.add('is-fallback');this.remove();" /></span>`
    : `<span class="player-face is-fallback">${escapeHtml((player.name || "?").charAt(0))}</span>`;
  btn.innerHTML = `
    ${face}
    <div>
      <div class="team-name">${player.number ? `#${escapeHtml(player.number)} ` : ""}${escapeHtml(player.name)}</div>
      <div class="team-meta">${escapeHtml(player.positionName || player.position || "")}${
        player.appearances ? ` · ${player.appearances} apps` : ""
      }${player.goals ? ` · ${player.goals} G` : ""}</div>
    </div>
    <span class="chev">›</span>
  `;
  btn.addEventListener("click", () => {
    selectedPlayer = player;
    renderTeams();
  });
  return btn;
}

function formationMarkup(formation, teamColor = "#30d158") {
  if (!formation?.lines?.length) return "";
  const lines = formation.lines
    .map((line) => {
      const slots = (line.players || [])
        .map(
          (p) => `
          <button type="button" class="pitch-player" data-pid="${escapeHtml(p.id)}">
            <span class="pitch-kit" style="--kit:${teamColor}">${escapeHtml(p.number || p.position || "·")}</span>
            <span class="pitch-name">${escapeHtml((p.name || "").split(" ").slice(-1)[0])}</span>
          </button>`
        )
        .join("");
      return `<div class="pitch-line pitch-${escapeHtml(line.key)}">${slots}</div>`;
    })
    .join("");
  return `
    <div class="pitch" style="--pitch-accent:${teamColor}">
      <div class="pitch-markings" aria-hidden="true"></div>
      <p class="pitch-shape">${escapeHtml(formation.shape || "4-3-3")}</p>
      ${lines}
    </div>
  `;
}

async function renderTeamDetail(team) {
  els.teamsList.innerHTML = `<div class="loading">Loading ${escapeHtml(team.name)}…</div>`;
  updateNav();
  try {
    const [detail, roster, schedule] = await Promise.all([
      API.loadTeamDetail(team.slug, team.espnId || team.id),
      API.loadRoster(team.slug, team.espnId || team.id),
      API.loadSchedule(team.slug, team.espnId || team.id),
    ]);

    if (selectedTeam !== team || selectedPlayer) return;

    const accent = detail.color || team.color || "#0a84ff";
    const header = document.createElement("div");
    header.className = "group team-hero";
    header.style.setProperty("--team-accent", accent);
    header.innerHTML = `
      <div class="fav-row">
        ${crest({ ...team, logo: detail.logo || team.logo, color: accent }, "crest-lg")}
        <div>
          <div class="team-name">${escapeHtml(detail.name || team.name)}</div>
          <div class="team-meta">${escapeHtml(detail.record || "—")}${detail.points != null ? ` · ${detail.points} pts` : ""}</div>
        </div>
        <button type="button" class="star-btn ${isFavName(team.name) ? "" : "is-off"}" data-star>${isFavName(team.name) ? "★" : "☆"}</button>
      </div>
      <div class="intel-row">
        <div>
          <p class="intel-note"><strong>Coach</strong> · ${escapeHtml(roster.coach || "—")}</p>
          <p class="intel-note"><strong>Stadium</strong> · ${escapeHtml(detail.stadium || "—")}</p>
          <p class="intel-note">${escapeHtml(detail.standingSummary || "")}</p>
        </div>
      </div>
    `;
    header.querySelector("[data-star]").addEventListener("click", () => toggleFavorite(team.name));

    const blocks = [header];

    if (schedule.form?.length) {
      const t = document.createElement("p");
      t.className = "group-title";
      t.textContent = "Form (this season)";
      const g = document.createElement("div");
      g.className = "group";
      g.innerHTML = `<div class="form-row">${schedule.form
        .map((r) => `<span class="form-pill ${r.toLowerCase()}">${escapeHtml(r)}</span>`)
        .join("")}</div>`;
      blocks.push(t, g);
    }

    if (schedule.lastFive?.length) {
      const t = document.createElement("p");
      t.className = "group-title";
      t.textContent = "Last five";
      const g = document.createElement("div");
      g.className = "group";
      schedule.lastFive.forEach((game) => {
        const row = document.createElement("div");
        row.className = "intel-row";
        row.innerHTML = `
          <div>
            <p class="intel-title">${game.home ? "vs" : "@"} ${escapeHtml(game.opp)}</p>
            <p class="intel-sub">${escapeHtml(game.score)}</p>
          </div>
          <span class="form-pill ${game.result.toLowerCase()}">${escapeHtml(game.result)}</span>
        `;
        g.appendChild(row);
      });
      blocks.push(t, g);
    }

    if (roster.players?.length) {
      const t = document.createElement("p");
      t.className = "group-title";
      t.textContent = `Squad · ${roster.players.length}`;
      const g = document.createElement("div");
      g.className = "group";
      roster.players.forEach((p) => g.appendChild(playerRowButton(p, team)));
      blocks.push(t, g);

      const ft = document.createElement("p");
      ft.className = "group-title";
      ft.textContent = `Starting XI · ${roster.formation?.shape || "4-3-3"}`;
      const fg = document.createElement("div");
      fg.className = "group pitch-wrap";
      fg.innerHTML = formationMarkup(roster.formation, accent);
      fg.querySelectorAll("[data-pid]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const player = roster.players.find((p) => p.id === btn.dataset.pid);
          if (!player) return;
          selectedPlayer = player;
          renderTeams();
        });
      });
      blocks.push(ft, fg);
    }

    els.teamsList.replaceChildren(...blocks);
  } catch (err) {
    els.teamsList.innerHTML = `<div class="group"><div class="empty">Couldn’t load club details.<br>${escapeHtml(err.message || err)}</div></div>`;
  }
}

function statCards(player) {
  const highlight = [
    { label: "Apps", value: player.appearances },
    { label: "Goals", value: player.goals },
    { label: "Assists", value: player.assists },
    { label: "Shots", value: player.shots },
    { label: "On target", value: player.shotsOnTarget },
    { label: "Yellow", value: player.yellowCards },
    { label: "Red", value: player.redCards },
    { label: "Saves", value: player.saves },
  ].filter((s) => s.value != null && s.value !== "" && !(s.label === "Saves" && !s.value && player.position !== "G"));

  if (!highlight.length && player.stats?.length) {
    return player.stats.slice(0, 8).map((s) => ({ label: s.short || s.label, value: s.value }));
  }
  return highlight;
}

async function renderPlayerDetail(player, team) {
  els.teamsList.innerHTML = `<div class="loading">Loading ${escapeHtml(player.name)}…</div>`;
  updateNav();
  try {
    const full = await API.loadPlayerStats(player.id, player);
    if (selectedPlayer?.id !== player.id) return;

    const accent = team.color || "#0a84ff";
    const cards = statCards(full);
    const face = full.headshot
      ? `<img class="player-hero-img" src="${escapeHtml(full.headshot)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()" />`
      : "";

    const header = document.createElement("div");
    header.className = "group player-hero";
    header.style.setProperty("--team-accent", accent);
    header.innerHTML = `
      <div class="player-hero-top">
        ${face}
        <div>
          <p class="player-number">${full.number ? `#${escapeHtml(full.number)}` : ""}</p>
          <h2 class="player-hero-name">${escapeHtml(full.name)}</h2>
          <p class="intel-note">${escapeHtml(full.positionName || full.position || "")}${
            full.nationality ? ` · ${escapeHtml(full.nationality)}` : ""
          }${full.age ? ` · Age ${escapeHtml(full.age)}` : ""}</p>
          <p class="intel-note">${escapeHtml(team.name)}${full.height ? ` · ${escapeHtml(full.height)}` : ""}</p>
        </div>
      </div>
      <div class="stat-grid">
        ${cards
          .map(
            (s) => `
          <div class="stat-card">
            <span class="stat-value">${escapeHtml(s.value)}</span>
            <span class="stat-label">${escapeHtml(s.label)}</span>
          </div>`
          )
          .join("")}
      </div>
    `;

    const blocks = [header];

    if (full.stats?.length) {
      const t = document.createElement("p");
      t.className = "group-title";
      t.textContent = full.seasonLabel || "Season stats";
      const g = document.createElement("div");
      g.className = "group";
      full.stats.forEach((s, i) => {
        const row = document.createElement("div");
        row.className = "setting-row";
        if (i === 0) row.style.borderTop = "0";
        row.innerHTML = `<strong>${escapeHtml(s.label)}</strong><span>${escapeHtml(s.value)}</span>`;
        g.appendChild(row);
      });
      blocks.push(t, g);
    } else {
      const empty = document.createElement("div");
      empty.className = "group";
      empty.innerHTML = `<div class="empty">No detailed season stats published for this player yet.</div>`;
      blocks.push(empty);
    }

    els.teamsList.replaceChildren(...blocks);
  } catch (err) {
    els.teamsList.innerHTML = `<div class="group"><div class="empty">Couldn’t load player stats.<br>${escapeHtml(err.message || err)}</div></div>`;
  }
}

function renderFavourites() {
  const frag = document.createDocumentFragment();
  const title = document.createElement("p");
  title.className = "group-title";
  title.textContent = "Your clubs";
  frag.appendChild(title);

  if (!favorites.length) {
    const empty = document.createElement("div");
    empty.className = "group";
    empty.innerHTML = `<div class="empty">No favourites yet. Open Teams, pick a club, and tap the star.</div>`;
    frag.appendChild(empty);
  } else {
    favorites.forEach((name) => {
      const team = live.teams.find((t) => t.name === name);
      const group = document.createElement("div");
      group.className = "group";
      group.innerHTML = `
        <div class="fav-row">
          ${crest(team || name)}
          <div>
            <div class="team-name">${escapeHtml(name)}</div>
            <div class="team-meta">${escapeHtml(team ? live.leagues.find((l) => l.id === team.league)?.name || "" : "Followed")}</div>
          </div>
          <button type="button" class="star-btn" data-unfav>★</button>
        </div>
        <div class="intel-row"><p class="intel-note">Open the club page for live form, squad, and formation.</p></div>
      `;
      group.querySelector("[data-unfav]").addEventListener("click", () => toggleFavorite(name));
      if (team) {
        const open = document.createElement("button");
        open.type = "button";
        open.className = "mini-btn block-btn";
        open.textContent = "Open club page";
        open.addEventListener("click", () => {
          showView("teams");
          teamsLeagueId = team.league;
          selectedTeam = team;
          selectedPlayer = null;
          renderTeams();
        });
        group.appendChild(open);
      }
      frag.appendChild(group);
    });
  }

  const alertTitle = document.createElement("p");
  alertTitle.className = "group-title";
  alertTitle.textContent = "Alerts";
  const alertGroup = document.createElement("div");
  alertGroup.className = "group";
  alertGroup.innerHTML = `
    <div class="setting-row">
      <label><strong>Match reminders</strong><span>Favourite kickoffs</span></label>
      <label class="switch"><input type="checkbox" id="alert-matches" ${alertSettings.matchReminders ? "checked" : ""} /><span></span></label>
    </div>
    <div class="setting-row">
      <label><strong>Transfer pings</strong><span>2027 window deals</span></label>
      <label class="switch"><input type="checkbox" id="alert-transfers" ${alertSettings.transferAlerts ? "checked" : ""} /><span></span></label>
    </div>
  `;
  alertGroup.querySelector("#alert-matches").addEventListener("change", (e) => {
    alertSettings.matchReminders = e.target.checked;
    persist();
  });
  alertGroup.querySelector("#alert-transfers").addEventListener("change", (e) => {
    alertSettings.transferAlerts = e.target.checked;
    persist();
  });
  const enable = document.createElement("button");
  enable.type = "button";
  enable.className = "primary-action";
  enable.textContent = alertSettings.enabled ? "Notifications on" : "Turn on notifications";
  enable.addEventListener("click", async () => {
    if (!("Notification" in window)) return;
    const permission = await Notification.requestPermission();
    alertSettings.enabled = permission === "granted";
    persist();
    if (alertSettings.enabled) new Notification("Derby", { body: "Alerts ready." });
    renderFavourites();
  });

  frag.append(alertTitle, alertGroup, enable);
  els.favouritesList.replaceChildren(frag);
}

function setAuthError(errorEl, message) {
  if (!errorEl) return;
  if (!message) {
    errorEl.hidden = true;
    errorEl.textContent = "";
    return;
  }
  errorEl.hidden = false;
  errorEl.textContent = message;
}

async function afterAuthSuccess() {
  syncFromAccount();
  await AUTH.updateFavorites(favorites);
  refreshAccountButton();
  renderAccount();
}

function renderAccount() {
  const user = AUTH.currentUser();
  const wrap = document.createDocumentFragment();

  if (user) {
    const title = document.createElement("p");
    title.className = "group-title";
    title.textContent = "Signed in";
    const card = document.createElement("div");
    card.className = "group auth-card glass-card";
    card.innerHTML = `
      <p class="intel-title">${escapeHtml(user.name)}</p>
      <p class="intel-note">${escapeHtml(user.email || user.username || user.phone || "")}</p>
      <p class="intel-note">Via ${escapeHtml(user.provider)} · ${favorites.length} favourites saved</p>
    `;
    const save = document.createElement("button");
    save.type = "button";
    save.className = "primary-action";
    save.textContent = "Save favourites to account";
    save.addEventListener("click", async () => {
      await AUTH.updateFavorites(favorites);
      renderAccount();
    });
    const out = document.createElement("button");
    out.type = "button";
    out.className = "primary-action secondary";
    out.textContent = "Sign out";
    out.addEventListener("click", async () => {
      await AUTH.logout();
      refreshAccountButton();
      renderAccount();
    });
    wrap.append(title, card, save, out, buildOpenAiCard());
    els.accountList.replaceChildren(wrap);
    return;
  }

  const title = document.createElement("p");
  title.className = "group-title";
  title.textContent = "Account";
  const social = document.createElement("div");
  social.className = "group auth-card";
  social.innerHTML = `<p class="intel-note">Sign in with Apple or Google — your account is saved on the server so you stay signed in.</p>
    <div id="google-btn-slot" class="google-btn-slot"></div>
    <p class="auth-error" id="social-error" hidden></p>`;

  const socialError = social.querySelector("#social-error");
  const apple = document.createElement("button");
  apple.type = "button";
  apple.className = "auth-btn apple";
  apple.innerHTML = `<span class="auth-brand"></span> Continue with Apple`;
  apple.addEventListener("click", async () => {
    setAuthError(socialError, "");
    apple.disabled = true;
    try {
      await AUTH.continueWithApple();
      await afterAuthSuccess();
    } catch (err) {
      if (String(err.message || err) !== "Cancelled") {
        setAuthError(socialError, err.message || "Apple sign-in failed.");
      }
    } finally {
      apple.disabled = false;
    }
  });

  const google = document.createElement("button");
  google.type = "button";
  google.className = "auth-btn google";
  google.innerHTML = `<span class="auth-brand google-g">G</span> Continue with Google`;
  google.addEventListener("click", async () => {
    setAuthError(socialError, "");
    google.disabled = true;
    try {
      await AUTH.continueWithGoogle();
      await afterAuthSuccess();
    } catch (err) {
      if (String(err.message || err) !== "Cancelled") {
        setAuthError(socialError, err.message || "Google sign-in failed.");
      }
    } finally {
      google.disabled = false;
    }
  });
  social.append(apple, google);

  const formCard = document.createElement("div");
  formCard.className = "group auth-card";
  formCard.innerHTML = `
    <div class="auth-tabs">
      <button type="button" class="seg-btn ${accountMode === "signin" ? "is-on" : ""}" data-mode="signin">Sign in</button>
      <button type="button" class="seg-btn ${accountMode === "signup" ? "is-on" : ""}" data-mode="signup">Create account</button>
    </div>
    <p class="auth-error" id="auth-error" hidden></p>
    <form id="auth-form"></form>
  `;

  const form = formCard.querySelector("#auth-form");
  const errorEl = formCard.querySelector("#auth-error");

  const paintForm = () => {
    formCard.querySelectorAll("[data-mode]").forEach((b) => {
      b.classList.toggle("is-on", b.dataset.mode === accountMode);
    });
    if (accountMode === "signin") {
      form.innerHTML = `
        <label>Email / username / phone<input name="identity" required autocomplete="username" placeholder="you@email.com" /></label>
        <label>Password<input name="password" type="password" required autocomplete="current-password" placeholder="••••••••" /></label>
        <button type="submit" class="auth-btn">Sign in</button>
      `;
    } else {
      form.innerHTML = `
        <label>Name<input name="name" required autocomplete="name" placeholder="Your name" /></label>
        <label>Email<input name="email" type="email" autocomplete="email" placeholder="you@email.com" /></label>
        <label>Username<input name="username" autocomplete="username" placeholder="ninetyfan" /></label>
        <label>Phone<input name="phone" autocomplete="tel" placeholder="+44…" /></label>
        <label>Password<input name="password" type="password" required autocomplete="new-password" placeholder="Min 4 characters" /></label>
        <button type="submit" class="auth-btn">Create account</button>
      `;
    }
  };

  formCard.querySelectorAll("[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      accountMode = btn.dataset.mode;
      setAuthError(errorEl, "");
      paintForm();
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    setAuthError(errorEl, "");
    try {
      if (accountMode === "signin") {
        await AUTH.login({
          identity: String(data.get("identity") || ""),
          password: String(data.get("password") || ""),
        });
      } else {
        await AUTH.register({
          name: String(data.get("name") || ""),
          email: String(data.get("email") || ""),
          username: String(data.get("username") || ""),
          phone: String(data.get("phone") || ""),
          password: String(data.get("password") || ""),
        });
      }
      await afterAuthSuccess();
    } catch (err) {
      setAuthError(errorEl, err.message || "Something went wrong.");
    }
  });

  paintForm();
  wrap.append(title, social, formCard, buildOpenAiCard());
  els.accountList.replaceChildren(wrap);

  // Native Google button when GIS client id is configured
  const slot = social.querySelector("#google-btn-slot");
  if (slot && AUTH.renderGoogleButton(slot)) {
    google.hidden = true;
  }
}

function buildOpenAiCard() {
  const frag = document.createDocumentFragment();
  const title = document.createElement("p");
  title.className = "group-title";
  title.textContent = "ChatGPT / OpenAI";
  const card = document.createElement("div");
  card.className = "group auth-card glass-card";
  card.innerHTML = `
    <p class="intel-note">Ask AI routes through the OpenAI API (ChatGPT models). Paste a key from platform.openai.com — this is not your ChatGPT password.</p>
    <p class="intel-note" id="openai-status">Checking…</p>
    <label>OpenAI API key<input name="openaiKey" type="password" autocomplete="off" placeholder="sk-…" /></label>
    <p class="auth-error" id="openai-error" hidden></p>
    <button type="button" class="auth-btn" id="openai-save">Save key for Ask AI</button>
  `;
  const status = card.querySelector("#openai-status");
  const err = card.querySelector("#openai-error");
  const input = card.querySelector('input[name="openaiKey"]');
  fetch("/api/auth/config", { credentials: "include" })
    .then((r) => r.json())
    .then((cfg) => {
      status.textContent = cfg.openaiConfigured
        ? `Connected${cfg.openaiKeyHint ? ` (${cfg.openaiKeyHint})` : ""} — Ask AI uses ChatGPT.`
        : "Not connected — Ask AI will use the built-in football brain until you add a key.";
      status.classList.toggle("is-live", !!cfg.openaiConfigured);
    })
    .catch(() => {
      status.textContent = "Couldn’t check ChatGPT status.";
    });
  card.querySelector("#openai-save").addEventListener("click", async () => {
    err.hidden = true;
    const key = String(input.value || "").trim();
    if (!key) {
      err.hidden = false;
      err.textContent = "Paste an API key first.";
      return;
    }
    try {
      const res = await fetch("/api/auth/config", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openaiApiKey: key }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      input.value = "";
      status.textContent = `Connected${data.openaiKeyHint ? ` (${data.openaiKeyHint})` : ""} — Ask AI uses ChatGPT.`;
      status.classList.add("is-live");
    } catch (e) {
      err.hidden = false;
      err.textContent = e.message || "Couldn’t save key.";
    }
  });
  frag.append(title, card);
  return frag;
}

function appendAsk(role, text, source) {
  const bubble = document.createElement("div");
  bubble.className = `ask-bubble ${role}`;
  const body = escapeHtml(text).replaceAll("\n", "<br>");
  bubble.innerHTML =
    role === "ai"
      ? `<p>${body}</p><span class="ask-source">${escapeHtml(source || "ChatGPT")}</span>`
      : `<p>${body}</p>`;
  els.askLog.appendChild(bubble);
  els.askLog.scrollTop = els.askLog.scrollHeight;
}

async function ask(question) {
  const q = String(question || "").trim();
  if (!q) return;
  appendAsk("user", q);
  appendAsk("ai", "Asking ChatGPT with live match context…", "ChatGPT");
  try {
    const result = await AI.research(q, {
      favorites,
      matches: live.matches,
      teams: live.teams,
      transfers: TRANSFERS,
    });
    const bubbles = els.askLog.querySelectorAll(".ask-bubble.ai");
    const last = bubbles[bubbles.length - 1];
    if (last) {
      last.innerHTML = `<p>${escapeHtml(result.text).replaceAll("\n", "<br>")}</p><span class="ask-source">${escapeHtml(result.source || "ChatGPT")}</span>`;
    } else {
      appendAsk("ai", result.text, result.source);
    }
  } catch (err) {
    appendAsk("ai", `I hit a snag: ${err.message || err}`, "Derby AI");
  }
}

function renderDate() {
  els.navDate.textContent = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "short",
    timeZone: "Europe/London",
  }).format(new Date());
}

function render() {
  if (currentView === "matches") {
    renderMatchLeagueSeg();
    renderMatches();
  }
  if (currentView === "transfers") renderTransfers();
  if (currentView === "teams") renderTeams();
  if (currentView === "favourites") renderFavourites();
  if (currentView === "account") renderAccount();
}

document.querySelectorAll(".tab-bar .tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    if (tab.dataset.view === "teams") {
      teamsLeagueId = null;
      selectedTeam = null;
      selectedPlayer = null;
    }
    showView(tab.dataset.view);
  });
});

els.navBack.addEventListener("click", () => {
  if (selectedPlayer) {
    selectedPlayer = null;
    renderTeams();
    return;
  }
  if (selectedTeam) {
    selectedTeam = null;
    renderTeams();
    return;
  }
  if (teamsLeagueId) {
    teamsLeagueId = null;
    renderTeams();
  }
});

els.accountBtn.addEventListener("click", () => showView("account"));

els.askForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const q = els.askInput.value;
  els.askInput.value = "";
  ask(q);
});

document.querySelectorAll("#ask-chips .chip").forEach((chip) => {
  chip.addEventListener("click", () => ask(chip.dataset.q));
});

els.teamSearchForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const q = String(els.teamSearchInput.value || "").trim();
  teamSearchQuery = q;
  selectedTeam = null;
  selectedPlayer = null;
  teamsLeagueId = null;
  if (q.length < 2) {
    teamSearchResults = [];
    renderTeams();
    return;
  }
  teamSearchLoading = true;
  renderTeams();
  try {
    teamSearchResults = await API.searchTeams(q);
  } catch (err) {
    teamSearchResults = [];
    console.warn(err);
  }
  teamSearchLoading = false;
  showView("teams");
});

window.addEventListener("ninety-auth", async () => {
  await afterAuthSuccess();
});

renderDate();
refreshAccountButton();
showView("matches");

AUTH.init()
  .then(() => {
    syncFromAccount();
    favorites = loadFavorites();
    refreshAccountButton();
    if (currentView === "account") renderAccount();
  })
  .catch(() => {});

bootstrapLive();
setInterval(() => {
  if (document.visibilityState === "visible") bootstrapLive();
}, 90_000);

if (!els.askLog.children.length) {
  appendAsk(
    "ai",
    "Ask me anything football. Connect ChatGPT in Account for the smartest answers — I’ll still use live scores and the transfer board either way.",
    "Derby AI"
  );
}
