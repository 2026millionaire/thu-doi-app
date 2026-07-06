"""CS Thu Đổi – App tra cứu + calculator giá mua lại.

Chạy local:
    python app.py
→ http://127.0.0.1:5052

Production (VPS):
    gunicorn -w 2 -b 127.0.0.1:5052 app:app
"""
import hashlib
import json
import os
import re
import sqlite3
import time
from datetime import datetime, timedelta
from functools import wraps
from pathlib import Path

import requests
from flask import (
    Flask,
    jsonify,
    redirect,
    render_template,
    request,
    session,
    url_for,
)
from werkzeug.middleware.proxy_fix import ProxyFix

import config
import shared_auth

HERE = Path(__file__).parent
DATA_PATH = HERE / "data.json"
GOLD_HISTORY_DB_PATH = Path(
    getattr(config, "GOLD_HISTORY_DB_PATH", os.environ.get("GOLD_HISTORY_DB_PATH", HERE / "gold_history.db"))
)
API_HISTORY = getattr(
    config,
    "API_HISTORY",
    "https://edge-cf-api.pnj.io/ecom-frontend/v1/get-gold-price-history",
)
GOLD_HISTORY_LOOKBACK_DAYS = int(getattr(config, "GOLD_HISTORY_LOOKBACK_DAYS", 14))


class PrefixMiddleware:
    """Strip APPLICATION_ROOT prefix khỏi PATH_INFO, set SCRIPT_NAME.
    Pattern giống /ctkm/: nginx proxy_pass http://.../bk/thudoi/ — upstream giữ prefix,
    middleware strip để Flask match routes gốc (/login, /api/data…) nhưng url_for vẫn ra
    đường link có prefix (qua SCRIPT_NAME).
    """
    def __init__(self, app, prefix):
        self.app = app
        self.prefix = prefix.rstrip("/")

    def __call__(self, environ, start_response):
        if not self.prefix:
            return self.app(environ, start_response)
        path = environ.get("PATH_INFO", "")
        if path == self.prefix or path.startswith(self.prefix + "/"):
            environ["PATH_INFO"] = path[len(self.prefix):] or "/"
            environ["SCRIPT_NAME"] = self.prefix
        return self.app(environ, start_response)


app = Flask(__name__)
app.secret_key = config.SECRET_KEY
# Tên cookie riêng để tránh đụng với session của app phieu-ck (cùng domain).
# Trước đây cả 2 app đều dùng cookie mặc định "session" → browser gửi cả 2
# khi ở /bk/thudoi/, Flask parse nhầm → user bị logout khi switch app.
app.config["SESSION_COOKIE_NAME"] = "session_thudoi"
# ProxyFix xử lý X-Forwarded-For/Proto/Host (nginx đã set)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
# Prefix từ env (VD APPLICATION_ROOT=/bk/thudoi). Local dev không set → middleware no-op.
_prefix = os.environ.get("APPLICATION_ROOT", "").strip()
if _prefix:
    app.wsgi_app = PrefixMiddleware(app.wsgi_app, _prefix)

# Load data 1 lần khi khởi động.
DATA = json.loads(DATA_PATH.read_text(encoding="utf-8"))

# In-memory cache giá vàng.
_gold_cache = {"data": None, "ts": 0.0, "via_proxy": False}


def _now_iso() -> str:
    return datetime.now().replace(microsecond=0).isoformat(sep=" ")


def _json_dumps(data: dict) -> str:
    return json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _parse_pnj_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    value = value.strip()
    for fmt in ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None


def _parse_client_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    value = value.strip()
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None


def _snapshot_time_from_payload(data: dict) -> datetime | None:
    times = []
    for loc in data.get("locations", []):
        for gold in loc.get("gold_type", []):
            dt = _parse_pnj_datetime(gold.get("updated_at"))
            if dt:
                times.append(dt)
    if times:
        return max(times)

    text = data.get("updated_text") or ""
    match = re.search(r"(\d{2}/\d{2}/\d{4}\s+\d{2}:\d{2}:\d{2})", text)
    return _parse_pnj_datetime(match.group(1)) if match else None


