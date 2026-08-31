const DRAW_RESULTS = new Set(["agreed", "repetition", "stalemate", "insufficient", "50move", "timevsinsufficient"]);
const LOSS_RESULTS = new Set(["checkmated", "resigned", "timeout", "lose", "abandoned"]);
const MIN_GAMES_TO_LOAD = 20;
const MAX_ARCHIVES_TO_LOAD = 6;

// ── URL helpers (mirrors app.js) ─────────────────────────────────────────
function getUsernameFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("user") || params.get("username") || "";
}

function updateUsernameInUrl(username) {
  const params = new URLSearchParams(window.location.search);
  params.set("user", username);
  const newUrl = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
  window.history.replaceState(null, "", newUrl);
}

// ── Game helpers ─────────────────────────────────────────────────────────
function getGamePlayerName(player, fallback) {
  if (!player) return fallback;
  if (typeof player === "string") return player;
  return player.username || fallback;
}

function getOutcomeClass(game, username) {
  const white = getGamePlayerName(game.white, "").toLowerCase();
  const uname = (username || "").trim().toLowerCase();
  const myColor = uname && white === uname ? "w" : "b";
  const mySide = myColor === "w" ? game.white : game.black;
  const oppSide = myColor === "w" ? game.black : game.white;
  const myResult  = (mySide  && mySide.result)  || "";
  const oppResult = (oppSide && oppSide.result) || "";
  if (myResult === "win" || LOSS_RESULTS.has(oppResult)) return "win";
  if (DRAW_RESULTS.has(myResult) || DRAW_RESULTS.has(oppResult)) return "draw";
  if (LOSS_RESULTS.has(myResult) || oppResult === "win") return "loss";
  return "unknown";
}

// chess.com game URLs look like:
//   https://www.chess.com/game/daily/12345678
// The URL is usually in the PGN [Link "..."] tag, falling back to constructing from game.url.
function getGameUrl(game) {
  const pgn = game.pgn || "";
  const m = pgn.match(/\[Link\s+"([^"]+)"\]/);
  return (m && m[1]) || game.url || null;
}

// ── Gantt rendering ──────────────────────────────────────────────────────

