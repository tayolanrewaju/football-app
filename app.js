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
const FANTASY = window.NINETY_FANTASY;
const ALERTS = window.NINETY_ALERTS;
const TRANSFERS = window.NINETY_DATA.transfers;

let matchLeague = "all";
let currentView = "matches";
let teamsLeagueId = null;
let selectedTeam = null;
let selectedPlayer = null;
let selectedMatch = null;
let selectedTransfer = null;
let teamsRegion = "Europe";
let favMode = localStorage.getItem("ninety-fav-mode") || "following";
let fantasySquad = loadJson("ninety-fantasy-v1", []);
try {
  const fantasySaved = JSON.parse(localStorage.getItem("ninety-fantasy-v2") || "null");
  if (fantasySaved?.theme) document.documentElement.dataset.theme = fantasySaved.theme;
} catch {
  /* Theme stays on the dark pitch until settings load. */
}
const pendingLeague = new URLSearchParams(location.search).get("league");
if (pendingLeague) sessionStorage.setItem("ninety-league-invite", pendingLeague.toUpperCase());
let fantasyPlayerId = null;
let fantasyQuery = "";
let fantasyHits = [];
let fantasySearching = false;
let fantasyPoints = null;
let fantasyPointsKey = "";
let fantasyLoading = false;
let accountMode = "signin";
let signupStep = 0;
let signupDraft = { country: "", club: null, players: [], name: "", email: "", password: "", code: "" };
let signupClubHits = [];
let signupPlayerHits = [];
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
  eventAlerts: true,
  transferAlerts: true,
});
let alertSeen = new Set(loadJson("ninety-alert-seen-v1", []));
let alertLog = loadJson("ninety-alert-log-v1", []);
let alertPrimed = localStorage.getItem("ninety-alert-primed") === "1";
let alertWatching = false;

