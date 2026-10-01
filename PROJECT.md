# JEV CARO — Mô tả dự án & Kiến trúc

> Game Caro (Gomoku) 15×15: Người chơi (X) đấu với AI "Jev" (O).
> Triết lý: **luật bắt buộc do code deterministic xử lý; Jev chỉ chọn nước chiến lược** trong danh sách đã được bộ máy tìm kiếm đối kháng thẩm định.

---

## 1. Tổng quan công nghệ

| Thành phần | Công nghệ |
|---|---|
| Framework | Next.js (App Router) |
| UI | React 19, CSS thuần (`globals.css`) |
| Ngôn ngữ | TypeScript strict |
| AI Engine | Negamax + Alpha-Beta pruning, Iterative Deepening |
| AI Integration | Jev (TypeSafe SystemOne API) |
| Testing | Node.js built-in test runner |
| Runtime | Node.js 18+ |

---

## 2. Cấu trúc thư mục

```
Caro-Jev/
├── app/
│   ├── layout.tsx              # Root layout, metadata, lang="vi"
│   ├── page.tsx                # Trang chủ — render <CaroGame />
│   ├── globals.css             # Toàn bộ styling
│   └── api/
│       └── move/
│           └── route.ts        # POST /api/move — pipeline quyết định
├── components/
│   └── CaroGame.tsx            # Client component: bàn cờ + decision trace
├── lib/
│   ├── game.ts                 # Logic cốt lõi (board, win/loss, serialize)
│   ├── candidates.ts           # Sinh nước đi ứng viên theo mật độ
│   ├── strategy.ts             # Tìm kiếm alpha-beta + đánh giá thế cờ
│   └── jev.ts                  # Gọi Jev API (TypeSafe SystemOne)
├── types/
│   └── game.ts                 # Type definitions chung
├── tests/
│   └── strategy.test.cjs       # Unit tests cho strategy engine
├── .env.example                # Mẫu biến môi trường
├── .env.local                  # API key thực (git-ignored)
├── package.json
├── tsconfig.json               # Config chính (noEmit, bundler resolution)
├── tsconfig.test.json          # Config build test (CommonJS → .test-build/)
└── PROJECT.md                  # File này
```

---

## 3. Luồng xử lý một lượt đi (Pipeline)

