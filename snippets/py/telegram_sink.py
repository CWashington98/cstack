"""Minimal Telegram send — extracted 2026-07-05 from ~/signal-watcher/sinks/telegram_sink.py
and ~/signal-watcher/report.py:send_telegram(). Copy-paste freely; no imports across projects.

Env-var driven (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID) or pass explicit token/chat_id.
Sends HTML-formatted text; on failure (e.g. bad markup) retries once as plain text so a
formatting bug never costs you the whole message — mirrors report.py's fallback.
requests-only (stdlib http.client works too, but requests is already a dependency in
signal-watcher and keeps this readable).
"""
from __future__ import annotations

import os

import requests

API = "https://api.telegram.org/bot{token}/sendMessage"


def send_telegram_message(
    text: str,
    *,
    token: str | None = None,
    chat_id: str | None = None,
    parse_mode: str | None = "HTML",
    timeout: int = 15,
) -> bool:
    """Send `text` to a Telegram chat. Returns True on success, False otherwise
    (never raises — a notification failure should not take down the caller)."""
    token = token or os.environ.get("TELEGRAM_BOT_TOKEN", "")
    chat_id = chat_id or os.environ.get("TELEGRAM_CHAT_ID", "")
    if not token or not chat_id:
        print("[telegram] not configured (TELEGRAM_BOT_TOKEN/CHAT_ID empty) — skipping send")
        return False

    url = API.format(token=token)
    payload = {"chat_id": chat_id, "text": text}
    if parse_mode:
        payload["parse_mode"] = parse_mode

    try:
        r = requests.post(url, json=payload, timeout=timeout)
        if r.status_code != 200 and parse_mode:
            # bad markup must never cost us the message — resend plain
            print(f"[telegram] {parse_mode} send failed {r.status_code}: {r.text[:160]} — retrying plain")
            r = requests.post(url, json={"chat_id": chat_id, "text": text}, timeout=timeout)
        if r.status_code != 200:
            print(f"[telegram] send failed {r.status_code}: {r.text[:160]}")
        return r.status_code == 200
    except Exception as e:
        print(f"[telegram] error: {e}")
        return False


if __name__ == "__main__":
    import sys

    send_telegram_message(" ".join(sys.argv[1:]) or "test message from telegram_sink.py")
