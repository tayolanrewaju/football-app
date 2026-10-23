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

function crest(nameOrTeam, sizeClass = "") {
  if (!nameOrTeam) return logoMarkup(null, "?", "#333", sizeClass);
  if (typeof nameOrTeam === "object") {
    return logoMarkup(nameOrTeam.logo, nameOrTeam.short || nameOrTeam.name, nameOrTeam.color, sizeClass);
  }
  const team = live.teams.find((t) => t.name === nameOrTeam);
  const matchLogo =
    live.matches.find((m) => m.home === nameOrTeam)?.homeLogo ||
    live.matches.find((m) => m.away === nameOrTeam)?.awayLogo;
  return logoMarkup(team?.logo || matchLogo, team?.short || nameOrTeam, team?.color || "#333", sizeClass);
}

function leagueLogo(league, sizeClass = "") {
  if (!league) return "";
  return logoMarkup(league.logo, league.flag || league.name, "#111", sizeClass);
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
  const deepTeams = currentView === "teams" && (teamsLeagueId || selectedTeam);
  els.navBack.hidden = !deepTeams;
  if (currentView === "teams" && selectedTeam) {
    els.navTitle.textContent = selectedTeam.name;
  } else if (currentView === "teams" && teamsLeagueId) {
    els.navTitle.textContent = live.leagues.find((l) => l.id === teamsLeagueId)?.name || "Teams";
  } else {
    els.navTitle.textContent = TITLES[currentView] || "NINETY";
  }
}

