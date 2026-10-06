import type { Board, GameMove, Player, Position } from "@/types/game";

export const BOARD_SIZE = 15;
export const WIN_LENGTH = 5;

export function createEmptyBoard(): Board {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => null),
  );
}

export function cloneBoard(board: Board): Board {
  return board.map((row) => [...row]);
}

export function isInside(row: number, col: number): boolean {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

export function isBoardShapeValid(board: unknown): board is Board {
  if (!Array.isArray(board) || board.length !== BOARD_SIZE) return false;

  return board.every(
    (row) =>
      Array.isArray(row) &&
      row.length === BOARD_SIZE &&
      row.every((cell) => cell === null || cell === "X" || cell === "O"),
  );
}

const DIRECTIONS: Array<[number, number]> = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

function countDirection(
  board: Board,
  position: Position,
  player: Player,
  rowStep: number,
  colStep: number,
): number {
  let count = 0;
  let row = position.row + rowStep;
  let col = position.col + colStep;

  while (isInside(row, col) && board[row][col] === player) {
    count += 1;
    row += rowStep;
    col += colStep;
  }

  return count;
}

export function isWinningMove(
  board: Board,
  position: Position,
  player: Player,
): boolean {
  if (board[position.row]?.[position.col] !== player) return false;

  return DIRECTIONS.some(([rowStep, colStep]) => {
    const forward = countDirection(board, position, player, rowStep, colStep);
    const backward = countDirection(board, position, player, -rowStep, -colStep);
    return 1 + forward + backward >= WIN_LENGTH;
  });
}

export function boardIsFull(board: Board): boolean {
  return board.every((row) => row.every((cell) => cell !== null));
}

export function getLegalMoves(board: Board): Position[] {
  const moves: Position[] = [];

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (board[row][col] === null) moves.push({ row, col });
    }
  }

  return moves;
}

export function findImmediateMove(board: Board, player: Player): Position | null {
  for (const move of getLegalMoves(board)) {
    const next = cloneBoard(board);
    next[move.row][move.col] = player;
    if (isWinningMove(next, move, player)) return move;
  }

  return null;
}

export function positionToKey(position: Position): string {
  const column = String.fromCharCode("A".charCodeAt(0) + position.col);
  return `${column}${position.row + 1}`;
}

export function keyToPosition(key: string): Position | null {
  const match = /^([A-O])(1[0-5]|[1-9])$/i.exec(key.trim());
  if (!match) return null;

  return {
    col: match[1].toUpperCase().charCodeAt(0) - "A".charCodeAt(0),
    row: Number(match[2]) - 1,
  };
}

export function serializeBoard(board: Board): string[] {
  return board.map((row) => row.map((cell) => cell ?? ".").join(""));
}

export function getWinningLine(board: Board): Position[] {
  for (let row = 0; row < BOARD_SIZE; row++) for (let col = 0; col < BOARD_SIZE; col++) {
    const player = board[row][col];
    if (!player) continue;
    for (const [dr, dc] of DIRECTIONS) {
      const line: Position[] = [];
      let r = row;
      let c = col;
      while (isInside(r, c) && board[r][c] === player) {
        line.push({ row: r, col: c });
        r += dr;
        c += dc;
      }
      if (line.length >= WIN_LENGTH) return line;
    }
  }
  return [];
}

export function replayMoves(value: unknown): { board: Board; moves: GameMove[] } | null {
  if (!Array.isArray(value) || value.length > BOARD_SIZE * BOARD_SIZE) return null;
  const board = createEmptyBoard();
  const moves: GameMove[] = [];
  let finished = false;
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || !entry.move || finished) return null;
    const { row, col } = entry.move;
    const player: Player = moves.length % 2 ? "O" : "X";
    if (entry.player !== player || !Number.isInteger(row) || !Number.isInteger(col) ||
      !isInside(row, col) || board[row][col] !== null) return null;
    board[row][col] = player;
    moves.push({ player, move: { row, col } });
    finished = isWinningMove(board, { row, col }, player);
  }
  return { board, moves };
}

export function validateJevTurn(board: Board): string | null {
  if (getWinningLine(board).length) return "Ván cờ đã kết thúc.";
  if (boardIsFull(board)) return "Bàn cờ đã đầy.";
  const cells = board.flat();
  if (cells.filter(cell => cell === "X").length !== cells.filter(cell => cell === "O").length + 1) {
    return "Số quân không hợp lệ: phải đến lượt O sau một nước X.";
  }
  return null;
}
