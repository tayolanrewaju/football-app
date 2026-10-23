const KEYS = {
  favorites: "ninety-favorites-v2",
  alerts: "ninety-alerts-v1",
};

const TITLES = {
  matches: "Matches",
  transfers: "Transfers",
  ask: "Ask AI",
  teams: "Teams",
  favourites: "Favourites",
};

const DATA = window.NINETY_DATA;
const AI = window.NINETY_AI;

let matchLeague = "all";
let currentView = "matches";
let teamsLeagueId = null;
let selectedTeamId = null;

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

let favorites = loadJson(KEYS.favorites, ["Arsenal", "Liverpool", "Real Madrid"]);
if (!Array.isArray(favorites)) favorites = ["Arsenal", "Liverpool", "Real Madrid"];

let alertSettings = loadJson(KEYS.alerts, {
  enabled: false,
  matchReminders: true,
  transferAlerts: true,
});

const els = {
  matchLeagues: document.querySelector("#match-leagues"),
  matchesList: document.querySelector("#matches-list"),
  transfersList: document.querySelector("#transfers-list"),
  teamsList: document.querySelector("#teams-list"),
  favouritesList: document.querySelector("#favourites-list"),
  askForm: document.querySelector("#ask-form"),
  askLog: document.querySelector("#ask-log"),
  askInput: document.querySelector("#ask-input"),
  navTitle: document.querySelector("#nav-title"),
  navDate: document.querySelector("#nav-date"),
  navBack: document.querySelector("#nav-back"),
};

function persist() {
  saveJson(KEYS.favorites, favorites);
  saveJson(KEYS.alerts, alertSettings);
}

function crest(teamName, sizeClass = "") {
  const team = DATA.teamByName[teamName] || DATA.teams.find((t) => t.name === teamName);
  const logo = DATA.logoFor(teamName) || team?.logo;
  const color = team?.color || "#8e8e93";
  const initials = (team?.short || teamName)
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
  const cls = `crest${sizeClass ? ` ${sizeClass}` : ""}`;
  if (logo) {
    return `<span class="${cls} crest-img" style="--crest-fallback:${color}"><img src="${escapeHtml(logo)}" alt="" loading="lazy" decoding="async" onerror="this.parentElement.classList.add('is-fallback');this.remove();" /><span class="crest-fallback">${escapeHtml(initials.slice(0, 3))}</span></span>`;
  }
  return `<span class="${cls}" style="background:${color}">${escapeHtml(initials.slice(0, 3))}</span>`;
}

function leagueLogo(league, sizeClass = "") {
  if (!league) return "";
  const cls = `crest crest-league${sizeClass ? ` ${sizeClass}` : ""}`;
  if (league.logo) {
    return `<span class="${cls} crest-img"><img src="${escapeHtml(league.logo)}" alt="" loading="lazy" decoding="async" onerror="this.parentElement.classList.add('is-fallback');this.remove();" /><span class="crest-fallback">${escapeHtml(league.flag || "?")}</span></span>`;
  }
  return `<span class="${cls} league-crest">${escapeHtml(league.flag || "?")}</span>`;
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
  if (favorites.includes(name)) favorites = favorites.filter((t) => t !== name);
  else favorites = [...favorites, name];
  persist();
  render();
}

function showView(name) {
  currentView = name;
  if (name !== "teams") {
    teamsLeagueId = null;
    selectedTeamId = null;
  }
  document.querySelectorAll(".tab-bar .tab").forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.view === name);
  });
  document.querySelectorAll(".screen").forEach((screen) => {
    const on = screen.id === name;
    if (on && !screen.classList.contains("is-active")) {
      screen.classList.add("is-entering");
      requestAnimationFrame(() => {
        screen.classList.remove("is-entering");
      });
    }
    screen.classList.toggle("is-active", on);
  });
  updateNav();
  render();
}

function updateNav() {
  els.navBack.hidden = !(currentView === "teams" && (teamsLeagueId || selectedTeamId));
  if (currentView === "teams" && selectedTeamId) {
    const team = DATA.teams.find((t) => t.id === selectedTeamId);
    els.navTitle.textContent = team?.name || "Team";
  } else if (currentView === "teams" && teamsLeagueId) {
    els.navTitle.textContent = DATA.leagueById[teamsLeagueId]?.name || "Teams";
  } else {
    els.navTitle.textContent = TITLES[currentView] || "NINETY";
  }
}

