const DRAW_RESULTS = new Set(["agreed", "repetition", "stalemate", "insufficient", "50move", "timevsinsufficient"]);
const LOSS_RESULTS = new Set(["checkmated", "resigned", "timeout", "lose", "abandoned"]);
const MIN_GAMES_TO_LOAD = 20;
const MIN_ARCHIVES_TO_LOAD = 3; // always load at least the last 3 months
const MAX_ARCHIVES_TO_LOAD = 6;

// ── Load-more state ────────────────────────────────────────────────────────
// Tracks the current user's session so the "load additional month" button can
// fetch further-back archives on demand and append them to the timeline.
let sessionArchives = null;   // full list of archive URLs, oldest -> newest
let sessionGames = [];        // all games loaded so far, across all archives
let sessionArchivesLoaded = 0; // how many of the most-recent archives are loaded
let sessionUsername = "";

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
  // Only daily games between human players.
  const daily = games.filter(g => g.time_class === "daily" && !isBotGame(g));
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

  // Games with end_time
  const dated = daily.filter(g => g.end_time);

  function getStartTime(g) {
    if (g.start_time) return g.start_time;
    const pgn = g.pgn || "";
    const dateTag = getPgnTag(pgn, "Date");
    const startTag = getPgnTag(pgn, "StartTime");
    if (dateTag && startTag) {
      const iso = dateTag.replace(/\./g, "-") + "T" + startTag;
      const ts = Math.floor(Date.parse(iso) / 1000);
      if (!isNaN(ts)) return ts;
    }
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

  // ── View state (Unix seconds) ──────────────────────────────────────────
  // The visible window [viewStart, viewEnd] is a range of Unix timestamps.
  // Initial view: pad slightly around the full data range.
  const dataMin = Math.min(...withTimes.map(d => d.start));
  const dataMax = Math.max(...withTimes.map(d => d.end));
  const dataPad = Math.max((dataMax - dataMin) * 0.04, 3600 * 6);

  let viewStart = dataMin - dataPad;
  let viewEnd   = dataMax + dataPad;

  // ── Helpers ────────────────────────────────────────────────────────────
  function viewSpan() { return viewEnd - viewStart || 1; }

  // Convert a Unix timestamp to a CSS left-percentage within the current view.
  function toPct(ts) {
    return ((ts - viewStart) / viewSpan()) * 100;
  }

  // ── Root elements ──────────────────────────────────────────────────────
  // Nav bar (prev / zoom out / zoom in / next)
  const navBar = document.createElement("div");
  navBar.className = "timeline-nav";
  navBar.innerHTML = `
    <button class="tl-nav-btn" id="tl-prev" title="Pan left">&#8592;</button>
    <button class="tl-nav-btn" id="tl-zoom-out" title="Zoom out">&#8722;</button>
    <button class="tl-nav-btn" id="tl-zoom-in" title="Zoom in">+</button>
    <button class="tl-nav-btn" id="tl-next" title="Pan right">&#8594;</button>
  `;
  chart.appendChild(navBar);

  // Scrollable viewport
  const viewport = document.createElement("div");
  viewport.className = "timeline-viewport";
  chart.appendChild(viewport);

  // Axis
  const axisEl = document.createElement("div");
  axisEl.className = "timeline-axis";
  viewport.appendChild(axisEl);

  // Rows container
  const rowsEl = document.createElement("div");
  rowsEl.className = "timeline-rows";
  viewport.appendChild(rowsEl);

  // Tooltip
  const tooltip = el("gameTooltip");

  // ── Build game rows ────────────────────────────────────────────────────
  // Pack intervals into rows so games with non-overlapping time ranges share a row,
  // while overlapping games stay on separate rows to remain readable.
  const sorted = [...withTimes].sort((a, b) => a.start - b.start);

  const rowEndTimes = [];
  const rowData = [];
  sorted.forEach(d => {
    const { game, start, end } = d;
    const outcome = getOutcomeClass(game, username);
    const opponent = getGamePlayerName(
      (username || "").trim().toLowerCase() === getGamePlayerName(game.white, "").toLowerCase()
        ? game.black : game.white,
      "?"
    );
    const durSec = end - start;
    const gameUrl = getGameUrl(game);

    let rowIndex = rowEndTimes.findIndex(rowEnd => rowEnd <= start);
    if (rowIndex === -1) {
      rowIndex = rowEndTimes.length;
      rowEndTimes.push(end);
    } else {
      rowEndTimes[rowIndex] = end;
    }

    rowData.push({ game, start, end, outcome, opponent, durSec, gameUrl, rowIndex });
  });

  const rowsByIndex = new Map();
  rowData.forEach(item => {
    if (!rowsByIndex.has(item.rowIndex)) rowsByIndex.set(item.rowIndex, []);
    rowsByIndex.get(item.rowIndex).push(item);
  });

  const packedRows = Array.from(rowsByIndex.entries()).sort(([a], [b]) => a - b).map(([, items]) => items);

  function showTooltipAt({ start, end, durSec, outcome, opponent }, x, y) {
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

  // ── Render function ────────────────────────────────────────────────────
  function render() {
    const span = viewSpan();

    // ── Axis ticks ──────────────────────────────────────────────────────
    axisEl.innerHTML = "";

    // Choose a tick interval based on the visible span.
    // Aim for roughly 6–12 ticks across the view.
    const TARGET_TICKS = 9;
    const rawInterval = span / TARGET_TICKS;
    // Candidate intervals: 1h, 2h, 4h, 6h, 12h, 1d, 2d, 3d, 7d, 14d, 30d
    const CANDIDATES = [
      3600, 7200, 14400, 21600, 43200,
      86400, 172800, 259200, 604800, 1209600, 2592000,
    ];
    let tickInterval = CANDIDATES[CANDIDATES.length - 1];
    for (const c of CANDIDATES) {
      if (c >= rawInterval) { tickInterval = c; break; }
    }

    // Snap the first tick to a clean boundary.
    // For sub-day intervals, snap to midnight + N * interval.
    // For multi-day intervals, snap to start-of-day.
    const firstTickRaw = Math.ceil(viewStart / tickInterval) * tickInterval;
    // Snap to a clean clock boundary aligned to midnight local time.
    const midnightOffset = new Date(firstTickRaw * 1000);
    midnightOffset.setHours(0, 0, 0, 0);
    const midnightTs = midnightOffset.getTime() / 1000;
    const firstTick = midnightTs + Math.ceil((firstTickRaw - midnightTs) / tickInterval) * tickInterval;

    for (let t = firstTick; t <= viewEnd + tickInterval; t += tickInterval) {
      const pct = toPct(t);
      if (pct < -5 || pct > 105) continue;

      const d = new Date(t * 1000);
      let label;
      if (tickInterval < 86400) {
        // Show date + time for sub-day ticks
        const hh = String(d.getHours()).padStart(2, "0");
        const mm = String(d.getMinutes()).padStart(2, "0");
        const mon = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
        label = d.getHours() === 0 && d.getMinutes() === 0 ? mon : `${hh}:${mm}`;
      } else {
        label = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      }

      const tickEl = document.createElement("div");
      tickEl.className = "axis-tick";
      tickEl.style.left = pct + "%";
      tickEl.textContent = label;
      axisEl.appendChild(tickEl);

      const tickLine = document.createElement("div");
      tickLine.className = "axis-tick-line";
      tickLine.style.left = pct + "%";
      axisEl.appendChild(tickLine);
    }

    // ── Rows ────────────────────────────────────────────────────────────
    rowsEl.innerHTML = "";

    packedRows.forEach((items) => {
      const hasVisibleItem = items.some(({ start, end }) => {
        const leftPct = toPct(start);
        const rightPct = toPct(end);
        return rightPct >= -1 && leftPct <= 101;
      });
      if (!hasVisibleItem) return;
      const row = document.createElement("div");
      row.className = "timeline-row";

      // Grid lines for this row (reuse same tick positions)
      for (let t = firstTick; t <= viewEnd + tickInterval; t += tickInterval) {
        const pct = toPct(t);
        if (pct < -1 || pct > 101) continue;
        const gl = document.createElement("div");
        gl.className = "grid-line";
        gl.style.left = pct + "%";
        row.appendChild(gl);
      }

      items.forEach(({ game, start, end, outcome, opponent, durSec, gameUrl }) => {
        const leftPct  = toPct(start);
        const rightPct = toPct(end);
        const widthPct = Math.max(0.3, rightPct - leftPct);

        // Skip bars that are entirely outside the view
        if (rightPct < -1 || leftPct > 101) return;

        const bar = document.createElement("a");
        bar.className = `game-bar game-bar-${outcome}`;
        bar.style.left = leftPct + "%";
        bar.style.width = widthPct + "%";

        if (gameUrl) {
          bar.href = gameUrl;
          bar.target = "_blank";
          bar.rel = "noopener noreferrer";
        }

        const barLabel = document.createElement("span");
        barLabel.className = "game-bar-label";
        barLabel.textContent = `vs ${opponent}`;
        bar.appendChild(barLabel);

        bar.addEventListener("mouseenter", e => showTooltipAt({ start, end, durSec, outcome, opponent }, e.clientX, e.clientY));
        bar.addEventListener("mousemove",  e => {
          tooltip.style.left = (e.clientX + 14) + "px";
          tooltip.style.top  = (e.clientY + 14) + "px";
        });
        bar.addEventListener("focus", () => {
          const r = bar.getBoundingClientRect();
          showTooltipAt({ start, end, durSec, outcome, opponent }, r.right, r.top);
        });
        bar.addEventListener("blur",       () => { tooltip.style.display = "none"; });
        bar.addEventListener("mouseleave", () => { tooltip.style.display = "none"; });

        row.appendChild(bar);
      });

      rowsEl.appendChild(row);
    });
  }

  // ── Zoom & pan helpers ─────────────────────────────────────────────────
  function clampView() {
    const minSpan = 3600 * 2;   // 2 hours minimum zoom
    const maxSpan = (dataMax - dataMin + 2 * dataPad) * 2;
    if (viewEnd - viewStart < minSpan) {
      const mid = (viewStart + viewEnd) / 2;
      viewStart = mid - minSpan / 2;
      viewEnd   = mid + minSpan / 2;
    }
    if (viewEnd - viewStart > maxSpan) {
      const mid = (viewStart + viewEnd) / 2;
      viewStart = mid - maxSpan / 2;
      viewEnd   = mid + maxSpan / 2;
    }
  }

  function zoom(factor, pivotTs) {
    // factor < 1 → zoom in; factor > 1 → zoom out
    const pivot = pivotTs !== undefined ? pivotTs : (viewStart + viewEnd) / 2;
    viewStart = pivot - (pivot - viewStart) * factor;
    viewEnd   = pivot + (viewEnd   - pivot) * factor;
    clampView();
    render();
  }

  function pan(fraction) {
    const delta = viewSpan() * fraction;
    viewStart += delta;
    viewEnd   += delta;
    render();
  }

  // ── Nav buttons ────────────────────────────────────────────────────────
  navBar.querySelector("#tl-prev").addEventListener("click",     () => pan(-0.3));
  navBar.querySelector("#tl-next").addEventListener("click",     () => pan(+0.3));
  navBar.querySelector("#tl-zoom-in").addEventListener("click",  () => zoom(0.6));
  navBar.querySelector("#tl-zoom-out").addEventListener("click", () => zoom(1.6));

  // ── Mouse wheel zoom ───────────────────────────────────────────────────
  viewport.addEventListener("wheel", e => {
    e.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    const pivotTs = viewStart + frac * viewSpan();
    const factor = e.deltaY > 0 ? 1.25 : 0.8;
    zoom(factor, pivotTs);
  }, { passive: false });

  // ── Drag to pan ────────────────────────────────────────────────────────
  let dragStartX = null;
  let dragStartViewStart = null;
  let dragStartViewEnd = null;

  viewport.addEventListener("mousedown", e => {
    if (e.button !== 0) return;
    dragStartX = e.clientX;
    dragStartViewStart = viewStart;
    dragStartViewEnd   = viewEnd;
    viewport.style.cursor = "grabbing";
  });

  function onWindowMouseMove(e) {
    if (dragStartX === null) return;
    const rect = viewport.getBoundingClientRect();
    const dx = e.clientX - dragStartX;
    const span = dragStartViewEnd - dragStartViewStart;
    const delta = -(dx / rect.width) * span;
    viewStart = dragStartViewStart + delta;
    viewEnd   = dragStartViewEnd   + delta;
    render();
  }

  function onWindowMouseUp() {
    if (dragStartX === null) return;
    dragStartX = null;
    viewport.style.cursor = "";
  }

  window.addEventListener("mousemove", onWindowMouseMove);
  window.addEventListener("mouseup",   onWindowMouseUp);

  // Clean up window listeners when the chart is rebuilt (loadGamesBtn re-calls buildTimeline).
  // Use a MutationObserver to detect when the chart element is emptied/replaced.
  const cleanupObserver = new MutationObserver(() => {
    if (!chart.contains(viewport)) {
      window.removeEventListener("mousemove", onWindowMouseMove);
      window.removeEventListener("mouseup",   onWindowMouseUp);
      cleanupObserver.disconnect();
    }
  });
  cleanupObserver.observe(chart, { childList: true });

  // ── Touch pan ──────────────────────────────────────────────────────────
  let touchStartX = null;
  let touchViewStart = null;
  let touchViewEnd = null;

  viewport.addEventListener("touchstart", e => {
    if (e.touches.length !== 1) return;
    touchStartX = e.touches[0].clientX;
    touchViewStart = viewStart;
    touchViewEnd   = viewEnd;
  }, { passive: true });

  viewport.addEventListener("touchmove", e => {
    if (touchStartX === null || e.touches.length !== 1) return;
    e.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const dx = e.touches[0].clientX - touchStartX;
    const span = touchViewEnd - touchViewStart;
    const delta = -(dx / rect.width) * span;
    viewStart = touchViewStart + delta;
    viewEnd   = touchViewEnd   + delta;
    render();
  }, { passive: false });

  viewport.addEventListener("touchend", () => { touchStartX = null; }, { passive: true });

  // ── Initial render ─────────────────────────────────────────────────────
  render();
}

// ── Load games ───────────────────────────────────────────────────────────
function updateLoadMoreButton() {
  const btn = el("loadMoreBtn");
  const hasMoreArchives = !!sessionArchives &&
    sessionArchivesLoaded < sessionArchives.length;
  btn.style.display = hasMoreArchives ? "" : "none";
  btn.disabled = false;
  btn.textContent = "Load additional month";
}

function updateStatusText(archivesLoaded) {
  const archiveWord = archivesLoaded === 1 ? "archive" : "archives";
  const dailyCount = sessionGames.filter(g => g.time_class === "daily").length;
  el("status").textContent =
    `Loaded ${sessionGames.length} games (${dailyCount} daily) from ${archivesLoaded} recent ${archiveWord}.`;
}

async function loadArchivesForUser(username) {
  el("status").textContent = "Loading archives...";
  el("timelineChart").style.display = "none";
  el("timeline-empty").style.display = "none";
  el("loadMoreBtn").style.display = "none";
  sessionArchives = null;
  sessionGames = [];
  sessionArchivesLoaded = 0;
  sessionUsername = username;
  try {
    const url = `https://api.chess.com/pub/player/${encodeURIComponent(username)}/games/archives`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Could not fetch archives: " + res.status);
    const data = await res.json();
    let archives = data.archives || [];
    archives = ensureCurrentMonthArchive(archives, username);
    if (!archives || archives.length === 0) throw new Error("No archives found for user.");

    const { games: loadedGames, archivesLoaded } = await loadRecentGamesFromArchives(fetch, archives, {
      minGames: MIN_GAMES_TO_LOAD,
      minArchives: MIN_ARCHIVES_TO_LOAD,
      maxArchives: MAX_ARCHIVES_TO_LOAD,
      onArchiveLoadStart: (archiveIndex) => {
        el("status").textContent = archiveIndex === 0
          ? "Loading latest archive..."
          : "Loading previous archive...";
      },
    });

    sessionArchives = archives;
    sessionGames = loadedGames;
    sessionArchivesLoaded = archivesLoaded;

    updateStatusText(archivesLoaded);
    updateLoadMoreButton();
    buildTimeline(sessionGames, username);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    el("status").textContent = "Error: " + msg;
  }
}

async function loadAdditionalMonth() {
  if (!sessionArchives || sessionArchivesLoaded >= sessionArchives.length) return;
  const btn = el("loadMoreBtn");
  btn.disabled = true;
  btn.textContent = "Loading...";
  el("status").textContent = "Loading previous archive...";
  try {
    // Archives are ordered oldest -> newest; the next one to load is the one
    // just before the oldest archive already loaded.
    const nextIndex = sessionArchives.length - 1 - sessionArchivesLoaded;
    const archiveUrl = sessionArchives[nextIndex];
    const res = await fetch(archiveUrl);
    if (!res.ok) throw new Error("Could not fetch archive: " + res.status);
    const monthData = await res.json();
    const monthGames = monthData && Array.isArray(monthData.games) ? monthData.games : [];

    // Merge newly loaded games into the current session; buildTimeline sorts by end time.
    sessionGames = sessionGames.concat(monthGames);
    sessionArchivesLoaded++;

    updateStatusText(sessionArchivesLoaded);
    updateLoadMoreButton();
    buildTimeline(sessionGames, sessionUsername);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    el("status").textContent = "Error: " + msg;
    updateLoadMoreButton();
  }
}

// ── Event wiring ─────────────────────────────────────────────────────────
el("loadGamesBtn").addEventListener("click", () => {
  const username = el("username").value.trim();
  if (!username) { alert("Enter a chess.com username"); return; }
  updateUsernameInUrl(username);
  loadArchivesForUser(username);
});

el("loadMoreBtn").addEventListener("click", () => {
  loadAdditionalMonth();
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
