(function () {
  const SHIELD = "M40 7 L67 17 V48 C67 66 55 80 40 90 C25 80 13 66 13 48 V17 Z";
  let seq = 0;

  const STYLE = {
    arsenal: { secondary: "#ffffff", pattern: "bars" },
    liverpool: { secondary: "#ffffff", pattern: "band" },
    mancity: { secondary: "#ffffff", pattern: "bars" },
    chelsea: { secondary: "#ffffff", pattern: "bars" },
    tottenham: { secondary: "#ffffff", pattern: "band" },
    manutd: { secondary: "#f5d76e", pattern: "stripes" },
    newcastle: { secondary: "#ffffff", pattern: "stripes" },
    realmadrid: { secondary: "#c9a227", pattern: "bars" },
    barcelona: { secondary: "#004d98", pattern: "stripes" },
    atletico: { secondary: "#ffffff", pattern: "stripes" },
    inter: { secondary: "#111111", pattern: "stripes" },
    milan: { secondary: "#111111", pattern: "stripes" },
    juventus: { secondary: "#ffffff", pattern: "stripes" },
    napoli: { secondary: "#ffffff", pattern: "band" },
    bayern: { secondary: "#ffffff", pattern: "band" },
    dortmund: { secondary: "#111111", pattern: "stripes" },
    leverkusen: { secondary: "#111111", pattern: "stripes" },
    psg: { secondary: "#e30613", pattern: "bars" },
    marseille: { secondary: "#ffffff", pattern: "band" },
    monaco: { secondary: "#ffffff", pattern: "split" },
  };

  const EXTRAS = {
    Bournemouth: { primary: "#d71920", secondary: "#111111", pattern: "stripes", label: "BOU" },
    Brighton: { primary: "#0057b8", secondary: "#ffffff", pattern: "bars", label: "BHA" },
    "West Ham": { primary: "#7a263a", secondary: "#7fd3f2", pattern: "bars", label: "WHU" },
    Wolves: { primary: "#fdb913", secondary: "#111111", pattern: "stripes", label: "WOL" },
    "Aston Villa": { primary: "#670e36", secondary: "#95bfe5", pattern: "bars", label: "AVL" },
    Fulham: { primary: "#ffffff", secondary: "#111111", pattern: "stripes", label: "FUL" },
    Sevilla: { primary: "#ffffff", secondary: "#d00027", pattern: "bars", label: "SEV" },
    "Real Sociedad": { primary: "#0056a8", secondary: "#ffffff", pattern: "band", label: "RSO" },
    Villarreal: { primary: "#ffe000", secondary: "#0055a5", pattern: "band", label: "VIL" },
    Roma: { primary: "#8e1f2f", secondary: "#f0bc42", pattern: "band", label: "ROM" },
    Atalanta: { primary: "#1e1b4b", secondary: "#111111", pattern: "stripes", label: "ATA" },
    "RB Leipzig": { primary: "#dd0741", secondary: "#ffffff", pattern: "band", label: "RBL" },
    Frankfurt: { primary: "#e1000f", secondary: "#111111", pattern: "stripes", label: "SGE" },
    Stuttgart: { primary: "#ffffff", secondary: "#e32219", pattern: "bars", label: "VFB" },
    Lyon: { primary: "#ffffff", secondary: "#0033a0", pattern: "bars", label: "OL" },
    Lille: { primary: "#e30613", secondary: "#ffffff", pattern: "band", label: "LIL" },
    Nice: { primary: "#111111", secondary: "#e30613", pattern: "stripes", label: "NIC" },
    Spurs: { alias: "Tottenham" },
  };

  const LEAGUES = {
    pl: { primary: "#c8102e", secondary: "#ffffff", pattern: "split", label: "ENG" },
    ll: { primary: "#c60b1e", secondary: "#ffc400", pattern: "band", label: "ESP" },
    sa: { primary: "#008c45", secondary: "#ffffff", pattern: "bars", label: "ITA" },
    bl: { primary: "#111111", secondary: "#dd0000", pattern: "band", label: "GER" },
    l1: { primary: "#0055a4", secondary: "#ffffff", pattern: "bars", label: "FRA" },
    ucl: { primary: "#0b1f3a", secondary: "#f0d78c", pattern: "band", label: "UCL" },
  };

  function esc(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function luminance(hex) {
    const n = Number.parseInt(String(hex).replace("#", ""), 16);
    if (Number.isNaN(n)) return 128;
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }

  function patternMarkup(pattern, secondary) {
    if (pattern === "stripes") {
      return [48, 54, 60]
        .map((x) => `<rect x="${x}" y="8" width="4.2" height="84" fill="${secondary}"/>`)
        .join("");
    }
    if (pattern === "bars") {
      return `<rect x="13" y="8" width="7" height="84" fill="${secondary}"/><rect x="20" y="8" width="3.2" height="84" fill="#f0d78c"/>`;
    }
    if (pattern === "band") {
      return `<rect x="12" y="40" width="56" height="12" fill="${secondary}"/>`;
    }
    if (pattern === "split") {
      return `<rect x="12" y="48" width="56" height="44" fill="${secondary}"/>`;
    }
    return "";
  }

  function markup(spec) {
    const id = `crest${++seq}`;
    const primary = spec.primary || "#8e8e93";
    const secondary = spec.secondary || "#111111";
    const dark = luminance(primary) < 48;
    const plate = dark ? "#f0d78c" : "#161616";
    const ink = dark ? "#161616" : "#f0d78c";
    const label = esc((spec.label || "FC").slice(0, 4));

    return `<svg class="crest-svg" viewBox="0 0 80 100" role="img" aria-label="${label}">
      <path d="M40 4 L70 15 V49 C70 68 57 83 40 94 C23 83 10 68 10 49 V15 Z" fill="#111"/>
      <clipPath id="${id}"><path d="${SHIELD}"/></clipPath>
      <g clip-path="url(#${id})">
        <rect width="80" height="100" fill="${primary}"/>
        ${patternMarkup(spec.pattern, secondary)}
        <rect x="18" y="16" width="44" height="13" rx="1.5" fill="${plate}"/>
      </g>
      <path d="${SHIELD}" fill="none" stroke="#e4c56a" stroke-width="1.7"/>
      <circle cx="40" cy="54" r="15.5" fill="none" stroke="#e4c56a" stroke-width="2"/>
      <circle cx="40" cy="54" r="12.2" fill="#fff" stroke="#111" stroke-width="1.3"/>
      <polygon points="40,45.2 46.6,49.8 44.2,57.2 35.8,57.2 33.4,49.8" fill="#111"/>
      <text x="40" y="25.8" text-anchor="middle" fill="${ink}" font-family="Inter, Liberation Sans, sans-serif" font-size="9" font-weight="800" letter-spacing="0.8">${label}</text>
    </svg>`;
  }

  function fromTeam(team) {
    const style = STYLE[team.id] || { secondary: "#ffffff", pattern: "band" };
    return {
      primary: team.color,
      secondary: style.secondary,
      pattern: style.pattern,
      label: team.short || team.name.slice(0, 3).toUpperCase(),
    };
  }

  function fallback(name) {
    const palettes = [
      ["#c8102e", "#111111", "stripes"],
      ["#034694", "#ffffff", "bars"],
      ["#6cabdd", "#ffffff", "band"],
      ["#241f20", "#ffffff", "stripes"],
      ["#fde100", "#111111", "band"],
      ["#008c45", "#ffffff", "split"],
    ];
    let h = 0;
    for (const ch of name) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
    const pick = palettes[h % palettes.length];
    const letters = name.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "FC";
    return { primary: pick[0], secondary: pick[1], pattern: pick[2], label: letters };
  }

  function resolve(name) {
    const extra = EXTRAS[name];
    if (extra?.alias) return resolve(extra.alias);
    const data = window.NINETY_DATA;
    const team = data?.teamByName?.[name] || data?.teams?.find((t) => t.name === name);
    if (team) return fromTeam(team);
    if (extra) return extra;
    return fallback(name || "Club");
  }

  function wrap(spec, variant) {
    const size = variant === "lg" ? " crest-lg" : "";
    return `<span class="crest${size}">${markup(spec)}</span>`;
  }

  window.NINETY_CREST = function (name, variant) {
    return wrap(resolve(name), variant);
  };

  window.NINETY_LEAGUE_CREST = function (league) {
    const spec = LEAGUES[league?.id] || { primary: "#1c1c1e", secondary: "#ffffff", pattern: "band", label: league?.flag || "FC" };
    return wrap(spec);
  };
})();