let teamSearchQuery = "";
let teamSearchClubs = [];
let teamSearchPlayers = [];
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
  if (!user) return;
  if (Array.isArray(user.favorites)) {
    favorites = [...user.favorites];
    saveJson(KEYS.favorites, favorites);
  }
  const remote = user.fantasy;
  if (remote && Array.isArray(remote.squad) && window.NINETY_FANTASY_GAME) {
    const local = NINETY_FANTASY_GAME.load();
    const remoteNewer = Number(remote.savedAt || 0) >= Number(local.savedAt || 0);
    if (remote.squad.length && (remoteNewer || !local.squad.length)) {
      localStorage.setItem("ninety-fantasy-v2", JSON.stringify({ ...local, ...remote }));
    }
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
  const deepMatch = currentView === "matches" && selectedMatch;
  const deepTransfer = currentView === "transfers" && selectedTransfer;
  const fantasyDeep = currentView === "favourites" && favMode === "fantasy" && window.NINETY_FANTASY_UI && NINETY_FANTASY_UI.screen() !== "home";
  const deepFantasy = fantasyDeep || (currentView === "favourites" && favMode === "fantasy" && fantasyPlayerId);
  els.navBack.hidden = !(deepTeams || deepMatch || deepFantasy || deepTransfer);
  if (fantasyDeep) {
    els.navTitle.textContent = NINETY_FANTASY_UI.title();
  } else if (currentView === "favourites" && favMode === "fantasy" && fantasyPlayerId) {
    els.navTitle.textContent = fantasySquad.find((player) => player.id === fantasyPlayerId)?.name || "Player";
  } else if (currentView === "favourites" && favMode === "fantasy") {
    els.navTitle.textContent = "Fantasy";
  } else if (deepTransfer) {
    els.navTitle.textContent = selectedTransfer.player || "Transfer";
  } else if (deepMatch) {
    els.navTitle.textContent = "Match";
  } else if (currentView === "teams" && selectedPlayer) {
    els.navTitle.textContent = selectedPlayer.name || "Player";
  } else if (currentView === "teams" && selectedTeam) {
    els.navTitle.textContent = selectedTeam.name;
  } else if (currentView === "teams" && teamsLeagueId) {
    els.navTitle.textContent = API.COMPETITIONS?.find((item) => item.id === teamsLeagueId)?.name || live.leagues.find((l) => l.id === teamsLeagueId)?.name || "Teams";
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

function rememberAlerts(keys) {
  let changed = false;
  for (const key of keys) {
    if (alertSeen.has(key)) continue;
    alertSeen.add(key);
    changed = true;
  }
  if (!changed) return;
  const list = [...alertSeen].slice(-500);
  alertSeen = new Set(list);
  saveJson("ninety-alert-seen-v1", list);
}

function deliverAlert(note) {
  alertLog = [{ title: note.title, body: note.body, at: Date.now() }, ...alertLog].slice(0, 20);
  saveJson("ninety-alert-log-v1", alertLog);
  const toast = document.querySelector("#alert-toast");
  if (toast) {
    toast.hidden = false;
    toast.innerHTML = `<strong>${escapeHtml(note.title)}</strong><span>${escapeHtml(note.body)}</span>`;
    clearTimeout(deliverAlert.timer);
    deliverAlert.timer = setTimeout(() => {
      toast.hidden = true;
    }, 6000);
  }
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    try {
      new Notification(note.title, { body: note.body, icon: "apple-touch-icon.png", tag: note.key || note.title });
    } catch {
      /* The browser can block a notification without failing the rest of the alert. */
    }
  }
}

async function watchFavouriteAlerts() {
  if (alertWatching) return;
  if (!alertSettings.enabled || !favorites.length || !live.matches.length) return;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  alertWatching = true;
  try {
    const now = Date.now();
    const interesting = live.matches
      .filter((match) => {
        if (!ALERTS.involvesFavourite(match, favorites)) return false;
        const start = new Date(match.start).getTime();
        const soon = match.status === "Upcoming" && start - now < 20 * 60 * 1000 && now - start < 3 * 60 * 60 * 1000;
        const recentFinal = match.status === "FT" && Number.isFinite(start) && now - start < 4 * 60 * 60 * 1000 && now > start;
        return match.status === "Live" || soon || recentFinal;
      })
      .slice(0, 8);
    const eventsByMatch = {};
    await Promise.all(
      interesting
        .filter((match) => match.status !== "Upcoming" || new Date(match.start).getTime() <= now)
        .map(async (match) => {
          try {
            const detail = await API.loadMatchDetail(match.league, match.id);
            eventsByMatch[match.id] = detail.events || [];
          } catch {
            eventsByMatch[match.id] = [];
          }
        })
    );
    const settings = { ...alertSettings, eventAlerts: alertSettings.eventAlerts !== false };
    if (!alertPrimed) {
      const quiet = ALERTS.planAlerts({
        matches: live.matches,
        favorites,
        now,
        seen: alertSeen,
        settings,
        eventsByMatch,
        prime: true,
      });
      rememberAlerts(quiet.mark);
      alertPrimed = true;
      localStorage.setItem("ninety-alert-primed", "1");
    }
    const plan = ALERTS.planAlerts({
      matches: live.matches,
      favorites,
      now,
      seen: alertSeen,
      settings,
      eventsByMatch,
      prime: false,
    });
    rememberAlerts(plan.mark);
    plan.notify.forEach(deliverAlert);
  } finally {
    alertWatching = false;
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

    const data = await API.loadAll({ past: 7, future: 7 });
    live.leagues = data.leagues;
    live.teams = data.teams;
    live.matches = data.matches;
    live.ready = true;
    live.error = null;
    watchFavouriteAlerts();
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

function londonDayKey(iso) {
  if (!iso) return "undated";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function dayHeading(iso) {
  const key = londonDayKey(iso);
  const today = londonDayKey(new Date().toISOString());
  const yesterday = londonDayKey(new Date(Date.now() - 86400000).toISOString());
  const tomorrow = londonDayKey(new Date(Date.now() + 86400000).toISOString());
  const label = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/London",
  }).format(new Date(iso));
  if (key === today) return `Today · ${label}`;
  if (key === yesterday) return `Yesterday · ${label}`;
  if (key === tomorrow) return `Tomorrow · ${label}`;
  return label;
}

function matchRow(match) {
  const row = document.createElement("article");
  row.className = `match-row${match.status === "Live" ? " is-live" : ""}`;
  row.style.setProperty("--home-tint", match.homeColor || "#0a84ff");
  row.style.setProperty("--away-tint", match.awayColor || "#30d158");
  const scoreHome = match.status === "Upcoming" ? "–" : match.homeScore;
  const scoreAway = match.status === "Upcoming" ? "–" : match.awayScore;
  const clock =
    match.status === "Live" ? match.minute || "Live" : match.status === "Upcoming" ? match.kickoff || "Scheduled" : "FT";
  const league = live.leagues.find((l) => l.id === match.league);
  row.innerHTML = `
    <div class="match-meta">
      <span class="status ${statusClass(match.status)}">${
        match.status === "Live"
          ? `<span class="live-dot"></span>${escapeHtml(clock)}`
          : escapeHtml(match.status === "Upcoming" ? clock : "FT")
      }</span>
      <span>${escapeHtml(league?.name || "")}${isFavName(match.home) || isFavName(match.away) ? " · ★" : ""}</span>
    </div>
    <div class="match-teams">
      <div class="club-line">${resolveMatchCrest(match, "home")}<span>${escapeHtml(match.home)}</span></div>
      <div class="club-line">${resolveMatchCrest(match, "away")}<span>${escapeHtml(match.away)}</span></div>
    </div>
    <div class="score-stack"><span>${scoreHome}</span><span>${scoreAway}</span></div>
  `;
  row.addEventListener("click", () => {
    selectedMatch = match;
    renderMatches();
  });
  return row;
}

function sideFromDetail(side, fallbackName) {
  return {
    id: side?.id,
    espnId: side?.id,
    name: side?.name || fallbackName,
    short: side?.short,
    logo: side?.logo,
    color: side?.color,
    slug: side?.slug || "eng.1",
  };
}

function openClubFromMatch(side) {
  teamsLeagueId = null;
  selectedPlayer = null;
  teamSearchQuery = "";
  selectedTeam = side;
  showView("teams");
}

async function renderMatchDetail(match) {
  els.matchesList.innerHTML = `<div class="loading">Loading ${escapeHtml(match.home)} v ${escapeHtml(match.away)}…</div>`;
  updateNav();
  try {
    const detail = await API.loadMatchDetail(match.league, match.id);
    if (selectedMatch?.id !== match.id) return;
    const home = detail.home || {};
    const away = detail.away || {};
    const score = (side) => (detail.status === "Upcoming" || side.score == null ? "–" : side.score);
    const when = detail.start
      ? new Intl.DateTimeFormat("en-GB", {
          weekday: "short",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Europe/London",
        }).format(new Date(detail.start))
      : match.kickoff || "";
    const header = document.createElement("div");
    header.className = "group match-hero";
    header.innerHTML = `
      <p class="intel-note">${escapeHtml(detail.leagueName || "")} · ${escapeHtml(detail.status === "Live" ? detail.clock : detail.status)}</p>
      <div class="match-hero-sides">
        <button type="button" class="match-side" data-side="home">
          ${crest(sideFromDetail(home, match.home), "crest-lg")}
          <span class="team-name">${escapeHtml(home.name || match.home)}</span>
          <span class="team-meta">${escapeHtml(home.record || "")}${home.points ? ` · ${escapeHtml(home.points)} pts` : ""}</span>
        </button>
        <div class="match-hero-score">
          <strong>${score(home)}</strong>
          <span>${score(away)}</span>
        </div>
        <button type="button" class="match-side" data-side="away">
          ${crest(sideFromDetail(away, match.away), "crest-lg")}
          <span class="team-name">${escapeHtml(away.name || match.away)}</span>
          <span class="team-meta">${escapeHtml(away.record || "")}${away.points ? ` · ${escapeHtml(away.points)} pts` : ""}</span>
        </button>
      </div>
      <p class="intel-note">${escapeHtml(when)}${detail.venue ? ` · ${escapeHtml(detail.venue)}` : ""}${
        detail.city ? `, ${escapeHtml(detail.city)}` : ""
      }${detail.attendance ? ` · ${Number(detail.attendance).toLocaleString("en-GB")} there` : ""}</p>
    `;
    header.querySelector('[data-side="home"]').addEventListener("click", () => openClubFromMatch(sideFromDetail(home, match.home)));
    header.querySelector('[data-side="away"]').addEventListener("click", () => openClubFromMatch(sideFromDetail(away, match.away)));

    const blocks = [header];
    if (detail.article?.headline) {
      const title = document.createElement("p");
      title.className = "group-title";
      title.textContent = "Report";
      const card = document.createElement("div");
      card.className = "group";
      card.innerHTML = `<div class="intel-row"><div><p class="intel-title">${escapeHtml(detail.article.headline)}</p><p class="intel-note">${escapeHtml(detail.article.description || "")}</p></div></div>`;
      blocks.push(title, card);
    }
    if (detail.events?.length) {
      const title = document.createElement("p");
      title.className = "group-title";
      title.textContent = "Match events";
      const card = document.createElement("div");
      card.className = "group";
      detail.events.forEach((event) => {
        const row = document.createElement("div");
        row.className = "timeline-row";
        row.innerHTML = `<span class="timeline-min">${escapeHtml(event.minute || "·")}</span><div><p class="intel-title">${escapeHtml(event.text)}</p><p class="intel-note">${escapeHtml(event.team || event.type)}</p></div>`;
        card.appendChild(row);
      });
      blocks.push(title, card);
    }
    if (detail.stats?.length) {
      const title = document.createElement("p");
      title.className = "group-title";
      title.textContent = "Team stats";
      const card = document.createElement("div");
      card.className = "group";
      card.innerHTML = detail.stats
        .map(
          (stat) => `
          <div class="compare-row">
            <span>${escapeHtml(stat.home)}</span>
            <span class="compare-label">${escapeHtml(stat.label)}</span>
            <span>${escapeHtml(stat.away)}</span>
          </div>`
        )
        .join("");
      blocks.push(title, card);
    }
    for (const [key, label, side] of [
      ["home", home.name || match.home, home],
      ["away", away.name || match.away, away],
    ]) {
      const lineup = detail.lineups?.[key];
      if (!lineup?.players?.length) continue;
      const starters = lineup.players.filter((p) => p.starter);
      const bench = lineup.players.filter((p) => !p.starter);
      const pitch = API.pitchFromLineup?.(lineup);
      if (pitch?.lines?.length) {
        const pitchTitle = document.createElement("p");
        pitchTitle.className = "group-title";
        pitchTitle.textContent = `${label}${lineup.formation ? ` · ${lineup.formation}` : ""}`;
        const pitchCard = document.createElement("div");
        pitchCard.className = "group pitch-wrap";
        pitchCard.innerHTML = formationMarkup(pitch, side.color || "#30d158");
        blocks.push(pitchTitle, pitchCard);
      }
      const title = document.createElement("p");
      title.className = "group-title";
      title.textContent = pitch?.lines?.length ? `${label} · players` : `${label}${lineup.formation ? ` · ${lineup.formation}` : ""}`;
      const card = document.createElement("div");
      card.className = "group";
      const list = document.createElement("div");
      starters.forEach((player) => {
        const row = document.createElement("div");
        row.className = "lineup-row";
        row.innerHTML = `<span class="lineup-num">${escapeHtml(player.number || "·")}</span><span>${escapeHtml(player.name)}</span><span class="team-meta">${escapeHtml(player.position || "")}</span>`;
        list.appendChild(row);
      });
      if (bench.length) {
        const note = document.createElement("p");
        note.className = "intel-note lineup-bench";
        note.textContent = `Bench · ${bench.map((p) => p.name).join(", ")}`;
        list.appendChild(note);
      }
      card.appendChild(list);
      blocks.push(title, card);
    }
    els.matchesList.replaceChildren(...blocks);
  } catch (err) {
    if (selectedMatch?.id !== match.id) return;
    els.matchesList.innerHTML = `<div class="group"><div class="empty">Couldn’t load this match.<br>${escapeHtml(err.message || err)}</div></div>`;
  }
}

function renderMatches() {
  updateNav();
  if (selectedMatch) {
    renderMatchDetail(selectedMatch);
    return;
  }
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

  list.sort((a, b) => String(a.start || "").localeCompare(String(b.start || "")));

  if (!list.length) {
    els.matchesList.innerHTML = `<div class="group"><div class="empty">No matches in this filter right now.</div></div>`;
    return;
  }

  const byDay = new Map();
  for (const match of list) {
    const key = londonDayKey(match.start);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(match);
  }

  const frag = document.createDocumentFragment();
  for (const [, matches] of byDay) {
    const title = document.createElement("p");
    title.className = "group-title";
    title.textContent = matches[0]?.start ? dayHeading(matches[0].start) : "Fixtures";
    const group = document.createElement("div");
    group.className = "group match-group";
    matches.forEach((match) => group.appendChild(matchRow(match)));
    frag.append(title, group);
  }

  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.className = "primary-action secondary";
  refresh.textContent = "Refresh live scores";
  refresh.addEventListener("click", () => bootstrapLive());
  frag.appendChild(refresh);
  els.matchesList.replaceChildren(frag);
  const today = [...els.matchesList.querySelectorAll(".group-title")].find((heading) =>
    heading.textContent.startsWith("Today")
  );
  if (today) {
    const top = today.getBoundingClientRect().top - els.matchesList.getBoundingClientRect().top + els.matchesList.scrollTop;
    els.matchesList.scrollTop = Math.max(0, top - 8);
  }
}

function transferStatusClass(status) {
  const s = String(status || "").toLowerCase();
  if (s.includes("hot")) return "hot";
  if (s.includes("completed")) return "warm";
  return "cold";
}

function renderTransfers() {
  updateNav();
  if (selectedTransfer) {
    renderTransferDetail(selectedTransfer);
    return;
  }
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
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.addEventListener("click", () => {
        selectedTransfer = t;
        renderTransfers();
      });
      group.appendChild(row);
    });
    frag.append(title, group);
  };

  makeGroup("Completed", done);
  makeGroup("Still cooking", hot);

  const overviewTitle = document.createElement("p");
  overviewTitle.className = "group-title";
  overviewTitle.textContent = "Latest transfer news";
  const overview = document.createElement("div");
  overview.className = "group";
  overview.innerHTML = `<div class="intel-row"><div><p class="intel-title">Reading the wire…</p><p class="intel-note">Pulling the newest briefs from the leagues.</p></div></div>`;
  frag.append(overviewTitle, overview);
  els.transfersList.replaceChildren(frag);
  loadTransferOverview(overview);
}

