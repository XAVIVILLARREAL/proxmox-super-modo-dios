// ============================================================
// 🔱 SUPER MODO DIOS PROXMOX — Bridge v4
// Hypervisor shell access + Proxmox-specific endpoints
// Corre DIRECTO en el host Proxmox (Debian), NO en Docker
// ============================================================

const express = require('express');
const http = require('http');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Optional modules — bridge works without them
let compression, morgan;
try { compression = require('compression'); } catch(e) { compression = null; }
try { morgan = require('morgan'); } catch(e) { morgan = null; }

const app = express();
const PORT = parseInt(process.env.PORT || '8003', 10);
const CMD_TIMEOUT = parseInt(process.env.CMD_TIMEOUT || '60000', 10); // 60s default — Proxmox commands can be slower
const RATE_LIMIT = parseInt(process.env.RATE_LIMIT || '30', 10);
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT || '10', 10);

// ── Multi-key auth ─────────────────────────────────────────
const DEFAULT_KEYS = 'xtreme-god-proxmox-v1-x9k2m7p4q1:admin';
const API_KEYS_CONFIG = (process.env.API_KEYS || DEFAULT_KEYS).split(',').map(kv => {
  const [key, role = 'admin'] = kv.trim().split(':');
  return { key, role: role.trim() };
});

function getKeyRole(key) {
  const entry = API_KEYS_CONFIG.find(k => k.key === key);
  return entry ? entry.role : null;
}

const roleLevel = { admin: 3, readonly: 1 };

// ── Rate limiter ───────────────────────────────────────────
const rateLimitBuckets = new Map();

function checkRateLimit(key, role) {
  const limit = role === 'admin' ? RATE_LIMIT * 2 : RATE_LIMIT;
  const now = Date.now();
  const window = 60_000;
  if (!rateLimitBuckets.has(key)) rateLimitBuckets.set(key, []);
  const bucket = rateLimitBuckets.get(key);
  while (bucket.length > 0 && now - bucket[0] > window) bucket.shift();
  if (bucket.length >= limit) return false;
  bucket.push(now);
  return true;
}

// ── Command queue ──────────────────────────────────────────
let activeCommands = 0;
const commandQueue = [];

function enqueueCommand(execFn) {
  return new Promise((resolve, reject) => {
    commandQueue.push({ execFn, resolve, reject });
    processQueue();
  });
}

function processQueue() {
  while (activeCommands < MAX_CONCURRENT && commandQueue.length > 0) {
    const { execFn, resolve, reject } = commandQueue.shift();
    activeCommands++;
    execFn().then(resolve).catch(reject).finally(() => {
      activeCommands--;
      processQueue();
    });
  }
}

// ── Metrics ────────────────────────────────────────────────
const metrics = {
  commands_total: 0,
  commands_success: 0,
  commands_failed: 0,
  commands_timedout: 0,
  started_at: new Date().toISOString(),
  hostname: require('os').hostname(),
};

function trackMetrics(role, success, timedout) {
  metrics.commands_total++;
  if (success) metrics.commands_success++;
  else metrics.commands_failed++;
  if (timedout) metrics.commands_timedout++;
}

// ── Auth middleware ────────────────────────────────────────
function auth(requiredRole = 'admin') {
  return (req, res, next) => {
    const key = req.headers['x-api-key'];
    const role = getKeyRole(key);
    if (!role) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if ((roleLevel[role] || 0) < (roleLevel[requiredRole] || 3)) {
      return res.status(403).json({ error: 'Forbidden', message: `Requires "${requiredRole}" role` });
    }
    if (!checkRateLimit(key, role)) {
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }
    req.authRole = role;
    next();
  };
}

// ── Gzip + Request Logging ────────────────────────────────
app.use(compression());
app.use(morgan(':date[iso] :remote-addr :method :url :status :response-time[0]ms'));

// ── CORS ───────────────────────────────────────────────────
app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-API-Key, Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

app.use(express.json({ limit: '10mb' }));

