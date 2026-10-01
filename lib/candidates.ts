import { BOARD_SIZE, isInside, positionToKey } from "@/lib/game";
import type { Board, Position } from "@/types/game";

const CENTER = (BOARD_SIZE - 1) / 2;

function nearbyStoneCount(board: Board, position: Position, radius: number): number {
  let count = 0;

  for (let rowStep = -radius; rowStep <= radius; rowStep += 1) {
    for (let colStep = -radius; colStep <= radius; colStep += 1) {
      if (rowStep === 0 && colStep === 0) continue;
      const row = position.row + rowStep;
      const col = position.col + colStep;
      if (isInside(row, col) && board[row][col] !== null) count += 1;
    }
  }

  return count;
}

export function generateCandidates(
  board: Board,
  radius = 2,
  maxCandidates = 48,
): Position[] {
  const occupied: Position[] = [];

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (board[row][col] !== null) occupied.push({ row, col });
    }
  }

  if (occupied.length === 0) {
    return [{ row: CENTER, col: CENTER }];
  }

  const unique = new Map<string, Position>();

  for (const stone of occupied) {
    for (let rowStep = -radius; rowStep <= radius; rowStep += 1) {
      for (let colStep = -radius; colStep <= radius; colStep += 1) {
        const row = stone.row + rowStep;
        const col = stone.col + colStep;

        if (!isInside(row, col) || board[row][col] !== null) continue;
        const position = { row, col };
        unique.set(positionToKey(position), position);
      }
    }
  }

  return [...unique.values()]
    .map((position) => {
      const density = nearbyStoneCount(board, position, 2);
      const centerDistance =
        Math.abs(position.row - CENTER) + Math.abs(position.col - CENTER);
      return {
        position,
        score: density * 10 - centerDistance,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, maxCandidates)
    .map((item) => item.position);
}