async function renderTransferDetail(transfer) {
  els.transfersList.innerHTML = `<div class="loading">Loading ${escapeHtml(transfer.player)}…</div>`;
  updateNav();
  const same = () => selectedTransfer?.id === transfer.id;
  let player = null;
  let articles = [];
  try {
    const [hits, news] = await Promise.all([
      API.searchPlayers(transfer.player).catch(() => []),
      API.loadTransferNews().catch(() => []),
    ]);
    if (!same()) return;
    const wanted = transfer.player.toLowerCase();
    player = hits.find((hit) => hit.name.toLowerCase() === wanted) || hits[0] || null;
    const needles = [transfer.player, transfer.from, transfer.to].map((item) => item.toLowerCase());
    articles = news.filter((article) => {
      const blob = `${article.headline} ${article.description}`.toLowerCase();
      return needles.some((needle) => needle && blob.includes(needle));
    });
  } catch {
    if (!same()) return;
  }
  const face = player?.headshot
    ? `<span class="player-face player-hero-face"><img src="${escapeHtml(player.headshot)}" alt="" referrerpolicy="no-referrer" /></span>`
    : "";
  const hero = document.createElement("div");
  hero.className = "group transfer-hero";
  hero.innerHTML = `
    ${face}
    <p class="intel-title">${escapeHtml(transfer.player)}</p>
    <p class="intel-note">${escapeHtml(player?.positionName || player?.position || "Player")}${player?.teamName ? ` · ${escapeHtml(player.teamName)}` : ""}</p>
    <div class="transfer-route">
      <div>${crest(transfer.from, "crest-lg")}<span>${escapeHtml(transfer.from)}</span></div>
      <span class="transfer-arrow">→</span>
      <div>${crest(transfer.to, "crest-lg")}<span>${escapeHtml(transfer.to)}</span></div>
    </div>
    <p class="intel-sub">${escapeHtml(transfer.fee)}</p>
    <p class="intel-note">${escapeHtml(transfer.window)} · <span class="pill ${transferStatusClass(transfer.status)}">${escapeHtml(transfer.status)}</span></p>
    <p class="intel-note">${escapeHtml(transfer.note)}</p>
  `;
  const blocks = [hero];
  const facts = document.createElement("div");
  facts.className = "group";
  const rows = [
    ["Player", transfer.player],
    ["From", transfer.from],
    ["To", transfer.to],
    ["Fee", transfer.fee],
    ["Window", transfer.window],
    ["Status", transfer.status],
  ];
  if (player?.teamName) rows.push(["Current club", player.teamName]);
  if (player?.positionName || player?.position) rows.push(["Position", player.positionName || player.position]);
  facts.innerHTML = rows
    .map(([label, value]) => `<div class="setting-row"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span></div>`)
    .join("");
  const factsTitle = document.createElement("p");
  factsTitle.className = "group-title";
  factsTitle.textContent = "Deal";
  blocks.push(factsTitle, facts);
  const newsTitle = document.createElement("p");
  newsTitle.className = "group-title";
  newsTitle.textContent = "News";
  const newsCard = document.createElement("div");
  newsCard.className = "group";
  if (!articles.length) {
    newsCard.innerHTML = `<div class="empty">No fresh briefs mention ${escapeHtml(transfer.player)} or these clubs yet.</div>`;
  } else {
    articles.slice(0, 6).forEach((article) => {
      const row = document.createElement("div");
      row.className = "intel-row";
      row.innerHTML = `<div><p class="intel-title">${escapeHtml(article.headline)}</p><p class="intel-note">${escapeHtml(article.description || "")}</p></div>`;
      newsCard.appendChild(row);
    });
  }
  blocks.push(newsTitle, newsCard);
  if (!same()) return;
  els.transfersList.replaceChildren(...blocks);
}

async function loadTransferOverview(host) {
  try {
    const articles = await API.loadTransferNews();
    const result = await AI.overviewNews(articles);
    const sources = articles
      .slice(0, 4)
      .map((article) => `<li>${escapeHtml(article.headline)}</li>`)
      .join("");
    host.innerHTML = `
      <div class="intel-row">
        <div>
          <p class="intel-title">Overview</p>
          <p class="intel-note overview-copy">${escapeHtml(result.text || "").replaceAll("\n", "<br>")}</p>
          ${sources ? `<ul class="overview-sources">${sources}</ul>` : ""}
          <p class="intel-note">${escapeHtml(result.source || "Derby AI")}</p>
        </div>
      </div>`;
  } catch (err) {
    host.innerHTML = `<div class="intel-row"><div><p class="intel-note">Couldn’t load transfer news. ${escapeHtml(err.message || err)}</p></div></div>`;
  }
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
    teamSearchClubs = [];
    teamSearchPlayers = [];
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
    els.teamsList.innerHTML = `<div class="loading">Searching clubs and players…</div>`;
    return;
  }

  if (teamSearchQuery && (teamSearchClubs.length || teamSearchPlayers.length)) {
    if (teamSearchClubs.length) {
      const title = document.createElement("p");
      title.className = "group-title";
      title.textContent = `Clubs · “${teamSearchQuery}”`;
      const group = document.createElement("div");
      group.className = "group";
      teamSearchClubs.forEach((team) => group.appendChild(teamRowButton(team, team.label || team.slug)));
      frag.append(title, group);
    }
    if (teamSearchPlayers.length) {
      const title = document.createElement("p");
      title.className = "group-title";
      title.textContent = `Players · “${teamSearchQuery}”`;
      const group = document.createElement("div");
      group.className = "group";
      teamSearchPlayers.forEach((player) => group.appendChild(playerSearchButton(player)));
      frag.append(title, group);
    }
    els.teamsList.replaceChildren(frag);
    return;
  }

  if (teamSearchQuery && !teamSearchClubs.length && !teamSearchPlayers.length) {
    els.teamsList.innerHTML = `<div class="group"><div class="empty">No clubs or players found for “${escapeHtml(teamSearchQuery)}”.</div></div>`;
    return;
  }

  if (teamsLeagueId) {
    renderCompetition(teamsLeagueId);
    return;
  }

  const catalog = API.COMPETITIONS || [];
  const regions = [];
  catalog.forEach((item) => {
    if (!regions.includes(item.region)) regions.push(item.region);
  });
  const picker = document.createElement("div");
  picker.className = "group comp-picker";
  const options = regions
    .map((region) => `<option value="${escapeHtml(region)}" ${region === teamsRegion ? "selected" : ""}>${escapeHtml(region)}</option>`)
    .join("");
  picker.innerHTML = `<label>Competition<select id="team-region">${options}</select></label>`;
  picker.querySelector("#team-region").addEventListener("change", (event) => {
    teamsRegion = event.target.value;
    renderTeams();
  });
  const title = document.createElement("p");
  title.className = "group-title";
  title.textContent = teamsRegion;
  const group = document.createElement("div");
  group.className = "group";
  catalog
    .filter((item) => item.region === teamsRegion)
    .forEach((item) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "team-row";
      btn.innerHTML = `
        <div>
          <div class="team-name">${escapeHtml(item.name)}</div>
          <div class="team-meta">${escapeHtml(item.kind === "cup" ? "Cup" : "League")} · ${escapeHtml(item.country)}</div>
        </div>
        <span class="chev">›</span>
      `;
      btn.addEventListener("click", () => {
        teamsLeagueId = item.id;
        renderTeams();
      });
      group.appendChild(btn);
    });
  frag.append(picker, title, group);
  els.teamsList.replaceChildren(frag);
}

