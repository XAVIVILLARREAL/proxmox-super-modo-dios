#!/bin/bash
# ================================================================
# SUPER MODO DIOS PROXMOX — Setup Completo
# Ejecutar: wget -O /tmp/setup.sh URL && bash /tmp/setup.sh
# ================================================================
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'
log() { echo -e "${GREEN}[OK]${NC} $1"; }
err() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }
check() {
  if [ $? -eq 0 ]; then
    log "$1"
  else
    err "$1"
  fi
}

echo ""
echo "====================================="
echo " SUPER MODO DIOS PROXMOX — INSTALADOR"
echo "====================================="
echo ""

# 1. Node.js
if ! command -v node &>/dev/null; then
  echo "Instalando Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
check "Node.js $(node -v)"

# 2. npm
if ! command -v npm &>/dev/null; then
  apt-get install -y npm
fi
check "npm $(npm -v)"

# 3. Directorio
mkdir -p /opt/super-modo-dios-proxmox
cd /opt/super-modo-dios-proxmox
log "Directorio: $(pwd)"

# 4. package.json
cat > package.json <<'NPMJSON'
{
  "name": "super-modo-dios-proxmox",
  "version": "4.0.0",
  "description": "Super Modo Dios Proxmox Bridge",
  "main": "bridge.js",
  "scripts": { "start": "node bridge.js" },
  "dependencies": { "express": "^4.18.2", "ws": "^8.16.0" }
}
NPMJSON
check "package.json creado"

# 5. .env
cat > .env <<'DOTENV'
PORT=8003
API_KEYS=xtreme-god-proxmox-v1-x9k2m7p4q1:admin
CMD_TIMEOUT=60000
RATE_LIMIT=30
MAX_CONCURRENT=10
DOTENV
check ".env creado"

# 6. npm install
npm install --production 2>&1 | tail -1
check "npm install completo"

# 7. bridge.js desde GitHub
rm -f bridge.js
wget -q -O bridge.js https://raw.githubusercontent.com/XAVIVILLARREAL/proxmox-super-modo-dios/main/bridge.js
check "bridge.js descargado ($(wc -l < bridge.js) lineas, $(wc -c < bridge.js) bytes)"

# 8. Sintaxis
node -c bridge.js 2>&1
check "Sintaxis JavaScript OK"

# 9. systemd
cat > /etc/systemd/system/super-modo-dios-proxmox.service <<'SYSD'
[Unit]
Description=Super Modo Dios Proxmox Bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/super-modo-dios-proxmox
EnvironmentFile=/opt/super-modo-dios-proxmox/.env
ExecStart=/usr/bin/node /opt/super-modo-dios-proxmox/bridge.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SYSD
systemctl daemon-reload
systemctl enable super-modo-dios-proxmox
check "Servicio systemd instalado"

# 10. PVE Token
pveum user add agent-god@pve --comment "Super Modo Dios" 2>/dev/null || true
pveum aclmodify / --user agent-god@pve --role Administrator 2>/dev/null || true
echo ""
echo "=== API TOKEN PVE ==="
pveum user token add agent-god@pve god-token --privsep 0 2>&1 || echo "(ya existe)"

# 11. Arrancar
systemctl start super-modo-dios-proxmox
sleep 2

# 12. Probar
echo ""
echo "=== PROBANDO BRIDGE ==="
HEALTH=$(curl -s http://127.0.0.1:8003/health -H "X-API-Key: xtreme-god-proxmox-v1-x9k2m7p4q1")
echo "$HEALTH"

if echo "$HEALTH" | grep -q '"status":"ok"'; then
  echo ""
  echo "========================================="
  echo "  SUPER MODO DIOS PROXMOX — ACTIVO       "
  echo "  http://127.0.0.1:8003                  "
  echo "  API Key: xtreme-god-proxmox-v1-x9k2m7p4q1"
  echo "========================================="
else
  echo ""
  echo "ADVERTENCIA: El bridge no respondió. Logs:"
  journalctl -u super-modo-dios-proxmox --no-pager -n 10
fi
