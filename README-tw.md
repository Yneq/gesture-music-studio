# MAESTRO — AI Gesture Music Studio

[English](./README.md) | 繁體中文

用 webcam 手勢辨識即時演奏音樂的全端互動樂器專案。

瀏覽器端 MediaPipe WASM（手勢辨識，在使用者裝置執行）→ Spring Boot REST + WebSocket → Vue 3 Dashboard（Web Audio API 即時發聲）

---

<p align="center">
  <img src="./docs/images/screenshot-login.png" width="320">
  <img src="./docs/images/screenshot-dashboard.png" width="320">
  <img src="./docs/images/screenshot-stats.png" width="220">
</p>

<p align="center">
  <img src="./docs/images/demoStudio.gif" width="700">
</p>

---

## 功能

- **手勢辨識**：MediaPipe Hands 辨識 8 種手勢（POINTING、OPEN_PALM、CLOSED_FIST、THUMB_UP、VICTORY…），在瀏覽器本機以 WebAssembly 執行，影像不離開裝置
- **圓形音階 UI**：食指滑過不同扇形區域即時觸發音符，支援 Piano / Acoustic Guitar / Synth / Drum 四種音色
- **手勢指令**：FIST 左右揮切換樂器；OPEN_PALM 轉腕調音量（palm rotation delta knob）；THUMB_UP / VICTORY / OPEN_PALM 觸發離散指令
- **自訂音階環**：拖拉介面自由排列 8 個音符格子，可儲存 / 載入多組排列
- **Google OAuth + JWT**：支援 Google 一鍵登入與帳密註冊
- **個人統計**：今日音符、累計音符、最常樂器、最常音符、最常手勢
- **即時在線**：STOMP WebSocket 顯示目前在線玩家
- **背景音樂**：Dashboard 自動播放 jazz 背景音，可一鍵切換

---

---

## 技術棧

| 分類 | 技術 |
|---|---|
| 後端框架 | Spring Boot 3.3.4 + Java 17 |
| 資料庫 | PostgreSQL（Spring Data JPA / Hibernate） |
| 即時通訊 | WebSocket（STOMP over SockJS） |
| 身份驗證 | JWT（jjwt）+ Google OAuth 2.0（GSI） |
| 密碼加密 | BCrypt（Spring Security） |
| 前端框架 | Vue 3 + Vite + Pinia |
| CSS | Tailwind CSS v4 |
| 手勢辨識 | MediaPipe Tasks Vision（JS + WebAssembly） |
| 音訊引擎 | Web Audio API |

---

## 資料庫 ER 圖

<p align="center">
  <img src="./docs/images/er-diagram.png" width="600">
</p>

---

## 專案結構

```
ai-gesture-music-studio/
├── backend/                        # Spring Boot 3.3 + Java 17
│   └── src/main/java/.../
│       ├── model/                  # JPA Entity（4 張表）
│       ├── dao/                    # DAO interface + JPA impl
│       ├── dto/                    # Request / Response DTO
│       ├── service/                # Service interface + impl
│       ├── controller/             # REST + WebSocket controller
│       ├── config/                 # CorsConfig、WebSocketConfig
│       ├── exception/              # ApiException、GlobalExceptionHandler
│       └── util/                   # SecurityConfig、JwtService、JwtAuthenticationFilter、CustomUserDetails
├── frontend/                       # Vue 3 + Vite + Tailwind v4 + Pinia
│   └── src/
│       ├── views/                  # LoginView、DashboardView
│       ├── components/             # GestureCamera、LayoutEditor、StatsModal
│       └── stores/                 # authStore、dashboardStore
└── gesture_ai/                     # Python 早期方案存檔（見架構演進）
```

---

## 啟動方式

### Backend

需求：Java 17+、Maven、PostgreSQL

```bash
# 1. 建立資料庫
createdb gesture_music_studio

# 2. 設定環境變數
export DB_USERNAME=postgres
export DB_PASSWORD=你的密碼
export JWT_SECRET=your-secret-min-32-chars

# 3. 啟動（Hibernate 自動建表）
cd backend
mvn spring-boot:run
```

### Frontend

```bash
cd frontend
npm install
npm run dev
# 開 http://localhost:5173
```

---

## API 文件

### 驗證 `/api/auth`

| Method | Path | 說明 |
|---|---|---|
| POST | `/api/auth/register` | 帳密註冊 |
| POST | `/api/auth/login` | 登入，回傳 JWT |
| POST | `/api/auth/google` | Google OAuth 登入 |
| GET  | `/api/auth/me` | 取得當前使用者資訊（需 token） |

### 演奏事件 `/api/music-events`（需 `Authorization: Bearer <token>`）

| Method | Path | 說明 |
|---|---|---|
| POST | `/api/music-events` | 新增音符事件（note、instrument、volume） |
| GET  | `/api/music-events/recent` | 取最近 20 筆事件 |

### 手勢紀錄 `/api/gesture`（需 token）

| Method | Path | 說明 |
|---|---|---|
| POST | `/api/gesture` | 新增手勢紀錄 |
| GET  | `/api/gesture/recent` | 取最近 20 筆 |

### 音階排列 `/api/layout`（需 token）

| Method | Path | 說明 |
|---|---|---|
| GET    | `/api/layout` | 取得所有已儲存排列 |
| POST   | `/api/layout` | 儲存新排列 |
| DELETE | `/api/layout/{id}` | 刪除排列 |

### 統計 `/api/stats`（需 token）

| Method | Path | 說明 |
|---|---|---|
| GET | `/api/stats/me` | 取得個人統計資料 |

### WebSocket

```
Endpoint: /ws
Subscribe: /topic/notes     # 即時音符串流
Subscribe: /topic/presence  # 在線人數變化
Publish:   /app/presence/join
Publish:   /app/presence/leave
```

---

## 架構演進

原始設計有一個獨立的 Python 服務（`gesture_ai/`）負責手勢辨識，前端把攝影機影像傳給它處理。

實作後評估三個問題：
1. **延遲**：影像上傳 → 辨識 → 回傳，網路來回導致明顯延遲
2. **部署複雜度**：多一個需要 GPU/CPU 的 Python 服務要維運
3. **隱私**：攝影機原始影像傳出瀏覽器

最終改為 MediaPipe 官方 JavaScript SDK（`@mediapipe/tasks-vision`），以 WebAssembly 在**使用者瀏覽器本機**執行推論，影像完全不離開裝置。`gesture_ai/` 保留為早期方案存檔。

---

## Known Limitations

- WebSocket 驗證已透過 `JwtChannelInterceptor` 實作，前端在 STOMP `CONNECT` frame header 帶上 JWT，後端攔截驗證後才允許建立連線。

---

## 技術筆記

- **雙管線 debounce**：離散指令手勢走時間型 debounce（1.5s 冷卻）；演奏型音符走區域變化型 debounce（滑入新區立刻觸發，同區停留 800ms 才重觸發）
- **Google OAuth FedCM**：使用 `renderButton` + 透明 overlay 解決 FedCM 在 HTTP 環境被封鎖的問題；私有 LAN IP 改用 `isLocalhost` 判斷隱藏按鈕
- **JWT**：密鑰走 `${JWT_SECRET}` 環境變數注入，不寫死在設定檔
- **音量控制**：手腕旋轉角度（palm rotation delta）累積控制，非 pinch，避免誤觸
