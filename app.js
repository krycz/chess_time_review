// Main application logic

// Globals for current game
let currentGame = null; // full game JSON from archives
let flatMoves = []; // computed moves with durations
let moveSanList = []; // SAN list for chess.js moves
let initialTimeSeconds = null;
let currentGameList = [];
let selectedMoveIndex = -1;
let userColor = "w"; // "w" or "b": color the user played in the current game

// Render moves list and durations
function renderMovesList(flatMoves) {
  const container = el("movesList");
  container.innerHTML = "";
  if (!flatMoves || flatMoves.length === 0) {
    container.textContent = "No move data found.";
    return;
  }
  // find max duration for bar scaling
  const maxDur = flatMoves.reduce((m, x) => (x.duration != null && x.duration > m) ? x.duration : m, 0);
  flatMoves.forEach((mv, idx) => {
    const row = document.createElement("div");
    row.className = "move-row";
    const isUserMove = mv.color === userColor;
    row.classList.add(isUserMove ? "move-row-user" : "move-row-opponent");
    if (idx === selectedMoveIndex) row.classList.add("active");
    row.dataset.plyIndex = mv.index;
    const num = document.createElement("div");
    num.className = "move-number small";
    num.textContent = mv.ply + (mv.color === "w" ? "w" : "b");
    const san = document.createElement("div");
    san.className = "move-san";
    san.textContent = mv.san;
    const barWrap = document.createElement("div");
    barWrap.className = "bar-wrap";
    if (mv.duration == null || isNaN(mv.duration)) {
      const emptyBar = document.createElement("div");
      emptyBar.className = "bar-empty";
      barWrap.appendChild(emptyBar);
    } else {
      const widthPercent = durationToBarPercent(mv.duration, maxDur, {
        minPercent: 2,
        maxPercent: 100,
        fallbackPercent: 15,
      });
      const bar = document.createElement("div");
      bar.className = "bar";
      bar.style.width = widthPercent + "%";
      barWrap.appendChild(bar);
    }
    const t = document.createElement("div");
    t.className = "move-time small";
    t.textContent = mv.duration == null ? "-" : fmtSeconds(mv.duration);
    row.appendChild(num);
    row.appendChild(san);
    row.appendChild(barWrap);
    row.appendChild(t);
    row.setAttribute("role", "button");
    row.setAttribute("tabindex", "0");
    row.addEventListener("click", () => setSelectedMoveIndex(idx));
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setSelectedMoveIndex(idx);
      }
    });
    container.appendChild(row);
  });
}

function updateMoveNavigation() {
  const hasSelection = selectedMoveIndex >= 0 && flatMoves.length > 0;
  el("prevMoveBtn").disabled = !hasSelection || selectedMoveIndex === 0;
  el("nextMoveBtn").disabled = !hasSelection || selectedMoveIndex === flatMoves.length - 1;
}

function drawInitialBoard() {
  const chess = new Chess();
  const pgn = currentGame && currentGame.pgn ? currentGame.pgn : "";
  const fen = getPgnTag(pgn, "FEN");
  if (fen) chess.load(fen);
  drawBoard(chess, userColor);
  highlightSquares(null, null);
  svg.innerHTML = "";
}

function renderSelectedMove() {
  renderMovesList(flatMoves);
  updateMoveNavigation();
  if (selectedMoveIndex < 0 || selectedMoveIndex >= flatMoves.length) {
    drawInitialBoard();
    return;
  }
  onMoveClick(flatMoves[selectedMoveIndex].index);
  const activeRow = el("movesList").querySelector(".move-row.active");
  if (activeRow) activeRow.scrollIntoView({ block: "nearest" });
}

function setSelectedMoveIndex(index) {
  if (flatMoves.length === 0) {
    selectedMoveIndex = -1;
    renderSelectedMove();
    return;
  }
  selectedMoveIndex = Math.max(0, Math.min(index, flatMoves.length - 1));
  renderSelectedMove();
}

