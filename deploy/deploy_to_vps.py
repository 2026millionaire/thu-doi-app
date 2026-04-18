"""Deploy CS Thu Đổi app → dangkhoa.io.vn/bk/thudoi/

Sử dụng (chạy từ thư mục `cs-thudoi-app/`):

    python deploy/deploy_to_vps.py             # update code + restart service
    python deploy/deploy_to_vps.py --nginx     # ALSO patch nginx (chỉ cần lần đầu)
    python deploy/deploy_to_vps.py --status    # chỉ check status, không deploy

Yêu cầu:
    pip install paramiko

SSH password lấy từ:
    1. env VPS_PASSWORD
    2. file deploy/.vps_password (đã gitignore)
    3. prompt stdin nếu cả 2 trên không có
"""
import argparse
import getpass
import os
import re
import sys
import tarfile
import tempfile
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

try:
    import paramiko
except ImportError:
    sys.exit("Cần paramiko. Chạy: pip install paramiko")

HERE = Path(__file__).resolve().parent
APP_DIR = HERE.parent  # cs-thudoi-app/

# === VPS config ===
HOST = '103.72.98.135'
PORT = 24700
USER = 'root'
REMOTE_APP_DIR = '/opt/thu-doi-app'
REMOTE_TARBALL = '/tmp/thu-doi-app.tar.gz'
SERVICE_NAME = 'thu-doi-app'
NGINX_FILE = '/etc/nginx/sites-enabled/phieuck'
PUBLIC_URL = 'https://dangkhoa.io.vn/bk/thudoi/'
INTERNAL_CHECK = 'http://127.0.0.1:5052/bk/thudoi/'

# === Tarball filter ===
EXCLUDE_DIRS = {'venv', '__pycache__', '.git', '.pytest_cache', 'node_modules', '.claude'}
EXCLUDE_EXTS = {'.pyc', '.pyo', '.log'}
EXCLUDE_FILES = {'.DS_Store', '.vps_password'}

NGINX_BLOCK = """    location /bk/thudoi/ {
        proxy_pass http://127.0.0.1:5052/bk/thudoi/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 10M;
    }
    location = /bk/thudoi { return 301 /bk/thudoi/; }

"""


# ------------------ helpers ------------------
def get_password():
    p = os.environ.get('VPS_PASSWORD')
    if p:
        return p
    pw_file = HERE / '.vps_password'
    if pw_file.exists():
        return pw_file.read_text(encoding='utf-8').strip()
    return getpass.getpass(f'SSH password for {USER}@{HOST}: ')


def build_tarball() -> Path:
    tmp = Path(tempfile.gettempdir()) / 'thu-doi-app-deploy.tar.gz'
    print(f'→ Đóng gói code từ {APP_DIR}')

    def _filter(tarinfo):
        parts = Path(tarinfo.name).parts
        if any(p in EXCLUDE_DIRS for p in parts):
            return None
        name = Path(tarinfo.name).name
        if name in EXCLUDE_FILES:
            return None
        if Path(tarinfo.name).suffix in EXCLUDE_EXTS:
            return None
        return tarinfo

    with tarfile.open(tmp, 'w:gz') as tar:
        tar.add(APP_DIR, arcname='thu-doi-app', filter=_filter)
    kb = tmp.stat().st_size / 1024
    print(f'  Tarball {kb:.0f} KB → {tmp}')
    return tmp


def run(ssh, cmd, timeout=180, label=None):
    label = label or cmd
    short = label if len(label) <= 120 else label[:117] + '...'
    print(f'$ {short}')
    _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode(errors='replace')
    err = stderr.read().decode(errors='replace')
    rc = stdout.channel.recv_exit_status()
    for line in out.rstrip().splitlines():
        print(f'  {line}')
    for line in err.rstrip().splitlines():
        print(f'  [err] {line}')
    if rc != 0:
        print(f'  ⚠️ rc={rc}')
    return rc, out, err


