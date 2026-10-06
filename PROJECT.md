# Jev Caro — Kiến trúc hiện tại

Tài liệu mô tả code hiện tại sau khi đơn giản hóa luồng Jev và giao diện. Hướng dẫn chạy nằm trong [README.md](README.md).

## Mục tiêu và luật

Caro freestyle 15 × 15, người chơi X đi trước và Jev chơi O. Ít nhất năm quân liên tiếp theo một trong bốn hướng là thắng, kể cả khi hai đầu bị chặn. Bàn đầy mà chưa có người thắng là hòa.

Code kiểm tra tính hợp lệ và các tình huống chiến thuật; Jev đánh giá chiến lược trong tập ứng viên. Chỉ có một luồng chơi, không có chế độ Nhanh/Cân bằng/Chuyên sâu.

## Công nghệ và cấu trúc

Next.js App Router, React, TypeScript và CSS thuần; API chạy bằng Node.js. `package.json` khai báo các gói bằng `latest`, còn `package-lock.json` khóa phiên bản cài đặt. Dùng `npm ci` để tái lập môi trường.

- `app/page.tsx`, `app/layout.tsx`: trang và layout.
- `app/globals.css`: bố cục responsive, màu sắc và trạng thái ô cờ.
- `components/CaroGame.tsx`: bàn cờ, gọi API, tự lưu và bảng phân tích quyết định hiện tại.
- `app/api/move/route.ts`: xác thực request và gọi luồng chọn nước.
- `lib/game.ts`: thao tác bàn cờ, tọa độ, phát hiện thắng, kiểm tra lượt và tái dựng nước đi.
- `lib/strategy.ts`: đánh giá mẫu đường cờ, lọc chiến thuật, tìm kiếm đối kháng và ngữ cảnh ứng viên.
- `lib/decision.ts`: điều phối giữa kết quả cục bộ và Jev.
- `lib/jev.ts`: tạo request TypeSafe, kiểm tra response và tổng hợp đánh giá.
- `lib/session.ts`: reducer quản lý lượt, đi lại, reset, khôi phục và lỗi.
- `lib/candidates.ts`: tiện ích sinh ứng viên còn trong repository; luồng quyết định hiện tại sinh ứng viên qua `lib/strategy.ts`.
- `types/game.ts`: kiểu dữ liệu dùng chung.
- `tests/strategy.test.cjs`, `tsconfig.test.json`: biên dịch và chạy kiểm thử bằng Node test runner.

## Luồng quyết định

1. Kiểm tra nước thắng ngay của O; có thì trả về `tactical-win`.
2. Gọi `analyzeMoves(board, 600, 4)`: ngân sách tìm kiếm 600 ms, tối đa bốn lượt ở vòng iterative deepening. Nhánh bắt buộc có thể được mở rộng thêm, với giới hạn ply nội bộ 16. Phần chuẩn bị/lọc chiến thuật vẫn chạy trước kiểm tra deadline, vì vậy 600 ms không phải giới hạn cứng cho toàn request.
3. Nếu X đang có nước thắng trực tiếp, chọn kết quả phòng thủ cục bộ (`tactical-block`). Nếu đã tìm được chuỗi thắng trong các nhánh xét, trả về `engine`.
4. `strategicChoices` lấy tối đa tám phương án từ thứ hạng chung, tấn công và phòng thủ. Không ép ứng viên phải nằm trong một khoảng điểm hẹp. Nước đã bị đánh giá thua được loại khi có lựa chọn khác; nếu mọi phương án đều thua, giữ các phương án tốt nhất còn lại. Không đổi một kết quả thắng đã tìm thấy lấy nước phát triển thông thường.
5. Gửi một request cho Jev. Không có lượt tìm kiếm sâu thứ hai sau phản hồi.
6. Chọn theo đánh giá tổng hợp của Jev. Khi bằng điểm ưu tiên thì dùng điểm cục bộ để phân định. Nếu mô hình lỗi hoặc hết thời gian, dùng ứng viên cục bộ đầu tiên (`fallback`).

Bộ tìm kiếm dùng negamax, alpha-beta, iterative deepening và bảng chuyển vị. Việc nhận dạng xét cả hàng liền, hàng đứt, ba mở, bốn buộc chặn và các đe dọa giao nhau. Đầu bàn được tính là biên chặn.

## Dữ liệu và câu hỏi gửi Jev

Endpoint được cấu hình trong code là `https://api.typesafe.ai/v1/systemone`. Khóa lấy từ `TYPESAFE_API_KEY`. Tên mô hình lấy từ `JEV_MODEL`, mặc định `jev-latest`.

Shared state gồm luật, quy ước A–O/1–15, 15 hàng bàn cờ, tọa độ quân X/O, diễn biến ván hiện tại, các đe dọa của hai bên và ngữ cảnh từng ứng viên. Mỗi ứng viên có bàn cờ sau khi đặt O, điểm tấn công/phòng thủ, đặc trưng chiến thuật, độ sâu hoàn tất và một nhánh đáp trả minh họa.

Mỗi request có `2 + 2 × số ứng viên` câu hỏi, tối đa 18:

- `best_move` (Choice): chọn nước.
- `plan` (Choice): tấn công, phòng thủ, chuẩn bị đòn kép hoặc phát triển.
- `quality_<tọa độ>` (Score 0–4): tiềm năng tấn công sau nước đi.
- `risk_<tọa độ>` (Noul 0–1): nguy cơ X còn chuỗi tấn công không thể hóa giải.