async function loadArchivesForUser(username) {
  el("status").textContent = "Loading archives...";
  try {
    const url = `https://api.chess.com/pub/player/${encodeURIComponent(username)}/games/archives`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Could not fetch archives: " + res.status);
    const data = await res.json();
    // archives is array of URLs; choose latest (last)
    const archives = data.archives;
    if (!archives || archives.length === 0) throw new Error("No archives found for user.");
    // fetch most recent archive only
    const last = archives[archives.length - 1];
    el("status").textContent = "Loading latest archive...";
    const res2 = await fetch(last);
    if (!res2.ok) throw new Error("Could not fetch latest archive: " + res2.status);
    const monthData = await res2.json();
    let games = monthData.games || [];
    // Show most recent games first (chess.com archives are returned in
    // chronological order, oldest first)
    games = games.slice().sort((a, b) => (b.end_time || 0) - (a.end_time || 0));
    // Populate select with recent games (limit 80)
    const select = el("gamesSelect");
    select.innerHTML = "";
    if (games.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No games found in latest archive";
      select.appendChild(opt);
    }
    games.slice(0, 80).forEach((g, i) => {
      const opt = document.createElement("option");
      const white = g.white && g.white.username ? g.white.username : g.white ? g.white : "white";
      const black = g.black && g.black.username ? g.black.username : g.black ? g.black : "black";
      const when = g.end_time ? new Date(g.end_time * 1000).toLocaleString() : "";
      const typeLabel = getGameTypeLabel(g);
      opt.value = i;
      opt.textContent = `${when} — ${typeLabel} — ${white} vs ${black}`;
      opt.dataset.gameIndex = i;
      select.appendChild(opt);
    });
    el("status").textContent = "Loaded " + games.length + " games from latest archive.";
    // store month games list in currentGamesList for selection usage
    currentGameList = games;
    // auto-select first if present
    if (games.length > 0) {
      select.selectedIndex = 0;
      await onGameSelectChange();
    } else {
      currentGame = null;
      flatMoves = [];
      moveSanList = [];
      selectedMoveIndex = -1;
      renderMovesList(flatMoves);
      updateMoveNavigation();
      el("gameMeta").textContent = "No game loaded.";
      if (typeof Chess !== "undefined") {
        drawInitialBoard();
      } else {
        el("board").innerHTML = "";
        svg.innerHTML = "";
      }
    }
  } catch (err) {
    currentGame = null;
    flatMoves = [];
    moveSanList = [];
    selectedMoveIndex = -1;
    el("status").textContent = "";
    el("movesList").textContent = "Error: " + err.message;
    el("gameMeta").textContent = "No game loaded.";
    updateMoveNavigation();
    if (typeof Chess !== "undefined") {
      drawInitialBoard();
    } else {
      el("board").innerHTML = "";
      svg.innerHTML = "";
    }
  }
}

async function onGameSelectChange() {
  const select = el("gamesSelect");
  const idx = select.selectedIndex;
  if (idx < 0) return;
  const game = currentGameList[idx];
  if (!game) return;
  currentGame = game;
  // Show metadata
  const white = game.white && game.white.username ? game.white.username : "white";
  const black = game.black && game.black.username ? game.black.username : "black";
  const when = game.end_time ? new Date(game.end_time * 1000).toLocaleString() : "";
  const typeLabel = getGameTypeLabel(game);
  el(
    "gameMeta"
  ).textContent = `${white} vs ${black} — ${when} — ${typeLabel}`;
  // Determine which color the logged-in user is playing
  const loadedUsername = el("username").value.trim().toLowerCase();
  if (loadedUsername && black.toLowerCase() === loadedUsername) {
    userColor = "b";
  } else {
    // Default to white if the username matches white or is unrecognised
    userColor = "w";
  }
  // parse PGN
  const pgn = game.pgn || "";
  const parsedMoves = parseMovesWithClocks(pgn);
  // initial time try to detect from TimeControl in PGN or game.time_control
  const timeControl = getPgnTag(pgn, "TimeControl") || game.time_control || null;
  const { initial, increment } = parseTimeControl(timeControl);
  initialTimeSeconds = initial;
  // compute flat moves
  flatMoves = computeDurations(parsedMoves, initialTimeSeconds, increment);
  // Build move SAN list (flatten SANs in order) to feed chess.js
  moveSanList = [];
  parsedMoves.forEach((m) => {
    if (m.white && m.white.san) moveSanList.push(m.white.san);
    if (m.black && m.black.san) moveSanList.push(m.black.san);
  });
  setSelectedMoveIndex(flatMoves.length > 0 ? 0 : -1);
  el("status").textContent = flatMoves.length > 0
    ? "Game loaded. Use the move list or arrows to review moves."
    : "Game loaded, but no move data was found.";
}

