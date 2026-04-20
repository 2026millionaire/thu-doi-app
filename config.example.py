"""Copy thành config.py và chỉnh theo môi trường."""
import os

SECRET_KEY = os.environ.get("SECRET_KEY", "change-me-in-production-" + os.urandom(8).hex())

# Users giờ được quản lý trong shared DB /opt/pnj-shared/pnj-auth.db (module shared_auth).
# Tạo user qua: python /opt/pnj-shared/init_shared_db.py hoặc shared_auth.create_user().

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
