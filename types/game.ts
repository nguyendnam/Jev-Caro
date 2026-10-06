export type Player = "X" | "O";
export type Cell = Player | null;
export type Board = Cell[][];

export type Position = {
  row: number;
  col: number;
};

export type GameMove = { player: Player; move: Position };
export type MoveSource = "tactical-win" | "tactical-block" | "jev" | "verified" | "engine" | "fallback";

export type CandidateTrace = {
  key: string;
  score: number;
  depth: number;
  line: string[];
  threats: string[];
  probability?: number;
  strategyScore?: number;
  risk?: number;
};

export type JevAssessment = {
  key: string;
  strategyScore: number;
  risk: number;
  preference: number;
};

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
  elapsedMs?: number;
  nodes?: number;
  candidates?: CandidateTrace[];
  principalVariation?: string[];
  evaluation?: "winning" | "losing" | "uncertain";
  jev?: {
    choice: string;
    plan: string;
    questions: number;
    assessments: JevAssessment[];
    overridden: boolean;
  };
};