function buildTimeline(games, username) {
  // Only daily games
  const daily = games.filter(g => g.time_class === "daily");
  const chart = el("timelineChart");
  const emptyMsg = el("timeline-empty");

  if (daily.length === 0) {
    chart.style.display = "none";
    emptyMsg.style.display = "";
    return;
  }
  emptyMsg.style.display = "none";
  chart.style.display = "";
  chart.innerHTML = "";

  // Games with both start_time and end_time
  const dated = daily.filter(g => g.end_time);
  // Estimate start_time: chess.com API provides end_time; start_time may or may not be present.
  // Use start_time if available, otherwise fall back to end_time minus a nominal duration.
  // The PGN [Date "..."] + [StartTime "..."] tags can also give start datetime.
  function getStartTime(g) {
    if (g.start_time) return g.start_time;
    // Try PGN tags
    const pgn = g.pgn || "";
    const dateTag = getPgnTag(pgn, "Date");      // e.g. "2024.05.01"
    const startTag = getPgnTag(pgn, "StartTime");// e.g. "09:25:00"
    if (dateTag && startTag) {
      // The StartTime tag is in local time, not UTC — parse without "Z"
      const iso = dateTag.replace(/\./g, "-") + "T" + startTag;
      const ts = Math.floor(Date.parse(iso) / 1000);
      if (!isNaN(ts)) return ts;
    }
    // Fall back: estimate start as end_time minus 1 day (daily games can last up to days)
    return g.end_time - 86400;
  }

  const withTimes = dated.map(g => ({
    game: g,
    start: getStartTime(g),
    end: g.end_time,
  })).filter(d => d.start < d.end);

  if (withTimes.length === 0) {
    chart.style.display = "none";
    emptyMsg.style.display = "";
    return;
  }

  // Group by calendar date of end_time (local)
  const byDate = {};
  withTimes.forEach(d => {
    const dt = new Date(d.end * 1000);
    const key = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
    (byDate[key] = byDate[key] || []).push(d);
  });

  // Sort dates newest first
  const dateKeys = Object.keys(byDate).sort((a, b) => b.localeCompare(a));

  // Determine global time range in seconds-of-day [0, 86400]
  // We map each game to its fractional second-of-day for start and end using local time.
  function toSecOfDay(ts) {
    const d = new Date(ts * 1000);
    return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
  }

  // Compute the actual extent across all games so we can zoom the axis
  let minSec = Infinity, maxSec = -Infinity;
  withTimes.forEach(d => {
    const s = toSecOfDay(d.start);
    const e = toSecOfDay(d.end);
    minSec = Math.min(minSec, s, e);
    maxSec = Math.max(maxSec, s, e);
  });
  // pad a little
  minSec = Math.max(0, minSec - 1800);
  maxSec = Math.min(86400, maxSec + 1800);
  const spanSec = maxSec - minSec || 1;

  function toPercent(ts) {
    const sod = toSecOfDay(ts);
    return Math.max(0, Math.min(100, ((sod - minSec) / spanSec) * 100));
  }

  // ── Axis ──────────────────────────────────────────────────────────────
  const axisEl = document.createElement("div");
  axisEl.className = "timeline-axis";

  // Pick a reasonable tick interval (in seconds)
  const tickIntervals = [900, 1800, 3600, 7200];
  let tickInterval = 3600;
  for (const t of tickIntervals) {
    if (spanSec / t <= 24) { tickInterval = t; break; }
  }

  const tickPositions = [];
  const firstTick = Math.ceil(minSec / tickInterval) * tickInterval;
  for (let t = firstTick; t <= maxSec; t += tickInterval) {
    tickPositions.push(t);
    const pct = ((t - minSec) / spanSec) * 100;
    const hh = Math.floor(t / 3600) % 24;
    const mm = String(Math.floor((t % 3600) / 60)).padStart(2, "0");
    const label = document.createElement("div");
    label.className = "axis-tick";
    label.style.left = pct + "%";
    label.style.bottom = "6px";
    label.textContent = `${String(hh).padStart(2, "0")}:${mm}`;
    axisEl.appendChild(label);

    const tick = document.createElement("div");
    tick.className = "axis-tick-line";
    tick.style.left = pct + "%";
    axisEl.appendChild(tick);
  }
  chart.appendChild(axisEl);

  // ── Rows ──────────────────────────────────────────────────────────────
  const rowsEl = document.createElement("div");
  rowsEl.className = "timeline-rows";

  const tooltip = el("gameTooltip");

  dateKeys.forEach(dateKey => {
    const row = document.createElement("div");
    row.className = "timeline-row";

    // Label
    const label = document.createElement("div");
    label.className = "row-label";
    // Format as "Mon 1 May"
    const [yr, mo, dy] = dateKey.split("-").map(Number);
    const labelDate = new Date(yr, mo - 1, dy);
    label.textContent = labelDate.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
    label.title = dateKey;
    row.appendChild(label);

    // Track
    const track = document.createElement("div");
    track.className = "row-track";

    // Grid lines
    tickPositions.forEach(t => {
      const gl = document.createElement("div");
      gl.className = "grid-line";
      gl.style.left = ((t - minSec) / spanSec * 100) + "%";
      track.appendChild(gl);
    });

    // Game bars
    byDate[dateKey].forEach(d => {
      const { game, start, end } = d;
      // For games that span midnight the start second-of-day > end second-of-day.
      // In that case clamp the start to the axis left edge so the bar still renders.
      const startSod = toSecOfDay(start);
      const endSod   = toSecOfDay(end);
      const adjustedStart = startSod > endSod ? start - startSod : start;
      const leftPct = toPercent(adjustedStart);
      const rightPct = toPercent(end);
      const widthPct = Math.max(0.3, rightPct - leftPct);

      const outcome = getOutcomeClass(game, username);
      const bar = document.createElement("a");
      bar.className = `game-bar game-bar-${outcome}`;
      bar.style.left = leftPct + "%";
      bar.style.width = widthPct + "%";

      const gameUrl = getGameUrl(game);
      if (gameUrl) {
        bar.href = gameUrl;
        bar.target = "_blank";
        bar.rel = "noopener noreferrer";
      }

      // Bar inner label
      const durSec = end - start;
      const barLabel = document.createElement("span");
      barLabel.className = "game-bar-label";
      const opponent = getGamePlayerName(
        (username || "").trim().toLowerCase() === getGamePlayerName(game.white, "").toLowerCase()
          ? game.black : game.white,
        "?"
      );
      barLabel.textContent = `vs ${opponent}`;
      bar.appendChild(barLabel);

      // Tooltip
      function showTooltipAt(x, y) {
        const startLocal = new Date(start * 1000).toLocaleString();
        const endLocal   = new Date(end   * 1000).toLocaleString();
        const durStr = fmtSeconds(durSec);
        const outcomeLabel = outcome === "win" ? "Win ✅" : outcome === "loss" ? "Loss ❌" : outcome === "draw" ? "Draw 🤝" : "Unknown ❔";
        tooltip.textContent = [
          `vs ${opponent}`,
          `Started: ${startLocal}`,
          `Ended:   ${endLocal}`,
          `Duration: ${durStr}`,
          outcomeLabel,
        ].join("\n");
        tooltip.style.left = (x + 14) + "px";
        tooltip.style.top  = (y + 14) + "px";
        tooltip.style.display = "block";
      }

      bar.addEventListener("mouseenter", (e) => {
        showTooltipAt(e.clientX, e.clientY);
      });
      bar.addEventListener("mousemove", (e) => {
        tooltip.style.left = (e.clientX + 14) + "px";
        tooltip.style.top  = (e.clientY + 14) + "px";
      });
      bar.addEventListener("focus", () => {
        const r = bar.getBoundingClientRect();
        showTooltipAt(r.right, r.top);
      });
      bar.addEventListener("blur", () => {
        tooltip.style.display = "none";
      });
      bar.addEventListener("mouseleave", () => {
        tooltip.style.display = "none";
      });

      track.appendChild(bar);
    });

    row.appendChild(track);
    rowsEl.appendChild(row);
  });

  chart.appendChild(rowsEl);
}

