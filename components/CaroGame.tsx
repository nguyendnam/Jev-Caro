"use client";

import { useMemo, useState } from "react";
import {
  BOARD_SIZE,
  boardIsFull,
  cloneBoard,
  createEmptyBoard,
  isWinningMove,
  positionToKey,
} from "@/lib/game";
import type { Board, MoveResponse, Position } from "@/types/game";

type GameResult = "human" | "jev" | "draw" | null;

function sourceLabel(source: MoveResponse["source"]): string {
  switch (source) {
    case "tactical-win":
      return "Rule engine: winning move";
    case "tactical-block":
      return "Rule engine: forced block";
    case "fallback":
      return "Fallback move";
    default:
      return "Jev decision";
  }
}

export default function CaroGame() {
  const [board, setBoard] = useState<Board>(() => createEmptyBoard());
  const [result, setResult] = useState<GameResult>(null);
  const [thinking, setThinking] = useState(false);
  const [lastDecision, setLastDecision] = useState<MoveResponse | null>(null);
  const [lastHumanMove, setLastHumanMove] = useState<Position | null>(null);
  const [lastJevMove, setLastJevMove] = useState<Position | null>(null);

  const topProbabilities = useMemo(() => {
    if (!lastDecision) return [];
    return Object.entries(lastDecision.probabilities)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [lastDecision]);

  async function askJev(nextBoard: Board) {
    setThinking(true);

    try {
      const response = await fetch("/api/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ board: nextBoard }),
      });

      const data = (await response.json()) as MoveResponse | { error: string };
      if (!response.ok || "error" in data) {
        throw new Error("error" in data ? data.error : "Move request failed");
      }

      const aiBoard = cloneBoard(nextBoard);
      const { move } = data;

      if (aiBoard[move.row][move.col] !== null) {
        throw new Error("Server returned an occupied cell");
      }

      aiBoard[move.row][move.col] = "O";
      setLastDecision(data);
      setLastJevMove(move);
      setBoard(aiBoard);

      if (isWinningMove(aiBoard, move, "O")) {
        setResult("jev");
      } else if (boardIsFull(aiBoard)) {
        setResult("draw");
      }
    } catch (error) {
      console.error(error);
    } finally {
      setThinking(false);
    }
  }

  function handleCellClick(row: number, col: number) {
    if (thinking || result || board[row][col] !== null) return;

    const nextBoard = cloneBoard(board);
    const move = { row, col };
    nextBoard[row][col] = "X";
    setBoard(nextBoard);
    setLastHumanMove(move);

    if (isWinningMove(nextBoard, move, "X")) {
      setResult("human");
      return;
    }

    if (boardIsFull(nextBoard)) {
      setResult("draw");
      return;
    }

    void askJev(nextBoard);
  }

  function resetGame() {
    setBoard(createEmptyBoard());
    setResult(null);
    setThinking(false);
    setLastDecision(null);
    setLastHumanMove(null);
    setLastJevMove(null);
  }

  const status = result
    ? result === "human"
      ? "Bạn thắng"
      : result === "jev"
        ? "Jev thắng"
        : "Hòa"
    : thinking
      ? "Jev đang quyết định..."
      : "Lượt của bạn";

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">SYSTEM ONE GAME LAB</p>
          <h1>JEV CARO</h1>
          <p className="subtitle">
            Bạn là X. Jev là O. Luật bắt buộc do code xử lý. Jev chọn nước chiến lược.
          </p>
        </div>
        <button className="resetButton" onClick={resetGame}>
          NEW GAME
        </button>
      </section>

      <section className="gameGrid">
        <div className="boardPanel">
          <div className="statusBar">
            <strong>{status}</strong>
            <span>15 × 15 · Thắng khi có ≥ 5 quân liên tiếp</span>
          </div>

          <div className="boardWrap">
            <div className="columnLabels">
              <span />
              {Array.from({ length: BOARD_SIZE }, (_, col) => (
                <span key={col}>{String.fromCharCode(65 + col)}</span>
              ))}
            </div>

            <div className="boardWithRows">
              <div className="rowLabels">
                {Array.from({ length: BOARD_SIZE }, (_, row) => (
                  <span key={row}>{row + 1}</span>
                ))}
              </div>

              <div className="board" role="grid" aria-label="Caro board">
                {board.map((row, rowIndex) =>
                  row.map((cell, colIndex) => {
                    const isHumanLast =
                      lastHumanMove?.row === rowIndex &&
                      lastHumanMove?.col === colIndex;
                    const isJevLast =
                      lastJevMove?.row === rowIndex && lastJevMove?.col === colIndex;

                    return (
                      <button
                        key={`${rowIndex}-${colIndex}`}
                        className={`cell ${cell ? `cell-${cell}` : ""} ${
                          isHumanLast || isJevLast ? "cell-last" : ""
                        }`}
                        onClick={() => handleCellClick(rowIndex, colIndex)}
                        disabled={thinking || result !== null || cell !== null}
                        aria-label={`${positionToKey({ row: rowIndex, col: colIndex })}: ${
                          cell ?? "empty"
                        }`}
                      >
                        {cell}
                      </button>
                    );
                  }),
                )}
              </div>
            </div>
          </div>
        </div>

        <aside className="decisionPanel">
          <p className="panelKicker">DECISION TRACE</p>
          <h2>{lastDecision ? lastDecision.key : "—"}</h2>

          {lastDecision ? (
            <>
              <div className="metric">
                <span>Source</span>
                <strong>{sourceLabel(lastDecision.source)}</strong>
              </div>
              <div className="metric">
                <span>Confidence</span>
                <strong>{Math.round(lastDecision.confidence * 100)}%</strong>
              </div>
              {lastDecision.model && (
                <div className="metric">
                  <span>Model</span>
                  <strong>{lastDecision.model}</strong>
                </div>
              )}

              <div className="probabilityList">
                {topProbabilities.map(([key, probability]) => (
                  <div className="probabilityRow" key={key}>
                    <div className="probabilityMeta">
                      <strong>{key}</strong>
                      <span>{Math.round(probability * 100)}%</span>
                    </div>
                    <div className="track">
                      <div
                        className="fill"
                        style={{ width: `${Math.max(2, probability * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {lastDecision.usage && (
                <p className="usage">
                  {lastDecision.usage.input_tokens} input tokens · {lastDecision.usage.output_tokens}{" "}
                  output tokens
                </p>
              )}

              {lastDecision.warning && (
                <p className="warning">Jev unavailable: {lastDecision.warning}</p>
              )}
            </>
          ) : (
            <p className="emptyState">
              Đánh nước đầu tiên. Sau lượt của Jev, quyết định và xác suất sẽ xuất hiện ở đây.
            </p>
          )}
        </aside>
      </section>
    </main>
  );
}
