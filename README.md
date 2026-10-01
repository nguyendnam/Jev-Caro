# Jev Caro

Human (X) vs TypeSafe Jev (O), 15x15 Caro/Gomoku.

## Architecture

1. Browser owns the visible board state.
2. Human clicks a legal empty cell.
3. `POST /api/move` sends the current board to the server.
4. Server first checks deterministic tactics:
   - O can win immediately -> take it.
   - X can win immediately -> block it.
5. Otherwise, the engine scores nearby cells for straight and broken threats, then runs iterative alpha-beta search (up to four plies, approximately one second). Forced blocks extend the search horizon. Candidate pruning makes this a bounded heuristic search, not a proof of optimal play.
6. Server asks Jev a `choice` question only over moves tied for the best completed search evaluation. Each candidate includes its score and search depth.
7. The API validates Jev's selected cell before returning it to the browser.
8. UI renders Jev's confidence and probability distribution.

## Rules used by this demo

- 15 x 15 board.
- Human is X and moves first.
- Jev is O.
- Five or more contiguous stones horizontally, vertically, or diagonally wins.
- No forbidden double-three/double-four rules.

## Run

```bash
npm install
cp .env.example .env.local
```

Put your TypeSafe API key in `.env.local`:

```env
TYPESAFE_API_KEY=...
```

Then:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Important fallback behavior

If the TypeSafe key is missing or the API call fails, `/api/move` returns the highest-ranked searched move as its deterministic fallback so the UI remains playable. The decision panel clearly labels it `Fallback move` and shows the error message. This prevents a network/API issue from being confused with a real Jev decision.

## Strategy checks

Run `npm test` to check immediate wins, broken fours, open-three defense, crossing threats, attacking fours, edge diagonals, legal moves and board preservation. The external Jev API has an eight-second timeout before using the local fallback.
