// Helper utilities

function el(id) {
  return document.getElementById(id);
}

// Format seconds to HH:MM:SS or MM:SS display
// Correctly handles negative times (e.g., -4:23 from incremental clocks)
function fmtSeconds(s) {
  if (s == null || isNaN(s)) return "-";
  const sign = s < 0 ? "-" : "";
  s = Math.abs(Math.round(s));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return hh > 0
    ? sign + String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0") + ":" + String(ss).padStart(2, "0")
    : sign + String(mm).padStart(1, "0") + ":" + String(ss).padStart(2, "0");
}

// Parse clock "H:MM:SS" or "MM:SS" to seconds
function parseClockToSeconds(s) {
  if (!s) return null;
  const parts = s.split(":").map((p) => parseInt(p, 10));
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parseInt(parts[0] || 0, 10);
}

// Extract tag value from PGN tags
function getPgnTag(pgn, tag) {
  const re = new RegExp("\\[" + tag + "\\s+\"([^\"]+)\"\\]");
  const m = pgn.match(re);
  return m ? m[1] : null;
}

// Parse moves and clocks from PGN into an array of {moveNumber, white: {san, clk}, black: {san, clk}}
function parseMovesWithClocks(pgn) {
  // Split off tag block
  const parts = pgn.split(/\r?\n\r?\n/);
  const movesText = parts.slice(1).join("\n").trim();
  if (!movesText) return [];

  // Tokenize:
  // - clock annotations like "{[%clk 0:05:00]}"
  // - other comments "{...}"
  // - move number tokens "1." or "1..."
  // - SAN / result tokens (anything else not whitespace or braces)
  const tokenRe = /\{\[%clk\s*([0-9:.]+)\]\}|\{[^}]*\}|\d+\.+|(?:[^\s\{\}]+)/g;
  const tokens = movesText.match(tokenRe) || [];

  const moves = [];
  let currentMove = null;
  let moveNumFromToken = null;
  let expectColor = "w"; // next SAN token is white by default

  for (const token of tokens) {
    // move number like "1." or "1..."
    if (/^\d+\.+$/.test(token)) {
      moveNumFromToken = parseInt(token, 10);
      // keep expectColor as 'w' (we will rely on SAN ordering)
      expectColor = "w";
      continue;
    }

    // clock annotation like "{[%clk 0:05:00]}"
    const clkMatch = token.match(/^\{\[%clk\s*([0-9:.]+)\]\}$/);
    if (clkMatch) {
      const clkStr = clkMatch[1];
      const clkSec = parseClockToSeconds(clkStr);
      // Attach to the last half-move. If expectColor==='b', last pushed SAN was white; attach to that white.
      // If expectColor==='w', the last pushed SAN was black; attach to that black.
      if (expectColor === "b") {
        const last = moves[moves.length - 1];
        if (last && last.white) last.white.clk = clkSec;
      } else {
        const last = moves[moves.length - 1];
        if (last && last.black) last.black.clk = clkSec;
      }
      continue;
    }

    // other comments "{...}" - ignore
    if (/^\{.*\}$/.test(token)) continue;

    // game result token -> stop
    if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(token)) break;

    // Otherwise it's a SAN token (move)
    if (expectColor === "w") {
      const mnum = moveNumFromToken || moves.length + 1;
      currentMove = { moveNumber: mnum, white: { san: token, clk: null }, black: null };
      moves.push(currentMove);
      expectColor = "b";
    } else {
      // black move for current move
      if (!currentMove) {
        const mnum = moveNumFromToken || moves.length + 1;
        currentMove = { moveNumber: mnum, white: { san: null, clk: null }, black: null };
        moves.push(currentMove);
      }
      currentMove.black = { san: token, clk: null };
      // done with this move
      expectColor = "w";
      currentMove = null;
      // once we've consumed a black move, clear moveNumFromToken so future move numbers are inferred
      moveNumFromToken = null;
    }
  }

  return moves;
}

// Compute per-move durations (in seconds) from parsed move list and initialTime (seconds) if available.
// Returns flattened array of moves in order (index starting 0) with {index, ply, color, san, clkAfter, duration}
function computeDurations(parsedMoves, initialTime) {
  const result = [];
  // Keep previous clock by color
  let prevClock = {
    w: initialTime == null ? null : initialTime,
    b: initialTime == null ? null : initialTime,
  };
  let plyIndex = 0;
  for (const mv of parsedMoves) {
    // White
    const w = mv.white;
    if (w && w.san) {
      const after = w.clk;
      let dur = null;
      if (after != null && prevClock.w != null) dur = prevClock.w - after;
      // update prevClock.w to after if present
      if (after != null) prevClock.w = after;
      result.push({ index: plyIndex, ply: plyIndex + 1, color: "w", san: w.san, clkAfter: after, duration: dur });
      plyIndex++;
    }
    // Black
    const b = mv.black;
    if (b && b.san) {
      const after = b.clk;
      let dur = null;
      if (after != null && prevClock.b != null) dur = prevClock.b - after;
      if (after != null) prevClock.b = after;
      result.push({ index: plyIndex, ply: plyIndex + 1, color: "b", san: b.san, clkAfter: after, duration: dur });
      plyIndex++;
    }
  }
  return result;
}
