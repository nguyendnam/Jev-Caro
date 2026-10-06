import { keyToPosition, positionToKey, serializeBoard } from "@/lib/game";
import { candidateContext, describePosition, type MoveAnalysis } from "@/lib/strategy";
import type { Board, GameMove, JevAssessment, Position } from "@/types/game";

const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";
export const PLANS: Record<string, string> = {
  attack: "Giành quyền tấn công",
  defense: "Củng cố phòng thủ",
  fork: "Chuẩn bị đòn kép",
  develop: "Kết nối và mở rộng thế cờ",
};
type Question = { type: "choice" | "score" | "noul"; instructions: string; criteria?: Record<string, string> | string[] };
type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => !!value && typeof value === "object" && !Array.isArray(value);
const unit = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

export type JevDecision = {
  move: Position;
  key: string;
  confidence: number;
  probabilities: Record<string, number>;
  model: string;
  usage?: { input_tokens: number; output_tokens: number };
  plan: string;
  assessments: JevAssessment[];
  questions: number;
};

export function buildJevRequest(board: Board, analysis: MoveAnalysis[], history: GameMove[] = []) {
  const candidates = candidateContext(board, analysis);
  const criteria = Object.fromEntries(candidates.map(item => [item.key,
    `Place O at ${item.key}. Features: ${item.tacticalFeatures.join(", ")}. Local search score ${item.searchScore}, completed depth ${item.completedDepth}. See candidates.${item.key} for the resulting board and continuation.`]));
  const questions: Record<string, Question> = {
    best_move: {
      type: "choice",
      instructions: "Which candidate is the strongest O move? Compare the supplied candidate positions, threats and adversarial continuations. Prevent X's forcing attacks before quiet development. Consider ordinary single-line play as well as combinations: connected twos, straight or broken threes, whether either end is blocked, and progression from three to four to five. An open three can become an open four with two winning ends; defend early unless O has a faster forcing win. Forks are only one possible tactic, not a requirement. Search scores are bounded approximations, not proof of optimal play. All questions are independent; use only the shared state.",
      criteria,
    },
    plan: {
      type: "choice",
      instructions: "Which strategic priority best fits O in the CURRENT position before the move? Base the answer on the actual threats and move history.",
      criteria: { attack: "O can seize initiative with forcing threats.", defense: "O must disrupt X's developing threats before attacking.",
        fork: "O should build independent intersecting threats.", develop: "Neither side has an urgent threat; improve O's connections and space." },
    },
  };
  for (const item of candidates) {
    questions[`quality_${item.key}`] = {
      type: "score",
      instructions: `Evaluate O's attacking potential AFTER O plays ${item.key}, using candidates.${item.key}.rowsAfterMove and its tactical features. Assess only the resulting O initiative, not safety (asked separately).`,
      criteria: ["O stones are disconnected with no useful development.", "O gains space or a connection but no concrete threat.",
        "O develops an open three or several connected future threats.", "O makes a forcing four or a credible combination attack.",
        "O has an immediate win or independent winning threats that X cannot stop."],
    };
    questions[`risk_${item.key}`] = {
      type: "noul",
      instructions: `AFTER O plays ${item.key}, does X retain a forcing attack that O cannot defend? Inspect candidates.${item.key}.rowsAfterMove, including a single unblocked three extending into an open four, straight or broken fours, as well as double threats. Check both ends and board edges in all four directions; do not wait for five stones or assume only forks are dangerous. Treat limited search as evidence, not a guarantee.`,
      criteria: { true: "X can force a win through an immediate win or an unavoidable sequence of threats.",
        false: "O can answer X's threats or counter-win first; no concrete forced loss is apparent." },
    };
  }
  return {
    model: process.env.JEV_MODEL?.trim() || "jev-latest",
    state: {
      game: "15x15 freestyle Gomoku / Caro",
      rules: { human: "X", jev: "O", turn: "O", win: "Five or more contiguous stones horizontally, vertically or diagonally; no forbidden moves." },
      coordinates: "Columns A through O left to right; rows 1 through 15 top to bottom. '.' is empty.",
      board_rows: serializeBoard(board),
      stones: { X: board.flatMap((row, r) => row.flatMap((cell, c) => cell === "X" ? [positionToKey({ row: r, col: c })] : [])),
        O: board.flatMap((row, r) => row.flatMap((cell, c) => cell === "O" ? [positionToKey({ row: r, col: c })] : [])) },
      move_history: history.map(item => `${item.player}:${positionToKey(item.move)}`),
      threats: describePosition(board),
      candidates: Object.fromEntries(candidates.map(item => [item.key, item])),
      search_limitations: "Selective search. Continuations are illustrative best replies within explored branches, not exhaustive proofs. A candidate passed immediate tactical checks but can have deeper strategic flaws.",
    },
    questions,
  };
}