def _gold_db():
    GOLD_HISTORY_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(GOLD_HISTORY_DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("""
        CREATE TABLE IF NOT EXISTS gold_history_days (
            date_key TEXT PRIMARY KEY,
            fetched_at TEXT NOT NULL,
            status_code INTEGER NOT NULL,
            has_data INTEGER NOT NULL,
            payload_json TEXT NOT NULL
        )
    """)
    con.execute("""
        CREATE TABLE IF NOT EXISTS gold_price_snapshots (
            snapshot_at TEXT PRIMARY KEY,
            last_seen_at TEXT NOT NULL,
            price_hash TEXT NOT NULL,
            source_date TEXT NOT NULL,
            fetched_at TEXT NOT NULL,
            payload_json TEXT NOT NULL
        )
    """)
    con.execute("CREATE INDEX IF NOT EXISTS idx_gold_snapshots_hash ON gold_price_snapshots(price_hash)")
    con.commit()
    return con


def _price_hash(payload: dict) -> str:
    stripped = {"locations": []}
    for loc in payload.get("locations", []):
        clean_loc = {"name": loc.get("name", ""), "gold_type": []}
        for gold in loc.get("gold_type", []):
            clean_loc["gold_type"].append({
                "name": gold.get("name", ""),
                "gia_mua": gold.get("gia_mua", ""),
                "gia_ban": gold.get("gia_ban", ""),
            })
        stripped["locations"].append(clean_loc)
    return hashlib.sha256(_json_dumps(stripped).encode("utf-8")).hexdigest()


def _insert_gold_snapshot(payload: dict, snapshot_at: datetime, source_date: str) -> None:
    snapshot_key = snapshot_at.isoformat(sep=" ")
    payload = _append_platin(payload)
    price_hash = _price_hash(payload)
    payload_json = _json_dumps(payload)
    fetched_at = _now_iso()

    with _gold_db() as con:
        previous = con.execute(
            "SELECT snapshot_at, last_seen_at, price_hash FROM gold_price_snapshots "
            "WHERE snapshot_at <= ? ORDER BY snapshot_at DESC LIMIT 1",
            (snapshot_key,),
        ).fetchone()
        if previous and previous["price_hash"] == price_hash:
            last_seen_at = max(previous["last_seen_at"], snapshot_key)
            con.execute(
                "UPDATE gold_price_snapshots SET last_seen_at = ?, fetched_at = ? WHERE snapshot_at = ?",
                (last_seen_at, fetched_at, previous["snapshot_at"]),
            )
            return

        con.execute(
            "INSERT OR REPLACE INTO gold_price_snapshots "
            "(snapshot_at, last_seen_at, price_hash, source_date, fetched_at, payload_json) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (snapshot_key, snapshot_key, price_hash, source_date, fetched_at, payload_json),
        )


def _record_current_gold_snapshot(data: dict) -> None:
    snapshot_at = _snapshot_time_from_payload(data)
    if snapshot_at:
        _insert_gold_snapshot(data, snapshot_at, snapshot_at.strftime("%Y%m%d"))


def _history_payload_has_data(data: dict) -> bool:
    return any(
        gold.get("data")
        for loc in data.get("locations", [])
        for gold in loc.get("gold_type", [])
    )


def _state_before(snapshot_at: datetime) -> dict[tuple[int, str], dict]:
    state = {}
    with _gold_db() as con:
        row = con.execute(
            "SELECT payload_json FROM gold_price_snapshots WHERE snapshot_at < ? "
            "ORDER BY snapshot_at DESC LIMIT 1",
            (snapshot_at.isoformat(sep=" "),),
        ).fetchone()
    if not row:
        return state

    payload = json.loads(row["payload_json"])
    for loc_idx, loc in enumerate(payload.get("locations", [])):
        if loc.get("name") == "Platin (tự tính)":
            continue
        for gold in loc.get("gold_type", []):
            state[(loc_idx, gold.get("name", ""))] = dict(gold)
    return state


def _current_state_payload(locations: list[dict], state: dict[tuple[int, str], dict], snapshot_at: datetime) -> dict:
    out_locations = []
    for loc_idx, loc in enumerate(locations):
        gold_rows = []
        gold_names = []
        for gold in loc.get("gold_type", []):
            name = gold.get("name", "")
            if name and name not in gold_names:
                gold_names.append(name)
        for key_loc_idx, gold_name in state:
            if key_loc_idx == loc_idx and gold_name and gold_name not in gold_names:
                gold_names.append(gold_name)

        for gold_name in gold_names:
            key = (loc_idx, gold_name)
            row = state.get(key)
            if row:
                gold_rows.append(dict(row))
        loc_name = loc.get("name", "")
        if loc_idx < len(config.LOCATION_NAMES):
            loc_name = config.LOCATION_NAMES[loc_idx]
        out_locations.append({"name": loc_name, "gold_type": gold_rows})
    return {
        "updated_text": "Giá vàng ngày:  " + snapshot_at.strftime("%d/%m/%Y %H:%M:%S"),
        "locations": out_locations,
    }


def _import_history_payload(date_key: str, data: dict) -> int:
    events = []
    for loc_idx, loc in enumerate(data.get("locations", [])):
        for gold in loc.get("gold_type", []):
            gold_name = gold.get("name", "")
            for row in gold.get("data", []):
                dt = _parse_pnj_datetime(row.get("updated_at"))
                if not dt:
                    continue
                events.append((dt, loc_idx, gold_name, row))

    events.sort(key=lambda x: x[0])
    day_start = datetime.strptime(date_key, "%Y%m%d")
    state: dict[tuple[int, str], dict] = _state_before(day_start)
    inserted = 0
    i = 0
    while i < len(events):
        dt = events[i][0]
        while i < len(events) and events[i][0] == dt:
            _, loc_idx, gold_name, row = events[i]
            state[(loc_idx, gold_name)] = {
                "name": gold_name,
                "gia_ban": row.get("gia_ban", ""),
                "gia_mua": row.get("gia_mua", ""),
                "updated_at": row.get("updated_at", ""),
                "note": row.get("note", ""),
                "color_note": row.get("color_note", "#003468"),
            }
            i += 1

        payload = _current_state_payload(data.get("locations", []), state, dt)
        _insert_gold_snapshot(payload, dt, date_key)
        inserted += 1
    return inserted


def _history_day_cached(date_key: str) -> bool:
    with _gold_db() as con:
        row = con.execute(
            "SELECT status_code FROM gold_history_days WHERE date_key = ?",
            (date_key,),
        ).fetchone()
    return bool(row and row["status_code"] == 200)


def _history_day_row(date_key: str):
    with _gold_db() as con:
        return con.execute(
            "SELECT * FROM gold_history_days WHERE date_key = ?",
            (date_key,),
        ).fetchone()


def _fetch_history_day(date_key: str) -> dict:
    if _history_day_cached(date_key):
        return {"cached": True}

    fetched_at = _now_iso()
    try:
        r = requests.get(
            API_HISTORY,
            params={"date": date_key},
            timeout=15,
            headers={
                "Accept": "application/json",
                "User-Agent": "Mozilla/5.0 (cs-thudoi-app)",
            },
        )
        status = r.status_code
        payload = r.json() if r.text.startswith("{") else {"error": r.text[:500]}
    except Exception as e:
        return {"cached": False, "error": str(e)}

    has_data = status == 200 and _history_payload_has_data(payload)
    with _gold_db() as con:
        con.execute(
            "INSERT OR REPLACE INTO gold_history_days "
            "(date_key, fetched_at, status_code, has_data, payload_json) "
            "VALUES (?, ?, ?, ?, ?)",
            (date_key, fetched_at, status, 1 if has_data else 0, _json_dumps(payload)),
        )

    inserted = _import_history_payload(date_key, payload) if has_data else 0
    return {"cached": False, "status_code": status, "has_data": has_data, "inserted": inserted}


def _import_cached_history_day(date_key: str) -> None:
    row = _history_day_row(date_key)
    if not row or not row["has_data"] or row["status_code"] != 200:
        return
    _import_history_payload(date_key, json.loads(row["payload_json"]))


def _snapshot_for(target: datetime):
    target_key = target.isoformat(sep=" ")
    with _gold_db() as con:
        row = con.execute(
            "SELECT * FROM gold_price_snapshots WHERE snapshot_at <= ? "
            "ORDER BY snapshot_at DESC LIMIT 1",
            (target_key,),
        ).fetchone()
        if not row:
            return None
        next_row = con.execute(
            "SELECT snapshot_at FROM gold_price_snapshots WHERE snapshot_at > ? "
            "ORDER BY snapshot_at ASC LIMIT 1",
            (row["snapshot_at"],),
        ).fetchone()
    return row, next_row["snapshot_at"] if next_row else None


def _ensure_snapshot_for(target: datetime) -> dict:
    looked_up = []
    target_has_data = False
    for offset in range(GOLD_HISTORY_LOOKBACK_DAYS + 1):
        day = target.date() - timedelta(days=offset)
        date_key = day.strftime("%Y%m%d")
        looked_up.append(date_key)
        _fetch_history_day(date_key)

        day_row = _history_day_row(date_key)
        has_data = bool(day_row and day_row["has_data"] and day_row["status_code"] == 200)
        if offset == 0:
            target_has_data = has_data
        if has_data and (offset > 0 or not target_has_data):
            break

    for date_key in reversed(looked_up):
        _import_cached_history_day(date_key)

    found = _snapshot_for(target)
    if found:
        row, next_snapshot_at = found
        return {
            "row": row,
            "next_snapshot_at": next_snapshot_at,
            "looked_up": looked_up,
        }
    return {"row": None, "next_snapshot_at": None, "looked_up": looked_up}


def login_required(f):
    @wraps(f)
    def wrap(*args, **kwargs):
        if "user" not in session:
            # Absolute path bao gồm prefix (script_root) để redirect về đúng URL sau login
            nxt = request.script_root + request.path
            return redirect(url_for("login", next=nxt))
        return f(*args, **kwargs)

    return wrap


# ==== ROUTES ====


@app.context_processor
def inject_cross_app_links():
    host = request.host.split(":")[0]
    is_local = host in {"127.0.0.1", "localhost"}
    return {
        "bieu_mau_url": "http://127.0.0.1:5050/bieu-mau" if is_local else "/bk/bieu-mau",
    }


@app.route("/")
@login_required
def index():
    # mtime của app.js + styles.css → cache-bust query ?v=... để browser luôn pick bản mới khi deploy
    statics = [HERE / "static" / f for f in ("app.js", "styles.css")]
    cache_bust = str(max(int(p.stat().st_mtime) for p in statics if p.exists()))
    return render_template("index.html", user=session.get("user"), cache_bust=cache_bust)


@app.route("/login", methods=["GET", "POST"])
def login():
    error = None
    if request.method == "POST":
        u = (request.form.get("username") or "").strip()
        p = request.form.get("password") or ""
        user = shared_auth.authenticate(u, p)
        if user:
            session["user"] = user["username"]
            session["role"] = user["role"]
            nxt = request.args.get("next") or url_for("index")
            return redirect(nxt)
        error = "Sai tài khoản hoặc mật khẩu"
    return render_template("login.html", error=error)


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/api/data")
@login_required
def api_data():
    return jsonify(DATA)


@app.route("/api/gia-vang-snapshot")
@login_required
def api_gia_vang_snapshot():
    target = _parse_client_datetime(request.args.get("at"))
    if not target:
        return jsonify({"error": "invalid_at", "detail": "Dùng định dạng YYYY-MM-DDTHH:MM"}), 400

    result = _ensure_snapshot_for(target)
    row = result["row"]
    if not row:
        return jsonify({
            "error": "snapshot_not_found",
            "looked_up": result["looked_up"],
        }), 404

    data = json.loads(row["payload_json"])
    valid_to = result["next_snapshot_at"] or target.isoformat(sep=" ")
    return jsonify({
        "data": data,
        "snapshot_at": row["snapshot_at"],
        "last_seen_at": row["last_seen_at"],
        "valid_from": row["snapshot_at"],
        "valid_to": valid_to,
        "requested_at": target.isoformat(sep=" "),
        "source_date": row["source_date"],
        "looked_up": result["looked_up"],
    })


def _append_platin(data: dict) -> dict:
    """Thêm 1 'location' ảo chứa Platin: giá = giá vàng NT 999.9 × tuổi platin."""
    if any(loc.get("name") == "Platin (tự tính)" for loc in data.get("locations", [])):
        return data

    # Tìm giá gốc
    base = None
    for loc in data.get("locations", []):
        for g in loc.get("gold_type", []):
            if g.get("name") == config.PLATIN_BASE_GOLD:
                base = g
                break
        if base:
            break
    if not base:
        return data  # không có giá gốc → bỏ qua

    def _num(s):
        try:
            return float(str(s).replace(".", "").replace(",", ""))
        except Exception:
            return 0.0

    def _fmt_api(v):
        # API format: số nguyên có dấu . phân cách ngàn (ví dụ "16.500")
        n = round(v)
        return f"{n:,.0f}".replace(",", ".")

    mua = _num(base.get("gia_mua", 0))
    ban = _num(base.get("gia_ban", 0))

    platin_types = []
    for p in config.PLATIN_AGES:
        platin_types.append({
            "name": p["name"],
            "gia_mua": _fmt_api(mua * p["ratio"]),
            "gia_ban": _fmt_api(ban * p["ratio"]),
            "updated_at": base.get("updated_at", ""),
            "note": f"= {config.PLATIN_BASE_GOLD} × {p['ratio']:.4f}",
            "color_note": "#6b7280",
        })

    platin_loc = {"name": "Platin (tự tính)", "gold_type": platin_types}
    data = dict(data)
    data["locations"] = list(data.get("locations", [])) + [platin_loc]
    return data


@app.route("/api/gia-vang")
@login_required
def api_gia_vang():
    force = request.args.get("refresh") == "1"
    now = time.time()
    if (
        not force
        and _gold_cache["data"]
        and now - _gold_cache["ts"] < config.GIA_VANG_CACHE_TTL
    ):
        return jsonify({
            "source": "cache",
            "via_proxy": _gold_cache["via_proxy"],
            "cached_at": _gold_cache["ts"],
            "age_sec": round(now - _gold_cache["ts"]),
            "data": _gold_cache["data"],
        })

    # Thử direct trước
    try:
        r = requests.get(
            config.API_DIRECT,
            timeout=8,
            headers={
                "Accept": "application/json",
                "User-Agent": "Mozilla/5.0 (cs-thudoi-app)",
            },
        )
        if r.status_code == 200 and r.text.startswith("{"):
            data = _append_platin(r.json())
            _record_current_gold_snapshot(data)
            _gold_cache.update(data=data, ts=now, via_proxy=False)
            return jsonify({
                "source": "direct",
                "via_proxy": False,
                "cached_at": now,
                "age_sec": 0,
                "data": data,
            })
    except Exception:
        pass

    # Fallback codetabs proxy
    try:
        r = requests.get(config.API_PROXY, timeout=15)
        if r.status_code == 200 and r.text.startswith("{"):
            data = r.json()
            # fix encoding location names (proxy đôi khi trả lỗi dấu)
            for i, loc in enumerate(data.get("locations", [])):
                if i < len(config.LOCATION_NAMES):
                    loc["name"] = config.LOCATION_NAMES[i]
            data = _append_platin(data)
            _record_current_gold_snapshot(data)
            _gold_cache.update(data=data, ts=now, via_proxy=True)
            return jsonify({
                "source": "proxy",
                "via_proxy": True,
                "cached_at": now,
                "age_sec": 0,
                "data": data,
            })
    except Exception as e:
        return jsonify({"error": "proxy_failed", "detail": str(e)}), 502

    return jsonify({"error": "both_failed"}), 502


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5052, debug=True)