// ── Helper: Run shell command ──────────────────────────────
function runCommand(command, options = {}) {
  const timeout = options.timeout || CMD_TIMEOUT;
  return new Promise((resolve) => {
    exec(command, { timeout, maxBuffer: 10 * 1024 * 1024, shell: '/bin/bash' }, (error, stdout, stderr) => {
      const exitCode = error ? (typeof error.code === 'number' ? error.code : error.status || 1) : 0;
      const result = {
        command,
        exit_code: exitCode,
        stdout: stdout || '',
        stderr: stderr || '',
        timestamp: new Date().toISOString()
      };
      const timedOut = error && error.signal === 'SIGTERM';
      if (timedOut) {
        result.error = 'Timed out';
        result.exit_code = 124;
      }
      if (error && !timedOut && exitCode !== 0) {
        result.error = error.message;
      }
      trackMetrics(options.role || 'admin', exitCode === 0, !!timedOut);
      // Truncate outputs
      const MAX_OUTPUT = 500 * 1024;
      if (result.stdout.length > MAX_OUTPUT) result.stdout = result.stdout.substring(0, MAX_OUTPUT) + '\n...[TRUNCATED]';
      if (result.stderr.length > MAX_OUTPUT) result.stderr = result.stderr.substring(0, MAX_OUTPUT) + '\n...[TRUNCATED]';
      resolve(result);
    });
  });
}

// ── Health ─────────────────────────────────────────────────
app.get('/health', auth('readonly'), (req, res) => {
  res.json({
    status: 'ok',
    version: '4.0.0-proxmox',
    bridge: 'Super Modo Dios Proxmox',
    uptime: process.uptime(),
    hostname: require('os').hostname(),
    active_commands: activeCommands,
    queue_length: commandQueue.length,
    max_concurrent: MAX_CONCURRENT,
    auth_role: req.authRole,
    api_keys_count: API_KEYS_CONFIG.length,
    timestamp: new Date().toISOString()
  });
});

// ── Metrics ────────────────────────────────────────────────
app.get('/metrics', auth('readonly'), (req, res) => {
  res.json({
    ...metrics,
    active_commands: activeCommands,
    queued_commands: commandQueue.length,
    uptime_seconds: process.uptime()
  });
});

// ── Shell exec (acceso TOTAL al host Proxmox) ──────────────
app.post('/shell/exec', auth('admin'), (req, res) => {
  const { command } = req.body;
  if (!command || typeof command !== 'string') {
    return res.status(400).json({ error: 'Missing command' });
  }
  const trimmed = command.trim();
  if (!trimmed) return res.status(400).json({ error: 'Empty command' });

  console.log(`[EXEC:${req.authRole}] ${req.ip}: ${trimmed.substring(0, 200)}`);

  enqueueCommand(() => runCommand(trimmed, { role: req.authRole }))
    .then(result => res.json(result));
});

// ── PROXMOX: List VMs ──────────────────────────────────────
app.get('/proxmox/vms', auth('admin'), (req, res) => {
  console.log(`[PROXMOX:VMS] ${req.ip}`);
  enqueueCommand(() => runCommand('qm list', { role: req.authRole }))
    .then(result => {
      // Parse qm list output
      const lines = (result.stdout || '').trim().split('\n');
      const vms = [];
      for (let i = 1; i < lines.length; i++) { // skip header
        const parts = lines[i].trim().split(/\s+/);
        if (parts.length >= 6) {
          vms.push({
            vmid: parts[0],
            name: parts[1],
            status: parts[2],
            mem_mb: parts[3],
            bootdisk: parts[4],
            pid: parts[5]
          });
        }
      }
      res.json({ vms, count: vms.length, raw: result.stdout });
    });
});

// ── PROXMOX: VM detail ─────────────────────────────────────
app.get('/proxmox/vms/:vmid', auth('admin'), (req, res) => {
  const vmid = parseInt(req.params.vmid, 10);
  if (isNaN(vmid)) return res.status(400).json({ error: 'Invalid VMID' });
  console.log(`[PROXMOX:VM:${vmid}] ${req.ip}`);
  enqueueCommand(() => runCommand(`qm config ${vmid} && echo "---STATUS---" && qm status ${vmid}`, { role: req.authRole }))
    .then(result => res.json(result));
});

// ── PROXMOX: List Containers ───────────────────────────────
app.get('/proxmox/containers', auth('admin'), (req, res) => {
  console.log(`[PROXMOX:CTS] ${req.ip}`);
  enqueueCommand(() => runCommand('pct list', { role: req.authRole }))
    .then(result => {
      const lines = (result.stdout || '').trim().split('\n');
      const containers = [];
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].trim().split(/\s+/);
        if (parts.length >= 4) {
          containers.push({
            vmid: parts[0],
            status: parts[1],
            lock: parts[2],
            name: parts[3]
          });
        }
      }
      res.json({ containers, count: containers.length, raw: result.stdout });
    });
});

