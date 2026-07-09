# MAESTRO — AI Gesture Music Studio

[繁體中文](./README-tw.md) | English

A full-stack interactive instrument that lets you play music in real time using webcam hand gestures.

Browser-side MediaPipe WASM (gesture recognition, runs on the user's device) → Spring Boot REST + WebSocket → Vue 3 Dashboard (Web Audio API playback)

---

## 🎹 Live Demo

**Try it now:** [https://gesture-music-studio.onrender.com](https://gesture-music-studio.onrender.com)

| | |
|---|---|
| 🎭 Demo account | `guest` / `guest123` (or register your own) |
| ⏱️ First load | Hosted on Render's free tier — the server sleeps when idle, so the **first visit may take up to ~1 minute** to wake up. Subsequent loads are fast. |
| 📷 Camera | Click **Start Camera** and allow webcam access — gesture recognition runs entirely in your browser (WebAssembly); the video never leaves your device. |
| 🌐 Browser | Chrome or Edge recommended. Desktop with webcam for gesture control; mobile supported for touch-based note playing. |

---

<p align="center">
  <img src="./docs/images/screenshot-login.png" width="370">
  <img src="./docs/images/screenshot-dashboard.png" width="370">
  <img src="./docs/images/screenshot-stats.png" width="155">
</p>

<p align="center">
  <img src="./docs/images/demoStudio.gif" width="700">
</p>

---

## Features

- **Gesture Recognition**: MediaPipe Hands detects 8 gestures (POINTING, OPEN_PALM, CLOSED_FIST, THUMB_UP, VICTORY…) running entirely in the browser via WebAssembly — the camera feed never leaves the device
- **Circular Note Ring UI**: Point your index finger into different ring sectors to trigger notes in gesture mode; tap the ring directly on mobile for touch-based playing. Supports Piano, Acoustic Guitar, Synth, and Drum
- **Gesture Commands**: FIST + swipe left/right to cycle instruments; OPEN_PALM + wrist rotation to control volume (palm rotation delta knob); THUMB_UP / VICTORY trigger discrete commands
- **Custom Note Layout**: Drag-and-drop editor to arrange 8 note slots freely, with save/load for multiple layouts
- **Responsive Design**: Fully usable on mobile — vertical stacked layout, touch events on the note ring, tab switcher for note feed / gesture history
- **Google OAuth + JWT**: Google one-click login and username/password registration
- **Personal Stats**: Today's notes, total notes, top instrument, top note, top gesture
- **Live Presence**: STOMP WebSocket shows who's currently online
- **Background Music**: Jazz background audio auto-plays on dashboard entry, toggleable

---

---

## Tech Stack

| Category | Technology |
|---|---|
| Backend Framework | Spring Boot 3.3.4 + Java 17 |
| Database | PostgreSQL (Spring Data JPA / Hibernate) |
| Real-time Communication | WebSocket (STOMP over SockJS) |
| Authentication | JWT (jjwt) + Google OAuth 2.0 (GSI) |
| Password Hashing | BCrypt (Spring Security) |
| Frontend Framework | Vue 3 + Vite + Pinia |
| CSS | Tailwind CSS v4 |
| Gesture Recognition | MediaPipe Tasks Vision (JS + WebAssembly) |
| Audio Engine | Web Audio API |

---

## Database Schema

<p align="center">
  <img src="./docs/images/er-diagram.png" width="600">
</p>

---

## Project Structure

```
ai-gesture-music-studio/
├── backend/                        # Spring Boot 3.3 + Java 17
│   └── src/main/java/.../
│       ├── model/                  # JPA Entities (4 tables)
│       ├── dao/                    # DAO interfaces + JPA impls
│       ├── dto/                    # Request / Response DTOs
│       ├── service/                # Service interfaces + impls
│       ├── controller/             # REST + WebSocket controllers
│       ├── config/                 # CorsConfig, WebSocketConfig
│       ├── exception/              # ApiException, GlobalExceptionHandler
│       └── util/                   # SecurityConfig, JwtService, JwtAuthenticationFilter, CustomUserDetails
├── frontend/                       # Vue 3 + Vite + Tailwind v4 + Pinia
│   └── src/
│       ├── views/                  # LoginView, DashboardView
│       ├── components/             # GestureCamera, LayoutEditor, StatsModal
│       └── stores/                 # authStore, dashboardStore
└── gesture_ai/                     # Python early prototype (see Architecture Evolution)
```

---

## Setup

### Backend

Requirements: Java 17+, Maven, PostgreSQL

```bash
# 1. Create database
createdb gesture_music_studio

# 2. Set environment variables
export DB_USERNAME=postgres
export DB_PASSWORD=your_password
export JWT_SECRET=your-secret-min-32-chars

# 3. Run (Hibernate auto-creates tables on first start)
cd backend
mvn spring-boot:run
```

### Frontend

```bash
cd frontend
npm install
npm run dev
# Open http://localhost:5173
```

---

## API Reference

### Auth `/api/auth`

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/register` | Register with username + password |
| POST | `/api/auth/login` | Login, returns JWT |
| POST | `/api/auth/google` | Google OAuth login |
| GET  | `/api/auth/me` | Get current user info (requires token) |

### Music Events `/api/music-events` (requires `Authorization: Bearer <token>`)

| Method | Path | Description |
|---|---|---|
| POST | `/api/music-events` | Record a note event (note, instrument, volume) |
| GET  | `/api/music-events/recent` | Get last 20 events |

### Gesture History `/api/gesture` (requires token)

| Method | Path | Description |
|---|---|---|
| POST | `/api/gesture` | Record a gesture command |
| GET  | `/api/gesture/recent` | Get last 20 gestures |

### Note Layouts `/api/layout` (requires token)

| Method | Path | Description |
|---|---|---|
| GET    | `/api/layout` | Get all saved layouts |
| POST   | `/api/layout` | Save a new layout |
| DELETE | `/api/layout/{id}` | Delete a layout |

### Stats `/api/stats` (requires token)

| Method | Path | Description |
|---|---|---|
| GET | `/api/stats/me` | Get personal statistics |

### WebSocket

```
Endpoint: /ws
Subscribe: /topic/notes     # Live note stream
Subscribe: /topic/presence  # Online presence updates
Publish:   /app/presence/join
Publish:   /app/presence/leave
```

---

## Architecture Evolution

The original design included a standalone Python service (`gesture_ai/`) for gesture recognition — the frontend would stream camera frames to it for processing.

After evaluation, three problems emerged:
1. **Latency**: Frame upload → inference → response introduced noticeable round-trip delay
2. **Deployment complexity**: An extra GPU/CPU-hungry Python service to maintain
3. **Privacy**: Raw camera frames leaving the browser

The final solution uses the official MediaPipe JavaScript SDK (`@mediapipe/tasks-vision`), running inference via **WebAssembly directly in the user's browser**. Camera footage never leaves the device. The `gesture_ai/` folder is kept as an archived early prototype.

---

## Known Limitations

- WebSocket auth is implemented via `JwtChannelInterceptor` — the frontend sends the JWT in the STOMP `CONNECT` frame header; the backend validates it before allowing the connection.

---

## Technical Notes

- **Dual-pipeline debounce**: Discrete command gestures use time-based debounce (1.5s cooldown); note-playing gestures use zone-change debounce (fires immediately on entering a new zone, re-triggers after 800ms in the same zone)
- **Google OAuth FedCM**: Uses `renderButton` + transparent overlay to work around FedCM being blocked on HTTP; private LAN IPs use `isLocalhost` check to hide the Google button
- **JWT**: Secret injected via `${JWT_SECRET}` environment variable, never hardcoded
- **Volume control**: Wrist rotation angle (palm rotation delta accumulation) — not pinch — to avoid accidental triggers
- **Canvas sizing**: Both idle ring and live overlay always read the canvas display dimensions via `getBoundingClientRect()` instead of video resolution, so the ring stays circular on any device pixel ratio or camera resolution (no stretch distortion on retina/high-DPI screens)
