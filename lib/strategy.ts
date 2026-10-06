import { BOARD_SIZE, cloneBoard, isInside, positionToKey } from "@/lib/game";
import type { Board, Player, Position } from "@/types/game";

export const WIN = 10_000_000;
const MATE = 9_000_000;
const DIRECTIONS = [[1, 0], [0, 1], [1, 1], [1, -1]];
const other = (player: Player): Player => player === "O" ? "X" : "O";
const position = (index: number): Position => ({ row: Math.floor(index / BOARD_SIZE), col: index % BOARD_SIZE });
const indexOf = (move: Position) => move.row * BOARD_SIZE + move.col;

// Geometry is shared; position-dependent caches belong to one search only.
const RAYS = Array.from({ length: 225 }, (_, index) => {
  const { row, col } = position(index);
  return DIRECTIONS.map(([dr, dc]) => Array.from({ length: 11 }, (_, i) => {
    const r = row + (i - 5) * dr;
    const c = col + (i - 5) * dc;
    return isInside(r, c) ? r * BOARD_SIZE + c : -1;
  }));
});
const NEIGHBORS = Array.from({ length: 225 }, (_, index) => {
  const { row, col } = position(index);
  const result: number[] = [];
  for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
    if ((dr || dc) && isInside(row + dr, col + dc)) result.push((row + dr) * BOARD_SIZE + col + dc);
  }
  return result;
});

type LinePattern = { win: boolean; ends: number[]; openThree: boolean; score: number };
type Threat = { win: boolean; ends: number[]; openThrees: number; fours: number; score: number };
type RankedMove = { index: number; attack: Threat; defense: Threat; priority: number };
export type MoveAnalysis = {
  move: Position;
  score: number;
  depth: number;
  line: Position[];
  attack: number;
  defense: number;
  threats: string[];
  nodes: number;
  proven: "win" | "loss" | null;
};
export type SearchOptions = { preferred?: Position[]; rootMoves?: Position[]; rootLimit?: number; branchLimit?: number };

function winningEnds(line: string[]): number[] {
  const ends = new Set<number>();
  for (let start = 1; start <= 5; start++) {
    const window = line.slice(start, start + 5);
    if (!window.includes("2") && window.filter(cell => cell === "1").length === 4) {
      ends.add(start + window.indexOf("0"));
    }
  }
  return [...ends];
}

function linePattern(key: string): LinePattern {
  const line = key.split("");
  let score = 0;
  let hasThree = false;
  for (let start = 1; start <= 5; start++) {
    const window = line.slice(start, start + 5);
    if (window.includes("2")) continue;
    const count = window.filter(cell => cell === "1").length;
    if (count === 5) return { win: true, ends: [], openThree: false, score: WIN };
    hasThree ||= count === 3;
    score = Math.max(score, [0, 2, 40, 450, 40_000][count]);
  }
  const ends = winningEnds(line);
  let openThree = false;
  // A real open three has an extension making TWO different winning cells.
  // This includes broken threes, without counting overlapping windows twice.
  if (!ends.length && hasThree) {
    for (let i = 1; i <= 9; i++) {
      if (line[i] !== "0") continue;
      line[i] = "1";
      openThree = winningEnds(line).length >= 2;
      line[i] = "0";
      if (openThree) break;
    }
  }
  if (openThree) score = 3500;
  return { win: false, ends, openThree, score };
}

class SearchBoard {
  cells: (Player | null)[];
  neighbors = new Int16Array(225);
  patterns = new Map<string, LinePattern>();
  threats: Record<Player, (Threat | undefined)[]> = { X: [], O: [] };

  constructor(board: Board) {
    this.cells = board.flat();
    this.cells.forEach((cell, index) => {
      if (cell) for (const neighbor of NEIGHBORS[index]) this.neighbors[neighbor]++;
    });
  }