// ── PROXMOX: Node info ─────────────────────────────────────
app.get('/proxmox/nodes', auth('admin'), (req, res) => {
  console.log(`[PROXMOX:NODES] ${req.ip}`);
  enqueueCommand(() => runCommand('pvesh get /nodes --output-format json 2>/dev/null || pvesh get /nodes', { role: req.authRole }))
    .then(result => {
      try {
        const nodes = JSON.parse(result.stdout);
        res.json({ nodes, count: Array.isArray(nodes) ? nodes.length : 0 });
      } catch {
        res.json({ nodes_raw: result.stdout, error: 'Could not parse JSON, using raw output' });
      }
    });
});

// ── PROXMOX: Storage ───────────────────────────────────────
app.get('/proxmox/storage', auth('admin'), (req, res) => {
  console.log(`[PROXMOX:STORAGE] ${req.ip}`);
  enqueueCommand(() => runCommand('pvesh get /storage --output-format json 2>/dev/null || pvesh get /storage', { role: req.authRole }))
    .then(result => {
      try {
        const storage = JSON.parse(result.stdout);
        res.json({ storage, count: Array.isArray(storage) ? storage.length : 0 });
      } catch {
        res.json({ storage_raw: result.stdout, error: 'Could not parse JSON' });
      }
    });
});

// ── PROXMOX: Cluster status ────────────────────────────────
app.get('/proxmox/cluster', auth('admin'), (req, res) => {
  console.log(`[PROXMOX:CLUSTER] ${req.ip}`);
  enqueueCommand(() => runCommand('pvecm status', { role: req.authRole }))
    .then(result => res.json(result));
});

// ── PROXMOX: Recent tasks ──────────────────────────────────
app.get('/proxmox/tasks', auth('admin'), (req, res) => {
  console.log(`[PROXMOX:TASKS] ${req.ip}`);
  const limit = parseInt(req.query.limit, 10) || 20;
  enqueueCommand(() => runCommand(`pvesh get /cluster/tasks --output-format json 2>/dev/null | head -${Math.min(limit * 10, 500)}`, { role: req.authRole }))
    .then(result => {
      try {
        const tasks = JSON.parse(result.stdout);
        const sliced = Array.isArray(tasks) ? tasks.slice(0, limit) : [];
        res.json({ tasks: sliced, count: sliced.length });
      } catch {
        res.json({ tasks_raw: result.stdout });
      }
    });
});

// ── PROXMOX: Version ───────────────────────────────────────
app.get('/proxmox/version', auth('readonly'), (req, res) => {
  console.log(`[PROXMOX:VERSION] ${req.ip}`);
  enqueueCommand(() => runCommand('pveversion --verbose 2>/dev/null | head -5', { role: req.authRole }))
    .then(result => res.json(result));
});

// ── PROXMOX: System resources (memory, CPU, disk) ──────────
app.get('/proxmox/resources', auth('admin'), (req, res) => {
  console.log(`[PROXMOX:RESOURCES] ${req.ip}`);
  const commands = [
    'echo "=== CPU ===" && nproc && cat /proc/cpuinfo | grep "model name" | head -1',
    'echo "=== MEMORY ===" && free -h',
    'echo "=== DISK ===" && df -h /',
    'echo "=== LOAD ===" && uptime',
    'echo "=== ZFS (si aplica) ===" && zpool list 2>/dev/null || echo "No ZFS pools"'
  ].join(' && ');
  enqueueCommand(() => runCommand(commands, { role: req.authRole }))
    .then(result => res.json(result));
});

// ── Audit log ──────────────────────────────────────────────
function auditLog(type, vmid, action, ip, role) {
  const entry = {
    timestamp: new Date().toISOString(),
    type, vmid, action, ip, role
  };
  console.log(`[AUDIT] ${JSON.stringify(entry)}`);
  fs.appendFile('/var/log/super-modo-dios-audit.log', 
    JSON.stringify(entry) + '\n', 
    () => {});
}

// ── PROXMOX: Start/Stop/Reboot VM ──────────────────────────
app.post('/proxmox/vms/:vmid/:action', auth('admin'), (req, res) => {
  const vmid = parseInt(req.params.vmid, 10);
  const action = req.params.action;
  if (isNaN(vmid)) return res.status(400).json({ error: 'Invalid VMID' });
  if (vmid < 100 || vmid > 999999) return res.status(400).json({ error: 'VMID out of range' });
  const allowedActions = ['start', 'stop', 'reboot', 'reset', 'shutdown', 'suspend', 'resume'];
  if (!allowedActions.includes(action)) {
    return res.status(400).json({ error: `Invalid action. Allowed: ${allowedActions.join(', ')}` });
  }
  auditLog('vm', vmid, action, req.ip, req.authRole);
  console.log(`[PROXMOX:VM:${vmid}:${action.toUpperCase()}] ${req.ip}`);
  const cmd = action === 'stop' ? `qm shutdown ${vmid} 2>/dev/null || qm stop ${vmid}` : `qm ${action} ${vmid}`;
  enqueueCommand(() => runCommand(cmd, { role: req.authRole, timeout: 120000 }))
    .then(result => res.json(result));
});

