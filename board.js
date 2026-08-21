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

// Return center of square in SVG coordinates
function squareCenter(square) {
  // find corresponding td element
  const td = boardEl.querySelector('td[data-square="' + square + '"]');
  if (!td) return null;
  const rect = boardEl.getBoundingClientRect();
  const tdRect = td.getBoundingClientRect();
  const x = tdRect.left - rect.left + tdRect.width / 2;
  const y = tdRect.top - rect.top + tdRect.height / 2;
  return { x, y };
}

// Draw board position from a chess.js instance
function drawBoard(chessInstance) {
  // chessInstance.board() returns 8x8 array with null or {type,color}
  const board = chessInstance.board();
  boardEl.innerHTML = "";
  const size = boardEl.clientWidth; // container width
  // make table rows
  for (let rank = 8; rank >= 1; rank--) {
    const tr = document.createElement("tr");
    for (let file = 1; file <= 8; file++) {
      const td = document.createElement("td");
      const isLight = (file + rank) % 2 === 0;
      td.className = isLight ? "light" : "dark";
      const piece = board[8 - rank][file - 1];
      if (piece) {
        td.textContent = pieceToUnicode(piece);
      } else td.textContent = "";
      td.dataset.square = fileRankToSquare(file, rank);
      tr.appendChild(td);
    }
    boardEl.appendChild(tr);
  }
  // adjust svg viewBox to board size for arrow drawing
  const rect = boardEl.getBoundingClientRect();
  svg.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
  svg.style.width = rect.width + "px";
  svg.style.height = rect.height + "px";
}

// Draw arrow from fromSquare to toSquare (in board coordinates)
function drawArrow(fromSquare, toSquare) {
  svg.innerHTML = "";
  const c1 = squareCenter(fromSquare);
  const c2 = squareCenter(toSquare);
  if (!c1 || !c2) return;
  // create line with arrowhead
  const ns = "http://www.w3.org/2000/svg";
  const defs = document.createElementNS(ns, "defs");
  defs.innerHTML =
    '<marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L8,4 L0,8 z" fill="#ff2b2b"/></marker>';
  svg.appendChild(defs);
  const line = document.createElementNS(ns, "line");
  line.setAttribute("x1", c1.x);
  line.setAttribute("y1", c1.y);
  line.setAttribute("x2", c2.x);
  line.setAttribute("y2", c2.y);
  line.setAttribute("stroke", "#ff2b2b");
  line.setAttribute("stroke-width", "4");
  line.setAttribute("stroke-linecap", "round");
  line.setAttribute("marker-end", "url(#arrowhead)");
  svg.appendChild(line);
  // optionally emphasize source square (circle)
  const circ = document.createElementNS(ns, "circle");
  circ.setAttribute("cx", c1.x);
  circ.setAttribute("cy", c1.y);
  circ.setAttribute("r", 8);
  circ.setAttribute("fill", "rgba(255,43,43,0.15)");
  circ.setAttribute("stroke", "none");
  svg.appendChild(circ);
}
