import type { Board, Player, Position } from "@/types/game";

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