// ── PROXMOX: Start/Stop Container ──────────────────────────
app.post('/proxmox/containers/:vmid/:action', auth('admin'), (req, res) => {
  const vmid = parseInt(req.params.vmid, 10);
  const action = req.params.action;
  if (isNaN(vmid)) return res.status(400).json({ error: 'Invalid VMID' });
  if (vmid < 100 || vmid > 999999) return res.status(400).json({ error: 'VMID out of range' });
  const allowedActions = ['start', 'stop', 'restart', 'suspend', 'resume'];
  if (!allowedActions.includes(action)) {
    return res.status(400).json({ error: `Invalid action. Allowed: ${allowedActions.join(', ')}` });
  }
  auditLog('ct', vmid, action, req.ip, req.authRole);
  console.log(`[PROXMOX:CT:${vmid}:${action.toUpperCase()}] ${req.ip}`);
  enqueueCommand(() => runCommand(`pct ${action} ${vmid}`, { role: req.authRole, timeout: 120000 }))
    .then(result => res.json(result));
});

// ── 404 ────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Not found', path: req.path }));

// ── HTTP server + WebSocket ───────────────────────────────
const server = http.createServer(app);
const { WebSocketServer } = require('ws');

const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws, req) => {
  // Auth via query param: ws://host:8003/ws/exec?api_key=KEY
  const url = new URL(req.url, `http://${req.headers.host}`);
  const key = url.searchParams.get('api_key');
  const role = getKeyRole(key);

  if (!role || (roleLevel[role] || 0) < 2) {
    ws.send(JSON.stringify({ error: 'Unauthorized or insufficient role' }));
    ws.close(4001);
    return;
  }

  console.log(`[WS:${role}] connected`);

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { msg = { type: 'exec', command: data.toString() }; }

    if (msg.type === 'exec' && msg.command) {
      console.log(`[WS:EXEC:${role}] ${msg.command.substring(0, 200)}`);
      const proc = spawn('bash', ['-c', msg.command], {
        timeout: CMD_TIMEOUT,
        env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' }
      });
      proc.stdout.on('data', (chunk) => ws.send(JSON.stringify({ type: 'stdout', data: chunk.toString() })));
      proc.stderr.on('data', (chunk) => ws.send(JSON.stringify({ type: 'stderr', data: chunk.toString() })));
      proc.on('close', (code) => ws.send(JSON.stringify({ type: 'exit', code })));
      proc.on('error', (err) => ws.send(JSON.stringify({ type: 'error', message: err.message })));
    } else {
      ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type. Send {"type":"exec","command":"..."}' }));
    }
  });

  ws.on('close', () => console.log(`[WS:${role}] disconnected`));
  ws.send(JSON.stringify({ type: 'connected', role, version: '4.0.0-proxmox', hostname: require('os').hostname() }));
});

server.on('upgrade', (request, socket, head) => {
  if (request.url.startsWith('/ws/exec')) {
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
  } else {
    socket.destroy();
  }
});

// ── Watchdog for systemd ──────────────────────────────────
// Sends heartbeat via sd_notify every 15 seconds
let watchdogInterval;
try {
  const sd_notify = require('sd_notify');
  if (sd_notify && sd_notify.watchdogEnabled()) {
    watchdogInterval = setInterval(() => {
      sd_notify.watchdog();
    }, 15000);
    console.log('[WATCHDOG] systemd watchdog enabled (15s interval)');
  }
} catch(e) {
  // sd_notify not available — watchdog disabled
}

// ── Start ──────────────────────────────────────────────────
server.listen(PORT, '127.0.0.1', () => {
  console.log(`🔱 SUPER MODO DIOS PROXMOX v4.1.0 — listening on http://127.0.0.1:${PORT}`);
  console.log(`   Auth keys: ${API_KEYS_CONFIG.length} configured`);
  console.log(`   Max concurrent: ${MAX_CONCURRENT} | Timeout: ${CMD_TIMEOUT}ms | Rate limit: ${RATE_LIMIT}/min`);
  console.log(`   Endpoints: /health /metrics /shell/exec /proxmox/* /ws/exec`);
  console.log(`   Features: gzip, morgan logging, audit log, watchdog`);
});