export function parseJevResponse(data: unknown, board: Board, candidates: Position[], questionCount: number): JevDecision {
  if (!record(data) || !record(data.answers) || typeof data.model !== "string") throw new Error("Jev trả về dữ liệu không hợp lệ.");
  const answer = data.answers.best_move;
  if (!record(answer) || answer.type !== "choice" || typeof answer.choice !== "string" || !unit(answer.confidence) || !record(answer.probabilities)) {
    throw new Error("Jev thiếu kết quả chọn nước hợp lệ.");
  }
  const move = keyToPosition(answer.choice);
  const key = move ? positionToKey(move) : "";
  const keys = candidates.map(positionToKey);
  if (!move || !keys.includes(key) || board[move.row][move.col] !== null) throw new Error("Jev chọn nước ngoài danh sách hợp lệ.");
  const probabilities: Record<string, number> = {};
  for (const candidate of keys) {
    const probability = answer.probabilities[candidate];
    if (!unit(probability)) throw new Error("Phân bố xác suất của Jev không hợp lệ.");
    probabilities[candidate] = probability;
  }
  const total = Object.values(probabilities).reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - 1) > 0.02 || Object.keys(answer.probabilities).some(item => !keys.includes(item))) {
    throw new Error("Phân bố xác suất của Jev không khớp các ứng viên.");
  }
  for (const candidate of keys) probabilities[candidate] /= total;
  const plan = data.answers.plan;
  if (!record(plan) || plan.type !== "choice" || typeof plan.choice !== "string" || !Object.hasOwn(PLANS, plan.choice)) {
    throw new Error("Jev thiếu đánh giá chiến lược.");
  }
  const assessments = keys.map(candidate => {
    const quality = data.answers as RecordValue;
    const score = quality[`quality_${candidate}`];
    const risk = quality[`risk_${candidate}`];
    if (!record(score) || score.type !== "score" || typeof score.score !== "number" || !Number.isFinite(score.score) ||
      score.score < 0 || score.score > 4 || !unit(score.confidence) || !record(risk) || risk.type !== "noul" || !unit(risk.noul)) {
      throw new Error("Jev thiếu đánh giá tấn công hoặc rủi ro của ứng viên.");
    }
    // Low-confidence quality scores contribute less, without inventing certainty.
    const attack = 0.5 + (score.score / 4 - 0.5) * score.confidence;
    return { key: candidate, strategyScore: score.score, risk: risk.noul,
      preference: probabilities[candidate] * 0.5 + attack * 0.2 + (1 - risk.noul) * 0.3 };
  });
  let usage: JevDecision["usage"];
  if (record(data.usage) && typeof data.usage.input_tokens === "number" && typeof data.usage.output_tokens === "number" &&
    Number.isSafeInteger(data.usage.input_tokens) && data.usage.input_tokens >= 0 && Number.isSafeInteger(data.usage.output_tokens) && data.usage.output_tokens >= 0) {
    usage = { input_tokens: data.usage.input_tokens, output_tokens: data.usage.output_tokens };
  }
  return { move, key, confidence: answer.confidence, probabilities, model: data.model, usage,
    plan: PLANS[plan.choice], assessments, questions: questionCount };
}

export async function chooseMoveWithJev(board: Board, candidates: Position[], analysis: MoveAnalysis[] = [],
  history: GameMove[] = [], signal?: AbortSignal): Promise<JevDecision> {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) throw new Error("Chưa cấu hình TYPESAFE_API_KEY; đang dùng bộ máy cờ cục bộ.");
  const payload = buildJevRequest(board, analysis, history);
  const timeout = AbortSignal.timeout(12_000);
  const response = await fetch(TYPESAFE_URL, {
    method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload), cache: "no-store", signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  // Never reflect provider response bodies or credentials into the browser.
  if (!response.ok) throw new Error(`Jev tạm thời không khả dụng (HTTP ${response.status}).`);
  return parseJevResponse(await response.json(), board, candidates, Object.keys(payload.questions).length);
}
