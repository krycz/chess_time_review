// Unit tests for utils.js pure functions
const {
  parseClockToSeconds,
  parseTimeControl,
  parseMovesWithClocks,
  computeDurations,
  durationToBarPercent,
  loadRecentGamesFromArchives,
  getCurrentMonthArchiveUrl,
  ensureCurrentMonthArchive,
  fmtSeconds,
  getCapturedPieces,
} = require("./utils.js");

// ---------------------------------------------------------------------------
// parseClockToSeconds
// ---------------------------------------------------------------------------
describe("parseClockToSeconds", () => {
  test("H:MM:SS format", () => {
    expect(parseClockToSeconds("0:15:00")).toBe(900);
    expect(parseClockToSeconds("1:00:00")).toBe(3600);
    expect(parseClockToSeconds("0:00:05")).toBe(5);
  });

  test("MM:SS format", () => {
    expect(parseClockToSeconds("14:50")).toBe(890);
    expect(parseClockToSeconds("0:00")).toBe(0);
    expect(parseClockToSeconds("10:10")).toBe(610);
  });

  test("single number", () => {
    expect(parseClockToSeconds("600")).toBe(600);
  });

  test("preserves fractional seconds", () => {
    expect(parseClockToSeconds("0:05:22.7")).toBeCloseTo(322.7);
  });

  test("D:HH:MM:SS format", () => {
    expect(parseClockToSeconds("2:23:55:00")).toBe(258900);
    expect(parseClockToSeconds("0:00:04:30")).toBe(270);
  });

  test("null / empty returns null", () => {
    expect(parseClockToSeconds(null)).toBeNull();
    expect(parseClockToSeconds("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseTimeControl
// ---------------------------------------------------------------------------
describe("parseTimeControl", () => {
  test("plain seconds", () => {
    expect(parseTimeControl("600")).toEqual({ initial: 600, increment: 0 });
  });

  test("seconds + increment", () => {
    expect(parseTimeControl("600+5")).toEqual({ initial: 600, increment: 5 });
    expect(parseTimeControl("900+10")).toEqual({ initial: 900, increment: 10 });
  });

  test("daily / correspondence format", () => {
    expect(parseTimeControl("1/259200")).toEqual({ initial: 259200, increment: 0 });
  });

  test("null / empty", () => {
    expect(parseTimeControl(null)).toEqual({ initial: null, increment: 0 });
    expect(parseTimeControl("")).toEqual({ initial: null, increment: 0 });
  });

  test("malformed returns nulls gracefully", () => {
    const result = parseTimeControl("abc");
    expect(result.increment).toBe(0);
    // initial will be NaN from parseInt, which is not finite, so should be null
    expect(result.initial).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseMovesWithClocks
// ---------------------------------------------------------------------------

// A minimal representative PGN with %clk for both colors, 900+10 time control.
const SAMPLE_PGN = `[Event "Test"]
[White "Alice"]
[Black "Bob"]
[TimeControl "900+10"]

1. e4 {[%clk 0:14:55]} e5 {[%clk 0:14:58]} 2. Nf3 {[%clk 0:14:48]} Nc6 {[%clk 0:14:53]} 3. Bb5 {[%clk 0:14:40]} a6 {[%clk 0:14:47]} 1-0
`;

describe("parseMovesWithClocks", () => {
  test("parses 3 full moves", () => {
    const moves = parseMovesWithClocks(SAMPLE_PGN);
    expect(moves).toHaveLength(3);
  });

  test("move 1 has correct SANs and clocks", () => {
    const moves = parseMovesWithClocks(SAMPLE_PGN);
    expect(moves[0].moveNumber).toBe(1);
    expect(moves[0].white.san).toBe("e4");
    expect(moves[0].white.clk).toBe(895); // 0:14:55
    expect(moves[0].black.san).toBe("e5");
    expect(moves[0].black.clk).toBe(898); // 0:14:58
  });

  test("move 2 has correct SANs and clocks", () => {
    const moves = parseMovesWithClocks(SAMPLE_PGN);
    expect(moves[1].white.san).toBe("Nf3");
    expect(moves[1].white.clk).toBe(888); // 0:14:48
    expect(moves[1].black.san).toBe("Nc6");
    expect(moves[1].black.clk).toBe(893); // 0:14:53
  });

  test("move 3 has correct SANs and clocks", () => {
    const moves = parseMovesWithClocks(SAMPLE_PGN);
    expect(moves[2].white.san).toBe("Bb5");
    expect(moves[2].white.clk).toBe(880); // 0:14:40
    expect(moves[2].black.san).toBe("a6");
    expect(moves[2].black.clk).toBe(887); // 0:14:47
  });
});

// ---------------------------------------------------------------------------
// computeDurations
// ---------------------------------------------------------------------------
describe("computeDurations", () => {
  // Hand-computed expected durations for SAMPLE_PGN, 900+10:
  //
  //  White move 1 (e4): prevClock.w=900, clkAfter=895, inc=10 -> 900+10-895 = 15s
  //  Black move 1 (e5): prevClock.b=900, clkAfter=898, inc=10 -> 900+10-898 = 12s
  //  White move 2 (Nf3): prevClock.w=895, clkAfter=888, inc=10 -> 895+10-888 = 17s
  //  Black move 2 (Nc6): prevClock.b=898, clkAfter=893, inc=10 -> 898+10-893 = 15s
  //  White move 3 (Bb5): prevClock.w=888, clkAfter=880, inc=10 -> 888+10-880 = 18s
  //  Black move 3 (a6):  prevClock.b=893, clkAfter=887, inc=10 -> 893+10-887 = 16s

  let flat;
  beforeAll(() => {
    const parsedMoves = parseMovesWithClocks(SAMPLE_PGN);
    flat = computeDurations(parsedMoves, 900, 10);
  });

  test("returns 6 plies for 3 full moves", () => {
    expect(flat).toHaveLength(6);
  });

  test("colors alternate w/b", () => {
    expect(flat[0].color).toBe("w");
    expect(flat[1].color).toBe("b");
    expect(flat[2].color).toBe("w");
    expect(flat[3].color).toBe("b");
    expect(flat[4].color).toBe("w");
    expect(flat[5].color).toBe("b");
  });

  test("white durations are correct with increment", () => {
    expect(flat[0].duration).toBe(15); // e4
    expect(flat[2].duration).toBe(17); // Nf3
    expect(flat[4].duration).toBe(18); // Bb5
  });

  test("black durations are correct with increment", () => {
    expect(flat[1].duration).toBe(12); // e5
    expect(flat[3].duration).toBe(15); // Nc6
    expect(flat[5].duration).toBe(16); // a6
  });

  test("all durations are non-negative", () => {
    flat.forEach((mv) => {
      expect(mv.duration).toBeGreaterThanOrEqual(0);
    });
  });

  test("without increment durations are different (larger)", () => {
    const parsedMoves = parseMovesWithClocks(SAMPLE_PGN);
    const flatNoInc = computeDurations(parsedMoves, 900, 0);
    // Without increment, white move 1: 900-895=5 (not 15)
    expect(flatNoInc[0].duration).toBe(5);
  });

  test("daily games use scaled per-move durations instead of countdown deltas", () => {
    const dailyPgn = `[Event "Let's Play!"]
[White "BrunoAFM"]
[Black "kr_cz"]
[TimeControl "1/259200"]

1. e4 {[%clk 0:05:22.7]} 1... e5 {[%clk 1:01:57.5]} 2. d3 {[%clk 0:47:56.2]} 2... Nf6 {[%clk 0:19:35.1]} *
`;

    const parsedMoves = parseMovesWithClocks(dailyPgn);
    const { initial, increment } = parseTimeControl("1/259200");
    const flat = computeDurations(parsedMoves, initial, increment, { isDaily: true });

    expect(flat[0].duration).toBeCloseTo(3227); // 0:05:22.7 -> 322.7s -> 3227s
    expect(flat[1].duration).toBeCloseTo(37175); // 1:01:57.5 -> 3717.5s -> 37175s
    expect(flat[2].duration).toBeCloseTo(28762); // 0:47:56.2 -> 2876.2s -> 28762s
    expect(flat[3].duration).toBeCloseTo(11751); // 0:19:35.1 -> 1175.1s -> 11751s

    expect(fmtSeconds(flat[0].duration)).toBe("53:47");
    expect(fmtSeconds(flat[1].duration)).toBe("10:19:35");
  });
});

// ---------------------------------------------------------------------------
// Regression: rapid 900+10 game — no all-zero / ever-growing durations
// This models the kr_cz vs madden599 bug: increment was discarded, causing
// one color to have all-zero durations while the other grew to 5+ minutes.
// ---------------------------------------------------------------------------
describe("Regression: 900+10 rapid game with increment", () => {
  // Construct a short PGN modelling the reported game's clock structure.
  // Clocks decrement by ~30s per move each, increment restores +10.
  const RAPID_PGN = `[Event "Rapid Game"]
[White "kr_cz"]
[Black "madden599"]
[TimeControl "900+10"]

1. e4 {[%clk 0:14:40]} e5 {[%clk 0:14:38]} 2. d4 {[%clk 0:14:15]} exd4 {[%clk 0:14:12]} 3. Nf3 {[%clk 0:13:55]} d5 {[%clk 0:13:50]} 4. exd5 {[%clk 0:13:30]} Qxd5 {[%clk 0:13:25]} 1/2-1/2
`;

  test("all durations are non-negative", () => {
    const { initial, increment } = parseTimeControl("900+10");
    const parsedMoves = parseMovesWithClocks(RAPID_PGN);
    const flat = computeDurations(parsedMoves, initial, increment);
    flat.forEach((mv) => {
      expect(mv.duration).toBeGreaterThanOrEqual(0);
    });
  });

  test("no color has all-zero durations while the other has large values", () => {
    const { initial, increment } = parseTimeControl("900+10");
    const parsedMoves = parseMovesWithClocks(RAPID_PGN);
    const flat = computeDurations(parsedMoves, initial, increment);
    const whiteMoves = flat.filter((m) => m.color === "w" && m.duration != null);
    const blackMoves = flat.filter((m) => m.color === "b" && m.duration != null);

    const whiteAllZero = whiteMoves.every((m) => m.duration === 0);
    const blackAllZero = blackMoves.every((m) => m.duration === 0);
    expect(whiteAllZero).toBe(false);
    expect(blackAllZero).toBe(false);

    // No single duration should exceed the initial time (pathological growing)
    flat.forEach((mv) => {
      if (mv.duration != null) {
        expect(mv.duration).toBeLessThanOrEqual(initial);
      }
    });
  });

  test("durations are reasonable (within expected range)", () => {
    const { initial, increment } = parseTimeControl("900+10");
    const parsedMoves = parseMovesWithClocks(RAPID_PGN);
    const flat = computeDurations(parsedMoves, initial, increment);
    // Each move should take between 0 and 120 seconds in this test fixture
    flat.forEach((mv) => {
      if (mv.duration != null) {
        expect(mv.duration).toBeLessThan(120);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // durationToBarPercent
  // ---------------------------------------------------------------------------
  describe("durationToBarPercent", () => {
    test("returns fallback percent for null/invalid durations", () => {
      expect(durationToBarPercent(null, 100)).toBe(15);
      expect(durationToBarPercent(NaN, 100)).toBe(15);
      expect(durationToBarPercent(5, 0)).toBe(15);
      expect(durationToBarPercent(5, NaN)).toBe(15);
      expect(durationToBarPercent(5, -10)).toBe(15);
    });

    test("is monotonic with duration", () => {
      const max = 600;
      const w1 = durationToBarPercent(5, max);
      const w2 = durationToBarPercent(30, max);
      const w3 = durationToBarPercent(120, max);
      const w4 = durationToBarPercent(600, max);
      expect(w1).toBeLessThanOrEqual(w2);
      expect(w2).toBeLessThanOrEqual(w3);
      expect(w3).toBeLessThanOrEqual(w4);
    });

    test("respects configured min and max percent bounds", () => {
      const minPercent = 8;
      const maxPercent = 100;
      expect(durationToBarPercent(0, 300, { minPercent, maxPercent })).toBe(minPercent);
      expect(durationToBarPercent(300, 300, { minPercent, maxPercent })).toBe(maxPercent);
      expect(durationToBarPercent(600, 300, { minPercent, maxPercent })).toBe(maxPercent);
    });
  });
});

// ---------------------------------------------------------------------------
// getCapturedPieces
// ---------------------------------------------------------------------------

// Helper: build the 8x8 board array that getCapturedPieces expects.
// pieces is an array of { type, color } objects; the rest of the squares are null.
// We just need the flat piece list — position on the board doesn't matter for counting.
function makeBoard(pieces) {
  // Fill a flat 64-slot array with nulls, then place pieces.
  const flat = Array(64).fill(null);
  pieces.forEach((p, i) => { flat[i] = p; });
  // Reshape into 8 rows of 8
  const board = [];
  for (let r = 0; r < 8; r++) {
    board.push(flat.slice(r * 8, r * 8 + 8));
  }
  return board;
}

// Build the starting position pieces array (standard chess starting set).
function startingPieces() {
  const pieces = [];
  const add = (color, type, count) => {
    for (let i = 0; i < count; i++) pieces.push({ color, type });
  };
  for (const color of ["w", "b"]) {
    add(color, "p", 8);
    add(color, "n", 2);
    add(color, "b", 2);
    add(color, "r", 2);
    add(color, "q", 1);
    add(color, "k", 1);
  }
  return pieces;
}

describe("getCapturedPieces", () => {
  test("starting position: no pieces captured, delta 0", () => {
    const board = makeBoard(startingPieces());
    const { capturedByWhite, capturedByBlack, delta } = getCapturedPieces(board);
    expect(capturedByWhite).toEqual({ p: 0, n: 0, b: 0, r: 0, q: 0 });
    expect(capturedByBlack).toEqual({ p: 0, n: 0, b: 0, r: 0, q: 0 });
    expect(delta).toBe(0);
  });

  test("white takes one black pawn: capturedByWhite.p = 1, delta = +1", () => {
    const all = startingPieces();
    const firstBlackPawn = all.findIndex((x) => x.color === "b" && x.type === "p");
    const pieces = all.filter((_, i) => i !== firstBlackPawn);
    const board = makeBoard(pieces);
    const { capturedByWhite, capturedByBlack, delta } = getCapturedPieces(board);
    expect(capturedByWhite.p).toBe(1);
    expect(capturedByBlack.p).toBe(0);
    expect(delta).toBe(1);
  });

  test("each side takes one knight: delta 0, capturedByWhite.n = 1, capturedByBlack.n = 1", () => {
    const pieces = startingPieces()
      .filter((p, i, arr) => {
        // Remove one black knight and one white knight
        const firstBlackN = arr.findIndex((x) => x.color === "b" && x.type === "n");
        const firstWhiteN = arr.findIndex((x) => x.color === "w" && x.type === "n");
        return i !== firstBlackN && i !== firstWhiteN;
      });
    const board = makeBoard(pieces);
    const { capturedByWhite, capturedByBlack, delta } = getCapturedPieces(board);
    expect(capturedByWhite.n).toBe(1);
    expect(capturedByBlack.n).toBe(1);
    expect(delta).toBe(0);
  });

  test("pawn promotion: white promotes one pawn to queen — does not inflate captures", () => {
    // White has 7 pawns + 2 queens (one original + one promoted), all other pieces intact.
    // Black has all pieces intact.
    // Expected: capturedByBlack.p = 0 (the pawn promoted, wasn't captured by black),
    //           capturedByBlack.q = 0 (white has an extra queen but it's not a black capture),
    //           capturedByWhite = all zeros (black lost nothing),
    //           delta = +8 (promotion increases on-board material by 8 points).
    const pieces = startingPieces()
      .filter((p, i, arr) => {
        // Remove one white pawn
        const firstWhiteP = arr.findIndex((x) => x.color === "w" && x.type === "p");
        return i !== firstWhiteP;
      });
    // Add an extra white queen (the promoted pawn)
    pieces.push({ color: "w", type: "q" });
    const board = makeBoard(pieces);
    const { capturedByWhite, capturedByBlack, delta } = getCapturedPieces(board);
    expect(capturedByBlack.p).toBe(0);
    expect(capturedByBlack.q).toBe(0);
    expect(capturedByWhite).toEqual({ p: 0, n: 0, b: 0, r: 0, q: 0 });
    // White traded a pawn (1pt) for a queen (9pt): net +8.
    expect(delta).toBe(8);
  });

  test("pawn promotion after capturing a piece: white promotes pawn (takes black rook), black queen captured", () => {
    // Scenario: white has 7 pawns + 2 queens (one promoted), lost nothing.
    //           black is missing one rook (captured by white) and one queen (captured by white).
    // capturedByWhite.r = 1, capturedByWhite.q = 1, capturedByBlack = all zeros, delta = 14.
    const pieces = startingPieces()
      .filter((p, i, arr) => {
        const firstWhiteP = arr.findIndex((x) => x.color === "w" && x.type === "p");
        const firstBlackR = arr.findIndex((x) => x.color === "b" && x.type === "r");
        const firstBlackQ = arr.findIndex((x) => x.color === "b" && x.type === "q");
        return i !== firstWhiteP && i !== firstBlackR && i !== firstBlackQ;
      });
    pieces.push({ color: "w", type: "q" }); // promoted pawn
    const board = makeBoard(pieces);
    const { capturedByWhite, capturedByBlack, delta } = getCapturedPieces(board);
    expect(capturedByBlack.p).toBe(0);
    expect(capturedByWhite.r).toBe(1);
    expect(capturedByWhite.q).toBe(1);
    // White: 7p+2q+2n+2b+2r=47, Black: 8p+0q+2n+2b+1r=25, delta=+22.
    expect(delta).toBe(22);
  });

  test("multiple promotions: white promotes 2 pawns to queens", () => {
    // White has 6 pawns + 3 queens. Black has all pieces.
    const pieces = startingPieces().filter((p, i, arr) => {
      const whitePs = arr.reduce((acc, x, idx) => {
        if (x.color === "w" && x.type === "p") acc.push(idx);
        return acc;
      }, []);
      return i !== whitePs[0] && i !== whitePs[1];
    });
    pieces.push({ color: "w", type: "q" });
    pieces.push({ color: "w", type: "q" });
    const board = makeBoard(pieces);
    const { capturedByBlack, delta } = getCapturedPieces(board);
    expect(capturedByBlack.p).toBe(0);
    // White: 6p+3q+2n+2b+2r=55, Black: 8p+1q+2n+2b+2r=39, delta=+16.
    expect(delta).toBe(16);
  });

  test("accepts a chess.js-style instance with .board() method", () => {
    const chessLike = { board: () => makeBoard(startingPieces()) };
    const { delta } = getCapturedPieces(chessLike);
    expect(delta).toBe(0);
  });

  test("hidden promotion edge case: pawn promotes to queen then promoted queen captured", () => {
    // Net board state: 7 pawns + 1 queen for white (same as if pawn was just captured).
    // Without move history, the board snapshot cannot distinguish "pawn captured" from
    // "pawn promoted, then promoted piece was captured". We assert the known behaviour:
    // the missing pawn shows up as capturedByBlack.p = 1.
    const all = startingPieces();
    const firstWhiteP = all.findIndex((x) => x.color === "w" && x.type === "p");
    const pieces = all.filter((_, i) => i !== firstWhiteP); // 7 white pawns, 1 queen (original)
    const board = makeBoard(pieces);
    const { capturedByBlack } = getCapturedPieces(board);
    // Known limitation matches chess.com / Lichess behaviour for this board snapshot.
    expect(capturedByBlack.p).toBe(1);
    expect(capturedByBlack.q).toBe(0);
  });
});

describe("loadRecentGamesFromArchives", () => {
  test("loads only latest archive when it already has enough games", async () => {
    const archiveUrls = [
      "u1",
      "u2",
      "u3",
      "u4",
      "u5",
    ];
    const responses = {
      u5: { games: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }, { id: 6 }] },
    };
    const fetchMock = jest.fn(async (url) => ({
      ok: true,
      status: 200,
      json: async () => responses[url] || { games: [] },
    }));

    const { games, archivesLoaded } = await loadRecentGamesFromArchives(fetchMock, archiveUrls, {
      minGames: 6,
      maxArchives: 4,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("u5");
    expect(archivesLoaded).toBe(1);
    expect(games).toHaveLength(6);
  });

  test("falls back to previous months until minimum games is reached", async () => {
    const archiveUrls = ["oldest", "mid1", "mid2", "latest"];
    const responses = {
      latest: { games: [{ id: 1 }, { id: 2 }] },
      mid2: { games: [{ id: 3 }, { id: 4 }, { id: 5 }] },
      mid1: { games: [{ id: 6 }] },
    };
    const fetchMock = jest.fn(async (url) => ({
      ok: true,
      status: 200,
      json: async () => responses[url] || { games: [] },
    }));

    const { games, archivesLoaded } = await loadRecentGamesFromArchives(fetchMock, archiveUrls, {
      minGames: 6,
      maxArchives: 4,
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["latest", "mid2", "mid1"]);
    expect(archivesLoaded).toBe(3);
    expect(games).toHaveLength(6);
    expect(games.map((g) => g.id)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test("does not load more than maxArchives", async () => {
    const archiveUrls = ["m1", "m2", "m3", "m4", "m5", "m6"];
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ games: [{ id: "g" }] }),
    }));

    const { games, archivesLoaded } = await loadRecentGamesFromArchives(fetchMock, archiveUrls, {
      minGames: 20,
      maxArchives: 4,
    });

    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["m6", "m5", "m4", "m3"]);
    expect(archivesLoaded).toBe(4);
    expect(games).toHaveLength(4);
  });

  test("handles 404/error on new month gracefully and loads previous archives", async () => {
    const archiveUrls = [
      "https://api.chess.com/pub/player/kr_cz/games/2026/08",
      "https://api.chess.com/pub/player/kr_cz/games/2026/09",
    ];
    const fetchMock = jest.fn(async (url) => {
      if (url.endsWith("2026/09")) {
        return {
          ok: false,
          status: 404,
          statusText: "Not Found",
          json: async () => ({ message: "Archive not found" }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          games: [{ id: "august_1" }, { id: "august_2" }, { id: "august_3" }, { id: "august_4" }, { id: "august_5" }, { id: "august_6" }],
        }),
      };
    });

    const { games, archivesLoaded } = await loadRecentGamesFromArchives(fetchMock, archiveUrls, {
      minGames: 6,
      maxArchives: 4,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.chess.com/pub/player/kr_cz/games/2026/09");
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.chess.com/pub/player/kr_cz/games/2026/08");
    expect(archivesLoaded).toBe(2);
    expect(games).toHaveLength(6);
    expect(games[0].id).toBe("august_1");
  });

  test("handles empty games list in new month and falls back to previous archives", async () => {
    const archiveUrls = [
      "https://api.chess.com/pub/player/kr_cz/games/2026/08",
      "https://api.chess.com/pub/player/kr_cz/games/2026/09",
    ];
    const fetchMock = jest.fn(async (url) => {
      if (url.endsWith("2026/09")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ games: [] }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          games: [{ id: "august_1" }, { id: "august_2" }, { id: "august_3" }, { id: "august_4" }, { id: "august_5" }, { id: "august_6" }],
        }),
      };
    });

    const { games, archivesLoaded } = await loadRecentGamesFromArchives(fetchMock, archiveUrls, {
      minGames: 6,
      maxArchives: 4,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(archivesLoaded).toBe(2);
    expect(games).toHaveLength(6);
  });

  test("handles network exception gracefully and continues to previous archives", async () => {
    const archiveUrls = [
      "https://api.chess.com/pub/player/kr_cz/games/2026/08",
      "https://api.chess.com/pub/player/kr_cz/games/2026/09",
    ];
    const fetchMock = jest.fn(async (url) => {
      if (url.endsWith("2026/09")) {
        throw new Error("Network error");
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          games: [{ id: "august_1" }, { id: "august_2" }, { id: "august_3" }, { id: "august_4" }, { id: "august_5" }, { id: "august_6" }],
        }),
      };
    });

    const { games, archivesLoaded } = await loadRecentGamesFromArchives(fetchMock, archiveUrls, {
      minGames: 6,
      maxArchives: 4,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(archivesLoaded).toBe(2);
    expect(games).toHaveLength(6);
  });
});

describe("getCurrentMonthArchiveUrl", () => {
  test("generates expected URL with username and UTC date", () => {
    const date = new Date("2026-09-01T18:34:16.356Z");
    expect(getCurrentMonthArchiveUrl("kr_cz", date)).toBe(
      "https://api.chess.com/pub/player/kr_cz/games/2026/09"
    );
  });

  test("normalizes username by trimming and lowercasing", () => {
    const date = new Date("2026-01-15T00:00:00Z");
    expect(getCurrentMonthArchiveUrl("  KR_CZ  ", date)).toBe(
      "https://api.chess.com/pub/player/kr_cz/games/2026/01"
    );
  });

  test("returns null if username is missing", () => {
    expect(getCurrentMonthArchiveUrl("", new Date())).toBeNull();
    expect(getCurrentMonthArchiveUrl(null, new Date())).toBeNull();
  });
});

describe("ensureCurrentMonthArchive", () => {
  test("appends current month when it is missing from archives", () => {
    const archives = [
      "https://api.chess.com/pub/player/kr_cz/games/2026/07",
      "https://api.chess.com/pub/player/kr_cz/games/2026/08",
    ];
    const date = new Date("2026-09-01T18:34:16.356Z");
    const result = ensureCurrentMonthArchive(archives, "kr_cz", date);

    expect(result).toEqual([
      "https://api.chess.com/pub/player/kr_cz/games/2026/07",
      "https://api.chess.com/pub/player/kr_cz/games/2026/08",
      "https://api.chess.com/pub/player/kr_cz/games/2026/09",
    ]);
  });

  test("does not add duplicate when current month is already in archives", () => {
    const archives = [
      "https://api.chess.com/pub/player/kr_cz/games/2026/08",
      "https://api.chess.com/pub/player/kr_cz/games/2026/09",
    ];
    const date = new Date("2026-09-01T18:34:16.356Z");
    const result = ensureCurrentMonthArchive(archives, "kr_cz", date);

    expect(result).toEqual([
      "https://api.chess.com/pub/player/kr_cz/games/2026/08",
      "https://api.chess.com/pub/player/kr_cz/games/2026/09",
    ]);
  });

  test("works when archives array is empty", () => {
    const date = new Date("2026-09-01T00:00:00Z");
    const result = ensureCurrentMonthArchive([], "kr_cz", date);
    expect(result).toEqual(["https://api.chess.com/pub/player/kr_cz/games/2026/09"]);
  });

  test("infers base URL from existing archive when username is not supplied", () => {
    const archives = ["https://api.chess.com/pub/player/kr_cz/games/2026/08"];
    const date = new Date("2026-09-01T00:00:00Z");
    const result = ensureCurrentMonthArchive(archives, "", date);
    expect(result).toEqual([
      "https://api.chess.com/pub/player/kr_cz/games/2026/08",
      "https://api.chess.com/pub/player/kr_cz/games/2026/09",
    ]);
  });
});
