# 🔱 Super Modo Dios Proxmox — Guía de Despliegue

Control total del hypervisor Proxmox VE mediante un bridge HTTP + WebSocket + API Token PVE nativo,
expuesto de forma segura vía Cloudflare Tunnel con Zero Trust Access opcional.

## 🏗️ Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│  INTERNET                                                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                  │
│  │ DeepSeek │  │ Navegador│  │  Scripts │                  │
│  │  (IA)    │  │  (Admin) │  │  (CI/CD) │                  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘                  │
│       │             │             │                          │
│       └─────────────┼─────────────┘                          │
│                     │ HTTPS                                   │
│                     ▼                                         │
│  ┌──────────────────────────────────────┐                    │
│  │  Cloudflare Global Network           │                    │
│  │  ┌────────────────────────────────┐  │                    │
│  │  │ Zero Trust Access (opcional)   │  │                    │
│  │  │ • Email OTP / Google OAuth     │  │                    │
│  │  │ • Bypass para X-API-Key        │  │                    │
│  │  └────────────┬───────────────────┘  │                    │
│  │               │                      │                    │
│  │  proxmox.xtremediagnostics.com ──────┤ (UI Proxmox)       │
│  │  proxmox-mcp.xtremediagnostics.com ──┤ (Bridge API)       │
│  └───────────────┼──────────────────────┘                    │
│                  │                                            │
│          Cloudflare Tunnel (cloudflared)                      │
│                  │                                            │
└──────────────────┼────────────────────────────────────────────┘
                   │
