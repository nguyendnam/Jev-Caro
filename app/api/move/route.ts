import { NextResponse } from "next/server";
import { analyzeMoves, strategicChoices } from "@/lib/strategy";
import {
  findImmediateMove,
  isBoardShapeValid,
  positionToKey,
} from "@/lib/game";
import { chooseMoveWithJev } from "@/lib/jev";
import type { Board, MoveResponse, Position } from "@/types/game";

function tacticalResponse(
  move: Position,
  source: "tactical-win" | "tactical-block",
): MoveResponse {
  const key = positionToKey(move);
  return {
    move,
    key,
    source,
    confidence: 1,
    probabilities: { [key]: 1 },
  };
}

function fallbackResponse(
  move: Position,
  warning: string,
): MoveResponse {
  const key = positionToKey(move);
  return {
    move,
    key,
    source: "fallback",
    confidence: 0,
    probabilities: { [key]: 1 },
    warning,
  };
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { board?: Board };

    if (!isBoardShapeValid(payload.board)) {
      return NextResponse.json({ error: "Invalid 15x15 board" }, { status: 400 });
    }

    const board = payload.board;

    const winningMove = findImmediateMove(board, "O");
    if (winningMove) {
      return NextResponse.json(tacticalResponse(winningMove, "tactical-win"));
    }

    const analysis = analyzeMoves(board);
    const shortlist = strategicChoices(analysis);
    const candidates = shortlist.map(item => item.move);
    if (candidates.length === 0) {
      return NextResponse.json({ error: "No legal move available" }, { status: 409 });
    }

    // Use the searched defense, including forcing continuations, rather than
    // returning the first winning square found in row/column order.
    if (findImmediateMove(board, "X")) {
      const response = tacticalResponse(analysis[0].move, "tactical-block");
      response.searchDepth = analysis[0].depth;
      response.reason = analysis[0].score <= -9_000_000
        ? "Đối thủ đã có thế thắng bắt buộc; chặn một đầu không đủ cứu ván cờ."
        : "Chặn đường thắng trực tiếp, sau khi kiểm tra các nước tiếp theo.";
      return NextResponse.json(response);
    }

    try {
      const decision = await chooseMoveWithJev(board, candidates, shortlist);
      const response: MoveResponse = {
        ...decision,
        source: "jev",
        searchDepth: shortlist[0].depth,
      };
      return NextResponse.json(response);
    } catch (error) {
      const warning = error instanceof Error ? error.message : "Unknown Jev error";
      return NextResponse.json({ ...fallbackResponse(analysis[0].move, warning), searchDepth: analysis[0].depth });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
