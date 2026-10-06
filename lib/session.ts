import { boardIsFull, getWinningLine, isInside, replayMoves } from "@/lib/game";
import type { GameMove, MoveResponse, Position } from "@/types/game";

export type Session = {
  moves: GameMove[];
  decision: MoveResponse | null;
  status: "human" | "thinking" | "error" | "finished";
  requestId: number;
  error: string | null;
};
export const emptySession = (): Session => ({ moves: [], decision: null, status: "human", requestId: 0, error: null });
export type SessionAction =
  | { type: "human"; move: Position }
  | { type: "resolved"; id: number; decision: MoveResponse }
  | { type: "failed"; id: number; error: string }
  | { type: "retry" }
  | { type: "undo" }
  | { type: "reset" }
  | { type: "restore"; moves: unknown };

export function sessionReducer(state: Session, action: SessionAction): Session {
  if (action.type === "reset") return { ...emptySession(), requestId: state.requestId + 1 };
  if (action.type === "restore") {
    const replay = replayMoves(action.moves);
    if (!replay) return state;
    const finished = !!getWinningLine(replay.board).length || boardIsFull(replay.board);
    const waiting = replay.moves.length % 2 === 1;
    return { ...emptySession(), moves: replay.moves, requestId: state.requestId + 1,
      status: finished ? "finished" : waiting ? "error" : "human",
      error: !finished && waiting ? "Ván đã lưu đang chờ lượt Jev. Bấm tiếp tục để phân tích." : null };
  }
  if (action.type === "undo") {
    if (!state.moves.length) return state;
    const moves = state.moves.slice(0, -(state.moves.at(-1)?.player === "X" ? 1 : 2));
    return { moves, decision: null,
      status: "human", error: null, requestId: state.requestId + 1 };
  }
  if (action.type === "retry") return state.status === "error"
    ? { ...state, status: "thinking", error: null, requestId: state.requestId + 1 } : state;
  if (action.type === "failed") return state.status === "thinking" && action.id === state.requestId
    ? { ...state, status: "error", error: action.error } : state;
  if (action.type === "human") {
    if (state.status !== "human" || !Number.isInteger(action.move.row) || !Number.isInteger(action.move.col) ||
      !isInside(action.move.row, action.move.col)) return state;
    const replay = replayMoves([...state.moves, { player: "X", move: action.move }]);
    if (!replay) return state;
    return { ...state, moves: replay.moves, error: null, requestId: state.requestId + 1,
      status: getWinningLine(replay.board).length || boardIsFull(replay.board) ? "finished" : "thinking" };
  }
  if (action.type === "resolved") {
    if (state.status !== "thinking" || action.id !== state.requestId) return state;
    const replay = replayMoves([...state.moves, { player: "O", move: action.decision.move }]);
    if (!replay) return { ...state, status: "error", error: "Máy chủ trả về nước không hợp lệ. Hãy thử lại." };
    return { ...state, moves: replay.moves, decision: action.decision,
      status: getWinningLine(replay.board).length || boardIsFull(replay.board) ? "finished" : "human", error: null };
  }
  return state;
}
