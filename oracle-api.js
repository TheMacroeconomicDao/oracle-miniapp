/**
 * Oracle API Server — Backend for Telegram Mini App
 * Reads live OpenClaw state + vault, exposes REST endpoints
 * Auth: Telegram initData HMAC-SHA256 or Bearer token
 *
 * Endpoints:
 *   GET  /health
 *   GET  /api/status        — system metrics + model info
 *   GET  /api/agents        — agent groups + live subagent status
 *   GET  /api/vault/graph   — knowledge graph from vault .md files
 *   GET  /api/tasks         — task history from subagent registry
 *   POST /api/tasks         — trigger a group task via gateway
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";

// ── Config ────────────────────────────────────────────────────────
const PORT = parseInt(process.env.ORACLE_API_PORT || "3001");
const OPENCLAW_DIR = process.env.OPENCLAW_DIR || "/home/openclaw/.openclaw";
const WORKSPACE = path.join(OPENCLAW_DIR, "workspace");
const VAULT_DIR = path.join(WORKSPACE, "vault");
const SESSIONS_DIR = path.join(OPENCLAW_DIR, "agents/main/sessions");
const SESSIONS_JSON = path.join(SESSIONS_DIR, "sessions.json");
const SUBAGENT_RUNS = path.join(OPENCLAW_DIR, "subagents/runs.json");
const GROUPS_FILE = path.join(WORKSPACE, "agent-groups.json");

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || "";
const GATEWAY_URL = `http://localhost:${process.env.OPENCLAW_GATEWAY_PORT || 18789}`;
const ALLOWED_TELEGRAM_USER_ID = process.env.ORACLE_ALLOWED_USER_ID || "1821708942";

// ── Telegram initData auth ────────────────────────────────────────
function verifyTelegramInitData(initData) {
  if (!TELEGRAM_BOT_TOKEN) return false;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return false;
    params.delete("hash");
    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");
    const secretKey = crypto
      .createHmac("sha256", "WebAppData")
      .update(TELEGRAM_BOT_TOKEN)
      .digest();
    const expectedHash = crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");
    if (hash !== expectedHash) return false;
    // Check user
    const userStr = params.get("user");
    if (userStr) {
      const user = JSON.parse(decodeURIComponent(userStr));
      if (String(user.id) !== ALLOWED_TELEGRAM_USER_ID) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function authenticate(req) {
  const auth = req.headers["authorization"] || "";
  // Bearer token (gateway token)
  if (auth.startsWith("Bearer ") && GATEWAY_TOKEN) {
    return auth.slice(7) === GATEWAY_TOKEN;
  }
  // Telegram initData
  if (auth.startsWith("tma ")) {
    return verifyTelegramInitData(decodeURIComponent(auth.slice(4)));
  }
  return false;
}

// ── File helpers ──────────────────────────────────────────────────
function readJSON(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

// ── /api/status ───────────────────────────────────────────────────
function getStatus() {
  const sessions = readJSON(SESSIONS_JSON, {});
  const runs = readJSON(SUBAGENT_RUNS, { runs: {} });
  const runsMap = runs.runs || {};
  const allRuns = Object.values(runsMap);
  const activeRuns = allRuns.filter((r) => r.status === "running" || !r.endedAt);
  const memUsage = process.memoryUsage();
  const uptime = process.uptime();

  return {
    ok: true,
    timestamp: Date.now(),
    system: {
      uptime: Math.round(uptime),
      uptimeHuman: formatDuration(uptime),
      memoryMb: Math.round(memUsage.rss / 1024 / 1024),
      platform: os.platform(),
      hostname: os.hostname(),
    },
    agents: {
      totalSessions: Object.keys(sessions).length,
      activeSubagents: activeRuns.length,
      totalRuns: allRuns.length,
    },
    vault: {
      totalNotes: countVaultNotes(),
    },
    model: "anthropic/claude-sonnet-4-6",
  };
}

function countVaultNotes() {
  try {
    let count = 0;
    function walk(dir) {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        if (f.isDirectory() && !f.name.startsWith(".")) walk(path.join(dir, f.name));
        else if (f.name.endsWith(".md")) count++;
      }
    }
    walk(VAULT_DIR);
    return count;
  } catch {
    return 0;
  }
}

function formatDuration(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}д ${h}ч`;
  if (h > 0) return `${h}ч ${m}м`;
  return `${m}м`;
}

// ── /api/agents ───────────────────────────────────────────────────
function getAgents() {
  const groupsConfig = readJSON(GROUPS_FILE, { agents: {}, groups: [], combinations: [] });
  const runs = readJSON(SUBAGENT_RUNS, { runs: {} });
  const runsMap = runs.runs || {};

  // Build live status map from subagent runs
  const liveStatus = {};
  for (const run of Object.values(runsMap)) {
    const task = (run.task || "").toLowerCase();
    // Try to detect agent by task content
    for (const agentId of Object.keys(groupsConfig.agents || {})) {
      if (task.includes(agentId.toLowerCase()) || task.includes((groupsConfig.agents[agentId].name || "").toLowerCase())) {
        const isActive = !run.endedAt;
        if (isActive) {
          liveStatus[agentId] = { status: "running", runId: run.runId, startedAt: run.startedAt };
        }
      }
    }
  }

  // Build agents with live status
  const agents = Object.entries(groupsConfig.agents || {}).map(([id, agent]) => ({
    ...agent,
    status: liveStatus[id]?.status || "idle",
    runId: liveStatus[id]?.runId || null,
    startedAt: liveStatus[id]?.startedAt || null,
  }));

  // Build recent runs for timeline
  const recentRuns = Object.values(runsMap)
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
    .slice(0, 20)
    .map((r) => ({
      runId: r.runId,
      task: (r.task || "").slice(0, 120),
      status: r.endedAt ? "done" : "running",
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      childSessionKey: r.childSessionKey,
    }));

  return {
    agents,
    groups: groupsConfig.groups || [],
    combinations: groupsConfig.combinations || [],
    recentRuns,
  };
}

// ── /api/vault/graph ──────────────────────────────────────────────
function getVaultGraph() {
  const nodes = [];
  const links = [];
  const nodeIds = new Set();
  const linkSet = new Set();

  const CAT_MAP = {
    "000": "overview",
    "100": "theory",
    "200": "project",
    "300": "research",
    "400": "daily",
    "500": "archive",
  };

  function extractFrontmatter(content) {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};
    const fm = {};
    for (const line of match[1].split("\n")) {
      const m = line.match(/^(\w+):\s*(.+)/);
      if (m) {
        const val = m[2].trim();
        if (val.startsWith("[")) {
          try {
            fm[m[1]] = JSON.parse(val.replace(/'/g, '"'));
          } catch {
            fm[m[1]] = val.replace(/[\[\]]/g, "").split(",").map((s) => s.trim());
          }
        } else {
          fm[m[1]] = val;
        }
      }
    }
    return fm;
  }

  function extractTitle(content, filename) {
    const match = content.match(/^#+\s+(.+)$/m);
    return match ? match[1].trim() : filename.replace(".md", "");
  }

  function extractLinks(content) {
    const wikilinks = [];
    const re = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;
    let m;
    while ((m = re.exec(content)) !== null) {
      const target = m[1].trim().replace(/\.md$/, "");
      if (target) wikilinks.push(target);
    }
    return wikilinks;
  }

  function nodeId(filePath) {
    return path.basename(filePath, ".md").toLowerCase().replace(/\s+/g, "-");
  }

  function walkVault(dir, prefix = "") {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const folderPrefix = entry.name.slice(0, 3);
        walkVault(fullPath, CAT_MAP[folderPrefix] || prefix);
      } else if (entry.name.endsWith(".md")) {
        try {
          const content = fs.readFileSync(fullPath, "utf-8");
          const fm = extractFrontmatter(content);
          const title = extractTitle(content, entry.name);
          const id = nodeId(entry.name);
          const category = prefix || "other";

          if (!nodeIds.has(id)) {
            nodes.push({
              id,
              label: title,
              category,
              file: path.relative(VAULT_DIR, fullPath),
              tags: fm.tags || [],
              created: fm.created || null,
            });
            nodeIds.add(id);
          }

          // Extract wikilinks
          const wikiLinks = extractLinks(content);
          for (const target of wikiLinks) {
            const targetId = target.toLowerCase().replace(/\s+/g, "-");
            // Add phantom node if not exists
            if (!nodeIds.has(targetId)) {
              nodes.push({
                id: targetId,
                label: target,
                category: "phantom",
                file: null,
                tags: [],
                phantom: true,
              });
              nodeIds.add(targetId);
            }
            const linkKey = `${id}→${targetId}`;
            if (!linkSet.has(linkKey)) {
              links.push({ source: id, target: targetId });
              linkSet.add(linkKey);
            }
          }
        } catch {
          // skip unreadable files
        }
      }
    }
  }

  walkVault(VAULT_DIR);

  // Compute degree (for node sizing)
  const inDegree = {};
  for (const link of links) {
    inDegree[link.target] = (inDegree[link.target] || 0) + 1;
    inDegree[link.source] = (inDegree[link.source] || 0) + 0.2;
  }
  for (const node of nodes) {
    node.degree = Math.round((inDegree[node.id] || 0.2) * 10) / 10;
  }

  return {
    nodes,
    links,
    stats: {
      total: nodes.length,
      real: nodes.filter((n) => !n.phantom).length,
      phantom: nodes.filter((n) => n.phantom).length,
      links: links.length,
    },
  };
}

// ── /api/tasks ────────────────────────────────────────────────────
function getTasks() {
  const runs = readJSON(SUBAGENT_RUNS, { runs: {} });
  const runsMap = runs.runs || {};

  const tasks = Object.values(runsMap)
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
    .slice(0, 50)
    .map((r) => ({
      id: r.runId,
      task: (r.task || "").slice(0, 200),
      status: r.endedAt ? (r.outcome === "error" ? "error" : "done") : "running",
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      durationMs: r.endedAt && r.startedAt ? r.endedAt - r.startedAt : null,
      requester: r.requesterSessionKey,
      child: r.childSessionKey,
    }));

  return { tasks };
}

// ── POST /api/tasks — trigger a group task ────────────────────────
async function triggerTask(body) {
  const { groupId, combinationId, task } = body;
  if (!task) return { ok: false, error: "task is required" };

  const groupsConfig = readJSON(GROUPS_FILE, { groups: [], combinations: [] });

  let targetLabel = "";
  if (groupId) {
    const group = (groupsConfig.groups || []).find((g) => g.id === groupId);
    targetLabel = group ? group.name : groupId;
  } else if (combinationId) {
    const combo = (groupsConfig.combinations || []).find((c) => c.id === combinationId);
    targetLabel = combo ? combo.name : combinationId;
  }

  // Send message to Oracle via Telegram Bot API
  const message = targetLabel
    ? `[Mini App Task] Группа: ${targetLabel}\n\n${task}`
    : `[Mini App Task] ${task}`;

  const tgRes = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: ALLOWED_TELEGRAM_USER_ID,
        text: message,
      }),
    }
  );

  const tgData = await tgRes.json();
  if (!tgData.ok) {
    return { ok: false, error: tgData.description || "Telegram API error" };
  }

  return { ok: true, messageId: tgData.result?.message_id };
}

// ── HTTP Server ───────────────────────────────────────────────────
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json; charset=utf-8",
};

function send(res, status, data) {
  res.writeHead(status, CORS_HEADERS);
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  // Health — no auth
  if (pathname === "/health" || pathname === "/healthz") {
    send(res, 200, { ok: true, ts: Date.now() });
    return;
  }

  // Auth all other routes
  if (!authenticate(req)) {
    send(res, 401, { ok: false, error: "Unauthorized" });
    return;
  }

  try {
    if (pathname === "/api/status" && req.method === "GET") {
      send(res, 200, getStatus());
    } else if (pathname === "/api/agents" && req.method === "GET") {
      send(res, 200, getAgents());
    } else if (pathname === "/api/vault/graph" && req.method === "GET") {
      send(res, 200, getVaultGraph());
    } else if (pathname === "/api/tasks" && req.method === "GET") {
      send(res, 200, getTasks());
    } else if (pathname === "/api/tasks" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        try {
          const parsed = JSON.parse(body || "{}");
          const result = await triggerTask(parsed);
          send(res, result.ok ? 200 : 400, result);
        } catch (e) {
          send(res, 400, { ok: false, error: String(e) });
        }
      });
    } else {
      send(res, 404, { ok: false, error: "Not found" });
    }
  } catch (e) {
    console.error("API error:", e);
    send(res, 500, { ok: false, error: "Internal server error" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[oracle-api] Listening on :${PORT}`);
  console.log(`[oracle-api] OPENCLAW_DIR: ${OPENCLAW_DIR}`);
  console.log(`[oracle-api] VAULT: ${VAULT_DIR}`);
  console.log(`[oracle-api] Auth: ${TELEGRAM_BOT_TOKEN ? "Telegram HMAC ✓" : "NO BOT TOKEN"} | ${GATEWAY_TOKEN ? "Bearer ✓" : "NO GATEWAY TOKEN"}`);
});