  put(index: number, player: Player | null) {
    const change = player ? 1 : -1;
    this.cells[index] = player;
    for (const neighbor of NEIGHBORS[index]) this.neighbors[neighbor] += change;
    for (const ray of RAYS[index]) for (const affected of ray) {
      if (affected < 0) continue;
      this.threats.X[affected] = undefined;
      this.threats.O[affected] = undefined;
    }
  }

  threat(index: number, player: Player): Threat {
    const cached = this.threats[player][index];
    if (cached) return cached;
    const result: Threat = { win: false, ends: [], openThrees: 0, fours: 0, score: 0 };
    const ends = new Set<number>();
    for (const ray of RAYS[index]) {
      const key = ray.map((cell, offset) => offset === 5 ? "1" : cell < 0 ? "2"
        : this.cells[cell] === null ? "0" : this.cells[cell] === player ? "1" : "2").join("");
      let pattern = this.patterns.get(key);
      if (!pattern) {
        pattern = linePattern(key);
        this.patterns.set(key, pattern);
      }
      result.win ||= pattern.win;
      result.openThrees += Number(pattern.openThree);
      result.fours += Number(pattern.ends.length > 0);
      result.score += pattern.score;
      for (const end of pattern.ends) ends.add(ray[end]);
    }
    result.ends = [...ends];
    if (result.win) result.score = WIN;
    else if (ends.size >= 2) result.score += 1_000_000;
    else if (result.fours && result.openThrees) result.score += 80_000;
    else if (result.openThrees >= 2) result.score += 25_000;
    this.threats[player][index] = result;
    return result;
  }

  rank(player: Player): RankedMove[] {
    const moves: RankedMove[] = [];
    for (let index = 0; index < 225; index++) {
      if (this.cells[index] || !this.neighbors[index]) continue;
      const attack = this.threat(index, player);
      const defense = this.threat(index, other(player));
      const { row, col } = position(index);
      const central = 14 - Math.abs(row - 7) - Math.abs(col - 7);
      moves.push({ index, attack, defense,
        priority: Math.max(attack.score, defense.score * 1.08) + Math.min(attack.score, defense.score) * 0.12 + central });
    }
    if (!moves.length && this.cells.every(cell => !cell)) {
      const attack = this.threat(112, player);
      moves.push({ index: 112, attack, defense: attack, priority: 14 });
    }
    return moves.sort((a, b) => b.priority - a.priority || a.index - b.index);
  }

  safe(candidate: RankedMove, player: Player, threats: RankedMove[]): boolean {
    if (candidate.attack.win) return true;
    this.put(candidate.index, player);
    try {
      for (const { index } of threats) {
        if (this.cells[index]) continue;
        const attack = this.threat(index, other(player));
        if (attack.win) return false;
        if (attack.ends.length >= 2 && (candidate.attack.ends.length === 0 ||
          (candidate.attack.ends.length === 1 && candidate.attack.ends[0] === index))) return false;
      }
      return true;
    } finally { this.put(candidate.index, null); }
  }
}

function labels(item: RankedMove): string[] {
  const result: string[] = [];
  if (item.attack.win) result.push("Thắng ngay");
  else if (item.attack.ends.length >= 2) result.push("Tạo hai đường thắng");
  else if (item.attack.fours) result.push("Tạo thế bốn buộc chặn");
  if (item.attack.openThrees >= 2) result.push("Tạo hai thế ba mở");
  else if (item.attack.openThrees) result.push("Tạo thế ba mở");
  if (item.defense.win) result.push("Chặn nước thắng");
  else if (item.defense.ends.length >= 2) result.push("Phá bẫy hai đường thắng");
  else if (item.defense.openThrees >= 2) result.push("Phá hai thế ba mở");
  else if (item.defense.fours) result.push("Chặn phát triển thành bốn");
  else if (item.defense.openThrees) result.push("Chặn phát triển thành ba mở");
  return result.length ? result : ["Phát triển thế cờ"];
}

