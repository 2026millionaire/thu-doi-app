# Deploy `thu-doi-app` → https://dangkhoa.io.vn/bk/thudoi/

| | |
|---|---|
| URL | `https://dangkhoa.io.vn/bk/thudoi/` |
| Folder | `/opt/thu-doi-app/` |
| Service | `thu-doi-app.service` |
| Port | 5052 |
| Nginx file | `/etc/nginx/sites-enabled/phieuck` |
| Login | `admin` / env `ADMIN_PASSWORD` |
| Pattern | Giống `/ctkm/` — upstream giữ prefix `/bk/thudoi/`, app tự handle qua `PrefixMiddleware` |

## Lần đầu deploy (một lần)

### A. Tạo GitHub repo

Tạo repo EMPTY tại `github.com/2026millionaire/thu-doi-app` (public hoặc private). Get URL HTTPS.

### B. Local — push code lên

```bash
cd "G:/#OSB/PNJ_CS-Thu-Doi/cs-thudoi-app"
git init -b master
git add .
git commit -m "Initial deploy"
git remote add origin https://github.com/2026millionaire/thu-doi-app.git
git push -u origin master
```

### C. VPS — clone + setup

```bash
ssh -p 24700 root@103.72.98.135

cd /opt
git clone https://github.com/2026millionaire/thu-doi-app.git thu-doi-app
cd thu-doi-app
bash deploy/install.sh clone  # nếu đã có $APP_DIR thì dùng 'update'
```

Script sẽ:
- Tạo `venv/` + cài deps
- Tạo `/etc/systemd/system/thu-doi-app.service` với SECRET_KEY random
- Enable + start service
- Test curl port 5052
- Print nginx snippet nếu chưa thêm

### D. Nginx (manual 1 lần)

```bash
sudo nano /etc/nginx/sites-enabled/phieuck
```

Paste 2 block sau (chỗ nào cũng được, miễn trong `server { ... }` SSL block):

```nginx
    location /bk/thudoi/ {
        proxy_pass http://127.0.0.1:5052/bk/thudoi/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 10M;
    }
    location = /bk/thudoi { return 301 /bk/thudoi/; }
```

Save (Ctrl+O, Enter, Ctrl+X) rồi:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## Update code (hàng ngày)

```bash
# Local:
cd "G:/#OSB/PNJ_CS-Thu-Doi/cs-thudoi-app"
git add . && git commit -m "message" && git push

# VPS (qua SSH hoặc one-liner):
ssh -p 24700 root@103.72.98.135 "cd /opt/thu-doi-app && git pull && systemctl restart thu-doi-app"
```

## Đổi password admin

```bash
sudo nano /etc/systemd/system/thu-doi-app.service
# sửa Environment=ADMIN_PASSWORD=<new>
sudo systemctl daemon-reload
sudo systemctl restart thu-doi-app
```

## Troubleshoot

| Vấn đề | Lệnh check |
|---|---|
| Service không start | `journalctl -u thu-doi-app -n 50 --no-pager` |
| Port 5052 không response | `curl -I http://127.0.0.1:5052/bk/thudoi/login` |
| 404 tại public URL | `grep -n "thudoi" /etc/nginx/sites-enabled/phieuck` |
| Session lost mỗi refresh | Check `Environment=SECRET_KEY=...` có set không |
