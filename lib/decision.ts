import { findImmediateMove, positionToKey } from "@/lib/game";
import { chooseMoveWithJev, type JevDecision } from "@/lib/jev";
import { analyzeMoves, strategicChoices, type MoveAnalysis } from "@/lib/strategy";
import type { Board, CandidateTrace, GameMove, MoveResponse } from "@/types/game";

// A short tactical screen supplies context; Jev makes the strategic choice.

function trace(analysis: MoveAnalysis[], jev?: JevDecision): CandidateTrace[] {
  return analysis.slice(0, 8).map(item => {
    const key = positionToKey(item.move);
    const assessment = jev?.assessments.find(value => value.key === key);
    return { key, score: Math.round(item.score), depth: item.depth,
      line: item.line.map(positionToKey), threats: item.threats,
      probability: jev?.probabilities[key], strategyScore: assessment?.strategyScore, risk: assessment?.risk };
  });
}

export function selectVerifiedMove(analysis: MoveAnalysis[], jev: JevDecision): MoveAnalysis {
  const eligible = strategicChoices(analysis, 8);
  return [...eligible].sort((a, b) => {
    const preference = (item: MoveAnalysis) => jev.assessments.find(value => value.key === positionToKey(item.move))?.preference ?? -1;
    return preference(b) - preference(a) || b.score - a.score;
  })[0];
}

export async function decideMove(board: Board, history: GameMove[] = [], signal?: AbortSignal): Promise<MoveResponse> {
  const started = performance.now();
  const winning = findImmediateMove(board, "O");
  if (winning) {
    const key = positionToKey(winning);
    return { move: winning, key, source: "tactical-win", confidence: 1, probabilities: {},
      reason: "Hoàn thành ít nhất năm quân liên tiếp.", evaluation: "winning", searchDepth: 0,
      principalVariation: [key], elapsedMs: Math.round(performance.now() - started), nodes: 0 };
  }
  const analysis = analyzeMoves(board, 600, 4);
  if (!analysis.length) throw new Error("Không còn nước hợp lệ.");
  const totalNodes = analysis[0].nodes;
  const finish = (selected: MoveAnalysis, extra: Partial<MoveResponse>, finalAnalysis = analysis): MoveResponse => ({
    move: selected.move, key: positionToKey(selected.move), source: "engine", confidence: 0, probabilities: {},
    searchDepth: selected.depth, principalVariation: selected.line.map(positionToKey),
    evaluation: selected.proven === "win" ? "winning" : selected.proven === "loss" ? "losing" : "uncertain",
    elapsedMs: Math.round(performance.now() - started), nodes: totalNodes,
    candidates: trace(finalAnalysis), ...extra,
  });
  if (findImmediateMove(board, "X")) {
    return finish(analysis[0], { source: "tactical-block",
      reason: analysis[0].proven === "loss"
        ? "Đối thủ có thế thắng bắt buộc trong các nhánh đã xét; một nước chặn không đủ hóa giải."
        : "Chặn đường thắng trực tiếp và kiểm tra chuỗi đáp trả." });
  }
  if (analysis[0].proven === "win") {
    return finish(analysis[0], { reason: "Bộ tìm kiếm tìm thấy chuỗi tấn công dẫn tới thắng trong các nhánh đã xét." });
  }
  const shortlist = strategicChoices(analysis, 8);
  let decision: JevDecision | undefined;
  let warning: string | undefined;
  try {
    decision = await chooseMoveWithJev(board, shortlist.map(item => item.move), shortlist, history, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    warning = error instanceof Error && error.name !== "TimeoutError" && error.name !== "AbortError"
      ? error.message : "Jev hết thời gian phản hồi; đã dùng kết quả tìm kiếm cục bộ.";
  }
  signal?.throwIfAborted();
  const finalAnalysis = shortlist;
  if (!decision) return finish(finalAnalysis[0], { source: "fallback", warning,
    reason: finalAnalysis[0].threats.join(" · ") }, finalAnalysis);
  const selected = selectVerifiedMove(finalAnalysis, decision);
  const overridden = positionToKey(selected.move) !== decision.key;
  return finish(selected, {
    source: overridden ? "verified" : "jev", confidence: decision.confidence,
    probabilities: decision.probabilities, model: decision.model, usage: decision.usage,
    reason: `${selected.threats.join(" · ")}. Jev ưu tiên: ${decision.plan.toLowerCase()}.${overridden ? " Đánh giá tấn công và rủi ro chọn nước khác với đề xuất Choice ban đầu." : " Jev chọn dựa trên thế cờ và các đáp trả đã cung cấp."}`,
    candidates: trace(finalAnalysis, decision),
    jev: { choice: decision.key, plan: decision.plan, questions: decision.questions, assessments: decision.assessments, overridden },
  }, finalAnalysis);
}
