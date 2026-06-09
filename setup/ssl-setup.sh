#!/bin/bash
# TrainConnect Europe – SSL/HTTPS Setup auf Ubuntu/Debian VPS
# Ausführen als root oder mit sudo
# Ersetze DOMAIN mit deiner Domain

DOMAIN="trainconnect.eu"
APP_DIR="/opt/trainconnect"
NODE_USER="trainconnect"

echo "=== 1. Nginx installieren ==="
apt update && apt install -y nginx

echo "=== 2. Certbot installieren ==="
apt install -y certbot python3-certbot-nginx

echo "=== 3. Nginx-Konfiguration einrichten ==="
cp "$(dirname "$0")/nginx.conf" /etc/nginx/sites-available/trainconnect
# Domain anpassen (falls abweichend)
sed -i "s/trainconnect.eu/$DOMAIN/g" /etc/nginx/sites-available/trainconnect

# Symlink aktivieren
ln -sf /etc/nginx/sites-available/trainconnect /etc/nginx/sites-enabled/trainconnect
rm -f /etc/nginx/sites-enabled/default

echo "=== 4. Nginx Syntax prüfen ==="
nginx -t

echo "=== 5. Nginx starten ==="
systemctl enable nginx
systemctl restart nginx

echo "=== 6. SSL-Zertifikat von Let's Encrypt holen ==="
certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" \
  --non-interactive --agree-tos --email admin@$DOMAIN \
  --redirect

echo "=== 7. Automatische Zertifikat-Erneuerung testen ==="
certbot renew --dry-run

echo "=== 8. Node.js App als Systemd-Service einrichten ==="
cat > /etc/systemd/system/trainconnect.service << SERVICE
[Unit]
Description=TrainConnect Europe
After=network.target

[Service]
Type=simple
User=$NODE_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=/usr/bin/node $APP_DIR/server.js
Restart=on-failure
RestartSec=5
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=trainconnect

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable trainconnect
systemctl start trainconnect

echo ""
echo "✅ Setup abgeschlossen!"
echo "   → https://$DOMAIN"
echo "   Logs: journalctl -fu trainconnect"
echo "   Nginx: systemctl status nginx"
