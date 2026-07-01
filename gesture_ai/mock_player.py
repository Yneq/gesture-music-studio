"""
Multi-user test script.
Registers + logs in a mock user, then sends note events in a loop
so you can see multi-user color-coded feed in the Dashboard
without needing a second webcam.

Usage:
    python mock_player.py [--username MockBand] [--instrument synth] [--bpm 80]
"""

import argparse
import os
import time
import random
import sys
import requests

BASE_URL = os.environ.get("MUSIC_SERVER", "http://localhost:8080") + "/api"
NOTES = ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"]

# Simple melodic patterns to cycle through
PATTERNS = [
    ["C4", "E4", "G4", "C5"],           # C major arpeggio
    ["A4", "G4", "E4", "D4"],           # descending
    ["C4", "D4", "E4", "F4", "G4"],     # scale up
    ["G4", "E4", "C4", "E4", "G4"],     # bounce
    ["C4", "C4", "G4", "G4", "A4", "A4", "G4"],  # Twinkle
]


def register_user(username: str, password: str) -> bool:
    try:
        r = requests.post(f"{BASE_URL}/auth/register", json={
            "username": username,
            "email": f"{username.lower()}@mock.test",
            "password": password,
        }, timeout=5)
        if r.status_code in (200, 201):
            print(f"[mock] Registered new user: {username}")
            return True
        if r.status_code == 409:
            print(f"[mock] User {username} already exists, logging in...")
            return True
        print(f"[mock] Register failed: {r.status_code} {r.text}")
        return False
    except requests.RequestException as e:
        print(f"[mock] Cannot reach backend: {e}")
        return False


def login(username: str, password: str) -> str | None:
    try:
        r = requests.post(f"{BASE_URL}/auth/login", json={
            "username": username,
            "password": password,
        }, timeout=5)
        if r.status_code == 200:
            token = r.json().get("token")
            print(f"[mock] Logged in as {username}")
            return token
        print(f"[mock] Login failed: {r.status_code} {r.text}")
        return None
    except requests.RequestException as e:
        print(f"[mock] Login error: {e}")
        return None


def send_note(token: str, note: str, instrument: str, volume: int = 75) -> bool:
    try:
        r = requests.post(f"{BASE_URL}/music-events", json={
            "note": note,
            "instrument": instrument,
            "volume": volume,
        }, headers={"Authorization": f"Bearer {token}"}, timeout=3)
        return r.status_code in (200, 201)
    except requests.RequestException:
        return False


def main():
    parser = argparse.ArgumentParser(description="Mock player for multi-user testing")
    parser.add_argument("--username",   default="MockBand",  help="Mock username")
    parser.add_argument("--password",   default="mock1234",  help="Mock password")
    parser.add_argument("--instrument", default="synth",
                        choices=["piano", "guitar", "synth", "drum"])
    parser.add_argument("--bpm",        type=int, default=80, help="Beats per minute")
    parser.add_argument("--pattern",    type=int, default=-1,
                        help="Pattern index 0-4, -1 = random each bar")
    args = parser.parse_args()

    beat_s = 60 / args.bpm

    # Register (ignore 409) then login
    register_user(args.username, args.password)
    token = login(args.username, args.password)
    if not token:
        sys.exit(1)

    print(f"[mock] Starting playback — instrument={args.instrument}, bpm={args.bpm}")
    print("[mock] Press Ctrl+C to stop\n")

    bar = 0
    try:
        while True:
            pattern = (PATTERNS[args.pattern % len(PATTERNS)]
                       if args.pattern >= 0
                       else random.choice(PATTERNS))
            print(f"[mock] Bar {bar+1}: {' '.join(pattern)}")
            for note in pattern:
                ok = send_note(token, note, args.instrument)
                status = "✓" if ok else "✗"
                print(f"  {status} {note}")
                time.sleep(beat_s)
            bar += 1
    except KeyboardInterrupt:
        print("\n[mock] Stopped.")


if __name__ == "__main__":
    main()
