"""CS Thu Đổi – App tra cứu + calculator giá mua lại.

Chạy local:
    python app.py
→ http://127.0.0.1:5052

Production (VPS):
    gunicorn -w 2 -b 127.0.0.1:5052 app:app
"""
import json
import os
import time
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


def _append_platin(data: dict) -> dict:
    """Thêm 1 'location' ảo chứa Platin: giá = giá vàng NT 999.9 × tuổi platin."""
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