async function renderCompetition(id) {
  const comp = API.COMPETITIONS?.find((item) => item.id === id);
  els.teamsList.innerHTML = `<div class="loading">Loading ${escapeHtml(comp?.name || "competition")}…</div>`;
  updateNav();
  try {
    const data = await API.loadCompetition(id);
    if (teamsLeagueId !== id || selectedTeam) return;
    const frag = document.createDocumentFragment();
    const head = document.createElement("p");
    head.className = "group-title";
    head.textContent = data.name;
    frag.appendChild(head);
    if (data.tables?.length) {
      data.tables.forEach((table) => {
        const title = document.createElement("p");
        title.className = "group-title";
        title.textContent = table.knockout ? `Knockout · ${table.name}` : table.name;
        const group = document.createElement("div");
        group.className = "group standings-lite";
        table.rows.forEach((team) => {
          const btn = teamRowButton({ ...team, league: id, slug: team.slug || data.slug }, `${team.played || "–"} played · GD ${team.gd || "–"} · ${team.points || "–"} pts`);
          const name = btn.querySelector(".team-name");
          if (name) name.insertAdjacentHTML("afterbegin", `<span class="rank-num">${escapeHtml(team.rank || "–")}</span> `);
          group.appendChild(btn);
        });
        frag.append(title, group);
      });
    }
    if (data.fixtures?.length) {
      const rounds = new Map();
      data.fixtures.forEach((fixture) => {
        const key = fixture.note || (data.kind === "cup" ? "Knockout" : "Fixtures");
        if (!rounds.has(key)) rounds.set(key, []);
        rounds.get(key).push(fixture);
      });
      rounds.forEach((fixtures, round) => {
        const title = document.createElement("p");
        title.className = "group-title";
        title.textContent = round;
        const group = document.createElement("div");
        group.className = "group";
        fixtures.forEach((fixture) => {
          const row = document.createElement("button");
          row.type = "button";
          row.className = "team-row";
          const score = fixture.status === "Upcoming" ? fixture.kickoff || "Scheduled" : `${fixture.homeScore ?? "–"}–${fixture.awayScore ?? "–"}`;
          row.innerHTML = `<div><div class="team-name">${escapeHtml(fixture.home)} v ${escapeHtml(fixture.away)}</div><div class="team-meta">${escapeHtml(score)} · ${escapeHtml(fixture.status || "")}</div></div><span class="chev">›</span>`;
          row.addEventListener("click", () => {
            selectedMatch = fixture;
            showView("matches");
          });
          group.appendChild(row);
        });
        frag.append(title, group);
      });
    }
    if (!data.tables?.length && !data.fixtures?.length) {
      const empty = document.createElement("div");
      empty.className = "group";
      empty.innerHTML = `<div class="empty">No table or fixtures are published for this competition yet.</div>`;
      frag.appendChild(empty);
    }
    els.teamsList.replaceChildren(frag);
  } catch (err) {
    if (teamsLeagueId !== id) return;
    els.teamsList.innerHTML = `<div class="group"><div class="empty">Couldn’t load this competition.<br>${escapeHtml(err.message || err)}</div></div>`;
  }
}

