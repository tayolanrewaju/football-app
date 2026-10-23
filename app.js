const KEYS = {
  matches: "ninety-matches-v2",
  favorites: "ninety-favorites-v1",
  alerts: "ninety-alerts-v1",
  notified: "ninety-notified-v1",
  watchedTransfers: "ninety-watched-transfers-v1",
};

const DATA = window.NINETY_DATA;
const AI = window.NINETY_AI;

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

function withDefaultKickoffs(list) {
  const now = Date.now();
  return list.map((match, index) => {
    if (match.kickoffAt) return match;
    if (match.status !== "Upcoming" && match.status !== "Live") return match;
    const offsetHours = match.status === "Live" ? -0.5 : 2 + index;
    return {
      ...match,
      kickoffAt: new Date(now + offsetHours * 60 * 60 * 1000).toISOString(),
    };
  });
}

let matches = withDefaultKickoffs(loadJson(KEYS.matches, DATA.seedMatches));
if (!Array.isArray(matches) || !matches.length) {
  matches = withDefaultKickoffs(structuredClone(DATA.seedMatches));
}

let favorites = loadJson(KEYS.favorites, ["Arsenal", "Liverpool"]);
if (!Array.isArray(favorites)) favorites = ["Arsenal", "Liverpool"];

let alertSettings = loadJson(KEYS.alerts, {
  enabled: false,
  matchReminders: true,
  transferAlerts: true,
  minutesBefore: 60,
});

let notified = loadJson(KEYS.notified, {});
let watchedTransfers = loadJson(KEYS.watchedTransfers, []);

const els = {
  matches: document.querySelector("#matches"),
  transfers: document.querySelector("#transfers"),
  market: document.querySelector("#market"),
  favourites: document.querySelector("#favourites"),
  alerts: document.querySelector("#alerts"),
  table: document.querySelector("#table"),
  form: document.querySelector("#match-form"),
  askForm: document.querySelector("#ask-form"),
  askLog: document.querySelector("#ask-log"),
  askInput: document.querySelector("#ask-input"),
  clubList: document.querySelector("#club-list"),
};

function persist() {
  saveJson(KEYS.matches, matches);
  saveJson(KEYS.favorites, favorites);
  saveJson(KEYS.alerts, alertSettings);
  saveJson(KEYS.notified, notified);
  saveJson(KEYS.watchedTransfers, watchedTransfers);
}

function showView(name) {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.view === name);
  });
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("is-visible", view.id === name);
  });
}

function isFavoriteMatch(match) {
  return favorites.includes(match.home) || favorites.includes(match.away);
}

function changeScore(id, side, delta) {
  matches = matches.map((match) => {
    if (match.id !== id) return match;
    const key = side === "home" ? "homeScore" : "awayScore";
    const otherKey = side === "home" ? "awayScore" : "homeScore";
    const current = match[key] ?? 0;
    return {
      ...match,
      status: match.status === "Upcoming" ? "Live" : match.status,
      [key]: Math.max(0, current + delta),
      [otherKey]: match[otherKey] ?? 0,
    };
  });
  persist();
  render();
}

function setStatus(id, status) {
  matches = matches.map((match) => {
    if (match.id !== id) return match;
    const homeScore = match.homeScore ?? 0;
    const awayScore = match.awayScore ?? 0;
    if (status === "Live" || status === "FT") {
      return { ...match, status, homeScore, awayScore };
    }
    return { ...match, status, homeScore: null, awayScore: null };
  });
  persist();
  render();
}

function removeMatch(id) {
  matches = matches.filter((match) => match.id !== id);
  persist();
  render();
}

function statusClass(status) {
  if (status === "Live") return "live";
  if (status === "FT") return "ft";
  return "upcoming";
}

function toggleFavorite(team) {
  if (favorites.includes(team)) {
    favorites = favorites.filter((t) => t !== team);
  } else {
    favorites = [...favorites, team];
  }
  persist();
  render();
  maybeNotifyTransfers();
}

