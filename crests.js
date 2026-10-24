(function () {
  const OUTER = "M40 1.2 L77 15 V52 C77 75 59 91 40 99.2 C21 91 3 75 3 52 V15 Z";
  const GOLD = "M40 4 L73.5 16.6 V52 C73.5 72.5 57.2 87.2 40 95.6 C22.8 87.2 6.5 72.5 6.5 52 V16.6 Z";
  const INNER = "M40 7.2 L70 18.4 V52 C70 69.8 55.4 83.6 40 92.2 C24.6 83.6 10 69.8 10 52 V18.4 Z";
  let seq = 0;

  const NAMED = {
    arsenal: { primary: "#db0007", secondary: "#ffffff", accent: "#9c824a", pattern: "bars", label: "ARSENAL" },
    bournemouth: { primary: "#d71920", secondary: "#111111", accent: "#d4af37", pattern: "stripes", label: "AFCB" },
    afcbournemouth: { alias: "bournemouth" },
    ukraine: { primary: "#0057b8", secondary: "#ffd100", accent: "#ffd100", pattern: "band", label: "UKRAINE" },
    brazil: { primary: "#009c3b", secondary: "#ffdf00", accent: "#002776", pattern: "cross", label: "BRASIL" },
    brasil: { alias: "brazil" },
    liverpool: { primary: "#c8102e", secondary: "#ffffff", accent: "#d4af37", pattern: "band", label: "LFC" },
    mancity: { primary: "#6cabdd", secondary: "#ffffff", accent: "#1c2c5b", pattern: "bars", label: "CITY" },
    manchestercity: { alias: "mancity" },
    manchesterunited: { primary: "#da291c", secondary: "#d4af37", accent: "#111111", pattern: "stripes", label: "MUFC" },
    manunited: { alias: "manchesterunited" },
    manutd: { alias: "manchesterunited" },
    chelsea: { primary: "#034694", secondary: "#ffffff", accent: "#d4af37", pattern: "bars", label: "CFC" },
    tottenham: { primary: "#132257", secondary: "#ffffff", accent: "#d4af37", pattern: "band", label: "SPURS" },
    spurs: { alias: "tottenham" },
    newcastle: { primary: "#241f20", secondary: "#ffffff", accent: "#d4af37", pattern: "stripes", label: "NUFC" },
    realmadrid: { primary: "#ffffff", secondary: "#c9a227", accent: "#111111", pattern: "bars", label: "MADRID" },
    barcelona: { primary: "#a50044", secondary: "#004d98", accent: "#d4af37", pattern: "stripes", label: "BARCA" },
    atletico: { primary: "#cb3524", secondary: "#ffffff", accent: "#272e61", pattern: "stripes", label: "ATLETI" },
    atleticomadrid: { alias: "atletico" },
    inter: { primary: "#010e80", secondary: "#111111", accent: "#d4af37", pattern: "stripes", label: "INTER" },
    intermilan: { alias: "inter" },
    milan: { primary: "#fb090b", secondary: "#111111", accent: "#d4af37", pattern: "stripes", label: "MILAN" },
    acmilan: { alias: "milan" },
    juventus: { primary: "#111111", secondary: "#ffffff", accent: "#d4af37", pattern: "stripes", label: "JUVE" },
    napoli: { primary: "#12a0d7", secondary: "#ffffff", accent: "#d4af37", pattern: "band", label: "NAPOLI" },
    bayern: { primary: "#dc052d", secondary: "#ffffff", accent: "#d4af37", pattern: "band", label: "BAYERN" },
    bayernmunich: { alias: "bayern" },
    dortmund: { primary: "#fde100", secondary: "#111111", accent: "#111111", pattern: "stripes", label: "BVB" },
    borussiadortmund: { alias: "dortmund" },
    leverkusen: { primary: "#e32221", secondary: "#111111", accent: "#d4af37", pattern: "stripes", label: "B04" },
    bayerleverkusen: { alias: "leverkusen" },
    psg: { primary: "#004170", secondary: "#da1834", accent: "#d4af37", pattern: "bars", label: "PSG" },
    parissaintgermain: { alias: "psg" },
    marseille: { primary: "#2faee0", secondary: "#ffffff", accent: "#d4af37", pattern: "band", label: "OM" },
    monaco: { primary: "#e30613", secondary: "#ffffff", accent: "#d4af37", pattern: "split", label: "ASM" },
    brighton: { primary: "#0057b8", secondary: "#ffffff", accent: "#d4af37", pattern: "bars", label: "BHA" },
    westham: { primary: "#7a263a", secondary: "#7fd3f2", accent: "#d4af37", pattern: "bars", label: "WHU" },
    wolves: { primary: "#fdb913", secondary: "#111111", accent: "#111111", pattern: "stripes", label: "WOLVES" },
    astonvilla: { primary: "#670e36", secondary: "#95bfe5", accent: "#d4af37", pattern: "bars", label: "VILLA" },
    fulham: { primary: "#ffffff", secondary: "#111111", accent: "#111111", pattern: "stripes", label: "FUL" },
  };

  const LEAGUES = {
    pl: { primary: "#c8102e", secondary: "#ffffff", accent: "#d4af37", pattern: "bars", label: "ENG" },
    ll: { primary: "#c60b1e", secondary: "#ffc400", accent: "#d4af37", pattern: "band", label: "ESP" },
    sa: { primary: "#008c45", secondary: "#ffffff", accent: "#d4af37", pattern: "bars", label: "ITA" },
    bl: { primary: "#111111", secondary: "#dd0000", accent: "#d4af37", pattern: "band", label: "GER" },
    l1: { primary: "#0055a4", secondary: "#ffffff", accent: "#ef4135", pattern: "bars", label: "FRA" },
    ucl: { primary: "#0b1f3a", secondary: "#f0d78c", accent: "#f0d78c", pattern: "band", label: "UCL" },
  };

  const PATTERNS = ["stripes", "bars", "band", "split", "cross", "pinstripe"];

  function esc(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function keyOf(name) {
    return String(name || "")
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]/g, "");
  }

  function luminance(hex) {
    const raw = String(hex || "").replace("#", "");
    const n = Number.parseInt(raw.length === 3 ? raw.replace(/./g, (c) => c + c) : raw, 16);
    if (Number.isNaN(n)) return 128;
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }

  function hash(name) {
    let h = 0;
    for (const ch of String(name || "FC")) h = (h * 33 + ch.charCodeAt(0)) >>> 0;
    return h;
  }

  function patternMarkup(pattern, secondary, accent) {
    const s = secondary || "#111111";
    const a = accent || "#d4af37";
    if (pattern === "stripes") {
      return [49, 55.5, 62].map((x) => `<rect x="${x}" y="0" width="5.2" height="100" fill="${s}"/>`).join("");
    }
    if (pattern === "bars") {
      return `<rect x="10" y="0" width="8" height="100" fill="${s}"/><rect x="18" y="0" width="3" height="100" fill="${a}"/>`;
    }
    if (pattern === "band") {
      return `<rect x="0" y="48" width="80" height="12" fill="${s}"/>`;
    }
    if (pattern === "split") {
      return `<rect x="0" y="54" width="80" height="46" fill="${s}"/>`;
    }
    if (pattern === "cross") {
      return `<rect x="33" y="0" width="14" height="100" fill="${a}"/><rect x="0" y="46" width="80" height="14" fill="${s}"/>`;
    }
    let lines = "";
    for (let i = -30; i < 100; i += 7) {
      lines += `<line x1="${i}" y1="108" x2="${i + 36}" y2="28" stroke="${s}" stroke-width="1.35"/>`;
    }
    return lines;
  }

  function stars(count, fill) {
    const gap = 9;
    const start = 40 - ((count - 1) * gap) / 2;
    let out = "";
    for (let i = 0; i < count; i += 1) {
      const x = start + i * gap;
      out += `<polygon points="${x},33.2 ${x + 1.15},36.2 ${x + 4.2},36.4 ${x + 1.8},38.4 ${x + 2.5},41.4 ${x},39.6 ${x - 2.5},41.4 ${x - 1.8},38.4 ${x - 4.2},36.4 ${x - 1.15},36.2" fill="${fill}"/>`;
    }
    return out;
  }

  function football() {
    return `
      <circle cx="40" cy="63" r="15.2" fill="#111"/>
      <circle cx="40" cy="63" r="13.1" fill="#fff" stroke="#111" stroke-width="1.15"/>
      <polygon points="40,53.6 47.1,58.6 44.5,66.8 35.5,66.8 32.9,58.6" fill="#111"/>
      <path d="M40 49.9 V53.6 M27.4 59.2 L32.9 58.6 M52.6 59.2 L47.1 58.6 M31.2 73.4 L35.5 66.8 M48.8 73.4 L44.5 66.8" fill="none" stroke="#111" stroke-width="1.05" stroke-linecap="round"/>
    `;
  }

  function fitLabel(raw, variant) {
    const text = String(raw || "FC")
      .toUpperCase()
      .replace(/[^A-Z0-9 ]/g, "")
      .trim();
    const compact = text.replace(/\s+/g, "");
    const limit = variant === "lg" ? 11 : variant === "xs" ? 3 : 4;
    if (!compact) return "FC";
    return compact.length <= limit ? compact : compact.slice(0, 3);
  }

  function markup(spec, variant) {
    const id = `crest${++seq}`;
    const primary = spec.primary || "#8e1f2f";
    const secondary = spec.secondary || (luminance(primary) > 160 ? "#111111" : "#ffffff");
    const accent = spec.accent || "#d4af37";
    const pattern = spec.pattern || "band";
    const label = esc(fitLabel(spec.label, variant));
    const fontSize = label.length <= 3 ? 8.2 : label.length <= 6 ? 6.3 : 5.15;
    const cap = luminance(primary) < 42 ? "#d4af37" : "#141414";
    const ink = luminance(cap) < 80 ? "#d4af37" : "#1a1a1a";
    const starFill = pattern === "cross" ? "#009c3b" : accent;
    const starCount = pattern === "cross" ? 5 : 0;

    return `<svg class="crest-svg" viewBox="0 0 80 100" role="img" aria-label="${label}">
      <path d="${OUTER}" fill="#111"/>
      <path d="${GOLD}" fill="#d4af37"/>
      <clipPath id="${id}"><path d="${INNER}"/></clipPath>
      <g clip-path="url(#${id})">
        <rect width="80" height="100" fill="${primary}"/>
        ${patternMarkup(pattern, secondary, accent)}
        <path d="M11 20 C22 11 58 11 69 20 L66 33 C54 26 26 26 14 33 Z" fill="${cap}"/>
        ${starCount ? stars(starCount, starFill) : ""}
        ${football()}
      </g>
      <path d="${INNER}" fill="none" stroke="#d4af37" stroke-width="1.35"/>
      <path id="${id}arc" d="M18 29.5 Q40 16.5 62 29.5" fill="none"/>
      <text fill="${ink}" font-family="Impact, Haettenschweiler, Arial Black, sans-serif" font-size="${fontSize}" font-weight="700" letter-spacing="0.4">
        <textPath href="#${id}arc" startOffset="50%" text-anchor="middle">${label}</textPath>
      </text>
    </svg>`;
  }

  function named(name) {
    let current = keyOf(name);
    const seen = new Set();
    while (current && NAMED[current] && !seen.has(current)) {
      seen.add(current);
      if (NAMED[current].alias) {
        current = NAMED[current].alias;
        continue;
      }
      return { ...NAMED[current] };
    }
    const hit = Object.keys(NAMED).find((k) => !NAMED[k].alias && k.length >= 6 && current.includes(k));
    return hit ? { ...NAMED[hit] } : null;
  }

  function fromHint(name, hint) {
    const known = named(name);
    if (known) return known;
    const h = hash(name);
    const primary = hint?.primary || ["#c8102e", "#034694", "#111111", "#fde100", "#008c45", "#0057b8"][h % 6];
    const letters = String(hint?.label || name || "FC")
      .replace(/[^A-Za-z0-9]/g, "")
      .slice(0, 8)
      .toUpperCase();
    return {
      primary,
      secondary: luminance(primary) > 170 ? "#111111" : "#ffffff",
      accent: "#d4af37",
      pattern: PATTERNS[h % PATTERNS.length],
      label: letters || "FC",
    };
  }

  function wrap(spec, variant) {
    const size =
      variant === "lg" ? " crest-lg" : variant === "sm" ? " crest-sm" : variant === "xs" ? " crest-xs" : "";
    return `<span class="crest${size}">${markup(spec, variant)}</span>`;
  }

  window.NINETY_CREST = function (name, variant, hint) {
    return wrap(fromHint(name, hint), variant || "");
  };

  window.NINETY_LEAGUE_CREST = function (league, variant) {
    const spec = LEAGUES[league?.id] || {
      primary: "#1c1c1e",
      secondary: "#d4af37",
      accent: "#d4af37",
      pattern: "band",
      label: league?.flag || league?.name || "FC",
    };
    return wrap(spec, variant || "xs");
  };
})();
