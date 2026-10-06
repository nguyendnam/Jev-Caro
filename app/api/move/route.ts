import { NextResponse } from "next/server";
import { decideMove } from "@/lib/decision";
import { isBoardShapeValid, replayMoves, serializeBoard, validateJevTurn } from "@/lib/game";
import type { GameMove } from "@/types/game";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  let payload: unknown;
  try { payload = await request.json(); }
  catch { return NextResponse.json({ error: "Nội dung JSON không hợp lệ." }, { status: 400 }); }
  if (!payload || typeof payload !== "object" || !("board" in payload) || !isBoardShapeValid(payload.board)) {
    return NextResponse.json({ error: "Bàn cờ phải có 15 × 15 ô X, O hoặc trống." }, { status: 400 });
  }
  const board = payload.board;
  const issue = validateJevTurn(board);
  if (issue) return NextResponse.json({ error: issue }, { status: 409 });
  // Legacy clients may still send a mode; all requests use the same analysis settings.
  let history: GameMove[] = [];
  if ("history" in payload) {
    const replay = replayMoves(payload.history);
    if (!replay || serializeBoard(replay.board).join("") !== serializeBoard(board).join("")) {
      return NextResponse.json({ error: "Lịch sử không khớp bàn cờ." }, { status: 400 });
    }
    history = replay.moves;
  }
  try {
    const decision = await decideMove(board, history, request.signal);
    return NextResponse.json(decision);
  } catch {
    return NextResponse.json({ error: request.signal.aborted ? "Lượt phân tích đã hủy." : "Không thể xử lý lượt đi. Hãy thử lại." },
      { status: request.signal.aborted ? 499 : 500 });
  }
}
