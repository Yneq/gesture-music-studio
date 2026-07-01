"""
全域設定常數。
信心值門檻、debounce 冷卻時間等集中在這裡，方便調參。
"""

import os

# Spring Boot 後端位置（MUSIC_SERVER 讓同學指向老師的 IP）
_SERVER = os.environ.get("MUSIC_SERVER", "http://localhost:8080")
BACKEND_HTTP_BASE_URL = _SERVER.rstrip("/") + "/api"
BACKEND_WS_URL = _SERVER.rstrip("/").replace("http://", "ws://").replace("https://", "wss://") + "/ws"

# AI Service 登入帳密（讀環境變數，沒設就用空字串讓 sender 以無認證模式跳過送資料）
AI_SERVICE_USERNAME = os.environ.get("AI_SERVICE_USERNAME", "")
AI_SERVICE_PASSWORD = os.environ.get("AI_SERVICE_PASSWORD", "")

# 信心值過濾
CONFIDENCE_THRESHOLD = 0.85

# 離散指令手勢的時間型 debounce（ms）
GESTURE_DEBOUNCE_COOLDOWN_MS = 500

# 屬於離散指令的手勢（POINT 是演奏模式，不在此列）
COMMAND_GESTURES = {"OPEN_HAND", "FIST", "THUMB_UP", "OK", "PEACE"}

# 演奏音符的預設樂器與音量
DEFAULT_INSTRUMENT = "piano"
DEFAULT_VOLUME = 80

# Webcam 設定
CAMERA_INDEX = 0
FRAME_WIDTH = 640
FRAME_HEIGHT = 480

# 圓形音階區域（正規化座標 0~1，畫面中央）
NOTE_ZONE_CENTER_X = 0.5
NOTE_ZONE_CENTER_Y = 0.5
NOTE_ZONE_INNER_RADIUS = 0.12
NOTE_ZONE_OUTER_RADIUS = 0.38
NOTES = ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"]

# 預覽視窗
PREVIEW_WINDOW_NAME = "AI Gesture Music Studio"
SHOW_NOTE_ZONE_OVERLAY = True