function playerSearchButton(hit) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "player-row";
  const face = hit.headshot
    ? `<span class="player-face"><img src="${escapeHtml(hit.headshot)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentElement.classList.add('is-fallback');this.remove();" /></span>`
    : `<span class="player-face is-fallback">${escapeHtml((hit.name || "?").charAt(0))}</span>`;
  btn.innerHTML = `
    ${face}
    <div>
      <div class="team-name">${hit.number ? `#${escapeHtml(hit.number)} ` : ""}${escapeHtml(hit.name)}</div>
      <div class="team-meta">${escapeHtml(hit.positionName || hit.position || "Player")}${hit.teamName ? ` · ${escapeHtml(hit.teamName)}` : ""}</div>
    </div>
    <span class="chev">›</span>
  `;
  btn.addEventListener("click", () => {
    selectedTeam = {
      id: hit.teamId,
      espnId: hit.teamId,
      name: hit.teamName || "Club",
      short: hit.teamShort,
      logo: hit.teamLogo,
      color: hit.teamColor,
      slug: hit.leagueSlug || "eng.1",
    };
    selectedPlayer = {
      id: hit.id,
      name: hit.name,
      number: hit.number,
      position: hit.position,
      positionName: hit.positionName,
      headshot: hit.headshot,
    };
    renderTeams();
  });
  return btn;
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

    const compTitle = document.createElement("p");
    compTitle.className = "group-title";
    compTitle.textContent = "Competitions";
    const compCard = document.createElement("div");
    compCard.className = "group";
    compCard.innerHTML = `<div class="empty">Checking the cups and leagues…</div>`;
    blocks.push(compTitle, compCard);
    const teamToken = team;
    API.loadTeamCompetitions(team).then((comps) => {
      if (selectedTeam !== teamToken || selectedPlayer) return;
      if (!comps.length) {
        compCard.innerHTML = `<div class="empty">No extra competitions published for this club yet.</div>`;
        return;
      }
      compCard.innerHTML = "";
      comps.forEach((comp) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "team-row";
        btn.innerHTML = `<div><div class="team-name">${escapeHtml(comp.name)}</div><div class="team-meta">${escapeHtml(comp.kind === "cup" ? "Cup" : "League")}</div></div><span class="chev">›</span>`;
        btn.addEventListener("click", () => {
          const known = API.COMPETITIONS?.find((item) => item.id === comp.id || item.slug === comp.slug);
          teamsLeagueId = known?.id || comp.id;
          if (known?.region) teamsRegion = known.region;
          selectedTeam = null;
          selectedPlayer = null;
          renderTeams();
        });
        compCard.appendChild(btn);
      });
    }).catch(() => {
      if (selectedTeam === teamToken) compCard.innerHTML = `<div class="empty">Competitions couldn’t be loaded.</div>`;
    });

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
          <p class="intel-note">${escapeHtml(team.name)}${full.height ? ` · ${escapeHtml(full.height)}` : ""}${
            full.weight ? ` · ${escapeHtml(full.weight)}` : ""
          }</p>
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

function saveFantasy() {
  saveJson("ninety-fantasy-v1", fantasySquad);
  fantasyPointsKey = "";
}

function money(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `£${number.toFixed(1)}m`;
}

function faceMarkup(url, name, className = "player-face", fallbackUrl = "") {
  const initial = escapeHtml((name || "?").trim().charAt(0) || "?");
  const primary = url || fallbackUrl || "";
  const fallback = url && fallbackUrl && fallbackUrl !== url ? fallbackUrl : "";
  if (!primary) return `<span class="${className} is-fallback">${initial}</span>`;
  const fallbackAttr = fallback ? ` data-fallback="${escapeHtml(fallback)}"` : "";
  return `<span class="${className}" data-initial="${initial}"><img src="${escapeHtml(primary)}" alt="" referrerpolicy="no-referrer"${fallbackAttr} onerror="if(this.dataset.fallback){this.src=this.dataset.fallback; this.dataset.fallback=''; return;} const box=this.parentElement; box.classList.add('is-fallback'); box.textContent=box.dataset.initial || '?';" /></span>`;
}

function fantasySpent() {
  return fantasySquad.reduce((sum, player) => sum + (Number(player.price) || 0), 0);
}

function fantasyPointsFor(id) {
  return fantasyPoints?.players?.find((player) => player.id === id) || null;
}

function fantasyState() {
  if (!window.NINETY_FANTASY_GAME) return null;
  return NINETY_FANTASY_GAME.load();
}

function activeSquad() {
  return fantasyState()?.squad || fantasySquad;
}

function squadClubsMatch(match) {
  return activeSquad().some((player) => {
    const club = String(player.club || "").toLowerCase();
    if (!club) return false;
    const home = String(match.home || "").toLowerCase();
    const away = String(match.away || "").toLowerCase();
    return home.includes(club) || away.includes(club) || club.includes(home) || club.includes(away);
  });
}

function finishFantasyPoints(raw, correction) {
  const next = raw || { total: 0, players: [] };
  next.total = Math.round(((next.total || 0) + correction) * 10) / 10;
  next.correction = correction;
  return next;
}

function ensureFantasyPoints() {
  const state = fantasyState();
  const squad = state?.squad || fantasySquad;
  const chip = state?.chipThisWeek || "";
  const correction = (state?.corrections || []).reduce((sum, row) => sum + (Number(row.value) || 0), 0);
  const options = { triple: chip === "triple", benchBoost: chip === "bench" };
  if (!squad.length || !live.matches.length) {
    fantasyPoints = finishFantasyPoints(FANTASY.weekPoints(squad, [], options), correction);
    return;
  }
  const matches = live.matches.filter(
    (match) => match.status !== "Upcoming" && FANTASY.inThisWeek(match.start) && squadClubsMatch(match)
  );
  const key = `${squad.map((player) => `${player.id}:${player.xi}:${player.captain}:${player.vice}`).join(",")}|${matches.map((match) => match.id).join(",")}|${chip}|${correction}`;
  if (key === fantasyPointsKey) return;
  fantasyPointsKey = key;
  fantasyLoading = true;
  Promise.all(matches.map((match) => API.loadMatchSheets(match.league, match.id).catch(() => null))).then((sheets) => {
    if (fantasyPointsKey !== key) return;
    fantasyPoints = finishFantasyPoints(FANTASY.weekPoints(squad, sheets.filter(Boolean), options), correction);
    fantasyLoading = false;
    const pointsScreens = new Set(["home", "team", "pick", "points", "live", "profile", "stats"]);
    const screen = window.NINETY_FANTASY_UI?.screen?.() || "home";
    if (currentView === "favourites" && favMode === "fantasy" && pointsScreens.has(screen)) renderFavourites();
  });
}

async function signFantasyPlayer(hit) {
  if (fantasySquad.some((player) => player.id === hit.id)) return;
  const quote = hit.quote || (await API.quoteFantasy(hit));
  const slot = (!quote.estimated && quote.slot) || FANTASY.slotOf(hit.positionName || hit.position || quote.slot);
  if (!FANTASY.canAdd(fantasySquad, slot)) return;
  const price = Number(quote.price);
  if (!Number.isFinite(price) || fantasySpent() + price > FANTASY.BUDGET + 0.001) return;
  fantasySquad.push({
    id: hit.id,
    name: hit.name,
    club: hit.teamName || "",
    clubLogo: hit.teamLogo || "",
    position: hit.positionName || hit.position || slot,
    slot,
    number: hit.number || "",
    headshot: quote.headshot || hit.headshot || "",
    price,
    estimated: !!quote.estimated,
    sources: quote.sources || [],
    xi: FANTASY.canStart(fantasySquad, slot),
    captain: fantasySquad.length === 0,
    vice: fantasySquad.length === 1,
  });
  saveFantasy();
  renderFavourites();
}

function renderFantasyPlayer() {
  const player = fantasySquad.find((item) => item.id === fantasyPlayerId);
  if (!player) {
    fantasyPlayerId = null;
    renderFavourites();
    return;
  }
  const scored = fantasyPointsFor(player.id);
  els.favouritesList.innerHTML = `<div class="loading">Loading ${escapeHtml(player.name)}…</div>`;
  updateNav();
  API.loadPlayerStats(player.id, player)
    .then((full) => {
      if (fantasyPlayerId !== player.id) return;
      const face = faceMarkup(full.headshot || player.headshot, full.name || player.name, "player-hero-face");
      const lines = (scored?.breakdown || [])
        .map(
          (match) => `
          <div class="setting-row">
            <strong>${escapeHtml(match.match)}</strong><span>${match.points} pts</span>
          </div>
          ${match.lines
            .map(
              (line) =>
                `<div class="setting-row fantasy-line"><span>${escapeHtml(line.label)}</span><span>${line.points > 0 ? "+" : ""}${line.points}</span></div>`
            )
            .join("")}`
        )
        .join("");
      const sources = (player.sources || [])
        .map(
          (source) =>
            `<div class="setting-row"><strong>${escapeHtml(source.game)}</strong><span>${escapeHtml(source.cost || "")}${
              source.derby != null ? ` · ${money(source.derby)}` : ""
            }</span></div>`
        )
        .join("");
      els.favouritesList.innerHTML = `
        <div class="group player-hero">
          <div class="player-hero-top">
            ${face}
            <div>
              <p class="player-number">${player.number ? `#${escapeHtml(player.number)}` : escapeHtml(player.slot)}</p>
              <h2 class="player-hero-name">${escapeHtml(full.name || player.name)}</h2>
              <p class="intel-note">${escapeHtml(full.positionName || player.position)}${
                full.nationality ? ` · ${escapeHtml(full.nationality)}` : ""
              }${full.age ? ` · Age ${escapeHtml(full.age)}` : ""}</p>
              <p class="intel-note">${escapeHtml(player.club)}${full.height ? ` · ${escapeHtml(full.height)}` : ""}${
                full.weight ? ` · ${escapeHtml(full.weight)}` : ""
              }</p>
              <p class="intel-note">${
                { G: "Goalkeeper", D: "Defender", M: "Midfielder", A: "Attacker" }[player.slot] || "Player"
              } · ${money(player.price)} · ${scored ? `${scored.points} pts` : "0 pts"}${
                scored?.doubled ? " · captain" : ""
              }</p>
            </div>
          </div>
        </div>
        <p class="group-title">This week</p>
        <div class="group">${lines || `<div class="empty">No match points in this Derby week yet.</div>`}</div>
        <p class="group-title">Price</p>
        <div class="group">
          ${sources || `<div class="empty">No fantasy listing.</div>`}
          <div class="setting-row"><strong>Derby cost</strong><span>${money(player.price)}</span></div>
        </div>
        <div class="group fantasy-actions">
          <button type="button" class="mini-btn" data-act="xi">${player.xi ? "Move to bench" : "Move to XI"}</button>
          <button type="button" class="mini-btn" data-act="captain">Captain</button>
          <button type="button" class="mini-btn" data-act="vice">Vice</button>
          <button type="button" class="mini-btn" data-act="sell">Sell</button>
        </div>
      `;
      els.favouritesList.querySelector("[data-act=xi]")?.addEventListener("click", () => {
        if (player.xi) {
          player.xi = false;
          if (player.captain) player.captain = false;
        } else {
          const parked = fantasySquad.map((item) => (item.id === player.id ? { ...item, xi: false } : item));
          if (FANTASY.canStart(parked, player.slot)) player.xi = true;
        }
        saveFantasy();
        renderFavourites();
      });
      els.favouritesList.querySelector("[data-act=captain]")?.addEventListener("click", () => {
        fantasySquad.forEach((item) => {
          item.captain = item.id === player.id;
          if (item.captain) item.vice = false;
        });
        player.xi = true;
        saveFantasy();
        renderFavourites();
      });
      els.favouritesList.querySelector("[data-act=vice]")?.addEventListener("click", () => {
        fantasySquad.forEach((item) => {
          item.vice = item.id === player.id;
          if (item.vice) item.captain = false;
        });
        saveFantasy();
        renderFavourites();
      });
      els.favouritesList.querySelector("[data-act=sell]")?.addEventListener("click", () => {
        fantasySquad = fantasySquad.filter((item) => item.id !== player.id);
        fantasyPlayerId = null;
        saveFantasy();
        updateNav();
        renderFavourites();
      });
    })
    .catch(() => {
      els.favouritesList.innerHTML = `<div class="group"><div class="empty">Couldn’t load this player.</div></div>`;
    });
}

function renderFantasy() {
  ensureFantasyPoints();
  if (window.NINETY_FANTASY_UI) {
    NINETY_FANTASY_UI.render({
      list: els.favouritesList,
      escapeHtml,
      faceMarkup,
      money,
      matches: live.matches,
      points: fantasyPoints,
      user: AUTH.currentUser(),
      api: API,
      ask(text) {
        showView("ask");
        ask(text);
      },
      follow(name) {
        if (name && !favorites.includes(name)) toggleFavorite(name);
      },
      onNotice(note) {
        if (!note || alertSeen.has(note.key)) return;
        if (note.key) rememberAlerts([note.key]);
        deliverAlert(note);
      },
    });
    return;
  }
  if (fantasyPlayerId) {
    renderFantasyPlayer();
    return;
  }
  const left = FANTASY.BUDGET - fantasySpent();
  const frag = document.createDocumentFragment();
  const head = document.createElement("div");
  head.className = "group fantasy-head";
  head.innerHTML = `
    <div class="fantasy-bank">
      <strong>${money(left)}</strong>
      <span>left of ${money(FANTASY.BUDGET)}</span>
    </div>
    <div class="fantasy-bank">
      <strong>${fantasyLoading && !fantasyPoints ? "…" : fantasyPoints?.total ?? 0}</strong>
      <span>points this week</span>
    </div>
  `;
  frag.appendChild(head);

  const search = document.createElement("form");
  search.className = "team-search";
  search.innerHTML = `
    <label class="sr-only" for="fantasy-search">Search players</label>
    <input id="fantasy-search" type="search" placeholder="Search any player…" value="${escapeHtml(fantasyQuery)}" autocomplete="off" />
    <button type="submit" class="search-go">Search</button>
  `;
  search.addEventListener("submit", async (event) => {
    event.preventDefault();
    fantasyQuery = search.querySelector("input").value.trim();
    if (fantasyQuery.length < 2) {
      fantasyHits = [];
      renderFavourites();
      return;
    }
    fantasySearching = true;
    renderFavourites();
    try {
      const hits = await API.searchPlayers(fantasyQuery);
      fantasyHits = await Promise.all(
        hits.slice(0, 8).map(async (hit) => {
          try {
            return { ...hit, quote: await API.quoteFantasy(hit) };
          } catch {
            return { ...hit, quote: null };
          }
        })
      );
    } catch {
      fantasyHits = [];
    }
    fantasySearching = false;
    if (currentView === "favourites") renderFavourites();
  });
  frag.appendChild(search);

  if (fantasySearching) {
    const loading = document.createElement("div");
    loading.className = "group";
    loading.innerHTML = `<div class="loading">Looking up players and prices…</div>`;
    frag.appendChild(loading);
  } else if (fantasyHits.length) {
    const title = document.createElement("p");
    title.className = "group-title";
    title.textContent = "Sign a player";
    const group = document.createElement("div");
    group.className = "group";
    fantasyHits.forEach((hit) => {
      const price = hit.quote?.price;
      const slot = hit.quote?.slot || FANTASY.slotOf(hit.position);
      const owned = fantasySquad.some((player) => player.id === hit.id);
      const affordable = Number.isFinite(Number(price)) && fantasySpent() + Number(price) <= FANTASY.BUDGET + 0.001;
      const room = FANTASY.canAdd(fantasySquad, slot);
      const row = document.createElement("div");
      row.className = "player-row fantasy-hit";
      row.innerHTML = `
        ${faceMarkup(hit.headshot, hit.name)}
        <div>
          <div class="team-name">${escapeHtml(hit.name)}</div>
          <div class="team-meta">${escapeHtml(hit.positionName || hit.position || slot)}${hit.teamName ? ` · ${escapeHtml(hit.teamName)}` : ""} · ${
            price == null ? "Price loading" : money(price)
          }${hit.quote?.estimated ? " · estimated" : ""}</div>
        </div>
        <button type="button" class="mini-btn" ${owned || !affordable || !room ? "disabled" : ""}>${owned ? "Owned" : "Sign"}</button>
      `;
      row.querySelector("button").addEventListener("click", () => signFantasyPlayer(hit));
      group.appendChild(row);
    });
    frag.append(title, group);
  }

  const xi = fantasySquad.filter((player) => player.xi);
  const lines = [
    ["A", "Attack"],
    ["M", "Midfield"],
    ["D", "Defence"],
    ["G", "Goalkeeper"],
  ];
  const pitch = document.createElement("div");
  pitch.className = "group pitch-wrap";
  const pitchLines = lines
    .map(([slot]) => {
      const players = xi.filter((player) => player.slot === slot);
      if (!players.length) return "";
      return `<div class="pitch-line">${players
        .map((player) => {
          const scored = fantasyPointsFor(player.id);
          return `<button type="button" class="pitch-player" data-id="${escapeHtml(player.id)}">
            ${faceMarkup(player.headshot, player.name, "pitch-face")}
            <span class="pitch-name">${escapeHtml(player.name.split(" ").slice(-1)[0])}${player.captain ? " (C)" : ""}${player.vice ? " (V)" : ""}</span>
            <span class="pitch-meta">${scored ? `${scored.points} pts` : money(player.price)}</span>
          </button>`;
        })
        .join("")}</div>`;
    })
    .join("");
  pitch.innerHTML = `
    <div class="pitch pitch-portrait">
      <div class="pitch-markings" aria-hidden="true">
        <span class="pitch-box pitch-box-top"></span>
        <span class="pitch-box pitch-box-bottom"></span>
      </div>
      <p class="pitch-shape">${xi.length}/11</p>
      ${pitchLines || `<p class="pitch-empty">Sign players to fill the pitch.</p>`}
    </div>
  `;
  pitch.querySelectorAll("[data-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      fantasyPlayerId = btn.dataset.id;
      updateNav();
      renderFavourites();
    });
  });
  frag.appendChild(pitch);

  const bench = fantasySquad.filter((player) => !player.xi);
  if (bench.length) {
    const title = document.createElement("p");
    title.className = "group-title";
    title.textContent = "Bench";
    const group = document.createElement("div");
    group.className = "group";
    bench.forEach((player) => {
      const scored = fantasyPointsFor(player.id);
      const row = document.createElement("button");
      row.type = "button";
      row.className = "player-row";
      row.innerHTML = `
        ${faceMarkup(player.headshot, player.name)}
        <div>
          <div class="team-name">${escapeHtml(player.name)}</div>
          <div class="team-meta">${escapeHtml(player.club)} · ${money(player.price)} · ${scored ? `${scored.points} pts` : "0 pts"}</div>
        </div>
        <span class="chev">›</span>
      `;
      row.addEventListener("click", () => {
        fantasyPlayerId = player.id;
        updateNav();
        renderFavourites();
      });
      group.appendChild(row);
    });
    frag.append(title, group);
  }

  frag.insertBefore(pitch, search);
  els.favouritesList.replaceChildren(frag);
  const input = document.querySelector("#fantasy-search");
  if (input && document.activeElement !== input) input.value = fantasyQuery;
}

function renderFavourites() {
  document.querySelectorAll("#fav-modes [data-fav]").forEach((btn) => {
    btn.classList.toggle("is-on", btn.dataset.fav === favMode);
  });
  if (favMode === "fantasy") {
    renderFantasy();
    return;
  }
  fantasyPlayerId = null;
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
      <label><strong>Kickoff alerts</strong><span>When a followed club is about to play, or the match is on</span></label>
      <label class="switch"><input type="checkbox" id="alert-matches" ${alertSettings.matchReminders ? "checked" : ""} /><span></span></label>
    </div>
    <div class="setting-row">
      <label><strong>Goals and cards</strong><span>Goals, penalties, yellow cards, and red cards</span></label>
      <label class="switch"><input type="checkbox" id="alert-events" ${alertSettings.eventAlerts !== false ? "checked" : ""} /><span></span></label>
    </div>
    <div class="setting-row">
      <label><strong>Transfer pings</strong><span>2027 window deals</span></label>
      <label class="switch"><input type="checkbox" id="alert-transfers" ${alertSettings.transferAlerts ? "checked" : ""} /><span></span></label>
    </div>
    ${(alertLog || [])
      .slice(0, 6)
      .map(
        (item) =>
          `<div class="setting-row"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.body)}</span></div>`
      )
      .join("")}
  `;
  alertGroup.querySelector("#alert-matches").addEventListener("change", (e) => {
    alertSettings.matchReminders = e.target.checked;
    persist();
    watchFavouriteAlerts();
  });
  alertGroup.querySelector("#alert-events").addEventListener("change", (e) => {
    alertSettings.eventAlerts = e.target.checked;
    persist();
    watchFavouriteAlerts();
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
    if (alertSettings.enabled) {
      deliverAlert({ key: `ready-${Date.now()}`, title: "Derby", body: "Alerts are on for the clubs you follow." });
      watchFavouriteAlerts();
    }
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

async function advanceSignup(errorEl, paintForm) {
  setAuthError(errorEl, "");
  if (signupStep === 0 && !signupDraft.country) return setAuthError(errorEl, "Choose your country.");
  if (signupStep === 1 && !signupDraft.club) return setAuthError(errorEl, "Choose your team.");
  if (signupStep === 2 && !signupDraft.players.length) return setAuthError(errorEl, "Add at least one player.");
  if (signupStep === 3) {
    signupDraft.name = document.querySelector("#signup-name")?.value.trim() || "";
    if (!signupDraft.name) return setAuthError(errorEl, "Add your name.");
  }
  if (signupStep === 4) {
    signupDraft.email = document.querySelector("#signup-email")?.value.trim() || "";
    if (!signupDraft.email.includes("@")) return setAuthError(errorEl, "Add a real email address.");
  }
  if (signupStep === 5) {
    signupDraft.password = document.querySelector("#signup-password")?.value || "";
    if (signupDraft.password.length < 4) return setAuthError(errorEl, "Use at least 4 characters.");
    try {
      await AUTH.requestSignupCode(signupDraft.email);
    } catch (err) {
      return setAuthError(errorEl, err.message || "The confirmation email could not be sent.");
    }
  }
  if (signupStep === 6) {
    signupDraft.code = document.querySelector("#signup-code")?.value.trim() || "";
    if (signupDraft.code.length < 6) return setAuthError(errorEl, "Enter the 6-digit code from your email.");
    try {
      await AUTH.register({
        name: signupDraft.name,
        email: signupDraft.email,
        password: signupDraft.password,
        code: signupDraft.code,
        country: signupDraft.country,
        favouriteClub: signupDraft.club?.name || "",
        favouritePlayers: signupDraft.players.map((player) => ({ id: player.id, name: player.name, teamName: player.teamName || "" })),
      });
      const clubName = signupDraft.club?.name;
      signupStep = 0;
      signupDraft = { country: "", club: null, players: [], name: "", email: "", password: "", code: "" };
      await afterAuthSuccess();
      if (clubName && !favorites.includes(clubName)) toggleFavorite(clubName);
    } catch (err) {
      setAuthError(errorEl, err.message || "That code did not match.");
    }
    return;
  }
  signupStep += 1;
  paintForm();
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
      ${user.picture ? `<img class="player-hero-face" alt="" src="${escapeHtml(user.picture)}" />` : ""}
      <p class="intel-title">${escapeHtml(user.displayName || user.name)}</p>
      <p class="intel-note">${escapeHtml(user.email || user.username || user.phone || "")}</p>
      <p class="intel-note">Via ${escapeHtml(user.provider)} · ${favorites.length} favourites saved · since ${escapeHtml(user.createdAt || "")}</p>
      <p class="intel-note">${window.NINETY_FANTASY_GAME ? `Fantasy ${escapeHtml(NINETY_FANTASY_GAME.load().teamName || "unnamed")} · ${NINETY_FANTASY_GAME.records(NINETY_FANTASY_GAME.load()).total} pts · ${(NINETY_FANTASY_GAME.load().archives || []).length} archived seasons` : ""}</p>
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
    const tools = document.createElement("div");
    tools.className = "group";
    tools.innerHTML = `
      <div class="setting-row"><strong>Display name</strong><span><input id="profile-name" value="${escapeHtml(user.displayName || user.name || "")}" /></span></div>
      <div class="setting-row"><strong>Username</strong><span><input id="profile-user" value="${escapeHtml(user.username || "")}" /></span></div>
      <div class="setting-row"><strong>Favourite club</strong><span><input id="profile-club" value="${escapeHtml(user.favouriteClub || "")}" /></span></div>
      <div class="setting-row"><strong>Country</strong><span><input id="profile-country" value="${escapeHtml(user.country || "")}" /></span></div>
      <div class="setting-row"><strong>Region</strong><span><input id="profile-region" value="${escapeHtml(user.region || "")}" /></span></div>
      <div class="setting-row"><strong>Picture URL</strong><span><input id="profile-picture" value="${escapeHtml(user.picture || "")}" placeholder="https://" /></span></div>
      <div class="setting-row"><strong>Email</strong><span>${user.emailVerified ? "Verified" : "Not verified"}</span></div>
      <button type="button" class="mini-btn" id="profile-save">Save profile</button>
      <button type="button" class="mini-btn" id="profile-verify">Email code</button>
      <button type="button" class="mini-btn" id="profile-delete">Delete account</button>
      <p class="intel-note" id="profile-note"></p>
    `;
    tools.querySelector("#profile-save").addEventListener("click", async () => {
      const data = await AUTH.postAccount("/api/auth/profile", {
        displayName: tools.querySelector("#profile-name").value,
        name: tools.querySelector("#profile-name").value,
        username: tools.querySelector("#profile-user").value,
        favouriteClub: tools.querySelector("#profile-club").value,
        country: tools.querySelector("#profile-country").value,
        region: tools.querySelector("#profile-region").value,
        picture: tools.querySelector("#profile-picture").value,
      });
      tools.querySelector("#profile-note").textContent = data.error || "Profile saved.";
      if (!data.error && data.user?.favouriteClub && !favorites.includes(data.user.favouriteClub)) toggleFavorite(data.user.favouriteClub);
    });
    tools.querySelector("#profile-verify").addEventListener("click", async () => {
      const sent = await AUTH.postAccount("/api/auth/verify/request", {});
      const code = window.prompt(sent.note || "Enter the code from your email");
      if (!code) return;
      const data = await AUTH.postAccount("/api/auth/verify", { code });
      tools.querySelector("#profile-note").textContent = data.error || "Email verified.";
    });
    tools.querySelector("#profile-delete").addEventListener("click", async () => {
      if (!window.confirm("Delete this account?")) return;
      await AUTH.postAccount("/api/auth/delete", {});
      await AUTH.logout();
      refreshAccountButton();
      renderAccount();
    });
    wrap.append(title, card, save, out, tools, buildOpenAiCard());
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
        <button type="button" class="mini-btn" id="reset-password">Reset password</button>
      `;
      return;
    }
    const steps = ["Country", "Team", "Players", "Name", "Email", "Password", "Code"];
    const dots = steps.map((_, index) => `<span class="${index === signupStep ? "is-on" : ""}"></span>`).join("");
    const countryOptions = (window.NINETY_DATA.countries || [])
      .map((country) => `<option value="${escapeHtml(country)}" ${signupDraft.country === country ? "selected" : ""}>${escapeHtml(country)}</option>`)
      .join("");
    const suggestions = ["Arsenal", "Real Madrid", "Barcelona", "Manchester City", "Liverpool", "Bayern Munich", "Paris Saint-Germain", "Inter"];
    let body = "";
    if (signupStep === 0) {
      body = `<h3>Which country are you from?</h3><label class="sr-only" for="signup-country">Country</label><select id="signup-country"><option value="">Choose a country</option>${countryOptions}</select>`;
    } else if (signupStep === 1) {
      const chosen = signupDraft.club ? `<p class="tutor-picked">${escapeHtml(signupDraft.club.name)}</p>` : "";
      body = `<h3>What is your favourite team?</h3>${chosen}<div class="tutor-picks">${suggestions.map((name) => `<button type="button" data-suggest-club="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join("")}</div><input id="signup-club-q" placeholder="Search any club" autocomplete="off" /><div id="signup-club-hits"></div>`;
    } else if (signupStep === 2) {
      const chips = signupDraft.players.map((player) => `<button type="button" data-drop-player="${escapeHtml(player.id)}">${escapeHtml(player.name)} ×</button>`).join("");
      body = `<h3>Who are your favourite players?</h3><div class="tutor-picks">${chips}</div><input id="signup-player-q" placeholder="Search a player" autocomplete="off" /><div id="signup-player-hits"></div>`;
    } else if (signupStep === 3) {
      body = `<h3>What should we call you?</h3><input id="signup-name" value="${escapeHtml(signupDraft.name)}" placeholder="Your name" autocomplete="name" />`;
    } else if (signupStep === 4) {
      body = `<h3>What is your email?</h3><p class="intel-note">We’ll send a confirmation code so the address is really yours.</p><input id="signup-email" type="email" value="${escapeHtml(signupDraft.email)}" placeholder="you@email.com" autocomplete="email" />`;
    } else if (signupStep === 5) {
      body = `<h3>Choose a password</h3><input id="signup-password" type="password" placeholder="At least 4 characters" autocomplete="new-password" />`;
    } else {
      body = `<h3>Enter the code from your email</h3><p class="intel-note">Check ${escapeHtml(signupDraft.email)} for a 6-digit code.</p><input id="signup-code" inputmode="numeric" maxlength="6" placeholder="000000" value="${escapeHtml(signupDraft.code)}" />`;
    }
    form.innerHTML = `<div class="tutor"><div class="tutor-dots" aria-hidden="true">${dots}</div>${body}<div class="tutor-nav"><button type="button" class="mini-btn" id="signup-back" ${signupStep === 0 ? "disabled" : ""}>Back</button><button type="button" class="auth-btn" id="signup-next">${signupStep === steps.length - 1 ? "Create account" : "Next"}</button></div></div>`;
    form.querySelector("#signup-back")?.addEventListener("click", () => {
      signupStep = Math.max(0, signupStep - 1);
      paintForm();
    });
    form.querySelector("#signup-country")?.addEventListener("change", (event) => {
      signupDraft.country = event.target.value;
    });
    form.querySelectorAll("[data-suggest-club]").forEach((button) => {
      button.addEventListener("click", async () => {
        const hits = await API.searchTeams(button.dataset.suggestClub).catch(() => []);
        signupDraft.club = hits[0] || { name: button.dataset.suggestClub, id: button.dataset.suggestClub };
        paintForm();
      });
    });
    const clubInput = form.querySelector("#signup-club-q");
    clubInput?.addEventListener("input", () => {
      const query = clubInput.value.trim();
      clearTimeout(clubInput._timer);
      clubInput._timer = setTimeout(async () => {
        signupClubHits = query.length < 2 ? [] : await API.searchTeams(query).catch(() => []);
        const box = form.querySelector("#signup-club-hits");
        if (!box) return;
        box.innerHTML = signupClubHits.slice(0, 6).map((hit, index) => `<button type="button" data-pick-club="${index}">${escapeHtml(hit.name)}</button>`).join("");
        box.querySelectorAll("[data-pick-club]").forEach((button) => {
          button.addEventListener("click", () => {
            signupDraft.club = signupClubHits[Number(button.dataset.pickClub)];
            paintForm();
          });
        });
      }, 220);
    });
    const playerInput = form.querySelector("#signup-player-q");
    playerInput?.addEventListener("input", () => {
      const query = playerInput.value.trim();
      clearTimeout(playerInput._timer);
      playerInput._timer = setTimeout(async () => {
        signupPlayerHits = query.length < 2 ? [] : await API.searchPlayers(query).catch(() => []);
        const box = form.querySelector("#signup-player-hits");
        if (!box) return;
        box.innerHTML = signupPlayerHits.slice(0, 6).map((hit, index) => `<button type="button" data-pick-player="${index}">${escapeHtml(hit.name)} · ${escapeHtml(hit.teamName || "")}</button>`).join("");
        box.querySelectorAll("[data-pick-player]").forEach((button) => {
          button.addEventListener("click", () => {
            const hit = signupPlayerHits[Number(button.dataset.pickPlayer)];
            if (hit && !signupDraft.players.some((player) => player.id === hit.id)) signupDraft.players.push(hit);
            paintForm();
          });
        });
      }, 220);
    });
    form.querySelectorAll("[data-drop-player]").forEach((button) => {
      button.addEventListener("click", () => {
        signupDraft.players = signupDraft.players.filter((player) => player.id !== button.dataset.dropPlayer);
        paintForm();
      });
    });
    form.querySelector("#signup-next")?.addEventListener("click", () => advanceSignup(errorEl, paintForm));
  };

  formCard.querySelectorAll("[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      accountMode = btn.dataset.mode;
      setAuthError(errorEl, "");
      paintForm();
    });
  });

  form.addEventListener("click", async (event) => {
    if (event.target?.id !== "reset-password") return;
    const identity = form.querySelector("[name=identity]")?.value || window.prompt("Email, username, or phone");
    if (!identity) return;
    const sent = await fetch("/api/auth/reset/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity }),
    }).then((res) => res.json());
    if (sent.error) return setAuthError(errorEl, sent.error);
    const code = window.prompt(sent.note || "Enter the code from your email");
    const password = code ? window.prompt("New password") : "";
    if (!code || !password) return;
    const done = await fetch("/api/auth/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity, code, password }),
    }).then((res) => res.json());
    setAuthError(errorEl, done.error || "Password updated. Sign in with the new one.");
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    setAuthError(errorEl, "");
    try {
      if (accountMode !== "signin") {
        await advanceSignup(errorEl, paintForm);
        return;
      }
      await AUTH.login({
        identity: String(data.get("identity") || ""),
        password: String(data.get("password") || ""),
      });
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
    if (tab.dataset.view === "matches") selectedMatch = null;
    if (tab.dataset.view === "transfers") selectedTransfer = null;
    if (tab.dataset.view === "favourites") fantasyPlayerId = null;
    showView(tab.dataset.view);
  });
});