```
┌─────────────────────────────────────────────────────────────────────┐
│                        NGƯỜI CHƠI CLICK Ô                           │
│                    (Client — CaroGame.tsx)                          │
│  • Đặt X lên bàn cờ                                                │
│  • Kiểm tra thắng/hòa ngay tại client                              │
│  • Nếu chưa kết thúc → POST /api/move { board }                   │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   SERVER — app/api/move/route.ts                    │
│                                                                     │
│  Bước 0: Validate board shape (15×15, chỉ X/O/null)                │
│     │                                                               │
│     ▼                                                               │
│  Bước 1: O có nước thắng ngay?  ──YES──▶  Trả "tactical-win"       │
│     │NO                                                             │
│     ▼                                                               │
│  Bước 2: X sắp thắng (cần chặn)? ──YES──▶  Trả "tactical-block"   │
│     │NO                                                             │
│     ▼                                                               │
│  Bước 3: analyzeMoves() — tìm kiếm alpha-beta                      │
│     │       → strategicChoices() — lọc nước cùng điểm cao nhất     │
│     ▼                                                               │
│  Bước 4: chooseMoveWithJev() — gửi shortlist cho Jev               │
│     │                                                               │
│     ├─ Thành công ──▶  Trả "jev" + confidence + probabilities      │
│     │                                                               │
│     └─ Thất bại ───▶  Trả "fallback" (nước đầu analysis) + warning │
│                                                                     │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   CLIENT — Cập nhật UI                              │
│  • Đặt O lên bàn cờ (validate lại ô trống)                         │
│  • Kiểm tra thắng/hòa cho O                                        │
│  • Hiển thị Decision Trace panel                                    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 4. Chi tiết từng module

### 4.1 `lib/game.ts` — Logic cốt lõi

| Hàm | Mục đích |
|---|---|
| `createEmptyBoard()` | Tạo bàn cờ 15×15 rỗng |
| `cloneBoard(board)` | Sao chép sâu (immutable update) |
| `isInside(row, col)` | Kiểm tra tọa độ trong biên |
| `isBoardShapeValid(board)` | Validate payload từ client |
| `isWinningMove(board, pos, player)` | Kiểm tra ≥5 quân liên tiếp qua 4 hướng |
| `boardIsFull(board)` | Kiểm tra hòa |
| `getLegalMoves(board)` | Liệt kê mọi ô trống |
| `findImmediateMove(board, player)` | Tìm nước thắng ngay (duyệt toàn bộ) |
| `positionToKey(pos)` / `keyToPosition(key)` | Chuyển đổi `{row,col}` ↔ `"H8"` |
| `serializeBoard(board)` | Bàn cờ → mảng chuỗi `"."/"X"/"O"` cho Jev |

**Hằng số:** `BOARD_SIZE = 15`, `WIN_LENGTH = 5`, 4 hướng kiểm tra: ngang, dọc, chéo chính, chéo phụ.

---

### 4.2 `lib/candidates.ts` — Sinh nước ứng viên

**Mục tiêu:** Giảm không gian tìm kiếm từ 225 ô xuống ~48 ô hợp lý.

**Thuật toán:**
1. Nếu bàn cờ trống → trả về ô trung tâm `H8`.
2. Với mỗi quân đã đặt, xét mọi ô trống trong bán kính `radius` (mặc định 2).
3. Chấm điểm mỗi ô: `score = density × 10 − centerDistance`
   - `density`: số quân lân cận trong bán kính 2
   - `centerDistance`: khoảng cách Manhattan tới tâm
4. Sắp xếp giảm dần, lấy tối đa `maxCandidates` (mặc định 48).

> Trong `strategy.ts`, hàm `rank()` gọi `generateCandidates(board, 2, 225)` để lấy nhiều ứng viên hơn cho việc đánh giá threat.

---

### 4.3 `lib/strategy.ts` — Bộ máy tìm kiếm đối kháng

#### 4.3.1 Hàm đánh giá `potential(board, move, player)`

Chấm điểm mọi **cửa sổ 5 ô** đi qua một vị trí (kể cả dòng đứt đoạn):

| Số quân trong cửa sổ | Điểm cơ sở | Ghi chú |
|---|---|---|
| 5 | 10,000,000 (WIN) | Thắng ngay |
| 4 | 8,000 × (1 + open×0.5) | Tứ — thưởng thêm nếu ≥2 đầu thắng |
| 3 | 450 × (1 + open×0.5) | Tam mở (≥675 = open three) |
| 2 | 35 × (1 + open×0.5) | Cặp |
| 1 | 2 × (1 + open×0.5) | Quân đơn lẻ |

**Thưởng tổ hợp:**
- 2 tứ → +500,000 (đôi tứ = thắng chắc)
- 1 tứ + 1 tam mở → +80,000
- 2 tam mở → +15,000

#### 4.3.2 Hàm xếp hạng `rank(board, player)`

Với mỗi ứng viên:
- `attack = potential(board, move, player)` — sức tấn công
- `defense = potential(board, move, opponent)` — giá trị phòng thủ
- `priority = max(attack, defense × 1.1) + min(attack, defense) × 0.1`

Sắp xếp theo `priority` giảm dần.

#### 4.3.3 Tìm kiếm chính `analyzeMoves(board, budgetMs, maxDepth)`

```
Thuật toán: Negamax + Alpha-Beta Pruning + Iterative Deepening
Ngân sách: budgetMs (mặc định 1000ms)
Độ sâu tối đa: maxDepth (mặc định 4)
```

**Các bước:**
1. `rank()` toàn bộ ứng viên cho O.
2. Nếu có nước thắng ngay (`attack ≥ WIN`) → chỉ xét nhóm đó.
3. Nếu có nước buộc phải chặn (`defense ≥ WIN`) → chỉ xét nhóm chặn.
4. Ngược lại → lấy top 14 ứng viên.
5. **Iterative deepening** từ depth 1 → maxDepth:
   - Mỗi vòng lặp, chạy negamax cho từng ứng viên gốc.
   - Nếu hết thời gian → giữ kết quả vòng trước.
6. Trả về danh sách `{ move, score, depth }` đã sắp xếp.

**Quiescence extension:** Khi hết depth mà đối phương có nước buộc chặn, mở rộng thêm 1 ply để tránh đánh giá sai.

#### 4.3.4 `strategicChoices(analysis)`

Lọc **chỉ các nước có điểm cao nhất** (bằng điểm với nước đầu tiên), tối đa 6 nước. Đây chính là danh sách gửi cho Jev — đảm bảo Jev chỉ chọn trong nhóm tối ưu.

---

### 4.4 `lib/jev.ts` — Tích hợp Jev (TypeSafe SystemOne API)

#### Endpoint
```
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <TYPESAFE_API_KEY>
```

#### Payload gửi đi

```jsonc
{
  "model": "jev-latest",
  "state": {
    "game": "Caro / Gomoku",
    "rules": { /* luật chơi, quân, điều kiện thắng */ },
    "coordinates": "Columns A–O, Rows 1–15",
    "board_rows": ["...............", "...X...........", ...],  // serializeBoard()
    "board_legend": ". = empty, X = human, O = Jev"
  },
  "questions": {
    "best_move": {
      "type": "choice",
      "instructions": "Chọn nước mạnh nhất cho O trong các ứng viên đã được search thẩm định...",
      "criteria": {
        "H8": "Place O at H8. Search score: 12345; completed depth: 3. Higher is better for O.",
        "G7": "Place O at G7. Search score: 12345; completed depth: 3. Higher is better for O.",
        // ...
      }
    }
  }
}
```

#### Response nhận về

```jsonc
{
  "model": "jev-...",
  "answers": {
    "best_move": {
      "type": "choice",
      "choice": "H8",           // nước Jev chọn
      "confidence": 0.72,       // độ tin cậy
      "probabilities": { "H8": 0.72, "G7": 0.15, ... }
    }
  },
  "usage": { "input_tokens": 1234, "output_tokens": 56 }
}
```

#### Validation phía server

1. Parse `choice` → tọa độ `{row, col}` qua regex `^([A-O])(1[0-5]|[1-9])$`.
2. Kiểm tra tọa độ nằm trong danh sách ứng viên.
3. Kiểm tra ô đó trống trên board.
4. Nếu bất kỳ bước nào fail → ném lỗi → route trả fallback.

#### Timeout & xử lý lỗi

- `AbortSignal.timeout(8000)` — tối đa 8 giây chờ Jev.
- API key thiếu → lỗi rõ ràng.
- HTTP không 2xx → lỗi kèm body (cắt 500 ký tự).

---

### 4.5 `app/api/move/route.ts` — API Route (Pipeline orchestrator)

| Bước | Điều kiện | Kết quả | Source |
|---|---|---|---|
| Validate | Board sai shape | 400 | — |
| ① Thắng ngay | `findImmediateMove(board, "O")` ≠ null | 200 | `tactical-win` |
| ② Chặn ngay | `findImmediateMove(board, "X")` ≠ null | 200 | `tactical-block` |
| ③ Tìm kiếm | `analyzeMoves` + `strategicChoices` | — | — |
| ④ Jev | `chooseMoveWithJev(board, candidates, analysis)` | 200 | `jev` |
| ⑤ Fallback | Jev lỗi | 200 | `fallback` + `warning` |
| Lỗi khác | Bất ngờ | 500 | — |

**Đảm bảo:** Bước ①② không gọi API ngoài — phản hồi tức thời, deterministic, confidence = 1.

---

### 4.6 `components/CaroGame.tsx` — UI Client

**State:**
- `board` — bàn cờ hiện tại
- `result` — `"human" | "jev" | "draw" | null`
- `thinking` — đang chờ Jev
- `lastDecision` — object `MoveResponse` để hiển thị trace
- `lastHumanMove` / `lastJevMove` — highlight ô vừa đánh

**Xử lý click:**
1. Guard: không click khi đang thinking / đã kết thúc / ô đã có quân.
2. Đặt X → kiểm tra thắng/hòa.
3. Gọi `askJev(nextBoard)` → fetch POST → cập nhật board + trace.
4. Validate lại phía client: ô Jev trả về phải trống.

**Decision Trace Panel:**
- Source (nhãn tiếng Anh)
- Confidence %
- Model name
- Top 6 xác suất (progress bar)
- Token usage
- Warning (nếu fallback)

---

### 4.7 `types/game.ts` — Type Definitions

```typescript
type Player = "X" | "O";
type Cell = Player | null;
type Board = Cell[][];
type Position = { row: number; col: number };
type MoveSource = "tactical-win" | "tactical-block" | "jev" | "fallback";
type MoveResponse = {
  move: Position;
  key: string;          // "H8"
  source: MoveSource;
  confidence: number;   // 0–1
  probabilities: Record<string, number>;
  model?: string;
  usage?: { input_tokens: number; output_tokens: number };
  warning?: string;
};
```

---

## 5. Cách triển khai & chạy dự án

### 5.1 Yêu cầu

- Node.js ≥ 18
- API key từ TypeSafe (cho Jev)

### 5.2 Cài đặt

```bash
# Clone / copy project
cd Caro-Jev

