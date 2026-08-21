// Board rendering and interaction logic

const boardEl = document.getElementById("board");
const svg = document.getElementById("svgOverlay");

// Map piece object from chess.js to unicode glyph
function pieceToUnicode(piece) {
  const map = {
    p: { w: "♙", b: "♟" },
    r: { w: "♖", b: "♜" },
    n: { w: "♘", b: "♞" },
    b: { w: "♗", b: "♝" },
    q: { w: "♕", b: "♛" },
    k: { w: "♔", b: "♚" },
  };
  return map[piece.type] ? map[piece.type][piece.color] : "";
}

function fileRankToSquare(file, rank) {
  // file=1..8 => a..h
  return String.fromCharCode(96 + file) + rank;
}

// Convert an algebraic square (e.g. "e4") into 0-100 percentage coordinates
// on an 8x8 grid, independent of DOM layout measurements. This keeps the
// arrow overlay perfectly aligned with the board regardless of borders,
// rounding, or responsive resizing.
function squareToPercentCoords(square) {
  if (!square || square.length < 2) return null;
  const file = square.charCodeAt(0) - 97; // 0 (a) .. 7 (h)
  const rank = parseInt(square[1], 10); // 1..8
  if (isNaN(file) || isNaN(rank) || file < 0 || file > 7 || rank < 1 || rank > 8) return null;
  const col = file; // 0 = a-file (left)
  const row = 8 - rank; // 0 = rank 8 (top)
  return {
    x: (col + 0.5) * 12.5,
    y: (row + 0.5) * 12.5,
  };
}

// Kept for backwards compatibility / potential external use.
function squareCenter(square) {
  return squareToPercentCoords(square);
}

// Draw board position from a chess.js instance
function drawBoard(chessInstance) {
  // chessInstance.board() returns 8x8 array with null or {type,color}
  const board = chessInstance.board();
  boardEl.innerHTML = "";
  // make table rows
  for (let rank = 8; rank >= 1; rank--) {
    const tr = document.createElement("tr");
    for (let file = 1; file <= 8; file++) {
      const td = document.createElement("td");
      const isLight = (file + rank) % 2 === 0;
      td.className = isLight ? "light" : "dark";
      const piece = board[8 - rank][file - 1];
      if (piece) {
        const span = document.createElement("span");
        span.className = "piece " + (piece.color === "w" ? "piece-white" : "piece-black");
        span.textContent = pieceToUnicode(piece);
        td.appendChild(span);
      }
      td.dataset.square = fileRankToSquare(file, rank);
      tr.appendChild(td);
    }
    boardEl.appendChild(tr);
  }
  // Use a fixed percentage-based viewBox so the arrow overlay always lines
  // up with the board grid, regardless of pixel measurements/rounding.
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.innerHTML = "";
}

// Highlight the from/to squares of the last move
function highlightSquares(fromSquare, toSquare) {
  boardEl.querySelectorAll("td.highlight-from, td.highlight-to").forEach((td) => {
    td.classList.remove("highlight-from", "highlight-to");
  });
  if (fromSquare) {
    const fromTd = boardEl.querySelector('td[data-square="' + fromSquare + '"]');
    if (fromTd) fromTd.classList.add("highlight-from");
  }
  if (toSquare) {
    const toTd = boardEl.querySelector('td[data-square="' + toSquare + '"]');
    if (toTd) toTd.classList.add("highlight-to");
  }
}

// Draw arrow from fromSquare to toSquare (in board coordinates)
function drawArrow(fromSquare, toSquare) {
  svg.innerHTML = "";
  const c1 = squareToPercentCoords(fromSquare);
  const c2 = squareToPercentCoords(toSquare);
  highlightSquares(fromSquare, toSquare);
  if (!c1 || !c2) return;

  // Shorten the line slightly at both ends so the arrowhead doesn't overlap
  // the piece glyphs and the tail doesn't start exactly on the source square.
  const dx = c2.x - c1.x;
  const dy = c2.y - c1.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;
  const startPad = 3; // percentage units
  const endPad = 4.2;
  const startX = c1.x + ux * startPad;
  const startY = c1.y + uy * startPad;
  const endX = c2.x - ux * endPad;
  const endY = c2.y - uy * endPad;

  const ns = "http://www.w3.org/2000/svg";
  const defs = document.createElementNS(ns, "defs");
  defs.innerHTML =
    '<marker id="arrowhead" markerWidth="3" markerHeight="3" refX="1.5" refY="1.5" orient="auto" markerUnits="strokeWidth">' +
    '<path d="M0,0 L3,1.5 L0,3 z" fill="#ff8c00" />' +
    "</marker>";
  svg.appendChild(defs);

  const line = document.createElementNS(ns, "line");
  line.setAttribute("x1", startX);
  line.setAttribute("y1", startY);
  line.setAttribute("x2", endX);
  line.setAttribute("y2", endY);
  line.setAttribute("stroke", "#ff8c00");
  line.setAttribute("stroke-width", "2.2");
  line.setAttribute("stroke-linecap", "round");
  line.setAttribute("marker-end", "url(#arrowhead)");
  line.setAttribute("opacity", "0.9");
  svg.appendChild(line);

  // Emphasize the source square with a soft circle
  const circ = document.createElementNS(ns, "circle");
  circ.setAttribute("cx", c1.x);
  circ.setAttribute("cy", c1.y);
  circ.setAttribute("r", 3.6);
  circ.setAttribute("fill", "rgba(255,140,0,0.25)");
  circ.setAttribute("stroke", "none");
  svg.appendChild(circ);
}
