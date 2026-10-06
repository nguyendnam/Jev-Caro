import { generateCandidates } from "@/lib/candidates";
import { cloneBoard, isInside, isWinningMove } from "@/lib/game";
import type { Board, Player, Position } from "@/types/game";

const DIRECTIONS = [[1, 0], [0, 1], [1, 1], [1, -1]];
const WIN = 10_000_000;
const other = (player: Player): Player => player === "O" ? "X" : "O";

type Potential = { score: number; winningReplies: Set<string> };
type RankedMove = {
  move: Position;
  attack: number;
  defense: number;
  priority: number;
  attackReplies: Set<string>;
  defenseReplies: Set<string>;
};
export type MoveAnalysis = { move: Position; score: number; depth: number };

// Score every five-cell window through this square, including broken lines.
function potential(board: Board, move: Position, player: Player): Potential {
  let total = 0;
  const winningReplies = new Set<string>();
  let fours = 0;
  let threes = 0;
  for (const [dr, dc] of DIRECTIONS) {
    let best = 0;
    const winningEnds = new Set<string>();
    for (let start = -4; start <= 0; start++) {
      let stones = 0;
      const empty: Position[] = [];
      let blocked = false;
      for (let i = start; i < start + 5; i++) {
        const row = move.row + i * dr;
        const col = move.col + i * dc;
        if (!isInside(row, col) || board[row][col] === other(player)) {
          blocked = true;
          break;
        }
        if (i === 0 || board[row][col] === player) stones++;
        else empty.push({ row, col });
      }
      if (blocked) continue;
      if (stones === 5) return { score: WIN, winningReplies };
      if (stones === 4) winningEnds.add(`${empty[0].row},${empty[0].col}`);
      const before = { row: move.row + (start - 1) * dr, col: move.col + (start - 1) * dc };
      const after = { row: move.row + (start + 5) * dr, col: move.col + (start + 5) * dc };
      const open = [before, after].filter(p => isInside(p.row, p.col) && board[p.row][p.col] === null).length;
      best = Math.max(best, [0, 2, 35, 450, 8000][stones] * (1 + open * 0.5));
    }
    if (winningEnds.size >= 2) best = 500_000;
    for (const end of winningEnds) winningReplies.add(end);
    if (winningEnds.size) fours++;
    if (best >= 675 && !winningEnds.size) threes++;
    total += best;
  }
  if (fours >= 2) total += 500_000;
  else if (fours && threes) total += 80_000;
  else if (threes >= 2) total += 15_000;
  return { score: total, winningReplies };
}

function rank(board: Board, player: Player): RankedMove[] {
  // Never prune by density before checking threats on every nearby legal square.
  return generateCandidates(board, 2, 225).map(move => {
    const attack = potential(board, move, player);
    const defense = potential(board, move, other(player));
    return { move, attack: attack.score, defense: defense.score,
      attackReplies: attack.winningReplies, defenseReplies: defense.winningReplies,
      priority: Math.max(attack.score, defense.score * 1.1) + Math.min(attack.score, defense.score) * 0.1 };
  }).sort((a, b) => b.priority - a.priority);
}

export function analyzeMoves(board: Board, budgetMs = 1500, maxDepth = 6): MoveAnalysis[] {
  const working = cloneBoard(board);
  const deadline = performance.now() + budgetMs;
  const timeout = Symbol("search timeout");
  const roots = rank(working, "O");
  if (!roots.length) return [];
  const wins = roots.filter(item => item.attack >= WIN);
  const blocks = roots.filter(item => item.defense >= WIN);
  // Validate ALL defenses before pruning or the timed search. Blocking one end of
  // a four, or allowing an open/broken/crossing four, is a proven tactical loss.
  const threats = roots.filter(item => item.defense >= WIN || item.defenseReplies.size >= 2);
  function allowsForcedLoss(candidate: RankedMove, player: Player, threats: RankedMove[]): boolean {
    const { move } = candidate;
    working[move.row][move.col] = player;
    try {
      for (const threat of threats) {
        const reply = threat.move;
        if (working[reply.row][reply.col] !== null) continue;
        const attack = potential(working, reply, other(player));
        if (attack.score >= WIN) return true;
        // The defender can counter-win unless the fork occupies its sole winning cell.
        if (attack.winningReplies.size >= 2 &&
          (candidate.attackReplies.size === 0 ||
            (candidate.attackReplies.size === 1 && candidate.attackReplies.has(`${reply.row},${reply.col}`)))) return true;
      }
      return false;
    } finally {
      working[move.row][move.col] = null;
    }
  }
  const safe = wins.length ? wins : roots.filter(item => !allowsForcedLoss(item, "O", threats));
  const choices = wins.length ? wins : safe.length ? safe.slice(0, 20) : blocks.length ? blocks : roots.slice(0, 20);
  let completed = choices.map(item => ({ move: item.move,
    score: wins.length ? WIN : !safe.length ? -WIN + 3 : item.priority, depth: 0 }));

  function search(player: Player, depth: number, alpha: number, beta: number, ply: number): number {
    if (performance.now() >= deadline) throw timeout;
    const moves = rank(working, player);
    if (!moves.length) return 0;
    if (moves.some(item => item.attack >= WIN)) return WIN - ply;
    const forced = moves.filter(item => item.defense >= WIN);
    if (forced.length > 1) return -WIN + ply + 1;
    // Two distinct winning replies are a proof, unlike the heuristic score.
    // Check this even at depth zero to see open fours and crossing broken fours.
    if (!forced.length && moves.some(item => item.attackReplies.size >= 2)) return WIN - ply - 2;
    const forkThreats = moves.filter(item => item.defenseReplies.size >= 2);
    const defenses = forced.length ? forced : forkThreats.length
      ? moves.filter(item => !allowsForcedLoss(item, player, forkThreats)) : moves;
    if (!defenses.length) return -WIN + ply + 3;
    // Extend forced blocks at the horizon so a forcing four is not mistaken for safety.
    if (depth <= 0 && !forced.length && !forkThreats.length) {
      const attack = Math.max(...moves.map(item => item.attack));
      const defense = Math.max(...moves.map(item => item.defense));
      return attack - defense * 1.15;
    }
    if (ply >= 10) return 0;
    const candidates = forced.length ? forced : defenses.slice(0, 10);
    let best = -Infinity;
    for (const { move } of candidates) {
      working[move.row][move.col] = player;
      let score: number;
      try {
        score = -search(other(player), depth - 1, -beta, -alpha, ply + 1);
      } finally {
        working[move.row][move.col] = null;
      }
      best = Math.max(best, score);
      alpha = Math.max(alpha, score);
      if (alpha >= beta) break;
    }
    return best;
  }

  for (let depth = 1; depth <= maxDepth; depth++) {
    const iteration: MoveAnalysis[] = [];
    try {
      for (const { move } of completed) {
        if (performance.now() >= deadline) throw timeout;
        working[move.row][move.col] = "O";
        let score: number;
        try {
          score = isWinningMove(working, move, "O") ? WIN : -search("X", depth - 1, -Infinity, Infinity, 1);
        } finally {
          working[move.row][move.col] = null;
        }
        iteration.push({ move, score, depth });
      }
      completed = iteration.sort((a, b) => b.score - a.score);
    } catch (error) {
      if (error !== timeout) throw error;
      break;
    }
  }
  return completed;
}

// Jev chooses only among moves with the same best search evaluation.
export function strategicChoices(analysis: MoveAnalysis[]): MoveAnalysis[] {
  if (!analysis.length) return [];
  return analysis.filter(item => item.score === analysis[0].score).slice(0, 6);
}