export function analyzeMoves(board: Board, budgetMs = 1500, maxDepth = 6, options: SearchOptions = {}): MoveAnalysis[] {
  const state = new SearchBoard(board);
  const deadline = performance.now() + Math.max(0, budgetMs);
  const timeout = Symbol("search timeout");
  let nodes = 0;
  const preferred = new Set(options.preferred?.map(indexOf));
  const roots = state.rank("O");
  if (!roots.length) return [];
  const wins = roots.filter(item => item.attack.win);
  const threats = roots.filter(item => item.defense.win || item.defense.ends.length >= 2);
  const safe = wins.length ? wins : roots.filter(item => state.safe(item, "O", threats));
  const blocks = roots.filter(item => item.defense.win);
  let choices = wins.length ? wins : safe.length ? safe : blocks.length ? blocks : roots;
  if (options.rootMoves?.length) {
    const requested = new Set(options.rootMoves.map(indexOf));
    const filtered = choices.filter(item => requested.has(item.index));
    if (filtered.length) choices = filtered;
  }
  // Jev's proposal gets searched even if it falls outside the ordinary beam.
  choices = choices.sort((a, b) => Number(preferred.has(b.index)) - Number(preferred.has(a.index)) || b.priority - a.priority)
    .slice(0, options.rootLimit ?? 24);
  let completed: MoveAnalysis[] = choices.map<MoveAnalysis>(item => ({
    move: position(item.index), score: wins.length ? WIN : !safe.length ? -WIN + 3 : item.priority,
    depth: 0, line: [position(item.index)], attack: item.attack.score, defense: item.defense.score,
    threats: labels(item), nodes: 0, proven: wins.length ? "win" : !safe.length ? "loss" : null,
  })).sort((a, b) => b.score - a.score);
  if (wins.length) return completed;

  type Entry = { score: number; line: number[]; bound: "exact" | "lower" | "upper" };
  const table = new Map<string, Entry>();
  function search(player: Player, depth: number, alpha: number, beta: number, ply: number): { score: number; line: number[] } {
    nodes++;
    if (performance.now() >= deadline) throw timeout;
    const key = `${player}:${depth}:${ply}:${state.cells.map(cell => cell ?? ".").join("")}`;
    const stored = table.get(key);
    const originalAlpha = alpha;
    const originalBeta = beta;
    if (stored) {
      if (stored.bound === "exact") return stored;
      if (stored.bound === "lower") alpha = Math.max(alpha, stored.score);
      else beta = Math.min(beta, stored.score);
      if (alpha >= beta) return stored;
    }
    const moves = state.rank(player);
    if (!moves.length) return { score: 0, line: [] };
    const win = moves.find(item => item.attack.win);
    if (win) return { score: WIN - ply, line: [win.index] };
    const forced = moves.filter(item => item.defense.win);
    if (forced.length > 1) return { score: -WIN + ply + 1, line: [forced[0].index, forced[1].index] };
    const fork = moves.find(item => item.attack.ends.length >= 2);
    if (!forced.length && fork) return { score: WIN - ply - 2, line: [fork.index] };
    const forks = moves.filter(item => item.defense.ends.length >= 2);
    const defenses = forced.length ? forced : forks.length ? moves.filter(item => state.safe(item, player, forks)) : moves;
    if (!defenses.length) return { score: -WIN + ply + 3, line: [] };
    const evaluate = () => {
      const attack = moves.map(item => item.attack.score).sort((a, b) => b - a);
      const defense = moves.map(item => item.defense.score).sort((a, b) => b - a);
      return attack[0] - defense[0] * 1.08 + (attack[1] ?? 0) * 0.12 - (defense[1] ?? 0) * 0.12;
    };
    if ((depth <= 0 && !forced.length && !forks.length) || ply >= 16) return { score: evaluate(), line: [] };
    // Preserve forcing attacks and double threes outside the quiet-move beam.
    const forcing = defenses.filter(item => item.attack.fours || item.attack.openThrees >= 2 || item.defense.openThrees >= 2);
    const candidates = forced.length ? forced : [...new Map([...forcing, ...defenses.slice(0, options.branchLimit ?? 10)]
      .map(item => [item.index, item])).values()];
    let best = -Infinity;
    let line: number[] = [];
    for (const item of candidates) {
      state.put(item.index, player);
      let reply: { score: number; line: number[] };
      try { reply = search(other(player), depth - 1, -beta, -alpha, ply + 1); }
      finally { state.put(item.index, null); }
      const score = -reply.score;
      if (score > best) { best = score; line = [item.index, ...reply.line]; }
      alpha = Math.max(alpha, score);
      if (alpha >= beta) break;
    }
    const entry: Entry = { score: best, line, bound: best <= originalAlpha ? "upper" : best >= originalBeta ? "lower" : "exact" };
    if (table.size < 40_000) table.set(key, entry);
    return entry;
  }

  for (let depth = 1; depth <= maxDepth; depth++) {
    const iteration: MoveAnalysis[] = [];
    try {
      for (const item of completed) {
        if (performance.now() >= deadline) throw timeout;
        const index = indexOf(item.move);
        state.put(index, "O");
        let reply: { score: number; line: number[] };
        try { reply = search("X", depth - 1, -Infinity, Infinity, 1); }
        finally { state.put(index, null); }
        const score = -reply.score;
        iteration.push({ ...item, score, depth, line: [item.move, ...reply.line.map(position)],
          proven: score >= MATE ? "win" : score <= -MATE ? "loss" : null });
      }
      completed = iteration.sort((a, b) => b.score - a.score);
      if (completed[0].proven === "win" || completed.every(item => item.proven === "loss")) break;
    } catch (error) {
      if (error !== timeout) throw error;
      break;
    }
  }
  return completed.map(item => ({ ...item, nodes }));
}

