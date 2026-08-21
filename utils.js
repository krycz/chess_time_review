// Helper utilities

function el(id) {
  return document.getElementById(id);
}

// Format seconds to "Nd H:MM:SS", "H:MM:SS" or "M:SS" display.
// Durations are always expected to be non-negative; if a negative or
// invalid value sneaks in, it is treated as 0.
function fmtSeconds(s) {
  if (s == null || isNaN(s)) return "-";
  s = Math.round(s);
  if (s < 0) s = 0;

  const SEC_PER_DAY = 86400;
  const days = Math.floor(s / SEC_PER_DAY);
  const rem = s - days * SEC_PER_DAY;
  const hh = Math.floor(rem / 3600);
  const mm = Math.floor((rem % 3600) / 60);
  const ss = rem % 60;

  if (days > 0) {
    return (
      days +
      "d " +
      String(hh).padStart(2, "0") +
      ":" +
      String(mm).padStart(2, "0") +
      ":" +
      String(ss).padStart(2, "0")
    );
  }
  if (hh > 0) {
    return String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0") + ":" + String(ss).padStart(2, "0");
  }
  return String(mm).padStart(1, "0") + ":" + String(ss).padStart(2, "0");
}

// Parse clock "H:MM:SS" or "MM:SS" to seconds
function parseClockToSeconds(s) {
  if (!s) return null;
  const parts = s.split(":").map((p) => parseInt(p, 10));
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parseInt(parts[0] || 0, 10);
}

// Parse a chess.com/PGN TimeControl string into { initial, increment } in seconds.
// Supported formats:
//  - "600"        -> 600s, no increment
//  - "600+5"      -> 600s initial, 5s increment per move
//  - "1/259200"   -> daily/correspondence: N days per move (converted to seconds), no increment
// Returns { initial: number|null, increment: number }
function parseTimeControl(tc) {
  if (!tc) return { initial: null, increment: 0 };
  // Daily format like "1/259200" (moves-per-period / seconds)
  if (tc.indexOf("/") > -1) {
    const [, secondsStr] = tc.split("/");
    const seconds = parseInt(secondsStr, 10);
    return { initial: Number.isFinite(seconds) ? seconds : null, increment: 0 };
  }
  if (tc.indexOf("+") > -1) {
    const [initStr, incStr] = tc.split("+");
    const initial = parseInt(initStr, 10);
    const increment = parseInt(incStr, 10);
    return {
      initial: Number.isFinite(initial) ? initial : null,
      increment: Number.isFinite(increment) ? increment : 0,
    };
  }
  const initial = parseInt(tc, 10);
  return { initial: Number.isFinite(initial) ? initial : null, increment: 0 };
}

// Extract tag value from PGN tags
function getPgnTag(pgn, tag) {
  const re = new RegExp("\\[" + tag + "\\s+\"([^\"]+)\"\\]");
  const m = pgn.match(re);
  return m ? m[1] : null;
}

// Build a short, human-friendly label (with emoji) describing a game's time class
// and time control, e.g. "⚡ Blitz 5+0", "⏱️ Rapid 15+10", "📅 Daily 3d/move", "🚀 Bullet 1+0".
// This lets users distinguish games that share a time_class (e.g. chess.com groups
// both 10+0 and 15+10 as "rapid") but have quite different pacing.
function getGameTypeLabel(game) {
  const timeClass = (game && game.time_class) || "";
  const tc = (game && game.time_control) || "";
  const emojiMap = {
    bullet: "🚀",
    blitz: "⚡",
    rapid: "⏱️",
    daily: "📅",
  };
  const emoji = emojiMap[timeClass] || "♟️";
  let label = timeClass ? timeClass.charAt(0).toUpperCase() + timeClass.slice(1) : "Game";

  if (!tc) return `${emoji} ${label}`;

  const { initial, increment } = parseTimeControl(tc);
  if (initial == null) return `${emoji} ${label}`;

  if (timeClass === "daily") {
    const days = initial / 86400;
    const daysStr = Number.isInteger(days) ? days : days.toFixed(1);
    label += ` ${daysStr}d/move`;
  } else {
    const minutes = initial / 60;
    const minStr = Number.isInteger(minutes) ? minutes : minutes.toFixed(1);
    label += ` ${minStr}+${increment}`;
  }
  return `${emoji} ${label}`;
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
    // move number like "1." (white) or "1..." (black's turn)
    if (/^\d+\.+$/.test(token)) {
      moveNumFromToken = parseInt(token, 10);
      // "1..." means black to move next; "1." means white to move next
      expectColor = token.indexOf("...") > -1 ? "b" : "w";
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

// Compute per-move durations (in seconds) from parsed move list, an initialTime (seconds)
// and an increment (seconds) added back to the clock after each move, if available.
//
// A player's clock after a move equals: clockBefore - duration + increment.
// So: duration = clockBefore + increment - clockAfter.
// Any residual negative value (e.g. due to lag compensation or rounding in the
// source data) is clamped to 0 so displayed durations are always non-negative.
//
// Returns flattened array of moves in order (index starting 0) with {index, ply, color, san, clkAfter, duration}
function computeDurations(parsedMoves, initialTime, increment) {
  const inc = increment || 0;
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
      if (after != null && prevClock.w != null) {
        dur = prevClock.w + inc - after;
        if (dur < 0) dur = 0;
      }
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
      if (after != null && prevClock.b != null) {
        dur = prevClock.b + inc - after;
        if (dur < 0) dur = 0;
      }
      if (after != null) prevClock.b = after;
      result.push({ index: plyIndex, ply: plyIndex + 1, color: "b", san: b.san, clkAfter: after, duration: dur });
      plyIndex++;
    }
  }
  return result;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    el,
    fmtSeconds,
    parseClockToSeconds,
    parseTimeControl,
    getPgnTag,
    getGameTypeLabel,
    parseMovesWithClocks,
    computeDurations,
  };
}