# ------------------ actions ------------------
def deploy_code(ssh, tarball_path: Path):
    print('\n── 1. Upload ─────────────')
    sftp = ssh.open_sftp()
    sftp.put(str(tarball_path), REMOTE_TARBALL)
    sftp.close()
    print(f'  Uploaded → {REMOTE_TARBALL}')

    print('\n── 2. Extract + rsync ────')
    run(ssh, f'cd /tmp && rm -rf thu-doi-app && tar -xzf {REMOTE_TARBALL}')
    run(ssh,
        f'mkdir -p {REMOTE_APP_DIR} && '
        f'rsync -a --delete --exclude=venv --exclude=.git '
        f'/tmp/thu-doi-app/ {REMOTE_APP_DIR}/')

    print('\n── 3. Dependencies ──────')
    run(ssh, f'[ -d {REMOTE_APP_DIR}/venv ] || python3 -m venv {REMOTE_APP_DIR}/venv')
    run(ssh, f'{REMOTE_APP_DIR}/venv/bin/pip install -U pip --quiet')
    run(ssh, f'{REMOTE_APP_DIR}/venv/bin/pip install -r {REMOTE_APP_DIR}/requirements.txt --quiet')

    print('\n── 4. Service ───────────')
    svc_path = f'/etc/systemd/system/{SERVICE_NAME}.service'
    rc, _, _ = run(ssh, f'test -f {svc_path}', label='[check service file exists]')
    if rc != 0:
        print('  → Tạo service file mới (lần đầu)')
        run(ssh, f'cp {REMOTE_APP_DIR}/deploy/{SERVICE_NAME}.service {svc_path}')
        run(ssh, f'SECRET=$(openssl rand -hex 32) && '
                 f'sed -i "s|CHANGE_ME_PROD_SECRET_KEY_HERE|$SECRET|" {svc_path}')
        run(ssh, 'systemctl daemon-reload')
        run(ssh, f'systemctl enable {SERVICE_NAME}')
    run(ssh, f'systemctl restart {SERVICE_NAME} && sleep 1 && systemctl is-active {SERVICE_NAME}')

    print('\n── 5. Smoke test ────────')
    run(ssh, f'curl -s -o /dev/null -w "internal=%{{http_code}}\\n" {INTERNAL_CHECK}')


def patch_nginx(ssh):
    print('\n── 6. Nginx config ──────')
    sftp = ssh.open_sftp()
    with sftp.file(NGINX_FILE, 'r') as f:
        content = f.read().decode()
    if 'location /bk/thudoi/' in content:
        print('  ✓ Đã có block /bk/thudoi/ — skip.')
        sftp.close()
        return
    m = re.search(r'^( *)location /bk/ \{', content, re.MULTILINE)
    if not m:
        print('  ⚠️ Không tìm thấy "location /bk/ {". Paste block sau vào file manual:')
        print(NGINX_BLOCK)
        sftp.close()
        return
    new_content = content[:m.start()] + NGINX_BLOCK + content[m.start():]
    run(ssh, f'cp -a {NGINX_FILE} {NGINX_FILE}.bak-$(date +%s)')
    with sftp.file(NGINX_FILE, 'w') as f:
        f.write(new_content)
    sftp.close()
    print(f'  → Wrote {len(new_content)} bytes')
    rc, out, err = run(ssh, 'nginx -t 2>&1')
    if rc != 0:
        print('  ❌ nginx -t failed. Rollback:')
        run(ssh, f'ls -t {NGINX_FILE}.bak-* | head -1 | xargs -I{{}} cp -a {{}} {NGINX_FILE}')
        return
    run(ssh, 'systemctl reload nginx')
    run(ssh, f'curl -s -o /dev/null -w "public=%{{http_code}}\\n" -L -k {PUBLIC_URL}')


def status(ssh):
    print('\n── STATUS ───────────────')
    run(ssh, f'systemctl is-active {SERVICE_NAME}')
    run(ssh, f'systemctl show {SERVICE_NAME} -p ActiveEnterTimestamp -p MainPID')
    run(ssh, f'curl -s -o /dev/null -w "internal=%{{http_code}}\\n" {INTERNAL_CHECK}')
    run(ssh, f'curl -s -o /dev/null -w "public=%{{http_code}}\\n" -L -k {PUBLIC_URL}')
    run(ssh, f'grep -c "thudoi" {NGINX_FILE}')
    run(ssh, f'journalctl -u {SERVICE_NAME} -n 5 --no-pager')


def main():
    ap = argparse.ArgumentParser(description='Deploy CS Thu Đổi app lên VPS.')
    ap.add_argument('--nginx', action='store_true',
                    help='Cũng patch nginx (chỉ cần lần đầu hoặc khi config thay đổi).')
    ap.add_argument('--status', action='store_true',
                    help='Chỉ check status, không deploy.')
    args = ap.parse_args()

    pw = get_password()
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f'Connecting to {USER}@{HOST}:{PORT}…')
    ssh.connect(HOST, port=PORT, username=USER, password=pw, timeout=15)
    print('Connected.')

    try:
        if args.status:
            status(ssh)
            return
        tarball = build_tarball()
        deploy_code(ssh, tarball)
        if args.nginx:
            patch_nginx(ssh)
    finally:
        ssh.close()

    print(f'\n✅ Done. {PUBLIC_URL}')


if __name__ == '__main__':
    main()