function refreshAccountButton() {
  const user = AUTH.currentUser();
  if (user) {
    els.accountAvatar.classList.add("is-user");
    els.accountAvatar.textContent = (user.name || "U").trim().charAt(0).toUpperCase();
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
  els.matchesList.innerHTML = `<div class="loading">Loading live scores…</div>`;
  try {
    const data = await API.loadAll();
    live.leagues = data.leagues;
    live.teams = data.teams;
    live.matches = data.matches;
    live.ready = true;
    live.error = null;
  } catch (err) {
    live.error = String(err?.message || err);
    live.ready = false;
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
    group.className = "group";
    matches.forEach((match) => {
      const row = document.createElement("article");
      row.className = `match-row${match.status === "Live" ? " is-live" : ""}`;
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
          <div class="club-line">${logoMarkup(match.homeLogo, match.home)}<span>${escapeHtml(match.home)}</span></div>
          <div class="club-line">${logoMarkup(match.awayLogo, match.away)}<span>${escapeHtml(match.away)}</span></div>
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
    teamSearchQuery = "";
    teamSearchResults = [];
    if (els.teamSearchInput) els.teamSearchInput.value = "";
    renderTeams();
  });
  return btn;
}

function renderTeams() {
  updateNav();

  if (selectedTeam) {
    renderTeamDetail(selectedTeam);
    return;
  }

  const frag = document.createDocumentFragment();

  if (teamSearchLoading) {
    frag.appendChild(Object.assign(document.createElement("div"), { className: "loading", textContent: "Searching world clubs…" }));
    els.teamsList.replaceChildren(frag);
    return;
  }

  if (teamSearchQuery && teamSearchResults.length) {
    const title = document.createElement("p");
    title.className = "group-title";
    title.textContent = `World results for “${teamSearchQuery}”`;
    const group = document.createElement("div");
    group.className = "group";
    teamSearchResults.forEach((team) => group.appendChild(teamRowButton(team, team.label || team.slug)));
    frag.append(title, group);
    els.teamsList.replaceChildren(frag);
    return;
  }

  if (teamSearchQuery && !teamSearchResults.length) {
    frag.appendChild(
      Object.assign(document.createElement("div"), {
        className: "group",
        innerHTML: `<div class="empty">No clubs found for “${escapeHtml(teamSearchQuery)}”.</div>`,
      })
    );
    els.teamsList.replaceChildren(frag);
    return;
  }

  if (!live.ready && !live.teams.length) {
    els.teamsList.innerHTML = `<div class="loading">Loading clubs…</div>`;
    return;
  }

  if (teamsLeagueId) {
    const league = live.leagues.find((l) => l.id === teamsLeagueId);
    const teams = live.teams
      .filter((t) => t.league === teamsLeagueId)
      .sort((a, b) => a.name.localeCompare(b.name));
    const title = document.createElement("p");
    title.className = "group-title league-heading";
    title.innerHTML = `${leagueLogo(league, "crest-xs")}<span>${escapeHtml(league?.name || "Clubs")} · ${teams.length}</span>`;
    const group = document.createElement("div");
    group.className = "group";
    if (!teams.length) {
      group.innerHTML = `<div class="empty">No clubs loaded for this league yet. Pull refresh from Matches.</div>`;
    } else {
      teams.forEach((team) => group.appendChild(teamRowButton(team, team.short)));
    }
    frag.append(title, group);
    els.teamsList.replaceChildren(frag);
    return;
  }

  const title = document.createElement("p");
  title.className = "group-title";
  title.textContent = "Top flight Europe";
  const group = document.createElement("div");
  group.className = "group";
  live.leagues
    .filter((l) => l.id !== "ucl")
    .forEach((league) => {
      const count = live.teams.filter((t) => t.league === league.id).length;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "team-row";
      btn.innerHTML = `
        ${leagueLogo(league)}
        <div>
          <div class="team-name">${escapeHtml(league.name)}</div>
          <div class="team-meta">${count} clubs · ${escapeHtml(league.country)}</div>
        </div>
        <span class="chev">›</span>
      `;
      btn.addEventListener("click", () => {
        teamsLeagueId = league.id;
        selectedTeam = null;
        renderTeams();
      });
      group.appendChild(btn);
    });
  frag.append(title, group);
  els.teamsList.replaceChildren(frag);
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

    const header = document.createElement("div");
    header.className = "group";
    header.innerHTML = `
      <div class="fav-row">
        ${crest({ ...team, logo: detail.logo || team.logo }, "crest-lg")}
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
      roster.players.slice(0, 25).forEach((p, i) => {
        const row = document.createElement("div");
        row.className = "setting-row";
        row.innerHTML = `<strong>${p.number ? `#${escapeHtml(p.number)} ` : ""}${escapeHtml(p.name)}</strong><span>${escapeHtml(p.position || "")}</span>`;
        if (i === 0) row.style.borderTop = "0";
        g.appendChild(row);
      });
      blocks.push(t, g);
    }

    els.teamsList.replaceChildren(...blocks);
  } catch (err) {
    els.teamsList.innerHTML = `<div class="group"><div class="empty">Couldn’t load club details.<br>${escapeHtml(err.message || err)}</div></div>`;
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
        <div class="intel-row"><p class="intel-note">Open the club page for live form and squad.</p></div>
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
      <label><strong>Transfer pings</strong><span>2026 window deals</span></label>
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
    if (alertSettings.enabled) new Notification("NINETY", { body: "Alerts ready." });
    renderFavourites();
  });

  frag.append(alertTitle, alertGroup, enable);
  els.favouritesList.replaceChildren(frag);
}

function renderAccount() {
  const user = AUTH.currentUser();
  const wrap = document.createDocumentFragment();

  if (user) {
    const title = document.createElement("p");
    title.className = "group-title";
    title.textContent = "Signed in";
    const card = document.createElement("div");
    card.className = "group auth-card";
    card.innerHTML = `
      <p class="intel-title">${escapeHtml(user.name)}</p>
      <p class="intel-note">${escapeHtml(user.email || user.username || user.phone || "")}</p>
      <p class="intel-note">Via ${escapeHtml(user.provider)} · ${favorites.length} favourites saved</p>
    `;
    const save = document.createElement("button");
    save.type = "button";
    save.className = "primary-action";
    save.textContent = "Save favourites to account";
    save.addEventListener("click", () => {
      AUTH.updateFavorites(favorites);
      renderAccount();
    });
    const out = document.createElement("button");
    out.type = "button";
    out.className = "primary-action secondary";
    out.textContent = "Sign out";
    out.addEventListener("click", () => {
      AUTH.logout();
      refreshAccountButton();
      renderAccount();
    });
    wrap.append(title, card, save, out);
    els.accountList.replaceChildren(wrap);
    return;
  }

  const title = document.createElement("p");
  title.className = "group-title";
  title.textContent = "Account";
  const social = document.createElement("div");
  social.className = "group auth-card";
  social.innerHTML = `<p class="intel-note">Sign in to sync favourites on this device.</p>`;
  const apple = document.createElement("button");
  apple.type = "button";
  apple.className = "auth-btn apple";
  apple.textContent = "Continue with Apple";
  apple.addEventListener("click", () => {
    AUTH.socialLogin("apple");
    syncFromAccount();
    AUTH.updateFavorites(favorites);
    refreshAccountButton();
    renderAccount();
  });
  const google = document.createElement("button");
  google.type = "button";
  google.className = "auth-btn google";
  google.textContent = "Continue with Google";
  google.addEventListener("click", () => {
    AUTH.socialLogin("google");
    syncFromAccount();
    AUTH.updateFavorites(favorites);
    refreshAccountButton();
    renderAccount();
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
      errorEl.hidden = true;
      paintForm();
    });
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    try {
      if (accountMode === "signin") {
        AUTH.login({
          identity: String(data.get("identity") || ""),
          password: String(data.get("password") || ""),
        });
        syncFromAccount();
      } else {
        AUTH.register({
          name: String(data.get("name") || ""),
          email: String(data.get("email") || ""),
          username: String(data.get("username") || ""),
          phone: String(data.get("phone") || ""),
          password: String(data.get("password") || ""),
        });
      }
      AUTH.updateFavorites(favorites);
      refreshAccountButton();
      renderAccount();
    } catch (err) {
      errorEl.hidden = false;
      errorEl.textContent = err.message || "Something went wrong.";
    }
  });

  paintForm();
  wrap.append(title, social, formCard);
  els.accountList.replaceChildren(wrap);
}

function appendAsk(role, text, source) {
  const bubble = document.createElement("div");
  bubble.className = `ask-bubble ${role}`;
  const body = escapeHtml(text).replaceAll("\n", "<br>");
  bubble.innerHTML =
    role === "ai"
      ? `<p>${body}</p><span class="ask-source">${escapeHtml(source || "NINETY AI")}</span>`
      : `<p>${body}</p>`;
  els.askLog.appendChild(bubble);
  els.askLog.scrollTop = els.askLog.scrollHeight;
}

async function ask(question) {
  const q = String(question || "").trim();
  if (!q) return;
  appendAsk("user", q);
  appendAsk("ai", "Checking live scores, world clubs, squads, and the 2027 board…", "NINETY AI");
  try {
    const result = await AI.research(q, {
      favorites,
      matches: live.matches,
      teams: live.teams,
      transfers: TRANSFERS,
    });
    // Replace the thinking bubble with the real answer
    const bubbles = els.askLog.querySelectorAll(".ask-bubble.ai");
    const last = bubbles[bubbles.length - 1];
    if (last) {
      last.innerHTML = `<p>${escapeHtml(result.text).replaceAll("\n", "<br>")}</p><span class="ask-source">${escapeHtml(result.source || "NINETY AI")}</span>`;
    } else {
      appendAsk("ai", result.text, result.source);
    }
  } catch (err) {
    appendAsk("ai", `I hit a snag while researching that: ${err.message || err}`, "NINETY AI");
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
    }
    showView(tab.dataset.view);
  });
});

els.navBack.addEventListener("click", () => {
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

renderDate();
syncFromAccount();
refreshAccountButton();
showView("matches");
bootstrapLive();
setInterval(() => {
  if (document.visibilityState === "visible") bootstrapLive();
}, 90_000);

if (!els.askLog.children.length) {
  appendAsk(
    "ai",
    "Ask me anything football — I’ll search live scores, world clubs, squads, and the 2027 transfer board together.",
    "NINETY AI"
  );
}
