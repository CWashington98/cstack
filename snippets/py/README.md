# snippets/py

Copy-paste by design — no versioning, no imports across projects. Copy the file you need into
your project and edit it there; changes here don't propagate and aren't meant to.

- `atomic.py` — atomic file writes (tmp + `os.replace`). From `~/signal-watcher/atomic.py`.
- `telegram_sink.py` — minimal Telegram text-message sender, env-var driven
  (`TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`), with HTML-then-plain retry on send failure. From
  `~/signal-watcher/sinks/telegram_sink.py` and `~/signal-watcher/report.py`.
- `launchd_install.sh.template` — install/refresh/stop N macOS launchd agents with race-safe
  bootout→settle→bootstrap sequencing. From `~/signal-watcher/install_launchd.sh`.
- `curl_cffi_cloudflare.md` — recipe for getting past Cloudflare with `curl_cffi` TLS
  impersonation, plus a Rails-form login pattern on top. From
  `~/signal-watcher/redpanda/scrape.py`.
