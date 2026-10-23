const STORAGE_KEY = "ninety-matches-v1";

const seedMatches = [
  { id: "m1", home: "Arsenal", away: "Chelsea", homeScore: 2, awayScore: 1, status: "FT", kickoff: "Sat 12:30" },
  { id: "m2", home: "Liverpool", away: "Man City", homeScore: 1, awayScore: 1, status: "Live", kickoff: "Sat 17:30" },
  { id: "m3", home: "Tottenham", away: "Newcastle", homeScore: null, awayScore: null, status: "Upcoming", kickoff: "Sun 14:00" },
  { id: "m4", home: "Man United", away: "Brighton", homeScore: 0, awayScore: 2, status: "FT", kickoff: "Sun 16:30" },
];

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const matchesEl = document.querySelector("#matches");
const tableEl = document.querySelector("#table");
const form = document.querySelector("#match-form");

function loadMatches() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return structuredClone(seedMatches);
  try {
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) && parsed.length ? parsed : structuredClone(seedMatches);
  } catch {
    return structuredClone(seedMatches);
  }
}

let matches = loadMatches();

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(matches));
}

function showView(name) {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.view === name);
  });
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("is-visible", view.id === name);
  });
}

function changeScore(id, side, delta) {
  matches = matches.map((match) => {
    if (match.id !== id) return match;
    const key = side === "home" ? "homeScore" : "awayScore";
    const otherKey = side === "home" ? "awayScore" : "homeScore";
    const current = match[key] ?? 0;
    const next = Math.max(0, current + delta);
    return {
      ...match,
      status: match.status === "Upcoming" ? "Live" : match.status,
      [key]: next,
      [otherKey]: match[otherKey] ?? 0,
    };
  });
  save();
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
  save();
  render();
}

function removeMatch(id) {
  matches = matches.filter((match) => match.id !== id);
  save();
  render();
}

function statusClass(status) {
  if (status === "Live") return "live";
  if (status === "FT") return "ft";
  return "upcoming";
}

function renderMatches() {
  if (!matches.length) {
    const empty = document.createElement("div");
    empty.className = "panel empty";
    empty.textContent = "No fixtures yet. Add one to kick things off.";
    matchesEl.replaceChildren(empty);
    return;
  }

  matchesEl.replaceChildren(
    ...matches.map((match) => {
      const card = document.createElement("article");
      card.className = "match";
      card.innerHTML = `
        <div class="meta">
          <span>${escapeHtml(match.kickoff)}</span>
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
          ${
            match.status !== "Live"
              ? `<button type="button" class="btn small ghost" data-status="Live">Mark live</button>`
              : ""
          }
          ${
            match.status !== "FT"
              ? `<button type="button" class="btn small ghost" data-status="FT">Full time</button>`
              : ""
          }
          ${
            match.status !== "Upcoming"
              ? `<button type="button" class="btn small ghost" data-status="Upcoming">Reset</button>`
              : ""
          }
          <button type="button" class="btn small danger" data-remove>Remove</button>
        </div>
      `;

      card.querySelectorAll(".score button").forEach((button) => {
        button.addEventListener("click", () => {
          const delta = button.dataset.action === "up" ? 1 : -1;
          changeScore(match.id, button.dataset.side, delta);
        });
      });

      card.querySelectorAll("[data-status]").forEach((button) => {
        button.addEventListener("click", () => setStatus(match.id, button.dataset.status));
      });

      card.querySelector("[data-remove]").addEventListener("click", () => removeMatch(match.id));

      return card;
    })
  );
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

function renderTable() {
  const rows = standings();
  const wrap = document.createElement("div");
  wrap.className = "panel table-wrap";
  if (!rows.length) {
    wrap.classList.add("empty");
    wrap.textContent = "Add a result and the table will appear here.";
    tableEl.replaceChildren(wrap);
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
                <td>${escapeHtml(row.team)}</td>
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
  tableEl.replaceChildren(wrap);
}

function render() {
  renderMatches();
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

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const home = String(data.get("home") || "").trim();
  const away = String(data.get("away") || "").trim();
  const kickoff = String(data.get("kickoff") || "").trim();
  if (!home || !away || !kickoff) return;

  matches = [
    {
      id: crypto.randomUUID(),
      home,
      away,
      kickoff,
      homeScore: null,
      awayScore: null,
      status: "Upcoming",
    },
    ...matches,
  ];
  form.reset();
  save();
  showView("matches");
  render();
});

render();
