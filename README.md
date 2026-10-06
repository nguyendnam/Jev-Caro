# Jev Caro

Game Caro 15 × 15: Bạn cầm **X**, Jev cầm **O**. Bạn đi trước, nối ít nhất năm quân theo hàng ngang, dọc hoặc chéo để thắng. Không áp dụng luật cấm hay luật chặn hai đầu cho hàng năm.

## Chạy trên máy

Yêu cầu Node.js **20.9 trở lên** và npm (theo phiên bản Next.js đang cài trong dự án).

```powershell
npm ci
Copy-Item .env.example .env.local
```

Điền khóa TypeSafe vào `.env.local`:

```dotenv
TYPESAFE_API_KEY=your_typesafe_api_key_here
JEV_MODEL=jev-latest
```

Không ghi khóa thật vào Git. Nếu đã có `.env.local`, giữ file đó và chỉ cập nhật biến cần thiết. Khóa chỉ được dùng ở máy chủ.

```powershell
npm run dev
```

Mở http://localhost:3000. Chạy bản production bằng:

```powershell
npm run build
npm start
```

Khi triển khai, cấu hình hai biến môi trường trên ở máy chủ rồi build lại. Thiếu khóa, hết thời gian hoặc phản hồi Jev không hợp lệ thì ứng dụng dùng kết quả cục bộ và hiển thị thông báo.

## Kiểm tra

```powershell
npm test
npx tsc --noEmit
npm run build
```

Xem [PROJECT.md](PROJECT.md) để biết cấu trúc code, luồng dữ liệu và các giới hạn hiện tại.