// Give Jev diverse non-losing moves rather than enforcing a narrow score band.
// Never trade a searched win for a quiet move.
export function strategicChoices(analysis: MoveAnalysis[], limit = 8): MoveAnalysis[] {
  if (!analysis.length) return [];
  const best = analysis[0];
  if (best.proven || Math.abs(best.score) >= MATE) {
    return analysis.filter(item => item.score === best.score).slice(0, limit);
  }
  const safe = analysis.filter(item => item.proven !== "loss");
  const attack = [...safe].sort((a, b) => b.attack - a.attack);
  const defense = [...safe].sort((a, b) => b.defense - a.defense);
  const diverse = new Map<string, MoveAnalysis>();
  for (let i = 0; i < safe.length && diverse.size < limit; i++) {
    for (const item of [safe[i], defense[i], attack[i]]) {
      if (item && diverse.size < limit) diverse.set(positionToKey(item.move), item);
    }
  }
  return [...diverse.values()];
}

export function describePosition(board: Board) {
  const state = new SearchBoard(board);
  const threats = (player: Player) => state.rank(player).filter(item => item.attack.win || item.attack.fours || item.attack.openThrees > 0)
    .slice(0, 10).map(item => ({ move: positionToKey(position(item.index)), win: item.attack.win,
      winningReplies: item.attack.ends.map(index => positionToKey(position(index))),
      openThrees: item.attack.openThrees, score: item.attack.score }));
  return { X: threats("X"), O: threats("O") };
}

export function candidateContext(board: Board, analysis: MoveAnalysis[]) {
  return analysis.map(item => {
    const next = cloneBoard(board);
    next[item.move.row][item.move.col] = "O";
    return { key: positionToKey(item.move), searchScore: item.score, completedDepth: item.depth,
      tacticalFeatures: item.threats, attack: item.attack, defense: item.defense,
      continuation: item.line.map((move, i) => `${i % 2 ? "X" : "O"}:${positionToKey(move)}`),
      rowsAfterMove: next.map(row => row.map(cell => cell ?? ".").join("")) };
  });
}