# Cài dependencies
npm install

# Tạo file môi trường
cp .env.example .env.local
# Sửa .env.local: thay TYPESAFE_API_KEY bằng key thực
```

### 5.3 Chạy development server

```bash
npm run dev
# Mở http://localhost:3000
```

### 5.4 Build production

```bash
npm run build
npm run start
```

### 5.5 Chạy tests

```bash
npm test
```

Lệnh test thực hiện:
1. Biên dịch TypeScript (module Node16) vào `.test-build/` (dùng `tsconfig.test.json`, chỉ bao gồm `lib/game.ts`, `lib/candidates.ts`, `lib/strategy.ts`, `types/game.ts`).
2. Chạy `node --test tests/strategy.test.cjs`.

### 5.6 Biến môi trường

| Biến | Bắt buộc | Mô tả |
|---|---|---|
| `TYPESAFE_API_KEY` | Có | API key gọi Jev. Thiếu → fallback mode |

---

## 6. Test cases (`tests/strategy.test.cjs`)

| # | Test | Kiểm tra |
|---|---|---|
| 1 | Takes a win instead of defending | Ưu tiên thắng hơn chặn |
| 2 | Blocks a broken four | Chặn tứ đứt đoạn |
| 3 | Blocks an open three | Chặn tam mở trước khi thành tứ không thể chặn |
| 4 | Prevents a crossing double threat | Chống đe dọa kép chéo |
| 5 | Creates a forcing open four | Tạo tứ mở buộc đối thủ phản hồi |
| 6 | Handles diagonal edge threats | Xử lý threat ở biên đường chéo |
| 7 | Search preserves input & restricts choices | Board không bị mutate; Jev chỉ nhận nước điểm cao nhất |
| 8 | Empty, full, expired-budget | Bàn cờ trống → H8; bàn đầy → []; hết budget → vẫn trả nước hợp lệ |

---

## 7. Sơ đồ kiến trúc tổng thể

```
┌──────────────────────────────────────────────────────────────┐
│                         BROWSER                               │
│  ┌────────────────────────────────────────────────────────┐  │
│  │              CaroGame.tsx (Client Component)            │  │
│  │  • Bàn cờ 15×15 (X = người chơi, O = Jev)            │  │
│  │  • Decision Trace Panel                                 │  │
│  │  • handleCellClick → POST /api/move                    │  │
│  └────────────────────────┬───────────────────────────────┘  │
└───────────────────────────┼──────────────────────────────────┘
                            │ HTTP POST { board }
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                    NEXT.JS SERVER (API Route)                 │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │            app/api/move/route.ts                      │    │
│  │  Validate → Tactical → Search → Jev → Response       │    │
│  └───────┬──────────┬───────────┬───────────────────────┘    │
│          │          │           │                             │
│          ▼          ▼           ▼                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                     │
│  │ lib/game │ │lib/strategy│ │ lib/jev  │                    │
│  │  .ts     │ │   .ts      │ │   .ts    │                    │
│  └──────────┘ └──────────┘ └─────┬────┘                     │
│          ▲                        │                           │
│          │                        │ HTTPS                     │
│  ┌───────┴──────┐                 ▼                           │
│  │lib/candidates│   ┌─────────────────────────┐              │
│  │   .ts        │   │  TypeSafe SystemOne API  │              │
│  └──────────────┘   │  (Jev AI Model)          │              │
│                     └─────────────────────────┘              │
└──────────────────────────────────────────────────────────────┘
```

---

## 8. Nguyên tắc thiết kế

1. **Deterministic trước, AI sau:** Nước bắt buộc (thắng/chặn) luôn do code xử lý — không phụ thuộc API, không latency.
2. **Jev không bao giờ đi sai:** Bị giới hạn trong shortlist đã validate; kiểm tra 2 lớp (server + client).
3. **Graceful degradation:** Jev lỗi → fallback về kết quả tìm kiếm, game vẫn chơi được.
4. **Minh bạch:** Mọi quyết định đều có trace (source, confidence, probabilities, tokens).
5. **Immutable state:** Board không bao giờ bị mutate trực tiếp; luôn clone trước khi thử nghiệm.
6. **Time-bounded search:** Không treo server; iterative deepening dừng đúng hạn.

---

## 9. Ghi chú mở rộng

- **Không có database:** Toàn bộ state nằm trong React state phía client. Mỗi request gửi toàn bộ board.
- **Không có authentication:** Demo đơn người dùng.
- **Không có rate limiting:** Nếu triển khai production, cần thêm middleware.
- **CSS thuần:** Không dùng Tailwind/CSS Modules — toàn bộ trong `globals.css`.
- **Path alias:** `@/` → root project (cấu hình trong `tsconfig.json`).