els.navBack.addEventListener("click", () => {
  if (currentView === "favourites" && favMode === "fantasy" && window.NINETY_FANTASY_UI?.back()) {
    updateNav();
    return;
  }
  if (currentView === "favourites" && fantasyPlayerId) {
    fantasyPlayerId = null;
    renderFavourites();
    return;
  }
  if (currentView === "matches" && selectedMatch) {
    selectedMatch = null;
    renderMatches();
    return;
  }
  if (currentView === "transfers" && selectedTransfer) {
    selectedTransfer = null;
    renderTransfers();
    return;
  }
  if (selectedPlayer) {
    selectedPlayer = null;
    if (teamSearchQuery) selectedTeam = null;
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
    teamSearchClubs = [];
    teamSearchPlayers = [];
    renderTeams();
    return;
  }
  teamSearchLoading = true;
  renderTeams();
  try {
    const [clubs, players] = await Promise.all([
      API.searchTeams(q).catch(() => []),
      API.searchPlayers(q).catch(() => []),
    ]);
    teamSearchClubs = clubs;
    teamSearchPlayers = players;
  } catch (err) {
    teamSearchClubs = [];
    teamSearchPlayers = [];
    console.warn(err);
  }
  teamSearchLoading = false;
  showView("teams");
});

window.addEventListener("ninety-auth", async () => {
  await afterAuthSuccess();
});

document.querySelectorAll("#fav-modes [data-fav]").forEach((btn) => {
  btn.addEventListener("click", () => {
    favMode = btn.dataset.fav;
    localStorage.setItem("ninety-fav-mode", favMode);
    fantasyPlayerId = null;
    updateNav();
    renderFavourites();
  });
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
function watchFantasyNotices() {
  if (!window.NINETY_FANTASY_GAME) return;
  const state = NINETY_FANTASY_GAME.load();
  NINETY_FANTASY_GAME.notices(state, { matches: live.matches }).forEach((note) => {
    if (alertSeen.has(note.key)) return;
    rememberAlerts([note.key]);
    deliverAlert(note);
  });
}

setInterval(() => {
  watchFavouriteAlerts();
  watchFantasyNotices();
}, 25_000);

if (!els.askLog.children.length) {
  appendAsk(
    "ai",
    "Ask me anything football. Connect ChatGPT in Account for the smartest answers — I’ll still use live scores and the transfer board either way.",
    "Derby AI"
  );
}
