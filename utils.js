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

// Parse clock "D:HH:MM:SS", "H:MM:SS", "MM:SS" or "SS.s" to seconds.
function parseClockToSeconds(s) {
  if (!s) return null;
  const rawParts = s.split(":");
  if (rawParts.some((part) => part === "")) return null;
  const parts = rawParts.map((p) => Number(p));
  if (parts.some((part) => !Number.isFinite(part))) return null;
  if (parts.length === 4) return parts[0] * 86400 + parts[1] * 3600 + parts[2] * 60 + parts[3];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

// Parse a chess.com/PGN TimeControl string into { initial, increment } in seconds.
// Supported formats:
//  - "600"        -> 600s, no increment
//  - "600+5"      -> 600s initial, 5s increment per move
//  - "1/259200"   -> daily/correspondence: N days per move (converted to seconds), no increment
// Returns { initial: number|null, increment: number }
function isDailyTimeControl(tc) {
  return typeof tc === "string" && /^1\/\d+$/.test(tc);
}

function parseTimeControl(tc) {
  if (!tc) return { initial: null, increment: 0 };
  // Daily format like "1/259200" (moves-per-period / seconds)
  if (isDailyTimeControl(tc)) {
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

  if (!tc) return emoji;

  const { initial, increment } = parseTimeControl(tc);
  if (initial == null) return emoji;

  if (timeClass === "daily") {
    const days = initial / 86400;
    const daysStr = Number.isInteger(days) ? days : days.toFixed(1);
    return `${emoji} ${daysStr}d/move`;
  } else {
    const minutes = initial / 60;
    const minStr = Number.isInteger(minutes) ? minutes : minutes.toFixed(1);
    return `${emoji} ${minStr}+${increment}`;
  }
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
// Chess.com daily/correspondence PGNs are different: their %clk values appear to
// encode per-move elapsed time in tenths of the UI value. For example, a PGN
// value of 0:05:22.7 lines up with a UI move time of about 53:47. For those
// games, use duration = %clk * 10 rather than treating %clk as remaining time
// on a countdown clock.
//
// Returns flattened array of moves in order (index starting 0) with {index, ply, color, san, clkAfter, duration}
function computeDurations(parsedMoves, initialTime, increment, opts) {
  const inc = increment || 0;
  const options = opts || {};
  const useDailyDurationEncoding = Boolean(options.isDaily);
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
      if (after != null && useDailyDurationEncoding) {
        dur = after * 10;
      } else if (after != null && prevClock.w != null) {
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
      if (after != null && useDailyDurationEncoding) {
        dur = after * 10;
      } else if (after != null && prevClock.b != null) {
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

// Map a move duration to a percentage width for the timeline bar.
// Width is normalized against the maximum duration in the current move list.
function durationToBarPercent(duration, maxDuration, opts) {
  const options = opts || {};
  const minPercent = Number.isFinite(options.minPercent) ? options.minPercent : 2;
  const maxPercent = Number.isFinite(options.maxPercent) ? options.maxPercent : 100;
  const fallbackPercent = Number.isFinite(options.fallbackPercent) ? options.fallbackPercent : 15;
  const startPercent = Math.min(minPercent, maxPercent);
  const endPercent = Math.max(minPercent, maxPercent);

  if (!Number.isFinite(duration)) return fallbackPercent;

  const safeDuration = Math.max(0, duration);
  const safeMax = Number.isFinite(maxDuration) ? Math.max(0, maxDuration) : 0;
  if (safeMax <= 0) return fallbackPercent;
  if (endPercent === startPercent) return startPercent;

  const ratio = safeDuration / safeMax;
  const clampedRatio = Math.min(1, Math.max(0, ratio));
  return startPercent + clampedRatio * (endPercent - startPercent);
}

// Load recent monthly archives newest-first and return enough games for the UI.
// `archiveUrls` is expected oldest->newest (chess.com archives API order).
// Stops once minGames is reached or maxArchives have been fetched.
async function loadRecentGamesFromArchives(fetchImpl, archiveUrls, opts) {
  const options = opts || {};
  const minGames = Number.isFinite(options.minGames) ? options.minGames : 6;
  const maxArchives = Number.isFinite(options.maxArchives) ? options.maxArchives : 4;
  const onArchiveLoadStart = typeof options.onArchiveLoadStart === "function"
    ? options.onArchiveLoadStart
    : null;
  const fetchFn = typeof fetchImpl === "function" ? fetchImpl : fetch;

  const recentArchives = (archiveUrls || []).slice(-maxArchives).reverse();
  const games = [];
  let archivesLoaded = 0;

  for (const [archiveIndex, archiveUrl] of recentArchives.entries()) {
    if (onArchiveLoadStart) onArchiveLoadStart(archiveIndex);
    const archiveRes = await fetchFn(archiveUrl);
    if (!archiveRes.ok) {
      const statusText = archiveRes.statusText ? " " + archiveRes.statusText : "";
      throw new Error("Could not fetch archive " + archiveUrl + ": " + archiveRes.status + statusText);
    }
    const monthData = await archiveRes.json();
    const monthGames = monthData && Array.isArray(monthData.games) ? monthData.games : [];
    games.push(...monthGames);
    archivesLoaded++;
    if (games.length >= minGames) break;
  }

  return { games, archivesLoaded };
}

// Piece point values used for material delta computation.
const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

// Piece order for display (least to most valuable, kings excluded).
const PIECE_ORDER = ["p", "n", "b", "r", "q"];

// Starting counts per side in a standard game.
const PIECE_START = { p: 8, n: 2, b: 2, r: 2, q: 1 };

// Compute which pieces have been captured for each color from a board snapshot.
//
// Accepts either a chess.js instance (with a .board() method) or a plain 8x8
// array (same format as chess.js .board() returns) so that unit tests can pass
// board states directly without needing a full chess.js instance.
//
// Returns { capturedByWhite, capturedByBlack, delta }
//   capturedByWhite  – pieces white has taken  (black pieces off the board)
//   capturedByBlack  – pieces black has taken  (white pieces off the board)
//   delta            – material advantage: >0 white is ahead, <0 black is ahead
//
// Pawn promotion is handled correctly: a promoted piece that is still on the
// board is counted as a "visible promotion" and subtracted from missing pawns,
// so the pawn does not appear as captured by the opponent.
//
// Edge case: if a pawn promotes to type T and then the resulting piece is
// captured, the board count for type T equals start[T], so the promotion and
// the subsequent capture are both invisible from the board snapshot alone.
// chess.com and Lichess exhibit the same limitation without move history, so
// we match their display behaviour (the missing pawn is shown as captured).
//
// Algorithm:
//   visiblePromotions = sum(max(0, onBoard[color][t] - start[t])  for t in {n,b,r,q})
//   captured[p]       = max(0, (start[p] - onBoard[color][p]) - visiblePromotions)
//   captured[t≠p]     = max(0, start[t] - onBoard[color][t])
function getCapturedPieces(chessInstanceOrBoard) {
  const board = typeof chessInstanceOrBoard.board === "function"
    ? chessInstanceOrBoard.board()
    : chessInstanceOrBoard;

  const onBoard = {
    w: { p: 0, n: 0, b: 0, r: 0, q: 0 },
    b: { p: 0, n: 0, b: 0, r: 0, q: 0 },
  };
  for (const row of board) {
    for (const sq of row) {
      if (sq && sq.type !== "k" && onBoard[sq.color][sq.type] != null) {
        onBoard[sq.color][sq.type]++;
      }
    }
  }

  function capturedForColor(color) {
    // Count pieces beyond the starting count — these are pawns that promoted
    // and are still on the board ("visible" promotions).
    let visiblePromotions = 0;
    for (const pt of ["n", "b", "r", "q"]) {
      visiblePromotions += Math.max(0, onBoard[color][pt] - PIECE_START[pt]);
    }

    const pawnsGone = PIECE_START["p"] - onBoard[color]["p"];

    const captured = {};
    // Pawns: some missing pawns promoted instead of being captured.
    // Only the ones not accounted for by visible promotions count as captured.
    captured["p"] = Math.max(0, pawnsGone - visiblePromotions);
    // Non-pawn pieces: use apparent deficit (start - on board). This handles
    // the common case correctly. The one unresolvable edge case — pawn promotes
    // to type T and then that piece is captured — is a known limitation shared
    // with chess.com and Lichess when operating from a board snapshot only.
    for (const pt of ["n", "b", "r", "q"]) {
      captured[pt] = Math.max(0, PIECE_START[pt] - onBoard[color][pt]);
    }
    return captured;
  }

  // capturedByWhite = black pieces that white has taken (count what's missing from black's set)
  const capturedByWhite = capturedForColor("b");
  // capturedByBlack = white pieces that black has taken (count what's missing from white's set)
  const capturedByBlack = capturedForColor("w");

  // Delta is the material advantage based on what is actually on the board.
  // Using on-board material (rather than captured-piece difference) means that
  // a promoted queen is counted at full value for its owner.
  let delta = 0;
  for (const pt of PIECE_ORDER) {
    delta += (onBoard.w[pt] - onBoard.b[pt]) * PIECE_VALUES[pt];
  }

  return { capturedByWhite, capturedByBlack, delta };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    el,
    fmtSeconds,
    parseClockToSeconds,
    parseTimeControl,
    isDailyTimeControl,
    getPgnTag,
    getGameTypeLabel,
    parseMovesWithClocks,
    computeDurations,
    durationToBarPercent,
    loadRecentGamesFromArchives,
    getCapturedPieces,
    PIECE_ORDER,
    PIECE_VALUES,
  };
}