function standings() {
  const rows = new Map();
  const ensure = (name) => {
    if (!rows.has(name)) {
      rows.set(name, { team: name, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, points: 0 });
    }
    return rows.get(name);
  };

  for (const match of matches) {
    if (match.homeScore == null || match.awayScore == null || match.status === "Upcoming") continue;
    const home = ensure(match.home);
    const away = ensure(match.away);
    home.played += 1;
    away.played += 1;
    home.gf += match.homeScore;
    home.ga += match.awayScore;
    away.gf += match.awayScore;
    away.ga += match.homeScore;
    if (match.homeScore > match.awayScore) {
      home.won += 1;
      home.points += 3;
      away.lost += 1;
    } else if (match.homeScore < match.awayScore) {
      away.won += 1;
      away.points += 3;
      home.lost += 1;
    } else {
      home.drawn += 1;
      away.drawn += 1;
      home.points += 1;
      away.points += 1;
    }
  }

  return [...rows.values()].sort(
    (a, b) => b.points - a.points || b.gf - b.ga - (a.gf - a.ga) || a.team.localeCompare(b.team)
  );
}

function renderMatches() {
  const favOnly = favorites.length > 0;
  const ordered = [...matches].sort((a, b) => {
    const af = isFavoriteMatch(a) ? 0 : 1;
    const bf = isFavoriteMatch(b) ? 0 : 1;
    return af - bf;
  });

  if (!ordered.length) {
    els.matches.replaceChildren(emptyPanel("No fixtures yet. Add one to kick things off."));
    return;
  }

  const header = document.createElement("div");
  header.className = "section-note panel";
  header.innerHTML = favOnly
    ? `<strong>Favourites first.</strong> Starred clubs float to the top — ${escapeHtml(favorites.join(", "))}.`
    : `<strong>Tip.</strong> Star clubs in Favourites to prioritise their fixtures and alerts.`;

  const cards = ordered.map((match) => {
    const card = document.createElement("article");
    card.className = `match${isFavoriteMatch(match) ? " is-fav" : ""}`;
    card.innerHTML = `
      <div class="meta">
        <span>${escapeHtml(match.kickoff)}${isFavoriteMatch(match) ? " · ★" : ""}</span>
        <span class="status ${statusClass(match.status)}">${escapeHtml(match.status)}</span>
      </div>
      <div class="teams">
        <div class="team">${escapeHtml(match.home)}</div>
        <div class="score">
          <button type="button" data-action="down" data-side="home" aria-label="Decrease ${escapeHtml(match.home)} score">−</button>
          <span>${match.homeScore ?? "–"}</span>
          <button type="button" data-action="up" data-side="home" aria-label="Increase ${escapeHtml(match.home)} score">+</button>
          <span class="sep">:</span>
          <button type="button" data-action="down" data-side="away" aria-label="Decrease ${escapeHtml(match.away)} score">−</button>
          <span>${match.awayScore ?? "–"}</span>
          <button type="button" data-action="up" data-side="away" aria-label="Increase ${escapeHtml(match.away)} score">+</button>
        </div>
        <div class="team away">${escapeHtml(match.away)}</div>
      </div>
      <div class="actions">
        ${match.status !== "Live" ? `<button type="button" class="btn small ghost" data-status="Live">Mark live</button>` : ""}
        ${match.status !== "FT" ? `<button type="button" class="btn small ghost" data-status="FT">Full time</button>` : ""}
        ${match.status !== "Upcoming" ? `<button type="button" class="btn small ghost" data-status="Upcoming">Reset</button>` : ""}
        <button type="button" class="btn small danger" data-remove>Remove</button>
      </div>
    `;

    card.querySelectorAll(".score button").forEach((button) => {
      button.addEventListener("click", () => {
        changeScore(match.id, button.dataset.side, button.dataset.action === "up" ? 1 : -1);
      });
    });
    card.querySelectorAll("[data-status]").forEach((button) => {
      button.addEventListener("click", () => setStatus(match.id, button.dataset.status));
    });
    card.querySelector("[data-remove]").addEventListener("click", () => removeMatch(match.id));
    return card;
  });

  els.matches.replaceChildren(header, ...cards);
}

