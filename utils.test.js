// Unit tests for utils.js pure functions
const {
  parseClockToSeconds,
  parseTimeControl,
  parseMovesWithClocks,
  computeDurations,
  durationToBarPercent,
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
    const pieces = startingPieces().filter((p, i) => {
      // Remove one black pawn (first occurrence)
      if (p.color === "b" && p.type === "p") {
        const firstBlackPawn = startingPieces().findIndex((x) => x.color === "b" && x.type === "p");
        return i !== firstBlackPawn;
      }
      return true;
    });
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
    //           delta = 0 (no material exchanged).
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
    expect(delta).toBe(0);
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
    expect(delta).toBe(14); // 5 (rook) + 9 (queen)
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
    expect(delta).toBe(0);
  });

  test("accepts a chess.js-style instance with .board() method", () => {
    const chessLike = { board: () => makeBoard(startingPieces()) };
    const { delta } = getCapturedPieces(chessLike);
    expect(delta).toBe(0);
  });
});
