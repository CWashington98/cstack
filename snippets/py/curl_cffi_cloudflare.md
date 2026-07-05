# Getting past Cloudflare with curl_cffi

Vendored 2026-07-05 from `~/signal-watcher/redpanda/scrape.py` (logging into a Kajabi-hosted
site sitting behind Cloudflare). Copy-paste by design.

## The problem

A plain `requests.get()` against a Cloudflare-fronted site gets 403'd — Cloudflare fingerprints
the TLS/HTTP handshake, and stock `requests`/`urllib3` doesn't look like a real browser.

## The recipe

Use [`curl_cffi`](https://github.com/lexiforest/curl_cffi) instead of `requests`. It has an
(almost) drop-in `requests`-shaped API but does real browser TLS/JA3 impersonation
(`impersonate="chrome"`), which is enough to get a clean 200 from Cloudflare without a headless
browser.

```python
from curl_cffi import requests  # NOT the stdlib requests — same API surface, different TLS stack

IMPERSONATE = "chrome"

session = requests.Session()

# Cloudflare only cares about the TLS/HTTP fingerprint — pass impersonate= on every call
r = session.get("https://example.mykajabi.com/login", impersonate=IMPERSONATE, timeout=30)
```

Key points:

- **Pass `impersonate=` on every request**, not just the session constructor — some
  `curl_cffi` versions reset it per-call.
- **Use a `Session`**, not one-off `requests.get()` calls, so cookies (including
  Cloudflare's `cf_clearance`) persist across the login → fetch sequence.
- **Timeouts matter** — Cloudflare challenge pages can hang; 30s was enough in practice.
- If `impersonate="chrome"` ever stops working (Cloudflare tightens fingerprinting), the
  fallback is a real headless browser (Playwright) — don't fight it further with tweaks.

## Login flow on top (Rails-style form auth)

Cloudflare-passing gets you *to* the page; a login-gated page also needs the site's own auth.
For a standard Rails form (CSRF token + cookie-based session), the pattern is: GET the login
page for the token, then POST credentials + token.

```python
import re

def _token(html_text: str) -> str | None:
    """Pull the Rails authenticity_token out of the login form (attribute order varies)."""
    m = re.search(r'name=["\']authenticity_token["\'][^>]*value=["\']([^"\']+)', html_text) or \
        re.search(r'value=["\']([^"\']+)["\'][^>]*name=["\']authenticity_token', html_text)
    return m.group(1) if m else None


def login(session, email: str, password: str, login_url: str) -> None:
    r = session.get(login_url, impersonate=IMPERSONATE, timeout=30)
    if r.status_code != 200:
        raise RuntimeError(f"GET login blocked (status {r.status_code}) — Cloudflare may have "
                            f"tightened; fall back to the Playwright path.")
    token = _token(r.text)
    if not token:
        raise RuntimeError("could not find authenticity_token on login page (page layout changed?)")

    resp = session.post(
        login_url,
        impersonate=IMPERSONATE,
        timeout=30,
        allow_redirects=True,
        data={
            "utf8": "✓",
            "authenticity_token": token,
            "member[email]": email,
            "member[password]": password,
            "member[remember_me]": "1",
            "commit": "Sign In",
        },
    )
    if resp.status_code >= 400:
        raise RuntimeError("login failed — check credentials (no captcha was present, so it's "
                            "almost certainly wrong email/password).")
```

## Retry / failure posture

The original script doesn't retry Cloudflare/login failures automatically — it raises
`RuntimeError` with a message pointing at the likely cause (Cloudflare tightened vs. bad
credentials vs. page layout changed) and lets the caller decide (cron job just fails loudly
that run). That's a deliberate choice for a low-frequency (monthly) scrape: silent retries
would hide a real fingerprinting regression. For higher-frequency scrapes, wrap the `login()` +
fetch call in your own retry/backoff.
