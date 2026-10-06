"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { BOARD_SIZE, createEmptyBoard, getWinningLine, positionToKey, replayMoves } from "@/lib/game";
import { emptySession, sessionReducer } from "@/lib/session";
import type { MoveResponse } from "@/types/game";

const SAVE_KEY = "jev-caro:v2";
const SOURCE: Record<MoveResponse["source"], string> = {
  "tactical-win": "Nước thắng trực tiếp", "tactical-block": "Phòng thủ bắt buộc",
  jev: "Jev · đã lọc chiến thuật", verified: "Jev · tổng hợp đánh giá", engine: "Chuỗi tấn công tìm được", fallback: "Bộ máy cờ cục bộ",
};

export default function CaroGame() {
  const [session, dispatch] = useReducer(sessionReducer, undefined, emptySession);
  const [ready, setReady] = useState(false);
  const [storageNotice, setStorageNotice] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [focused, setFocused] = useState(112);
  const boardRef = useRef<HTMLDivElement>(null);
  const thinking = session.status === "thinking";
  const ply = session.moves.length;
  const board = useMemo(() => replayMoves(session.moves)?.board ?? createEmptyBoard(), [session.moves]);
  const winningLine = useMemo(() => new Set(getWinningLine(board).map(positionToKey)), [board]);
  const lastMove = session.moves.at(-1);
  const decision = session.decision;
  const result = winningLine.size ? lastMove?.player === "X" ? "Bạn thắng" : "Jev thắng"
    : ply === 225 ? "Hòa" : null;
  const status = result ?? (thinking ? "Jev đang phân tích" : session.status === "error" ? "Đang chờ lượt Jev" : "Đến lượt bạn");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved && saved.version === 2 && replayMoves(saved.moves)) {
          dispatch({ type: "restore", moves: saved.moves });
        } else setStorageNotice("Bản lưu không hợp lệ; đã mở ván mới.");
      }
    } catch { setStorageNotice("Không đọc được bản lưu trên trình duyệt này."); }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ version: 2, moves: session.moves })); }
    catch { setStorageNotice("Không thể tự lưu trên trình duyệt này."); }
  }, [session.moves, ready]);

  useEffect(() => {
    if (!thinking) return;
    const controller = new AbortController();
    const id = session.requestId;
    const current = replayMoves(session.moves);
    if (!current) return;
    let active = true;
    const started = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    void (async () => {
      try {
        const response = await fetch("/api/move", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ board: current.board, history: current.moves }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
        });
        const data = await response.json();
        if (!response.ok || data.error) throw new Error(data.error || "Không thể xử lý lượt đi.");
        if (!data.move || typeof data.key !== "string" || !Object.hasOwn(SOURCE, data.source)) throw new Error("Phản hồi nước đi không hợp lệ.");
        if (active) dispatch({ type: "resolved", id, decision: data });
      } catch (error) {
        if (!active || controller.signal.aborted) return;
        dispatch({ type: "failed", id, error: error instanceof Error && error.name !== "TimeoutError"
          ? error.message : "Lượt phân tích hết thời gian. Hãy thử lại hoặc đi lại nước vừa đánh." });
      }
    })();
    return () => { active = false; controller.abort(); clearInterval(timer); };
  }, [thinking, session.requestId, session.moves]);

  function reset() { dispatch({ type: "reset" }); }
  function undo() { dispatch({ type: "undo" }); }

  return (
    <main className="shell">
      <header className="hero">
        <div><p className="eyebrow">SYSTEM ONE / STRATEGY LAB</p><h1>JEV CARO<span className="titleDot">.</span></h1>
          <p className="subtitle">Đọc thế cờ. Dự đoán đòn đáp trả. Đấu trí cùng Jev.</p></div>
        <button className="resetButton" onClick={reset}>VÁN MỚI <span aria-hidden="true">↗</span></button>
      </header>

      <section className="gameToolbar" aria-label="Cài đặt ván cờ">
        <div className="boardActions">
          <button className="smallButton" disabled={!session.moves.length} onClick={undo}>↶ Đi lại</button>
        </div>
        <span className="saveState">{ready ? "Lưu trên máy" : "Đang khôi phục…"}</span>
      </section>

      <section className="gameGrid">
        <div className="boardColumn">
          <section className="boardPanel" aria-label="Ván đấu">
            <div className="statusBar">
              <div className="statusTitle"><span className={`statusDot ${thinking ? "pulse" : ""}`} />
                <strong role="status" aria-live="polite">{status}</strong></div>
              <span>{thinking ? `${elapsed}s · tìm kiếm & đánh giá Jev` : <><b className="xText">X</b> Bạn · <b className="oText">O</b> Jev · Nước {ply}</>}</span>
            </div>
            <div className="boardStage"><div className="boardWrap">
              <div className="columnLabels"><span />{Array.from({ length: BOARD_SIZE }, (_, col) => <span key={col}>{String.fromCharCode(65 + col)}</span>)}</div>
              <div className="boardWithRows">
                <div className="rowLabels">{Array.from({ length: BOARD_SIZE }, (_, row) => <span key={row}>{row + 1}</span>)}</div>
                <div className="board" role="group" aria-label="Bàn cờ Caro" ref={boardRef}>
                  {board.flatMap((row, r) => row.map((cell, c) => {
                    const key = positionToKey({ row: r, col: c });
                    const index = r * 15 + c;
                    const last = lastMove?.move.row === r && lastMove.move.col === c;
                    const blocked = !ready || session.status !== "human" || cell !== null;
                    return <button key={key} data-cell={index} tabIndex={focused === index ? 0 : -1}
                      className={`cell ${cell ? `cell-${cell}` : ""} ${last ? "cell-last" : ""} ${winningLine.has(key) ? "cell-win" : ""}`}
                      aria-label={`${key}: ${cell ?? "trống"}`}
                      aria-disabled={blocked}
                      onFocus={() => setFocused(index)}
                      onClick={() => { if (!blocked) dispatch({ type: "human", move: { row: r, col: c } }); }}
                      onKeyDown={event => {
                        const offset: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -15, ArrowDown: 15 };
                        if (!Object.hasOwn(offset, event.key)) return;
                        event.preventDefault();
                        const next = Math.max(0, Math.min(224, index + offset[event.key]));
                        boardRef.current?.querySelector<HTMLButtonElement>(`[data-cell="${next}"]`)?.focus();
                      }}>
                      {cell}
                    </button>;
                  }))}
                </div>
              </div>
            </div></div>
            {session.error && <div className="errorBanner" role="alert"><p>{session.error}</p>
              <button className="smallButton" onClick={() => dispatch({ type: "retry" })}>Tiếp tục lượt Jev</button></div>}
            {storageNotice && <p className="warning">{storageNotice}</p>}
          </section>

        </div>

        <div className="sideColumn">
        <aside className="decisionPanel" aria-label="Phân tích của Jev">
          <div className="sectionHeading"><p className="panelKicker">JEV / DECISION</p><span className="badge">{thinking ? "ĐANG NGHĨ" : decision ? "ĐÃ PHÂN TÍCH" : "SẴN SÀNG"}</span></div>
          {decision ? <>
            <div className="decisionHero"><h2>{decision.key}</h2><span>{SOURCE[decision.source]}</span></div>
            <p className="decisionReason">{decision.reason}</p>
            <div className="analysisStats"><div><small>Độ sâu hoàn tất</small><strong>{decision.searchDepth ?? 0}<em> lượt</em></strong></div>
              <div><small>Thời gian</small><strong>{((decision.elapsedMs ?? 0) / 1000).toFixed(1)}<em>s</em></strong></div>
              <div><small>Nhánh đã xét</small><strong>{(decision.nodes ?? 0).toLocaleString("vi-VN")}</strong></div>
              <div><small>Câu hỏi Jev</small><strong>{decision.jev?.questions ?? 0}</strong></div></div>
            {decision.jev && <div className="jevInsight"><p className="panelKicker">GÓC NHÌN CỦA MÔ HÌNH</p>
              <p>{decision.jev.plan}</p><div className="metric"><span>Choice đề xuất</span><strong>{decision.jev.choice}</strong></div>
              <div className="metric"><span>Độ tin cậy Choice</span><strong>{Math.round(decision.confidence * 100)}%</strong></div>
              <p className="muted">Độ tin cậy là mức tập trung của phân bố lựa chọn, không phải xác suất thắng.</p></div>}
            {decision.evaluation === "losing" && <p className="warning">Tìm kiếm phát hiện nguy cơ thua trong các nhánh đã xét.</p>}
            {decision.principalVariation && decision.principalVariation.length > 1 && <div className="continuation">
              <p className="panelKicker">NHÁNH DỰ KIẾN</p><div>{decision.principalVariation.slice(0, 8).map((key, i) =>
                <span key={`${key}-${i}`} className={i % 2 ? "xText" : "oText"}>{i % 2 ? "X" : "O"} {key}</span>)}</div>
              <p className="muted">Một nhánh từ tìm kiếm; đối thủ có thể chọn cách đáp khác.</p></div>}
            {!!decision.candidates?.length && <details className="candidateDetails" open><summary>So sánh {decision.candidates.length} ứng viên</summary>
              {decision.candidates.map(candidate => <div className={`candidateCard ${candidate.key === decision.key ? "selected" : ""}`} key={candidate.key}>
                <div className="candidateTop"><strong>{candidate.key}</strong><span>{candidate.probability !== undefined ? `Choice ${Math.round(candidate.probability * 100)}%` : `Điểm ${candidate.score.toLocaleString("vi-VN")}`}</span></div>
                {candidate.probability !== undefined && <div className="track"><div className="fill" style={{ width: `${candidate.probability * 100}%` }} /></div>}
                <p>{candidate.threats.join(" · ")}</p>
                {candidate.strategyScore !== undefined && <small>Tấn công {candidate.strategyScore.toFixed(1)}/4 · Rủi ro Jev ước lượng {Math.round((candidate.risk ?? 0) * 100)}%</small>}
              </div>)}
            </details>}
            {decision.warning && <p className="warning" role="status">{decision.warning}</p>}
            <p className="modelFootnote">{decision.model ?? "Local engine"}{decision.usage ? ` · ${decision.usage.input_tokens.toLocaleString("vi-VN")} token vào / ${decision.usage.output_tokens} ra` : ""}</p>
          </> : <div className="emptyAnalysis"><div className="emptyMark">O</div><h2>{thinking ? "Jev đang đọc thế cờ." : ply ? "Tiếp tục ván đấu." : "Jev đang chờ bạn."}</h2>
            <p>Mỗi lượt chiến lược, Jev so sánh nước đi, đánh giá tấn công và nhận diện rủi ro. Các nước nguy hiểm rõ ràng được kiểm tra trước khi gửi cho Jev.</p>
            <ol><li>Đọc toàn bộ thế cờ</li><li>Đánh giá nhiều phương án</li><li>Cân nhắc cách đối thủ đáp trả</li></ol></div>}
        </aside>

        </div>
      </section>
      <footer className="pageFooter"><span>15 × 15 · Nối ≥ 5 quân để thắng</span><span>Phím mũi tên để di chuyển · Enter để đánh</span></footer>
    </main>
  );
}