// ── Load games ───────────────────────────────────────────────────────────
async function loadArchivesForUser(username) {
  el("status").textContent = "Loading archives...";
  el("timelineChart").style.display = "none";
  el("timeline-empty").style.display = "none";
  try {
    const url = `https://api.chess.com/pub/player/${encodeURIComponent(username)}/games/archives`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Could not fetch archives: " + res.status);
    const data = await res.json();
    const archives = data.archives;
    if (!archives || archives.length === 0) throw new Error("No archives found for user.");

    const { games: loadedGames, archivesLoaded } = await loadRecentGamesFromArchives(fetch, archives, {
      minGames: MIN_GAMES_TO_LOAD,
      maxArchives: MAX_ARCHIVES_TO_LOAD,
      onArchiveLoadStart: (archiveIndex) => {
        el("status").textContent = archiveIndex === 0
          ? "Loading latest archive..."
          : "Loading previous archive...";
      },
    });

    const archiveWord = archivesLoaded === 1 ? "archive" : "archives";
    const dailyCount = loadedGames.filter(g => g.time_class === "daily").length;
    el("status").textContent =
      `Loaded ${loadedGames.length} games (${dailyCount} daily) from ${archivesLoaded} recent ${archiveWord}.`;

    buildTimeline(loadedGames, username);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    el("status").textContent = "Error: " + msg;
  }
}

// ── Event wiring ─────────────────────────────────────────────────────────
el("loadGamesBtn").addEventListener("click", () => {
  const username = el("username").value.trim();
  if (!username) { alert("Enter a chess.com username"); return; }
  updateUsernameInUrl(username);
  loadArchivesForUser(username);
});

el("username").addEventListener("keydown", (e) => {
  if (e.key === "Enter") el("loadGamesBtn").click();
});

// On load, auto-populate from URL
(function () {
  const usernameFromUrl = getUsernameFromUrl();
  if (usernameFromUrl) {
    el("username").value = usernameFromUrl;
    loadArchivesForUser(usernameFromUrl);
  } else {
    el("username").focus();
  }
})();
