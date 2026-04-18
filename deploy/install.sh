#!/bin/bash
# Deploy /bk/thudoi/ → port 5052. Pattern theo /ctkm/.
# Chạy trên VPS root. Giả định repo đã được clone tại /tmp/thu-doi-app hoặc /opt/thu-doi-app.
#
# Usage:
#   # Lần đầu (clone repo):
#   bash install.sh clone https://github.com/<user>/<repo>.git
#
#   # Update (git pull):
#   bash install.sh update

set -euo pipefail

APP_NAME="thu-doi-app"
APP_DIR="/opt/${APP_NAME}"
SERVICE_NAME="${APP_NAME}"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
PORT=5052
PREFIX="/bk/thudoi"
NGINX_FILE="/etc/nginx/sites-enabled/phieuck"

MODE="${1:-update}"
REPO_URL="${2:-}"

die() { echo "❌ $*" >&2; exit 1; }

case "$MODE" in
  clone)
    [ -n "$REPO_URL" ] || die "Cần repo URL. Chạy: bash install.sh clone <repo-url>"
    [ ! -d "$APP_DIR" ] || die "$APP_DIR đã tồn tại. Dùng mode 'update' hoặc xóa folder trước."
    echo "==> 1. Clone $REPO_URL → $APP_DIR"
    cd /opt && git clone "$REPO_URL" "$APP_NAME"
    ;;
  update)
    [ -d "$APP_DIR/.git" ] || die "$APP_DIR không phải git repo. Chạy mode 'clone' trước."
    echo "==> 1. git pull"
    cd "$APP_DIR" && git pull --ff-only
    ;;
  *)
    die "Mode phải là 'clone' hoặc 'update'"
    ;;
esac

cd "$APP_DIR"

echo "==> 2. Venv + deps"
if [ ! -d venv ]; then
  python3 -m venv venv
fi
./venv/bin/pip install --upgrade pip --quiet
./venv/bin/pip install -r requirements.txt --quiet

echo "==> 3. Systemd service"
if [ ! -f "$SERVICE_FILE" ]; then
  cp deploy/${APP_NAME}.service "$SERVICE_FILE"
  # Generate random SECRET_KEY (chỉ lần đầu)
  SECRET=$(openssl rand -hex 32)
  sed -i "s|CHANGE_ME_PROD_SECRET_KEY_HERE|$SECRET|" "$SERVICE_FILE"
  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME"
  echo "   Đã tạo $SERVICE_FILE với SECRET_KEY random."
  echo "   ⚠️ Password admin mặc định: xinlayEOFFICE#002 (đổi trong $SERVICE_FILE nếu cần)"
fi
systemctl restart "$SERVICE_NAME"
sleep 1
systemctl --no-pager status "$SERVICE_NAME" | head -12

echo "==> 4. Test port nội bộ"
if curl -sf -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:${PORT}${PREFIX}/login" | grep -q "^200$"; then
  echo "   ✓ App response 200 tại http://127.0.0.1:${PORT}${PREFIX}/login"
else
  echo "   ⚠️ Port $PORT chưa response OK. Check: journalctl -u $SERVICE_NAME -n 30 --no-pager"
fi

echo "==> 5. Nginx"
if grep -q "location ${PREFIX}/" "$NGINX_FILE"; then
  echo "   ✓ Nginx đã có location ${PREFIX}/ — skip."
else
  echo "   ⚠️ Chưa có location ${PREFIX}/ trong $NGINX_FILE"
  echo "   Paste block sau vào file (ở đâu cũng được, miễn trong server block SSL):"
  echo "   ─────────────────────────────────────────"
  cat deploy/nginx-location.conf
  echo "   ─────────────────────────────────────────"
  echo "   Sửa xong: sudo nginx -t && sudo systemctl reload nginx"
fi

echo ""
echo "==> XONG."
echo "   URL: https://dangkhoa.io.vn${PREFIX}/"
echo "   Login: admin / xinlayEOFFICE#002"
echo "   Log:   journalctl -u $SERVICE_NAME -f"
