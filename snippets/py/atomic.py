"""Vendored verbatim from ~/signal-watcher/atomic.py (2026-07-05) — copy-paste freely.

Atomic file writes — tmp + os.replace, so a crash/power loss mid-write can never
truncate the datastore (signals.json is rewritten every poll; the exposure recurs
thousands of times a day without this)."""
from __future__ import annotations

import os
import pathlib


def write_text(path, text: str) -> None:
    p = pathlib.Path(path)
    tmp = p.with_name(p.name + ".tmp")
    tmp.write_text(text)
    os.replace(tmp, p)  # atomic on APFS