function likelihoodClass(value) {
  const v = String(value || "").toLowerCase();
  if (v.includes("hot") || v.includes("done")) return "hot";
  if (v.includes("rising") || v.includes("warm")) return "warm";
  return "cold";
}

function renderTransfers() {
  const list = [...DATA.transfers].sort((a, b) => {
    const score = (t) => {
      let s = 0;
      if (favorites.includes(t.from) || favorites.includes(t.to)) s += 10;
      if (t.likelihood === "Hot" || t.likelihood === "Done-ish") s += 5;
      if (t.likelihood === "Rising" || t.likelihood === "Warm") s += 3;
      return s;
    };
    return score(b) - score(a);
  });

  const note = document.createElement("div");
  note.className = "section-note panel";
  note.innerHTML =
    "<strong>Big moves incoming.</strong> Hot deals and club links for your favourites rise to the top.";

  const cards = list.map((t) => {
    const related = favorites.includes(t.from) || favorites.includes(t.to);
    const card = document.createElement("article");
    card.className = `intel-card${related ? " is-fav" : ""}`;
    card.innerHTML = `
      <div class="intel-top">
        <div>
          <p class="intel-title">${escapeHtml(t.player)}</p>
          <p class="intel-sub">${escapeHtml(t.from)} → ${escapeHtml(t.to)}</p>
        </div>
        <span class="pill ${likelihoodClass(t.likelihood)}">${escapeHtml(t.likelihood)}</span>
      </div>
      <p class="intel-meta">${escapeHtml(t.fee)} · ${escapeHtml(t.window)}${related ? " · ★ your club" : ""}</p>
      <p class="intel-note">${escapeHtml(t.note)}</p>
    `;
    return card;
  });

  els.transfers.replaceChildren(note, ...cards);
}

function renderMarket() {
  const sorted = [...DATA.market].sort((a, b) => {
    const num = (v) => Number(String(v).replace(/[^\d]/g, "")) || 0;
    return num(b.value) - num(a.value);
  });

  const note = document.createElement("div");
  note.className = "section-note panel";
  note.innerHTML =
    "<strong>Player market.</strong> Estimated valuations and momentum — useful when a rumour heats up.";

  const cards = sorted.map((p) => {
    const related = favorites.includes(p.club);
    const card = document.createElement("article");
    card.className = `intel-card${related ? " is-fav" : ""}`;
    card.innerHTML = `
      <div class="intel-top">
        <div>
          <p class="intel-title">${escapeHtml(p.player)}</p>
          <p class="intel-sub">${escapeHtml(p.club)} · ${escapeHtml(p.pos)} · ${p.age} yrs</p>
        </div>
        <span class="pill value">${escapeHtml(p.value)}</span>
      </div>
      <p class="intel-meta">Trend: <span class="trend ${escapeHtml(p.trend)}">${escapeHtml(p.trend)}</span>${related ? " · ★" : ""}</p>
      <p class="intel-note">${escapeHtml(p.note)}</p>
    `;
    return card;
  });

  els.market.replaceChildren(note, ...cards);
}

function renderFavourites() {
  const wrap = document.createElement("div");
  wrap.className = "panel fav-panel";
  wrap.innerHTML = `
    <p class="form-title">Favourite teams</p>
    <p class="ask-hint">Star clubs to prioritise fixtures, transfers, market names, and notifications.</p>
    <div class="fav-grid"></div>
  `;
  const grid = wrap.querySelector(".fav-grid");
  DATA.clubs.forEach((club) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `fav-chip${favorites.includes(club) ? " is-on" : ""}`;
    btn.setAttribute("aria-pressed", favorites.includes(club) ? "true" : "false");
    btn.textContent = `${favorites.includes(club) ? "★" : "☆"} ${club}`;
    btn.addEventListener("click", () => toggleFavorite(club));
    grid.appendChild(btn);
  });
  els.favourites.replaceChildren(wrap);
}

function permissionLabel() {
  if (!("Notification" in window)) return "Not supported in this browser";
  return Notification.permission;
}

