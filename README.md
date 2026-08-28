# Chess Time Review

A browser-based Chess.com move-time visualizer. Enter a Chess.com username to load
recent games and step through each move while seeing how much time was spent on it,
alongside a replay of the board position.

## Features

- Loads a player's recent games directly from the Chess.com public API.
- Parses PGN move times and computes per-move durations from clock data.
- Displays a move list with duration bars, colored by which side (you vs. opponent) made the move.
- Renders the board position for the selected move, including the move arrow and captured pieces.
- Keyboard and button navigation (previous/next) to step through moves.
- Remembers the loaded username in the URL query string (`?user=<username>`) for easy sharing/reloading.

## Getting Started

This is a static, dependency-free web app — no build step is required.

1. Serve the project directory with any static file server, for example:
   ```bash
   npx http-server .
   ```
   or
   ```bash
   python3 -m http.server
   ```
2. Open the served `index.html` in your browser.
3. Enter a Chess.com username and click **Load recent games**.

## Project Structure

- `index.html` — page markup and script includes.
- `app.js` — application logic: loading games, rendering the move list, and wiring up UI events.
- `board.js` — chessboard rendering, piece drawing, and move arrows/highlights.
- `utils.js` — PGN parsing, time control parsing, and move duration calculations.
- `styles.css` — page and board styling.

The app uses [chess.js](https://github.com/jhlywa/chess.js) (loaded via CDN) for move
generation/validation and board state.

## Testing

Unit tests are written with [Jest](https://jestjs.io/) and cover `utils.js` and `app.js`.

Install dependencies and run the test suite:

```bash
npm install
npm test
```