function renderMatchLeagueSeg() {
  const items = [
    { id: "all", name: "All", logoHtml: "" },
    { id: "live", name: "Live", logoHtml: `<span class="live-dot"></span>` },
    { id: "fav", name: "Following", logoHtml: "" },
    ...DATA.leagues.map((l) => ({ ...l, logoHtml: leagueLogo(l, "crest-xs") })),
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
  let list = [...DATA.matches];
  if (matchLeague === "live") list = list.filter((m) => m.status === "Live");
  else if (matchLeague === "fav") {
    list = list.filter((m) => isFavName(m.home) || isFavName(m.away));
  } else if (matchLeague !== "all") {
    list = list.filter((m) => m.league === matchLeague);
  }

  list.sort((a, b) => {
    const rank = (s) => (s === "Live" ? 0 : s === "Upcoming" ? 1 : 2);
    return rank(a.status) - rank(b.status);
  });

  if (!list.length) {
    els.matchesList.innerHTML = `<div class="group"><div class="empty">No matches in this filter.</div></div>`;
    return;
  }

  const byLeague = new Map();
  for (const match of list) {
    if (!byLeague.has(match.league)) byLeague.set(match.league, []);
    byLeague.get(match.league).push(match);
  }

  const frag = document.createDocumentFragment();
  for (const [leagueId, matches] of byLeague) {
    const league = DATA.leagueById[leagueId];
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
        match.status === "Live" ? `${match.minute}'` : match.status === "Upcoming" ? match.kickoff : "FT";
      row.innerHTML = `
        <div class="match-meta">
          <span class="status ${statusClass(match.status)}">${match.status === "Live" ? `<span class="live-dot"></span>${escapeHtml(clock)}` : escapeHtml(match.status === "Upcoming" ? clock : "FT")}</span>
          <span>${isFavName(match.home) || isFavName(match.away) ? "★ Following" : ""}</span>
        </div>
        <div class="match-teams">
          <div class="club-line">${crest(match.home)}<span>${escapeHtml(match.home)}</span></div>
          <div class="club-line">${crest(match.away)}<span>${escapeHtml(match.away)}</span></div>
        </div>
        <div class="score-stack">
          <span>${scoreHome}</span>
          <span>${scoreAway}</span>
        </div>
      `;
      group.appendChild(row);
    });
    frag.append(title, group);
  }
  els.matchesList.replaceChildren(frag);
}

function transferStatusClass(status) {
  const s = String(status || "").toLowerCase();
  if (s.includes("hot")) return "hot";
  if (s.includes("completed")) return "warm";
  return "cold";
}

function renderTransfers() {
  const list = [...DATA.transfers];
  const done = list.filter((t) => t.status === "Completed");
  const hot = list.filter((t) => t.status !== "Completed");

  const frag = document.createDocumentFragment();

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

  makeGroup("This season — completed", done);
  makeGroup("Still cooking", hot);
  els.transfersList.replaceChildren(frag);
}

function renderTeams() {
  updateNav();

  if (selectedTeamId) {
    renderTeamDetail(selectedTeamId);
    return;
  }

  if (teamsLeagueId) {
    const league = DATA.leagueById[teamsLeagueId];
    const teams = DATA.teams.filter((t) => t.league === teamsLeagueId);
    const title = document.createElement("p");
    title.className = "group-title league-heading";
    title.innerHTML = `${leagueLogo(league, "crest-xs")}<span>${escapeHtml(league?.name || "Clubs")}</span>`;
    const group = document.createElement("div");
    group.className = "group";
    teams.forEach((team) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "team-row";
      btn.innerHTML = `
        ${crest(team.name)}
        <div>
          <div class="team-name">${escapeHtml(team.name)}${isFavName(team.name) ? " ★" : ""}</div>
          <div class="team-meta">${escapeHtml(team.stadium)}</div>
        </div>
        <span class="chev">›</span>
      `;
      btn.addEventListener("click", () => {
        selectedTeamId = team.id;
        renderTeams();
      });
      group.appendChild(btn);
    });
    if (!teams.length) {
      group.innerHTML = `<div class="empty">Club pages for Champions League live under each domestic league.</div>`;
    }
    els.teamsList.replaceChildren(title, group);
    return;
  }

  const title = document.createElement("p");
  title.className = "group-title";
  title.textContent = "Top flight Europe";
  const group = document.createElement("div");
  group.className = "group";
  DATA.leagues
    .filter((l) => l.id !== "ucl")
    .forEach((league) => {
      const count = DATA.teams.filter((t) => t.league === league.id).length;
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
        selectedTeamId = null;
        renderTeams();
      });
      group.appendChild(btn);
    });
  els.teamsList.replaceChildren(title, group);
}