// When user clicks a move from the list
function onMoveClick(plyIndex) {
  if (!currentGame) return;
  // build chess instance and apply moves up to the plyIndex (but not the selected move)
  const chess = new Chess();
  // start FEN if present
  const pgn = currentGame.pgn || "";
  const fen = getPgnTag(pgn, "FEN");
  if (fen) chess.load(fen);
  // apply moves up to plyIndex (we want position before move at plyIndex)
  for (let i = 0; i < plyIndex; i++) {
    const san = moveSanList[i];
    if (!san) break;
    const m = chess.move(san, { sloppy: true });
    if (!m) {
      // couldn't apply SAN? attempt sloppy fallback
      // try removing annotations like +, #, ?!
      const clean = san.replace(/[+#?!]+/g, "");
      chess.move(clean, { sloppy: true });
    }
  }
  // now the next move to apply is moveSanList[plyIndex]
  const nextSan = moveSanList[plyIndex];
  let moveObj = null;
  if (nextSan) {
    moveObj = chess.move(nextSan, { sloppy: true });
    // moveObj is the move that was just made; but we want the position before that move (starting position)
    // So undo it to go back to starting position
    if (moveObj) chess.undo();
  }
  // draw position before move
  drawBoard(chess, userColor);
  // draw arrow if we have moveObj or can compute move from sloppy attempt
  if (!moveObj && nextSan) {
    // try to compute legal moves that match SAN
    try {
      moveObj = chess.move(nextSan, { sloppy: true });
      if (moveObj) chess.undo();
    } catch (e) {}
  }
  if (moveObj) {
    drawArrow(moveObj.from, moveObj.to);
  } else {
    highlightSquares(null, null);
    svg.innerHTML = "";
  }
}

function stepSelectedMove(direction) {
  if (flatMoves.length === 0 || selectedMoveIndex < 0) return;
  setSelectedMoveIndex(selectedMoveIndex + direction);
}

// Wire up UI
el("loadGamesBtn").addEventListener("click", () => {
  const username = el("username").value.trim();
  if (!username) {
    alert("Enter a chess.com username");
    return;
  }
  updateUsernameInUrl(username);
  loadArchivesForUser(username);
});
el("gamesSelect").addEventListener("change", onGameSelectChange);
el("prevMoveBtn").addEventListener("click", () => stepSelectedMove(-1));
el("nextMoveBtn").addEventListener("click", () => stepSelectedMove(1));

// Allow pressing enter on username
el("username").addEventListener("keydown", (e) => {
  if (e.key === "Enter") el("loadGamesBtn").click();
});

// Read the username from the URL query string (supports ?user= or ?username=)
function getUsernameFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("user") || params.get("username") || "";
}

// Update the URL (without reloading the page) to reflect the current username
function updateUsernameInUrl(username) {
  const params = new URLSearchParams(window.location.search);
  params.set("user", username);
  const newUrl = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
  window.history.replaceState(null, "", newUrl);
}

// On load, prefill username from URL (if present) and auto-load games; otherwise focus the field
(function () {
  updateMoveNavigation();
  const usernameFromUrl = getUsernameFromUrl();
  if (usernameFromUrl) {
    el("username").value = usernameFromUrl;
    loadArchivesForUser(usernameFromUrl);
  } else {
    el("username").focus();
  }
})();
