"""Copy thành config.py và chỉnh theo môi trường."""
import hashlib
import os

SECRET_KEY = os.environ.get("SECRET_KEY", "change-me-in-production-" + os.urandom(8).hex())


def _h(pw: str) -> str:
    return hashlib.sha256(pw.encode()).hexdigest()


# Danh sách user. Key = username, Value = sha256 hash của password.
# Đổi password trước khi deploy!
USERS = {
    "admin": _h("admin123"),
    "khoa": _h("huepnj1305"),
}

# Cache giá vàng (giây)
GIA_VANG_CACHE_TTL = 300

# API PNJ
API_DIRECT = "https://edge-cf-api.pnj.io/ecom-frontend/v3/get-gold-price"
API_PROXY = "https://api.codetabs.com/v1/proxy/?quest=" + API_DIRECT
LOCATION_NAMES = [
    "TPHCM", "Hà Nội", "Đà Nẵng", "Miền Tây", "Tây Nguyên", "Đông Nam Bộ",
    "Giá vàng nữ trang", "Giá vàng nguyên liệu mua ngoài",
]

PLATIN_AGES = [
    {"name": "Platin 9000", "ratio": 0.9000},
    {"name": "Platin 9250", "ratio": 0.9250},
]
PLATIN_BASE_GOLD = "Vàng nữ trang 999.9"
