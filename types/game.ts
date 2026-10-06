export type Player = "X" | "O";
export type Cell = Player | null;
export type Board = Cell[][];

export type Position = {
  row: number;
  col: number;
};

export type MoveSource = "tactical-win" | "tactical-block" | "jev" | "fallback";

export type MoveResponse = {
  move: Position;
  key: string;
  source: MoveSource;
  confidence: number;
  probabilities: Record<string, number>;
  model?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  warning?: string;
  searchDepth?: number;
  reason?: string;
};