async function enableAlerts() {
  if (!("Notification" in window)) {
    alertSettings.enabled = false;
    persist();
    renderAlerts();
    return;
  }
  const permission = await Notification.requestPermission();
  alertSettings.enabled = permission === "granted";
  persist();
  renderAlerts();
  if (alertSettings.enabled) {
    notifyNow("NINETY alerts on", "You'll get pings for favourite fixtures and hot transfers.");
    scheduleMatchChecks();
    maybeNotifyTransfers();
  }
}

function notifyNow(title, body, tag) {
  if (!alertSettings.enabled || !("Notification" in window) || Notification.permission !== "granted") {
    return;
  }
  try {
    new Notification(title, { body, tag: tag || undefined });
  } catch {
    /* ignore unsupported options */
  }
}

function scheduleMatchChecks() {
  if (!alertSettings.enabled || !alertSettings.matchReminders) return;
  const lead = (alertSettings.minutesBefore || 60) * 60 * 1000;
  const now = Date.now();

  for (const match of matches) {
    if (match.status !== "Upcoming" || !match.kickoffAt) continue;
    if (!isFavoriteMatch(match)) continue;
    const start = Date.parse(match.kickoffAt);
    if (Number.isNaN(start)) continue;
    const notifyAt = start - lead;
    const key = `match:${match.id}`;
    if (notified[key]) continue;
    if (notifyAt <= now && start > now) {
      notified[key] = Date.now();
      persist();
      notifyNow(
        `${match.home} vs ${match.away}`,
        `Kickoff ${match.kickoff} — your favourite is involved.`,
        key
      );
    }
  }
}

function maybeNotifyTransfers() {
  if (!alertSettings.enabled || !alertSettings.transferAlerts) return;
  const hot = DATA.transfers.filter((t) => {
    const linked = favorites.includes(t.from) || favorites.includes(t.to);
    const spicy = t.likelihood === "Hot" || t.likelihood === "Done-ish" || t.likelihood === "Rising";
    return linked && spicy;
  });

  for (const t of hot) {
    const key = `transfer:${t.id}:${favorites.join("|")}`;
    if (watchedTransfers.includes(key)) continue;
    watchedTransfers = [...watchedTransfers, key];
    persist();
    notifyNow(
      `Transfer watch: ${t.player}`,
      `${t.from} → ${t.to} · ${t.fee} (${t.likelihood})`,
      key
    );
  }
}

function renderAlerts() {
  const panel = document.createElement("div");
  panel.className = "panel form alerts-panel";
  panel.innerHTML = `
    <p class="form-title">Match & transfer alerts</p>
    <p class="ask-hint">Browser notifications for favourite kickoffs and big moves linked to your clubs.</p>
    <div class="alert-status">
      <span>Permission: <strong>${escapeHtml(permissionLabel())}</strong></span>
      <span>Status: <strong>${alertSettings.enabled ? "On" : "Off"}</strong></span>
    </div>
    <label class="check">
      <input type="checkbox" id="alert-matches" ${alertSettings.matchReminders ? "checked" : ""} />
      Remind me before favourite matches
    </label>
    <label class="check">
      <input type="checkbox" id="alert-transfers" ${alertSettings.transferAlerts ? "checked" : ""} />
      Ping hot transfers for my clubs
    </label>
    <label>
      Minutes before kickoff
      <input type="number" id="alert-mins" min="5" max="180" step="5" value="${Number(alertSettings.minutesBefore) || 60}" />
    </label>
    <button type="button" class="btn primary wide" id="alert-enable">${alertSettings.enabled ? "Refresh permission" : "Turn on notifications"}</button>
    <button type="button" class="btn ghost wide" id="alert-test">Send test notification</button>
  `;

  panel.querySelector("#alert-enable").addEventListener("click", () => enableAlerts());
  panel.querySelector("#alert-test").addEventListener("click", () => {
    if (!alertSettings.enabled) {
      enableAlerts().then(() => notifyNow("NINETY test", "If you can read this, alerts are working."));
      return;
    }
    notifyNow("NINETY test", "If you can read this, alerts are working.");
  });
  panel.querySelector("#alert-matches").addEventListener("change", (e) => {
    alertSettings.matchReminders = e.target.checked;
    persist();
  });
  panel.querySelector("#alert-transfers").addEventListener("change", (e) => {
    alertSettings.transferAlerts = e.target.checked;
    persist();
    if (e.target.checked) maybeNotifyTransfers();
  });
  panel.querySelector("#alert-mins").addEventListener("change", (e) => {
    alertSettings.minutesBefore = Math.max(5, Math.min(180, Number(e.target.value) || 60));
    persist();
  });

  const upcoming = matches.filter((m) => m.status === "Upcoming" && isFavoriteMatch(m));
  const preview = document.createElement("div");
  preview.className = "panel";
  preview.innerHTML = upcoming.length
    ? `<p class="form-title">Next pings</p><ul class="plain-list">${upcoming
        .map(
          (m) =>
            `<li>${escapeHtml(m.home)} vs ${escapeHtml(m.away)} · ${escapeHtml(m.kickoff)}</li>`
        )
        .join("")}</ul>`
    : `<p class="ask-hint">No upcoming favourite fixtures queued. Star clubs or add a kickoff time on Add.</p>`;

  els.alerts.replaceChildren(panel, preview);
}