function renderTeamDetail(teamId) {
  const team = DATA.teams.find((t) => t.id === teamId);
  if (!team) return;
  updateNav();

  const header = document.createElement("div");
  header.className = "group";
  header.innerHTML = `
    <div class="fav-row">
      ${crest(team.name)}
      <div>
        <div class="team-name">${escapeHtml(team.name)}</div>
        <div class="team-meta">${escapeHtml(DATA.leagueById[team.league]?.name || "")} · Est. ${team.founded}</div>
      </div>
      <button type="button" class="star-btn ${isFavName(team.name) ? "" : "is-off"}" data-star>${isFavName(team.name) ? "★" : "☆"}</button>
    </div>
    <div class="intel-row">
      <div>
        <p class="intel-note"><strong>Manager</strong> · ${escapeHtml(team.manager)}</p>
        <p class="intel-note"><strong>Stadium</strong> · ${escapeHtml(team.stadium)}</p>
        <p class="intel-note">${escapeHtml(team.about)}</p>
      </div>
    </div>
  `;
  header.querySelector("[data-star]").addEventListener("click", () => toggleFavorite(team.name));

  const formTitle = document.createElement("p");
  formTitle.className = "group-title";
  formTitle.textContent = "Form";
  const formGroup = document.createElement("div");
  formGroup.className = "group";
  formGroup.innerHTML = `
    <div class="form-row">${(team.form || [])
      .map((r) => `<span class="form-pill ${r.toLowerCase()}">${escapeHtml(r)}</span>`)
      .join("")}</div>
  `;

  const lastTitle = document.createElement("p");
  lastTitle.className = "group-title";
  lastTitle.textContent = "Last five";
  const lastGroup = document.createElement("div");
  lastGroup.className = "group";
  (team.lastFive || []).forEach((g) => {
    const row = document.createElement("div");
    row.className = "intel-row";
    row.innerHTML = `
      <div>
        <p class="intel-title">${g.home ? "vs" : "@"} ${escapeHtml(g.opp)}</p>
        <p class="intel-sub">${escapeHtml(g.score)}</p>
      </div>
      <span class="form-pill ${g.result.toLowerCase()}">${escapeHtml(g.result)}</span>
    `;
    lastGroup.appendChild(row);
  });

  const xiTitle = document.createElement("p");
  xiTitle.className = "group-title";
  xiTitle.textContent = `Lineup · ${team.lineup?.formation || ""}`;
  const xiGroup = document.createElement("div");
  xiGroup.className = "group";
  (team.lineup?.xi || []).forEach((player, i) => {
    const row = document.createElement("div");
    row.className = "setting-row";
    row.innerHTML = `<strong>${i + 1}. ${escapeHtml(player)}</strong>`;
    xiGroup.appendChild(row);
  });
  if (team.lineup?.bench?.length) {
    const bench = document.createElement("div");
    bench.className = "intel-row";
    bench.innerHTML = `<p class="intel-note"><strong>Bench</strong> · ${escapeHtml(team.lineup.bench.join(", "))}</p>`;
    xiGroup.appendChild(bench);
  }

  els.teamsList.replaceChildren(header, formTitle, formGroup, lastTitle, lastGroup, xiTitle, xiGroup);
}

