// Main application logic

// Globals for current game
let currentGame = null; // full game JSON from archives
let flatMoves = []; // computed moves with durations
let moveSanList = []; // SAN list for chess.js moves
let initialTimeSeconds = null;
let currentGameList = [];
let selectedMoveIndex = -1;
let userColor = "w"; // "w" or "b": color the user played in the current game
const DRAW_RESULTS = new Set(["agreed", "repetition", "stalemate", "insufficient", "50move", "timevsinsufficient"]);
const LOSS_RESULTS = new Set(["checkmated", "resigned", "timeout", "lose", "abandoned"]);
const MIN_GAMES_TO_LOAD = 6;
const MAX_ARCHIVES_TO_LOAD = 4; // current month + up to 3 previous months

function getGamePlayerName(player, fallback) {
  if (!player) return fallback;
  if (typeof player === "string") return player;
  return player.username || fallback;
}

function formatGameSelectDate(endTime) {
  if (!endTime) return "";
  const d = new Date(endTime * 1000);
  const month = d.getMonth() + 1;
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${month}/${day} ${hours}:${minutes}`;
}

function getGamePerspective(game, username) {
  const white = getGamePlayerName(game && game.white, "white");
  const black = getGamePlayerName(game && game.black, "black");
  const loadedUsername = (username || "").trim().toLowerCase();
  if (loadedUsername && white.toLowerCase() === loadedUsername) {
    return { white, black, myColor: "w", opponent: black };
  }
  if (loadedUsername && black.toLowerCase() === loadedUsername) {
    return { white, black, myColor: "b", opponent: white };
  }
  return { white, black, myColor: null, opponent: `${white} vs ${black}` };
}

function getOutcomeEmoji(game, myColor) {
  if (!game || !myColor) return "❔";
  const mySide = myColor === "w" ? game.white : game.black;
  const oppSide = myColor === "w" ? game.black : game.white;
  const myResult = mySide && mySide.result ? mySide.result : "";
  const oppResult = oppSide && oppSide.result ? oppSide.result : "";

  if (myResult === "win" || LOSS_RESULTS.has(oppResult)) return "✅";
  if (DRAW_RESULTS.has(myResult) || DRAW_RESULTS.has(oppResult)) return "🤝";
  if (LOSS_RESULTS.has(myResult) || oppResult === "win") return "❌";
  return "❔";
}

function getColorPieceEmoji(myColor) {
  if (myColor === "w") return "♔";
  if (myColor === "b") return "♚";
  return "❔";
}

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

function scrollMoveRowIntoListView(container, row) {
  if (!container || !row) return;
  const containerRect = container.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  const rowTop = rowRect.top - containerRect.top + container.scrollTop;
  const rowBottom = rowTop + rowRect.height;
  const viewTop = container.scrollTop;
  const viewBottom = viewTop + container.clientHeight;

  if (rowTop < viewTop) {
    container.scrollTop = rowTop;
    return;
  }

  if (rowBottom > viewBottom) {
    container.scrollTop = rowBottom - container.clientHeight;
  }
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
  const movesList = el("movesList");
  const activeRow = movesList.querySelector(".move-row.active");
  if (activeRow) scrollMoveRowIntoListView(movesList, activeRow);
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
    // archives is array of URLs ordered oldest->newest
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
    let games = loadedGames;
    // Show most recent games first (chess.com archives are returned in
    // chronological order, oldest first)
    games = games.slice().sort((a, b) => (b.end_time || 0) - (a.end_time || 0));
    // Populate select with recent games (limit 80)
    const select = el("gamesSelect");
    select.innerHTML = "";
    if (games.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No games found in recent archives";
      select.appendChild(opt);
    }
    games.slice(0, 80).forEach((g, i) => {
      const opt = document.createElement("option");
      const perspective = getGamePerspective(g, username);
      const when = formatGameSelectDate(g.end_time);
      const typeLabel = getGameTypeLabel(g);
      const colorEmoji = getColorPieceEmoji(perspective.myColor);
      const outcomeEmoji = getOutcomeEmoji(g, perspective.myColor);
      opt.value = i;
      const labelParts = [`${colorEmoji} ${perspective.opponent}`, typeLabel, outcomeEmoji];
      if (when) labelParts.unshift(when);
      opt.textContent = labelParts.join(" — ");
      opt.dataset.gameIndex = i;
      select.appendChild(opt);
    });
    const archiveWord = archivesLoaded === 1 ? "archive" : "archives";
    el("status").textContent = "Loaded " + games.length + " games from " + archivesLoaded + " recent " + archiveWord + ".";
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
  const perspective = getGamePerspective(game, el("username").value);
  // Determine which color the logged-in user is playing
  if (perspective.myColor === "b") {
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
  flatMoves = computeDurations(parsedMoves, initialTimeSeconds, increment, {
    isDaily: game.time_class === "daily",
  });
  // Build move SAN list (flatten SANs in order) to feed chess.js
  moveSanList = [];
  parsedMoves.forEach((m) => {
    if (m.white && m.white.san) moveSanList.push(m.white.san);
    if (m.black && m.black.san) moveSanList.push(m.black.san);
  });
  setSelectedMoveIndex(flatMoves.length > 0 ? 0 : -1);
  el("status").textContent = flatMoves.length > 0
    ? ""
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

document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  if (e.key === "ArrowLeft") { e.preventDefault(); stepSelectedMove(-1); }
  else if (e.key === "ArrowRight") { e.preventDefault(); stepSelectedMove(1); }
});

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