Prompt nhấn mạnh cả các cách thắng thông thường: kết nối hai quân, ba mở hai đầu thành bốn mở rồi năm, các đầu bị chặn và thế đứt đoạn. Đòn đôi chỉ là một khả năng. Câu hỏi độc lập, cùng đọc shared state.

Điểm ưu tiên hiện tại:

```text
attack = 0.5 + (score / 4 - 0.5) × scoreConfidence
preference = 0.5 × choiceProbability + 0.2 × attack + 0.3 × (1 - risk)
```

Response được kiểm tra kiểu, tọa độ hợp lệ, danh sách ứng viên, miền giá trị và phân bố xác suất. Tổng xác suất được chấp nhận trong sai số 0.02 rồi chuẩn hóa. Thiếu đánh giá bắt buộc thì chuyển sang fallback.

`source: verified` là tên tương thích trong dữ liệu: hiện biểu thị nước được tổng hợp từ các đánh giá khác với Choice ban đầu; **không có nghĩa đã chạy thêm một lượt tìm kiếm sau Jev**. Lời giải thích hiển thị được ghép từ đặc trưng chiến thuật và nhãn kế hoạch, không phải văn bản tự do do mô hình sinh.

## API

`POST /api/move` nhận JSON:

```typescript
{
  board: ("X" | "O" | null)[][]; // Đúng 15 × 15
  history?: { player: "X" | "O"; move: { row: number; col: number } }[];
}
```

`row`/`col` bắt đầu từ 0. Lượt O hợp lệ cần số X bằng số O cộng một. Ván phải chưa kết thúc. Nếu cung cấp history, API tái dựng và yêu cầu khớp bàn cờ; trường mode từ client cũ được bỏ qua.

Response gồm nước chọn, tọa độ, nguồn quyết định, thời gian, độ sâu, số node, đánh giá ứng viên và metadata Jev khi có. JSON/bàn cờ/history sai trả 400; sai lượt hoặc ván đã kết thúc trả 409; lỗi chưa xử lý trả 500; request bị hủy có thể trả 499.

Timeout gọi Jev là 12 giây. Client giới hạn lượt request 30 giây, route khai báo `maxDuration = 30`. Không trả nguyên response lỗi từ nhà cung cấp hoặc khóa API cho trình duyệt.

## Trạng thái ván và giao diện

Reducer có trạng thái `human`, `thinking`, `error`, `finished`. Mỗi lượt có requestId; phản hồi cũ sau reset/đi lại bị bỏ qua. Client hủy request khi lượt không còn hiệu lực. Lỗi không cho người chơi đánh thêm X; người chơi có thể thử lại hoặc đi lại.

Session giữ danh sách nước đi và **một quyết định Jev hiện tại**, không giữ toàn bộ decision trace từng lượt. Đi lại bỏ cặp X/O gần nhất, hoặc X đang chờ O, rồi xóa quyết định đang hiển thị.

`localStorage` dùng khóa `jev-caro:v2`, lưu version và các nước của ván hiện tại. Khi mở lại, nước đi được xác thực; ván đang chờ O yêu cầu bấm tiếp tục. Bản lưu không chứa metadata phân tích Jev.

Giao diện còn bàn cờ, Ván mới, Đi lại, trạng thái lưu và bảng phân tích. Đã xóa chọn cấp độ, đánh số quân, xuất JSON và lịch sử/xem lại ván cùng code/CSS liên quan. Danh sách nước đi nội bộ vẫn cần cho tính hợp lệ, đi lại, lưu ván và ngữ cảnh mô hình.

Màu chính: nền `#f3f0e8`, panel `#fffdf7`, bàn cờ `#f4d7a1`, viền `#111111`, X `#0057ff`, O `#ff3b30`. Ô thuộc hàng thắng dùng **xanh lục `#4ade80`**; nút Ván mới vẫn vàng `#ffd60a`.

Trên desktop đủ cao, layout dùng chiều cao viewport, bàn cờ co theo vùng còn lại và bảng phân tích cuộn riêng. Trên màn hình hẹp, hai cột chuyển thành một cột. Có điều khiển bàn phím và nhãn tọa độ cho từng ô.

## Kiểm thử và giới hạn

`npm test` biên dịch vào `.test-build` rồi chạy 24 test. Các nhóm kiểm tra gồm thắng/chặn trực tiếp, ba mở và bốn đứt, đòn giao nhau, tình huống ảnh người dùng từng báo, tám phép đối xứng, tính hợp lệ của nhánh, ứng viên đa dạng, schema Jev, API/fallback, reset/đi lại và bản lưu. API được mock trong test; test không xác nhận chất lượng của một phiên bản mô hình ngoài dịch vụ.

Chạy thêm `npx tsc --noEmit` và `npm run build` để kiểm tra kiểu và production build. Thay đổi giao diện cần kiểm tra trực tiếp ở kích thước laptop và mobile.

Tìm kiếm có giới hạn thời gian, độ sâu và số nhánh. Các trường `proven`, `winning`, `losing` phản ánh những nhánh đã xét, không phải chứng minh vét cạn toàn bàn. Độ tin cậy Choice và Noul không phải xác suất thắng được hiệu chuẩn cho cả ván.

Chưa có database, kho trận thua, truy hồi bài học, fine-tuning hoặc cơ chế tự học xuyên ván. Tự lưu chỉ phục vụ ván hiện tại trên trình duyệt đó.