function renderFavourites() {
  const title = document.createElement("p");
  title.className = "group-title";
  title.textContent = "Your clubs";

  if (!favorites.length) {
    els.favouritesList.innerHTML = `<div class="group"><div class="empty">Star teams from the Teams tab to track form here.</div></div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  frag.appendChild(title);

  favorites.forEach((name) => {
    const team = DATA.teamByName[name] || DATA.teams.find((t) => t.name === name);
    const group = document.createElement("div");
    group.className = "group fav-card";

    if (!team) {
      group.innerHTML = `
        <div class="fav-row">
          ${crest(name)}
          <div class="team-name">${escapeHtml(name)}</div>
          <button type="button" class="star-btn" data-unfav>★</button>
        </div>`;
      group.querySelector("[data-unfav]").addEventListener("click", () => toggleFavorite(name));
      frag.appendChild(group);
      return;
    }

    group.innerHTML = `
      <div class="fav-row">
        ${crest(team.name)}
        <div>
          <div class="team-name">${escapeHtml(team.name)}</div>
          <div class="team-meta">${escapeHtml(DATA.leagueById[team.league]?.name || "")}</div>
        </div>
        <button type="button" class="star-btn" data-unfav>★</button>
      </div>
      <div class="form-row pad">${(team.form || [])
        .map((r) => `<span class="form-pill ${r.toLowerCase()}">${escapeHtml(r)}</span>`)
        .join("")}</div>
    `;
    group.querySelector("[data-unfav]").addEventListener("click", () => toggleFavorite(team.name));

    (team.lastFive || []).forEach((g) => {
      const row = document.createElement("div");
      row.className = "intel-row";
      row.innerHTML = `
        <div>
          <p class="intel-title">${g.home ? "vs" : "@"} ${escapeHtml(g.opp)}</p>
          <p class="intel-sub">${escapeHtml(g.score)}</p>
        </div>
        <span class="form-pill ${g.result.toLowerCase()}">${escapeHtml(g.result)}</span>
      `;
      group.appendChild(row);
    });

    const open = document.createElement("button");
    open.type = "button";
    open.className = "mini-btn block-btn";
    open.textContent = "Open club page";
    open.addEventListener("click", () => {
      showView("teams");
      teamsLeagueId = team.league;
      selectedTeamId = team.id;
      renderTeams();
    });
    group.appendChild(open);
    frag.appendChild(group);
  });

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
      <label><strong>Transfer pings</strong><span>Big Europe moves</span></label>
      <label class="switch"><input type="checkbox" id="alert-transfers" ${alertSettings.transferAlerts ? "checked" : ""} /><span></span></label>
    </div>
  `;
  const enable = document.createElement("button");
  enable.type = "button";
  enable.className = "primary-action";
  enable.textContent = alertSettings.enabled ? "Notifications on" : "Turn on notifications";
  enable.addEventListener("click", async () => {
    if (!("Notification" in window)) return;
    const permission = await Notification.requestPermission();
    alertSettings.enabled = permission === "granted";
    persist();
    if (alertSettings.enabled) new Notification("NINETY", { body: "Alerts ready for your favourites." });
    renderFavourites();
  });
  alertGroup.querySelector("#alert-matches").addEventListener("change", (e) => {
    alertSettings.matchReminders = e.target.checked;
    persist();
  });
  alertGroup.querySelector("#alert-transfers").addEventListener("change", (e) => {
    alertSettings.transferAlerts = e.target.checked;
    persist();
  });

  frag.append(alertTitle, alertGroup, enable);
  els.favouritesList.replaceChildren(frag);
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

function ask(question) {
  const q = String(question || "").trim();
  if (!q) return;
  appendAsk("user", q);
  const result = AI.answerQuestion(q, { favorites });
  appendAsk("ai", result.text, result.source);
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
}

document.querySelectorAll(".tab-bar .tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    if (tab.dataset.view === "teams") {
      teamsLeagueId = null;
      selectedTeamId = null;
    }
    showView(tab.dataset.view);
  });
});

els.navBack.addEventListener("click", () => {
  if (selectedTeamId) {
    selectedTeamId = null;
    renderTeams();
    return;
  }
  if (teamsLeagueId) {
    teamsLeagueId = null;
    renderTeams();
  }
});

els.askForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const q = els.askInput.value;
  els.askInput.value = "";
  ask(q);
});

document.querySelectorAll("#ask-chips .chip").forEach((chip) => {
  chip.addEventListener("click", () => ask(chip.dataset.q));
});

renderDate();
showView("matches");

if (!els.askLog.children.length) {
  appendAsk(
    "ai",
    "Ask me anything football — live scores, Europe transfers, lineups, or your favourites' form.",
    "NINETY AI"
  );
}