┌──────────────────┼────────────────────────────────────────────┐
│  SERVIDOR PROXMOX VE (Debian 12 Bookworm)                     │
│                  │                                            │
│     ┌────────────┴───────────────┐                            │
│     │  cloudflared (systemd)     │  ← Túnel saliente           │
│     │  /etc/cloudflared/config.yml                            │
│     └────────┬───────────────────┘                            │
│              │                                                 │
│     ┌────────┴──────────┐   ┌─────────────────┐              │
│     │ localhost:8006    │   │ localhost:8003   │              │
│     │ Proxmox VE Web UI │   │ Super Modo Dios  │              │
│     │ (pveproxy)        │   │ Bridge (Node.js) │              │
│     └───────────────────┘   └────────┬────────┘              │
│                                      │                        │
│                     ┌────────────────┼────────────────┐       │
│                     │  Endpoints REST + WebSocket      │       │
│                     │  • /health    • /proxmox/vms     │       │
│                     │  • /metrics   • /proxmox/nodes   │       │
│                     │  • /shell/exec• /proxmox/storage │       │
│                     │  • /ws/exec   • /proxmox/vms/ID  │       │
│                     └────────────────┼────────────────┘       │
│                                      │                        │
│              ┌──────────────────────┼──────────────┐          │
│              │  Shell del Host Proxmox             │          │
│              │  qm | pct | pvesh | pveum | apt ... │          │
│              └─────────────────────────────────────┘          │
│                                                               │
│  ┌──────────────────────────────────────┐                     │
│  │ API Token PVE Nativo (opcional)      │                     │
│  │ Usuario: agent-god@pve               │                     │
│  │ Rol: Administrator                   │                     │
│  │ Token: agent-god@pve!god-token       │                     │
│  └──────────────────────────────────────┘                     │
└──────────────────────────────────────────────────────────────┘
```

## 🚀 Instalación Rápida

### Paso 1: Preparar archivos en el servidor Proxmox

```bash
# Desde tu máquina local, copia los archivos al Proxmox:
scp -r proxmox-deploy/* root@IP-DE-PROXMOX:/root/proxmox-deploy/
```

### Paso 2: Instalar el Bridge

```bash
ssh root@IP-DE-PROXMOX
cd /root/proxmox-deploy
chmod +x *.sh
bash install.sh
```

Esto instala:
- Node.js 20
- El bridge Super Modo Dios en `/opt/super-modo-dios-proxmox`
- Servicio systemd con auto-arranque
- API Token PVE nativo (`agent-god@pve` con rol Administrator)

### Paso 3: Configurar Cloudflare Tunnel

```bash
bash cloudflare-tunnel.sh
```

Esto:
- Instala `cloudflared`
- Crea el túnel Cloudflare
- Configura DNS para `proxmox.xtremediagnostics.com` y `proxmox-mcp.xtremediagnostics.com`
- Instala cloudflared como servicio systemd

### Paso 4 (Recomendado): Activar Zero Trust Access

Ve al panel de Cloudflare Zero Trust y agrega una Application para `proxmox.xtremediagnostics.com`:

1. https://one.dash.cloudflare.com → Access → Applications
2. Add Application → Self-Hosted
3. Domain: `proxmox.xtremediagnostics.com`
4. Policy: Allow → Emails ending in `@xtremediagnostics.com`
5. Para la API (`proxmox-mcp.xtremediagnostics.com`), agrega una bypass rule para el header `X-API-Key`

## 📡 Endpoints del Bridge

### Health & Métricas (rol: readonly)

```bash
# Health check
curl https://proxmox-mcp.xtremediagnostics.com/health \
  -H "X-API-Key: xtreme-god-proxmox-v1-x9k2m7p4q1"

# Métricas de uso
curl https://proxmox-mcp.xtremediagnostics.com/metrics \
  -H "X-API-Key: xtreme-god-proxmox-v1-x9k2m7p4q1"
```

### Shell Remoto (rol: admin)

```bash
# Ejecutar cualquier comando en el host Proxmox
curl -X POST https://proxmox-mcp.xtremediagnostics.com/shell/exec \
  -H "X-API-Key: xtreme-god-proxmox-v1-x9k2m7p4q1" \
  -H "Content-Type: application/json" \
  -d '{"command": "pveversion && qm list && pct list"}'
```

### Proxmox Específicos (rol: admin)

| Endpoint | Descripción | Ejemplo |
|----------|-------------|---------|
| `GET /proxmox/vms` | Listar VMs | `curl .../proxmox/vms -H 'X-API-Key: ...'` |
| `GET /proxmox/vms/:vmid` | Detalle de VM | `curl .../proxmox/vms/100 -H 'X-API-Key: ...'` |
| `POST /proxmox/vms/:vmid/start` | Iniciar VM | `curl -X POST .../proxmox/vms/100/start` |
| `POST /proxmox/vms/:vmid/stop` | Apagar VM | `curl -X POST .../proxmox/vms/100/stop` |
| `POST /proxmox/vms/:vmid/reboot` | Reiniciar VM | `curl -X POST .../proxmox/vms/100/reboot` |
| `GET /proxmox/containers` | Listar CTs | `curl .../proxmox/containers` |
| `POST /proxmox/containers/:vmid/start` | Iniciar CT | `curl -X POST .../proxmox/containers/200/start` |
| `GET /proxmox/nodes` | Info del nodo | `curl .../proxmox/nodes` |
| `GET /proxmox/storage` | Almacenamiento | `curl .../proxmox/storage` |
| `GET /proxmox/cluster` | Estado cluster | `curl .../proxmox/cluster` |
| `GET /proxmox/tasks` | Tareas recientes | `curl .../proxmox/tasks?limit=10` |
| `GET /proxmox/version` | Versión PVE | `curl .../proxmox/version` |
| `GET /proxmox/resources` | CPU/Mem/Disk | `curl .../proxmox/resources` |

### WebSocket (shell streaming en tiempo real)

```bash
# Con wscat
wscat -c "wss://proxmox-mcp.xtremediagnostics.com/ws/exec?api_key=xtreme-god-proxmox-v1-x9k2m7p4q1"

# Enviar comandos:
{"type":"exec","command":"qm list && pct list"}
```

## 🔑 Autenticación

| Rol | API Key (default) | Permisos |
|-----|------------------|----------|
| `admin` | `xtreme-god-proxmox-v1-x9k2m7p4q1` | Shell, Proxmox, WebSocket |
| `readonly` | Define la tuya en `.env` | Solo `/health` y `/metrics` |

### Agregar más API Keys

Edita `/opt/super-modo-dios-proxmox/.env`:
```bash
API_KEYS=xtreme-god-proxmox-v1-x9k2m7p4q1:admin,tu-key-readonly:readonly
```

Luego reinicia:
```bash
systemctl restart super-modo-dios-proxmox
```

## ⚙️ Gestión del Servicio

```bash
# Estado
systemctl status super-modo-dios-proxmox

# Reiniciar
systemctl restart super-modo-dios-proxmox

# Logs
journalctl -u super-modo-dios-proxmox -f

# Logs del túnel
journalctl -u cloudflared -f
```

## 🔒 Seguridad

El bridge escucha **solo en 127.0.0.1** (localhost). No es accesible desde fuera del servidor.
El acceso externo es únicamente a través del túnel Cloudflare, que provee:

1. **Cifrado TLS** de extremo a extremo
2. **Zero Trust Access** (opcional) con autenticación previa
3. **WAF** de Cloudflare contra ataques comunes
4. **DDoS protection** automática de Cloudflare

### Recomendaciones adicionales

- Cambia la API Key default después de instalar
- Usa Zero Trust Access para la UI de Proxmox
- Configura alertas en Cloudflare para intentos de acceso fallidos
- Rotar el API Token PVE periódicamente

## 📁 Archivos del Proyecto

| Archivo | Descripción |
|---------|-------------|
| `super-modo-dios-bridge.js` | Bridge Node.js (410 líneas) |
| `package.json` | Dependencias npm |
| `install.sh` | Script de instalación automática |
| `cloudflare-tunnel.sh` | Script de configuración del túnel |
| `README.md` | Esta documentación |

## 🧪 Tests rápidos post-instalación

```bash
# 1. Health check local
curl http://127.0.0.1:8003/health -H "X-API-Key: xtreme-god-proxmox-v1-x9k2m7p4q1"

# 2. Ejecutar comando en el host
curl -X POST http://127.0.0.1:8003/shell/exec \
  -H "X-API-Key: xtreme-god-proxmox-v1-x9k2m7p4q1" \
  -H "Content-Type: application/json" \
  -d '{"command":"pveversion"}'

# 3. Listar VMs
curl http://127.0.0.1:8003/proxmox/vms -H "X-API-Key: xtreme-god-proxmox-v1-x9k2m7p4q1"

# 4. Recursos del sistema
curl http://127.0.0.1:8003/proxmox/resources -H "X-API-Key: xtreme-god-proxmox-v1-x9k2m7p4q1"

# 5. Remoto (después del túnel)
curl https://proxmox-mcp.xtremediagnostics.com/health \
  -H "X-API-Key: xtreme-god-proxmox-v1-x9k2m7p4q1"
```

---

*Super Modo Dios Proxmox v4.0 — Junio 2026*
*Parte del ecosistema Xtreme Diagnostics ERP*
