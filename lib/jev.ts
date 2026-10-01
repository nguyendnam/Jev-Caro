import { keyToPosition, positionToKey, serializeBoard } from "@/lib/game";
import type { MoveAnalysis } from "@/lib/strategy";
import type { Board, Position } from "@/types/game";

const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";

type ChoiceAnswer = {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
};

type SystemOneResponse = {
  model: string;
  answers: {
    best_move?: ChoiceAnswer;
  };
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
};

export async function chooseMoveWithJev(
  board: Board,
  candidates: Position[],
  analysis: MoveAnalysis[] = [],
): Promise<{
  move: Position;
  key: string;
  confidence: number;
  probabilities: Record<string, number>;
  model: string;
  usage: SystemOneResponse["usage"];
}> {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    throw new Error("Missing TYPESAFE_API_KEY in .env.local");
  }

  const criteria = Object.fromEntries(
    candidates.map((position) => {
      const key = positionToKey(position);
      const evaluated = analysis.find(item => positionToKey(item.move) === key);
      return [key, `Place O at ${key}. Search score: ${evaluated?.score ?? "unknown"}; completed depth: ${evaluated?.depth ?? 0}. Higher is better for O.`];
    }),
  );

  const response = await fetch(TYPESAFE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "jev-latest",
      state: {
        game: "Caro / Gomoku",
        rules: {
          board_size: "15x15",
          human_piece: "X",
          jev_piece: "O",
          current_turn: "O",
          win_condition: "Five or more contiguous stones horizontally, vertically, or diagonally.",
          forbidden_moves: "None",
        },
        coordinates:
          "Columns are A through O from left to right. Rows are 1 through 15 from top to bottom.",
        board_rows: serializeBoard(board),
        board_legend: ". = empty, X = human, O = Jev",
      },
      questions: {
        best_move: {
          type: "choice",
          instructions:
            "Choose the strongest move for O from the supplied search-vetted candidates. A bounded adversarial search has evaluated threats and opponent replies; candidates share its best evaluation. Prefer moves that create strong threats, block dangerous X threats, connect O stones, preserve future winning paths, and use central influence. Immediate wins and immediate blocks are already handled by deterministic code before this question.",
          criteria,
        },
      },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`TypeSafe API ${response.status}: ${body.slice(0, 500)}`);
  }

  const data = (await response.json()) as SystemOneResponse;
  const answer = data.answers.best_move;

  if (!answer || answer.type !== "choice") {
    throw new Error("Jev returned no valid choice answer");
  }

  const move = keyToPosition(answer.choice);
  const isCandidate =
    move !== null &&
    candidates.some(
      (candidate) => candidate.row === move.row && candidate.col === move.col,
    );

  if (!move || !isCandidate || board[move.row][move.col] !== null) {
    throw new Error(`Jev returned an invalid move: ${answer.choice}`);
  }

  return {
    move,
    key: answer.choice,
    confidence: answer.confidence,
    probabilities: answer.probabilities,
    model: data.model,
    usage: data.usage,
  };
}
