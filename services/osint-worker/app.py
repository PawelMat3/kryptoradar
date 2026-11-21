"""Krypto Radar osint-worker: HTTP wrapper na Maigret (MIT).

Maigret sprawdza, na których serwisach istnieje konto o danym nicku. Worker:
  - w trybie demo używa bazy syntetycznych serwisów (sites/demo-db.json),
  - w trybie live ogranicza Maigreta do listy dozwolonych serwisów (MAIGRET_LIVE_SITES),
  - wyłącza autoaktualizację bazy i rekurencję (kontrolowany, odtwarzalny zakres zapytań),
  - zwraca liczbę sprawdzonych serwisów (do oceny "pospolitości" nicku).
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

HERE = Path(__file__).parent
DEMO_DB = HERE / "sites" / "demo-db.json"
LIVE_SITES = [s.strip() for s in os.getenv("MAIGRET_LIVE_SITES", "GitHub,GitLab,Keybase,HackerNews,Telegram,Reddit").split(",") if s.strip()]
TIMEOUT = os.getenv("MAIGRET_TIMEOUT", "15")
USERNAME_RE = re.compile(r"^[A-Za-z0-9._\-]{2,64}$")

app = FastAPI(title="Krypto Radar osint-worker", version="0.1.0")


def maigret_version() -> str:
    try:
        import maigret  # type: ignore

        return getattr(maigret, "__version__", "unknown")
    except Exception:  # pragma: no cover
        return "unknown"


class SearchRequest(BaseModel):
    username: str = Field(..., max_length=64)
    mode: str = "demo"


@app.get("/health")
def health():
    return {"ok": True, "maigret": maigret_version(), "liveSites": LIVE_SITES, "demoDb": DEMO_DB.name}


@app.post("/search")
def search(req: SearchRequest):
    if not USERNAME_RE.match(req.username):
        raise HTTPException(400, "Niedozwolone znaki w nicku")
    with tempfile.TemporaryDirectory() as out:
        cmd = [
            sys.executable, "-m", "maigret", req.username,
            "--no-autoupdate", "--no-recursion", "--no-progressbar", "--no-color",
            "--timeout", TIMEOUT, "--retries", "0",
            "--dns-resolver", "threaded",
            "-J", "simple", "-fo", out,
        ]
        if req.mode == "demo":
            cmd += ["--db", str(DEMO_DB), "-a"]
            checked = len(json.loads(DEMO_DB.read_text(encoding="utf-8"))["sites"])
            db = DEMO_DB.name
        else:
            for s in LIVE_SITES:
                cmd += ["--site", s]
            checked = len(LIVE_SITES)
            db = "maigret-builtin (ograniczona do: " + ", ".join(LIVE_SITES) + ")"
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=240)
        report = Path(out) / f"report_{req.username}_simple.json"
        if not report.exists():
            raise HTTPException(502, f"Maigret nie zwrócił raportu: {proc.stderr[-500:] or proc.stdout[-500:]}")
        data = json.loads(report.read_text(encoding="utf-8"))

    claimed = []
    for site, r in data.items():
        st = r.get("status") or {}
        if st.get("status") != "Claimed":
            continue
        claimed.append({
            "site": site,
            "url": r.get("url_user") or st.get("url"),
            "username": r.get("username", req.username),
            "tags": st.get("tags", []),
            "ids": st.get("ids") or {},
        })
    return {"username": req.username, "checkedSites": checked, "claimed": claimed, "maigretVersion": maigret_version(), "db": db}