function emptyPanel(text) {
  const el = document.createElement("div");
  el.className = "panel empty";
  el.textContent = text;
  return el;
}

function renderTable() {
  const rows = standings();
  const wrap = document.createElement("div");
  wrap.className = "panel table-wrap";
  if (!rows.length) {
    wrap.classList.add("empty");
    wrap.textContent = "Add a result and the table will appear here.";
    els.table.replaceChildren(wrap);
    return;
  }
  wrap.innerHTML = `
    <table>
      <thead>
        <tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row, index) => `
              <tr class="${index < 3 ? "podium" : ""}">
                <td>${index + 1}</td>
                <td>${escapeHtml(row.team)}${favorites.includes(row.team) ? " ★" : ""}</td>
                <td>${row.played}</td>
                <td>${row.won}</td>
                <td>${row.drawn}</td>
                <td>${row.lost}</td>
                <td>${row.gf - row.ga}</td>
                <td>${row.points}</td>
              </tr>
            `
          )
          .join("")}
      </tbody>
    </table>
  `;
  els.table.replaceChildren(wrap);
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
  const result = AI.answerQuestion(q, {
    favorites,
    matches,
    standings,
  });
  appendAsk("ai", result.text, result.source);
}

function renderClubList() {
  els.clubList.innerHTML = DATA.clubs.map((c) => `<option value="${escapeHtml(c)}"></option>`).join("");
}

function render() {
  renderMatches();
  renderTransfers();
  renderMarket();
  renderFavourites();
  renderAlerts();
  renderTable();
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => showView(tab.dataset.view));
});

document.querySelectorAll("[data-jump]").forEach((button) => {
  button.addEventListener("click", () => {
    showView(button.dataset.jump);
    document.querySelector("#board")?.scrollIntoView({ behavior: "smooth" });
  });
});

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(els.form);
  const home = String(data.get("home") || "").trim();
  const away = String(data.get("away") || "").trim();
  const kickoff = String(data.get("kickoff") || "").trim();
  const kickoffAtRaw = String(data.get("kickoffAt") || "").trim();
  if (!home || !away || !kickoff) return;

  matches = [
    {
      id: crypto.randomUUID(),
      home,
      away,
      kickoff,
      kickoffAt: kickoffAtRaw ? new Date(kickoffAtRaw).toISOString() : new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      homeScore: null,
      awayScore: null,
      status: "Upcoming",
    },
    ...matches,
  ];
  els.form.reset();
  persist();
  showView("matches");
  render();
  scheduleMatchChecks();
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

renderClubList();
render();
scheduleMatchChecks();

if (!els.askLog.children.length) {
  appendAsk(
    "ai",
    "Hey — ask me about big transfers, player valuations, your favourite fixtures, or football rules.",
    "NINETY AI"
  );
}

setInterval(() => {
  scheduleMatchChecks();
}, 30_000);
