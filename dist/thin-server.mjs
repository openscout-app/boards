import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
const require$1 = createRequire(import.meta.url);
const DEFAULT_WINDOW_MS = 14 * 24 * 36e5;
const PR_URL_RE = /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/g;
function homeDir() {
  return process.env.SCOUT_SESSIONS_HOME || process.env.HOME || os.homedir();
}
function runtimeUrl$1() {
  const explicit = process.env.SCOUT_RUNTIME_URL || process.env.OPENSCOUT_BROKER_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(homeDir(), ".openscout", "config.json"), "utf8"));
    if (cfg?.port) return `http://127.0.0.1:${cfg.port}`;
  } catch {
  }
  return "http://127.0.0.1:43110";
}
function scoutBin() {
  if (process.env.SCOUT_BIN) return process.env.SCOUT_BIN;
  try {
    const pkg = require$1.resolve("@openscout/scout/package.json");
    const candidate = path.join(path.dirname(pkg), "bin", "scout");
    if (fs.existsSync(candidate)) return candidate;
  } catch {
  }
  const which = spawnSync("which", ["scout"], { encoding: "utf8" });
  return which.status === 0 ? which.stdout.trim() : null;
}
function findBun() {
  const which = spawnSync("which", ["bun"], { encoding: "utf8" });
  return which.status === 0 ? which.stdout.trim() : null;
}
async function checkRuntime(base = runtimeUrl$1()) {
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1500), redirect: "error" });
    return res.ok;
  } catch {
    return false;
  }
}
function runScoutSetup(packageName = "@openscout/scout") {
  const bin = scoutBin();
  const bun = findBun();
  if (!bin) throw new Error(`Scout CLI not found. Reinstall ${packageName}.`);
  if (!bun) throw new Error("Bun 1.4.4+ is required to run Scout's background runtime (https://bun.sh).");
  const env = { ...process.env, PATH: `${path.dirname(bun)}:${process.env.PATH || ""}` };
  execFileSync(bin, ["setup"], { stdio: "pipe", env, timeout: 3e4 });
}
function isSyntheticPromptRecord(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return true;
  if (/^# AGENTS\.md instructions\b/i.test(trimmed)) return true;
  if (/^<environment_context>/i.test(trimmed) && !trimmed.includes("</environment_context>\n")) return true;
  if (/^The following is a <SYSTEM_MESSAGE>/i.test(trimmed)) return true;
  if (/<command-name>\s*\/(?:clear|compact|login|logout|status|help)\s*<\/command-name>/i.test(trimmed)) return true;
  return false;
}
function stripPromptEnvelope(raw) {
  if (!raw) return "";
  if (isSyntheticPromptRecord(raw)) return "";
  const userReq = /<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/i.exec(raw);
  const picked = userReq ? userReq[1] : raw;
  return picked.replace(/<(ADDITIONAL_METADATA|CONTEXT_SUMMARY|SYSTEM_MESSAGE|INSTRUCTIONS|environment_context|system-reminder|system_reminder|local-command-caveat|recommended_plugins|command-name|command-message|command-args)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, " ").replace(/<\/?pasted_content\b[^>]*>/gi, " ").replace(/^New (?:broker|runtime) ask from [^\n]+?\.\s*(?:Task:\s*)?/i, "").replace(/<\/?[A-Z_]{4,}>/g, " ").replace(/<truncated \d+ (?:bytes|lines)>/gi, "").replace(/\s+/g, " ").trim();
}
function summarizeHumanTitle(raw, maxLen = 110) {
  if (!raw) return null;
  const cleaned = stripPromptEnvelope(raw).replace(/^#+\s*/, "").replace(/^[>*-\s]+/, "").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").trim();
  if (!cleaned) return null;
  const firstSentence = cleaned.split(/\n/)[0]?.trim() || cleaned;
  return firstSentence.length <= maxLen ? firstSentence : `${firstSentence.slice(0, maxLen - 1).trimEnd()}…`;
}
function sniffWorkspaceFromPathHint(candidatePath) {
  if (typeof candidatePath !== "string" || !candidatePath.startsWith("/")) return null;
  const devMatch = /^(\/(?:Users|home)\/[^/]+\/dev\/[^/]+)/.exec(candidatePath);
  if (devMatch?.[1]) return devMatch[1];
  const parts = candidatePath.split("/").filter(Boolean);
  if (parts.length >= 4 && (parts[0] === "Users" || parts[0] === "home") && !parts[2]?.startsWith(".")) {
    return `/${parts.slice(0, 4).join("/")}`;
  }
  return null;
}
function sniffWorkspaceFromText(text) {
  const activeMatch = /Active Workspaces:\s*\n\s*-\s*([^\r\n<]+)/i.exec(text);
  if (activeMatch?.[1]?.trim()) return activeMatch[1].trim();
  const cwdMatch = /Command Working Directory:\s*([^\r\n<]+)/i.exec(text);
  if (cwdMatch?.[1]?.trim()) return cwdMatch[1].trim();
  return null;
}
function walkJsonl(dir, maxDepth, windowMs, filter, out = [], depth = 0) {
  if (depth > maxDepth || !fs.existsSync(dir)) return out;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  const now = Date.now();
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkJsonl(full, maxDepth, windowMs, filter, out, depth + 1);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      if (filter && !filter(full, entry.name)) continue;
      try {
        const st = fs.statSync(full);
        if (now - st.mtimeMs <= windowMs && st.size > 0) {
          out.push({ path: full, mtimeMs: st.mtimeMs, size: st.size });
        }
      } catch {
      }
    }
  }
  return out;
}
function readSlice(filePath, start2, length) {
  const fd = fs.openSync(filePath, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const clampedStart = Math.max(0, Math.min(start2, size));
    const clampedLen = Math.max(0, Math.min(length, size - clampedStart));
    if (clampedLen === 0) return "";
    const buf = Buffer.alloc(clampedLen);
    fs.readSync(fd, buf, 0, clampedLen, clampedStart);
    return buf.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}
function flattenContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        const rec = item;
        if (typeof rec.text === "string") return rec.text;
        if (typeof rec.input_text === "string") return rec.input_text;
        if (typeof rec.output_text === "string") return rec.output_text;
      }
      return "";
    }).filter(Boolean).join("\n");
  }
  return "";
}
function looksLikeUuid(value) {
  return /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);
}
function sniffTranscriptMeta(filePath, source, size) {
  let sessionId = path.basename(filePath, ".jsonl");
  let cwd = null;
  let branch = null;
  let model = null;
  let firstPrompt = null;
  let latestPrompt = null;
  if (source === "antigravity") {
    const brainMatch = /brain[\\/]([^\\/]+)[\\/]\.system_generated[\\/]logs[\\/]transcript\.jsonl$/i.exec(filePath) || /brain[\\/]([\da-f-]{36})[\\/]/i.exec(filePath);
    if (brainMatch?.[1]) sessionId = brainMatch[1];
  } else if (source === "kimi") {
    const kimiMatch = /sessions[\\/][^\\/]+[\\/]([^\\/]+)[\\/]agents/i.exec(filePath);
    if (kimiMatch?.[1]) sessionId = kimiMatch[1];
  }
  const fileSize = size ?? (fs.existsSync(filePath) ? fs.statSync(filePath).size : 0);
  const head = readSlice(filePath, 0, 48e3);
  const tail = fileSize > 48e3 ? readSlice(filePath, Math.max(0, fileSize - 48e3), 48e3) : "";
  const lines = [...head.split("\n").slice(0, 30), ...tail ? tail.split("\n").slice(1) : []];
  for (const line of lines) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof obj.cwd === "string" && !cwd) cwd = obj.cwd;
    if (typeof obj.gitBranch === "string" && !branch) branch = obj.gitBranch;
    if (source === "claude") {
      if (typeof obj.sessionId === "string") sessionId = obj.sessionId;
      if (typeof obj.message?.model === "string") model = obj.message.model;
      if (obj.type === "user") {
        const txt = stripPromptEnvelope(flattenContent(obj.message?.content ?? obj.content));
        if (txt) {
          firstPrompt ??= txt;
          latestPrompt = txt;
        }
      }
    } else if (source === "codex") {
      if (obj.type === "session_meta" && obj.payload) {
        if (typeof obj.payload.id === "string") sessionId = obj.payload.id;
        if (typeof obj.payload.cwd === "string" && !cwd) cwd = obj.payload.cwd;
        if (typeof obj.payload.git?.branch === "string" && !branch) branch = obj.payload.git.branch;
      }
      if (obj.type === "turn_context" && typeof obj.payload?.model === "string") model = obj.payload.model;
      if (obj.type === "response_item" && obj.payload?.role === "user") {
        const txt = stripPromptEnvelope(flattenContent(obj.payload.content));
        if (txt) {
          firstPrompt ??= txt;
          latestPrompt = txt;
        }
      } else if (obj.type === "event_msg" && obj.payload?.type === "user_message") {
        const txt = stripPromptEnvelope(String(obj.payload.message ?? obj.payload.text ?? ""));
        if (txt) {
          firstPrompt ??= txt;
          latestPrompt = txt;
        }
      }
    } else if (source === "antigravity") {
      const step = obj.step || obj;
      const type = String(step.type || "");
      if (typeof step.metadata?.generatorModel === "string") model = step.metadata.generatorModel;
      if (typeof step.model === "string" && !model) model = step.model;
      const ws = step.userInput?.activeUserState?.activeDocument?.workspaceUri;
      if (typeof ws === "string" && ws.startsWith("file://") && !cwd) {
        cwd = decodeURIComponent(ws.slice("file://".length));
      }
      if (!cwd && typeof step.content === "string") {
        cwd = sniffWorkspaceFromText(step.content);
      }
      const rawCalls = step.plannerResponse?.toolCalls || step.tool_calls || [];
      if (!cwd && Array.isArray(rawCalls)) {
        for (const call of rawCalls) {
          let args = call?.args || call?.arguments || {};
          if (typeof call?.argumentsJson === "string") {
            try {
              args = JSON.parse(call.argumentsJson);
            } catch {
            }
          }
          cwd = sniffWorkspaceFromPathHint(args?.Path || args?.TargetFile);
          if (cwd) break;
        }
      }
      if (type === "USER_INPUT" || type.endsWith("_USER_INPUT")) {
        const rawPrompt = String(step.userInput?.userResponse ?? step.content ?? "");
        if (!cwd) cwd = sniffWorkspaceFromText(rawPrompt);
        const txt = stripPromptEnvelope(rawPrompt);
        if (txt) {
          firstPrompt ??= txt;
          latestPrompt = txt;
        }
      }
    } else if (source === "kimi") {
      if (obj.type === "turn.prompt") {
        const txt = stripPromptEnvelope(flattenContent(obj.input ?? obj.content));
        if (txt) {
          firstPrompt ??= txt;
          latestPrompt = txt;
        }
      }
    }
  }
  let project = "session";
  if (cwd) {
    project = path.basename(cwd);
  } else if (source === "claude") {
    const dirName = path.basename(path.dirname(filePath));
    project = dirName.replace(/^-/, "").split("-").pop() || "claude";
  } else if (source === "kimi") {
    const wdMatch = /sessions[\\/]wd_([^\\/]+)[\\/]/i.exec(filePath);
    project = wdMatch?.[1] || "kimi";
  } else if (!looksLikeUuid(sessionId)) {
    project = sessionId;
  } else {
    project = source === "antigravity" ? "Antigravity" : source;
  }
  const title = summarizeHumanTitle(latestPrompt || firstPrompt);
  return { sessionId, cwd, project, branch, model, title };
}
const transcriptDiscoveryCache = /* @__PURE__ */ new Map();
function discoverLocalTranscripts(options = {}) {
  const home = homeDir();
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const maxPerHarness = options.maxPerHarness ?? 40;
  const filterHarness = options.harness || "";
  const cacheKey = `${home}|${windowMs}|${maxPerHarness}|${filterHarness}|${process.env.OPENSCOUT_TAIL_CODEX_SESSIONS_ROOT || ""}|${process.env.OPENSCOUT_TAIL_CLAUDE_PROJECTS_ROOT || ""}|${process.env.OPENSCOUT_TAIL_ANTIGRAVITY_BRAIN_ROOT || ""}|${process.env.OPENSCOUT_TAIL_KIMI_SESSIONS_ROOT || ""}`;
  const cached = !options.bypassCache ? transcriptDiscoveryCache.get(cacheKey) : void 0;
  if (cached && Date.now() - cached.at < 2500) {
    return cached.items;
  }
  const claudeRoot = process.env.OPENSCOUT_TAIL_CLAUDE_PROJECTS_ROOT || path.join(home, ".claude", "projects");
  const codexRoot = process.env.OPENSCOUT_TAIL_CODEX_SESSIONS_ROOT || path.join(home, ".codex", "sessions");
  const kimiHome = process.env.KIMI_CODE_HOME?.trim() || path.join(home, ".kimi-code");
  const kimiRoot = process.env.OPENSCOUT_TAIL_KIMI_SESSIONS_ROOT || path.join(kimiHome, "sessions");
  const agyBrainOverride = process.env.OPENSCOUT_TAIL_ANTIGRAVITY_BRAIN_ROOT;
  const brainFilter = (full, name) => name === "transcript.jsonl" && full.includes(`${path.sep}.system_generated${path.sep}logs${path.sep}`);
  const sources = [
    { source: "claude", files: walkJsonl(claudeRoot, 3, windowMs) },
    {
      source: "codex",
      files: [
        ...walkJsonl(codexRoot, 4, windowMs),
        ...process.env.OPENSCOUT_TAIL_CODEX_SESSIONS_ROOT ? [] : walkJsonl(path.join(home, ".openai-codex", "sessions"), 4, windowMs)
      ]
    },
    {
      source: "antigravity",
      files: [
        ...agyBrainOverride ? walkJsonl(agyBrainOverride, 4, windowMs, brainFilter) : [
          ...walkJsonl(path.join(home, ".gemini", "antigravity-cli", "brain"), 4, windowMs, brainFilter),
          ...walkJsonl(path.join(home, ".gemini", "antigravity", "brain"), 4, windowMs, brainFilter),
          ...walkJsonl(path.join(home, ".gemini", "antigravity-ide", "brain"), 4, windowMs, brainFilter)
        ],
        ...walkJsonl(path.join(home, ".gemini", "antigravity", "conversations"), 2, windowMs)
      ]
    },
    {
      source: "kimi",
      files: [
        ...walkJsonl(kimiRoot, 5, windowMs, (_full, name) => name === "wire.jsonl"),
        ...process.env.OPENSCOUT_TAIL_KIMI_SESSIONS_ROOT ? [] : walkJsonl(path.join(home, ".kimi", "sessions"), 5, windowMs)
      ]
    }
  ];
  const seenPaths = /* @__PURE__ */ new Set();
  const transcripts = [];
  for (const group of sources) {
    if (filterHarness && group.source !== filterHarness) continue;
    const recent = group.files.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, maxPerHarness);
    for (const item of recent) {
      if (seenPaths.has(item.path)) continue;
      seenPaths.add(item.path);
      try {
        const meta = sniffTranscriptMeta(item.path, group.source, item.size);
        transcripts.push({
          source: group.source,
          sessionId: meta.sessionId,
          project: meta.project,
          cwd: meta.cwd,
          branch: meta.branch,
          model: meta.model,
          title: meta.title,
          transcriptPath: item.path,
          mtimeMs: Math.floor(item.mtimeMs),
          size: item.size
        });
      } catch {
      }
    }
  }
  const sorted = transcripts.sort((a, b) => b.mtimeMs - a.mtimeMs);
  transcriptDiscoveryCache.set(cacheKey, { at: Date.now(), items: sorted });
  return sorted;
}
function collectPrs(text, prsMap, fallbackTitle) {
  if (!text || typeof text !== "string") return;
  const mergedHint = /\bmerged\b/i.test(text);
  for (const match of text.matchAll(PR_URL_RE)) {
    const [, owner, repo, num2] = match;
    const key = `${repo}#${num2}`;
    const prev = prsMap.get(key);
    prsMap.set(key, {
      key,
      label: key,
      number: Number(num2),
      url: `https://github.com/${owner}/${repo}/pull/${num2}`,
      title: prev?.title || fallbackTitle || key,
      state: prev?.state === "merged" || mergedHint ? "merged" : "open"
    });
  }
}
function recordTouchedPath(rawPath, cwd, set) {
  if (!rawPath || typeof rawPath !== "string") return;
  const cleaned = rawPath.trim();
  if (!cleaned) return;
  if (cwd && cleaned.startsWith(cwd)) {
    const rel = cleaned.slice(cwd.length).replace(/^[\\/]+/, "");
    if (rel) {
      set.add(rel);
      return;
    }
  }
  const parts = cleaned.split(/[\\/]/).filter(Boolean);
  set.add(parts.slice(-3).join("/") || cleaned);
}
function scanLocalFeedSessions(options = {}) {
  const discovered = discoverLocalTranscripts({ maxPerHarness: options.maxPerHarness ?? 15 });
  const items = [];
  for (const entry of discovered) {
    try {
      const raw = readSlice(entry.transcriptPath, Math.max(0, entry.size - 65536), 65536);
      const lines = raw.split("\n").filter(Boolean);
      let prompt = entry.title;
      let reply = null;
      let branch = entry.branch;
      const touched = /* @__PURE__ */ new Set();
      const prsMap = /* @__PURE__ */ new Map();
      for (const line of lines) {
        let obj;
        try {
          obj = JSON.parse(line);
        } catch {
          continue;
        }
        if (entry.source === "claude") {
          if (obj.gitBranch && !branch) branch = obj.gitBranch;
          if (obj.type === "user") {
            const txt = stripPromptEnvelope(flattenContent(obj.message?.content ?? obj.content));
            if (txt) prompt = txt;
            if (Array.isArray(obj.message?.content)) {
              for (const b of obj.message.content) {
                if (b?.type === "tool_result" && typeof b.content === "string") collectPrs(b.content, prsMap, null);
              }
            }
          } else if (obj.type === "assistant" && Array.isArray(obj.message?.content)) {
            const text = obj.message.content.filter((b) => b?.type === "text" && b.text).map((b) => b.text).join("\n").trim();
            if (text) {
              reply = text;
              collectPrs(text, prsMap, null);
            }
            for (const b of obj.message.content) {
              if (b?.type === "tool_use" && b.input && (b.name === "Edit" || b.name === "Write" || b.name === "MultiEdit")) {
                recordTouchedPath(b.input.file_path || b.input.path, entry.cwd, touched);
              }
            }
          }
        } else if (entry.source === "codex") {
          if (obj.type === "session_meta" && obj.payload?.git?.branch) branch = obj.payload.git.branch;
          if (obj.type === "response_item" && obj.payload?.role === "user") {
            const txt = stripPromptEnvelope(flattenContent(obj.payload.content));
            if (txt) prompt = txt;
          } else if (obj.type === "response_item" && obj.payload?.role === "assistant") {
            const txt = flattenContent(obj.payload.content).trim();
            if (txt) {
              reply = txt;
              collectPrs(txt, prsMap, null);
            }
          } else if (obj.type === "response_item" && (obj.payload?.type === "custom_tool_call" || obj.payload?.type === "function_call")) {
            const patchText = typeof obj.payload?.input === "string" ? obj.payload.input : obj.payload?.arguments || "";
            for (const pm of String(patchText).matchAll(/\*\*\* (?:Update|Add) File:\s*([^\r\n]+)/g)) {
              recordTouchedPath(pm[1], entry.cwd, touched);
            }
          } else if (obj.type === "response_item" && obj.payload?.type === "function_call_output") {
            collectPrs(obj.payload.output, prsMap, null);
          }
        } else if (entry.source === "antigravity") {
          const step = obj.step || obj;
          const type = String(step.type || "");
          if (type.endsWith("USER_INPUT")) {
            const txt = stripPromptEnvelope(String(step.userInput?.userResponse ?? step.content ?? ""));
            if (txt) prompt = txt;
          } else if (type.endsWith("PLANNER_RESPONSE")) {
            const text = String(step.plannerResponse?.modifiedResponse ?? step.plannerResponse?.response ?? step.content ?? "").trim();
            if (text) {
              reply = text;
              collectPrs(text, prsMap, null);
            }
            for (const tc of step.plannerResponse?.toolCalls || []) {
              if (tc.name === "edit_file" || tc.name === "write_file") {
                let args = tc.argumentsJson;
                if (typeof args === "string") {
                  try {
                    args = JSON.parse(args);
                  } catch {
                    args = null;
                  }
                }
                if (args?.Path) recordTouchedPath(args.Path, entry.cwd, touched);
              }
            }
          }
          if (step.runCommand?.combinedOutput?.full) {
            collectPrs(step.runCommand.combinedOutput.full, prsMap, null);
          }
        } else if (entry.source === "kimi") {
          if (obj.type === "turn.prompt") {
            const txt = stripPromptEnvelope(flattenContent(obj.input ?? obj.content));
            if (txt) prompt = txt;
          } else if (obj.type === "context.append_loop_event" && obj.event?.part?.text) {
            reply = obj.event.part.text;
            collectPrs(reply, prsMap, null);
          }
        }
      }
      if (!reply && !prompt) continue;
      const cleanReply = (reply || prompt || "").trim();
      const firstLine2 = cleanReply.split("\n").find((l) => l.trim().length > 0)?.replace(/^#+\s*/, "").trim() || "Completed session turn";
      const headline = firstLine2.slice(0, 140);
      const prs = [...prsMap.values()].map((pr) => ({
        ...pr,
        title: pr.title === pr.key ? headline : pr.title
      }));
      items.push({
        id: `local:session:${entry.source}:${entry.sessionId}`,
        sessionId: entry.sessionId,
        source: entry.source,
        project: entry.project.startsWith(".") || entry.project === "logs" || entry.project === "main" ? null : entry.project,
        cwd: entry.cwd,
        branch,
        title: headline,
        asked: prompt ? prompt.trim().slice(0, 280) : null,
        body: cleanReply.slice(0, 2400),
        filesTouched: [...touched],
        prs,
        at: entry.mtimeMs,
        transcriptPath: entry.transcriptPath
      });
    } catch {
    }
  }
  return items.sort((a, b) => b.at - a.at).slice(0, options.limit ?? 30);
}
function parseSessionObserve(transcript) {
  const content = fs.readFileSync(transcript.transcriptPath, "utf8");
  const allLines = content.split("\n");
  const startIdx = Math.max(0, allLines.length - 1600);
  const events2 = [];
  let model = transcript.model ?? null;
  let branch = transcript.branch ?? null;
  let cwd = transcript.cwd ?? null;
  let seq = 0;
  for (let i = startIdx; i < allLines.length; i++) {
    const line = allLines[i];
    if (!line?.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = Date.parse(obj.timestamp || obj.created_at || obj.step?.metadata?.createdAt || "") || transcript.mtimeMs;
    if (transcript.source === "claude") {
      if (obj.cwd && !cwd) cwd = obj.cwd;
      if (obj.gitBranch && !branch) branch = obj.gitBranch;
      if (obj.message?.model) model = obj.message.model;
      if (obj.type === "user") {
        const text = stripPromptEnvelope(flattenContent(obj.message?.content ?? obj.content));
        if (text) events2.push({ id: `ev-${++seq}`, kind: "prompt", text, ts, recordIndex: i });
      } else if (obj.type === "assistant" && Array.isArray(obj.message?.content)) {
        for (const block of obj.message.content) {
          if (block?.type === "text" && block.text) {
            events2.push({ id: `ev-${++seq}`, kind: "message", text: block.text, ts, recordIndex: i });
          } else if (block?.type === "tool_use") {
            const pathVal = block.input?.file_path || block.input?.path || void 0;
            const arg = block.input?.command || pathVal || block.input?.pattern || "";
            events2.push({
              id: `ev-${++seq}`,
              kind: "tool",
              tool: block.name || "tool",
              arg: String(arg),
              ...pathVal ? { path: String(pathVal) } : {},
              text: `${block.name || "tool"} ${arg}`.trim(),
              ts,
              recordIndex: i
            });
          }
        }
      }
    } else if (transcript.source === "codex") {
      if (obj.type === "session_meta") {
        if (obj.payload?.cwd && !cwd) cwd = obj.payload.cwd;
        if (obj.payload?.git?.branch && !branch) branch = obj.payload.git.branch;
      }
      if (obj.type === "turn_context" && obj.payload?.model) model = obj.payload.model;
      if (obj.type === "response_item" && obj.payload?.role === "user") {
        const text = stripPromptEnvelope(flattenContent(obj.payload.content));
        if (text) events2.push({ id: `ev-${++seq}`, kind: "prompt", text, ts, recordIndex: i });
      } else if (obj.type === "response_item" && obj.payload?.role === "assistant") {
        const text = flattenContent(obj.payload.content).trim();
        if (text) events2.push({ id: `ev-${++seq}`, kind: "message", text, ts, recordIndex: i });
      } else if (obj.type === "response_item" && (obj.payload?.type === "function_call" || obj.payload?.type === "local_shell_call")) {
        let arg = String(obj.payload.arguments || obj.payload.command || "");
        try {
          const parsed = JSON.parse(arg);
          arg = parsed.cmd || parsed.command || (Array.isArray(parsed.command) ? parsed.command.join(" ") : arg);
        } catch {
        }
        events2.push({
          id: `ev-${++seq}`,
          kind: "tool",
          tool: obj.payload.name || "shell",
          arg: String(arg).slice(0, 220),
          text: `${obj.payload.name || "shell"} ${String(arg).slice(0, 220)}`.trim(),
          ts,
          recordIndex: i
        });
      }
    } else if (transcript.source === "antigravity") {
      const step = obj.step || obj;
      const type = String(step.type || "");
      if (step.metadata?.generatorModel) model = step.metadata.generatorModel;
      if (typeof step.model === "string") model = step.model;
      if (type === "USER_INPUT" || type.endsWith("_USER_INPUT")) {
        const text = stripPromptEnvelope(String(step.userInput?.userResponse ?? step.content ?? ""));
        if (text) events2.push({ id: `ev-${++seq}`, kind: "prompt", text, ts, recordIndex: i });
      } else if (type === "PLANNER_RESPONSE" || type.endsWith("_PLANNER_RESPONSE")) {
        const pr = step.plannerResponse;
        const calls = pr?.toolCalls || step.tool_calls || [];
        for (const call of calls) {
          let args = {};
          try {
            args = typeof call.argumentsJson === "string" ? JSON.parse(call.argumentsJson) : call.arguments || call.args || {};
          } catch {
          }
          const toolName = call.name || call.tool_name || "tool";
          const pathVal = args.Path || args.TargetFile || null;
          if (!cwd && pathVal) cwd = sniffWorkspaceFromPathHint(pathVal);
          const arg = args.CommandLine || pathVal || args.query || args.toolSummary || toolName;
          events2.push({
            id: `ev-${++seq}`,
            kind: "tool",
            tool: toolName,
            arg: String(arg),
            ...pathVal ? { path: String(pathVal) } : {},
            text: `${toolName} ${arg}`.trim(),
            ts,
            recordIndex: i
          });
        }
        const reply = pr?.modifiedResponse || pr?.response || (typeof step.content === "string" ? step.content : "");
        if (reply) events2.push({ id: `ev-${++seq}`, kind: "message", text: reply, ts, recordIndex: i });
      }
    } else if (transcript.source === "kimi") {
      if (obj.type === "turn.prompt") {
        const text = stripPromptEnvelope(flattenContent(obj.input ?? obj.content));
        if (text) events2.push({ id: `ev-${++seq}`, kind: "prompt", text, ts, recordIndex: i });
      } else if (obj.type === "context.append_loop_event") {
        const ev = obj.event;
        if (ev?.type === "tool.call") {
          const arg = typeof ev.args === "string" ? ev.args : JSON.stringify(ev.args ?? ev.input ?? {}).slice(0, 180);
          events2.push({ id: `ev-${++seq}`, kind: "tool", tool: ev.name || "tool", arg, text: `${ev.name || "tool"} ${arg}`.trim(), ts, recordIndex: i });
        } else if (ev?.part?.text) {
          events2.push({ id: `ev-${++seq}`, kind: "message", text: String(ev.part.text), ts, recordIndex: i });
        }
      }
    }
  }
  return {
    live: Date.now() - transcript.mtimeMs < 6e4,
    events: events2,
    files: [],
    metadata: {
      session: {
        adapterType: transcript.source,
        cwd,
        externalSessionId: transcript.sessionId || path.basename(transcript.transcriptPath, ".jsonl"),
        ...model ? { model } : {},
        ...branch ? { branch } : {},
        ...transcript.title ? { title: transcript.title } : {}
      }
    }
  };
}
async function resolveSessionObserve(requestedId) {
  const cleaned = requestedId.replace(/^session:[^:]+:/, "");
  let hit = discoverLocalTranscripts({ maxPerHarness: 80 }).find(
    (t) => t.sessionId === cleaned || t.transcriptPath === cleaned || t.transcriptPath.includes(cleaned)
  ) ?? discoverLocalTranscripts({ maxPerHarness: 80, bypassCache: true }).find(
    (t) => t.sessionId === cleaned || t.transcriptPath === cleaned || t.transcriptPath.includes(cleaned)
  );
  if (!hit) {
    const base = runtimeUrl$1();
    if (await checkRuntime(base)) {
      try {
        const res = await fetch(`${base}/v1/tail/discover`, {
          signal: AbortSignal.timeout(2500),
          redirect: "error"
        });
        if (res.ok) {
          const snap = await res.json();
          const rtHit = (snap?.transcripts || []).find(
            (t) => t.sessionId === cleaned || typeof t.transcriptPath === "string" && t.transcriptPath.includes(cleaned)
          );
          if (rtHit && typeof rtHit.transcriptPath === "string" && fs.existsSync(rtHit.transcriptPath)) {
            const st = fs.statSync(rtHit.transcriptPath);
            const meta = sniffTranscriptMeta(rtHit.transcriptPath, rtHit.source || "claude", st.size);
            hit = {
              source: rtHit.source || "claude",
              sessionId: rtHit.sessionId || meta.sessionId,
              project: rtHit.project || meta.project,
              cwd: rtHit.cwd || meta.cwd,
              branch: meta.branch,
              model: meta.model,
              title: meta.title,
              transcriptPath: rtHit.transcriptPath,
              mtimeMs: Math.floor(st.mtimeMs),
              size: st.size
            };
          }
        }
      } catch {
      }
    }
  }
  if (!hit || !fs.existsSync(hit.transcriptPath)) return null;
  const data = parseSessionObserve(hit);
  return {
    kind: "observe",
    refId: hit.sessionId,
    observe: {
      kind: "history",
      refId: hit.sessionId,
      sessionId: hit.sessionId,
      source: hit.source,
      project: hit.project,
      fidelity: "timestamped",
      updatedAt: hit.mtimeMs,
      data
    }
  };
}
function readTranscriptContextWindow(params) {
  const home = homeDir();
  let filePath = null;
  if (params.source) {
    const candidate = params.source.startsWith("~/") ? path.join(home, params.source.slice(2)) : params.source;
    if (fs.existsSync(candidate) && candidate.endsWith(".jsonl")) filePath = candidate;
  }
  const local2 = discoverLocalTranscripts({ maxPerHarness: 80 });
  const hit = local2.find(
    (t) => filePath && t.transcriptPath === filePath || params.sessionId && (t.sessionId === params.sessionId || t.transcriptPath.includes(params.sessionId))
  );
  if (!hit && !filePath) return null;
  const targetPath = hit?.transcriptPath ?? filePath;
  const harness = hit?.source ?? (targetPath.includes(".claude") ? "claude" : targetPath.includes("antigravity") ? "antigravity" : targetPath.includes("kimi") ? "kimi" : "codex");
  const st = fs.statSync(targetPath);
  const meta = hit ?? { ...sniffTranscriptMeta(targetPath, harness, st.size), source: harness, transcriptPath: targetPath, mtimeMs: st.mtimeMs, size: st.size };
  const parsed = parseSessionObserve(meta);
  const center = params.centerRecord ?? -1;
  const radius = params.radius ?? 3;
  let matchPos = parsed.events.findIndex((e) => e.recordIndex === center);
  if (matchPos < 0 && center >= 0) {
    matchPos = parsed.events.reduce((best, ev, idx) => {
      if (ev.recordIndex == null) return best;
      if (best < 0) return idx;
      const prevDiff = Math.abs((parsed.events[best]?.recordIndex ?? 0) - center);
      return Math.abs(ev.recordIndex - center) < prevDiff ? idx : best;
    }, -1);
  }
  const sliceStart = matchPos >= 0 ? Math.max(0, matchPos - radius) : Math.max(0, parsed.events.length - (radius * 2 + 1));
  const sliceEnd = matchPos >= 0 ? Math.min(parsed.events.length, matchPos + radius + 1) : parsed.events.length;
  const turns = parsed.events.slice(sliceStart, sliceEnd).map((ev, idx) => ({
    index: ev.recordIndex ?? sliceStart + idx,
    role: ev.kind === "prompt" ? "prompt" : ev.kind === "tool" ? "tool" : "reply",
    label: ev.kind === "prompt" ? "You" : ev.kind === "tool" ? ev.tool || "Tool" : "Agent",
    text: ev.kind === "tool" ? ev.arg || ev.text : ev.text,
    matched: matchPos >= 0 ? sliceStart + idx === matchPos : false
  }));
  return {
    sessionId: meta.sessionId,
    project: meta.project,
    harness: meta.source,
    title: meta.title,
    turns
  };
}
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
function isLoopbackHost(req) {
  return LOCAL_HOST.test(req.headers.host || "");
}
function isLocalRequest(req) {
  const host = req.headers.host || "";
  if (!isLoopbackHost(req)) return false;
  if (req.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
function sendJson(res, status, data) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(data));
}
async function readJsonBody(req, maxBytes = 16384) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > maxBytes) throw new Error("Request body is too large.");
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected a JSON object.");
  }
  return parsed;
}
function createScoutThinHttpHandler(options) {
  const title = options.product === "Scout" ? "Scout" : `Scout ${options.product}`;
  return async function handleThinApi(req, res) {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const pathname = url.pathname;
    if (!pathname.startsWith("/api/") && !pathname.startsWith("/v1/")) return false;
    if (!isLocalRequest(req)) {
      sendJson(res, 403, { error: `Open ${title} on this host.` });
      return true;
    }
    const runtimeBase = runtimeUrl$1();
    if (req.method === "GET" && pathname === "/api/identity") {
      sendJson(res, 200, { app: options.packageName, product: options.product });
      return true;
    }
    if (options.apiHandler) {
      const handled = await options.apiHandler(req, res, { url, pathname, runtimeBase });
      if (handled) return true;
    }
    if (req.method === "GET" && pathname === "/api/status") {
      const runtimeUp = await checkRuntime(runtimeBase);
      const extra = options.getStatus ? await options.getStatus({ runtimeUp, runtimeUrl: runtimeBase }) : {};
      sendJson(res, 200, { runtimeUp, runtimeUrl: runtimeBase, ...extra });
      return true;
    }
    if (req.method === "POST" && pathname === "/api/setup") {
      try {
        runScoutSetup(options.packageName);
        sendJson(res, 200, { ok: true, runtimeUp: await checkRuntime(runtimeBase) });
      } catch (err) {
        sendJson(res, 503, { error: err instanceof Error ? err.message : String(err) });
      }
      return true;
    }
    if (req.method === "GET" && (pathname === "/v1/events/stream" || pathname === "/v1/tail/events")) {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "connection": "keep-alive"
      });
      res.write(": connected\n\n");
      const keepAlive = setInterval(() => res.write(": ping\n\n"), 2e4);
      req.on("close", () => clearInterval(keepAlive));
      return true;
    }
    if (req.method === "GET" && pathname === "/api/recent-sessions") {
      const limit = Math.min(24, Math.max(1, Number(url.searchParams.get("limit") ?? 8)));
      const sessions = discoverLocalTranscripts({ maxPerHarness: 15 }).slice(0, limit).map((item) => ({
        sessionId: item.sessionId,
        harness: item.source,
        project: item.project,
        branch: item.branch,
        model: item.model,
        title: item.title,
        updatedAt: item.mtimeMs
      }));
      sendJson(res, 200, { sessions });
      return true;
    }
    if (req.method === "POST" && pathname === "/api/session-context") {
      try {
        const body = await readJsonBody(req);
        const context = readTranscriptContextWindow(body);
        if (!context) {
          sendJson(res, 404, { error: "Session transcript not found." });
          return true;
        }
        sendJson(res, 200, context);
      } catch (err) {
        sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
      }
      return true;
    }
    const refMatch = /^\/api\/session-ref\/(.+)$/.exec(pathname);
    if (req.method === "GET" && refMatch?.[1]) {
      const resolved = await resolveSessionObserve(decodeURIComponent(refMatch[1]));
      if (!resolved) {
        sendJson(res, 404, { error: "Session transcript not found." });
        return true;
      }
      sendJson(res, 200, resolved);
      return true;
    }
    if (req.method === "GET" && pathname === "/api/messages") {
      const conversationId = url.searchParams.get("conversationId") || "";
      if (conversationId && await checkRuntime(runtimeBase)) {
        try {
          const upstream = await fetch(`${runtimeBase}/v1/messages?conversationId=${encodeURIComponent(conversationId)}&limit=50`, {
            signal: AbortSignal.timeout(3e3),
            redirect: "error"
          });
          if (upstream.ok) {
            const data = await upstream.json();
            sendJson(res, 200, Array.isArray(data) ? data : data.messages || []);
            return true;
          }
        } catch {
        }
      }
      sendJson(res, 200, []);
      return true;
    }
    sendJson(res, 404, { error: `Unknown ${title} API route.` });
    return true;
  };
}
function runtimeUrl(env = process.env) {
  const given = env.SCOUT_RUNTIME_URL || env.OPENSCOUT_BROKER_URL;
  if (given) return given.replace(/\/+$/, "");
  try {
    const home = env.OPENSCOUT_HOME || path.join(os.homedir(), ".openscout");
    const c = JSON.parse(fs.readFileSync(path.join(home, "config.json"), "utf8"));
    const port = Number(c?.ports?.broker);
    if (Number.isInteger(port) && port > 0) {
      const host = !c.host || c.host === "0.0.0.0" || c.host === "::" ? "127.0.0.1" : c.host;
      return `http://${host}:${port}`;
    }
  } catch {
  }
  return "http://127.0.0.1:43110";
}
class RuntimeDown extends Error {
  constructor(url) {
    super(`Scout's runtime isn't answering at ${url}.`);
    this.code = "runtime_down";
  }
}
class RuntimeError extends Error {
  constructor(status, body, p) {
    super(body && (body.message || body.error) || `${p} answered ${status}`);
    this.status = status;
    this.body = body;
    this.code = body?.error || `http_${status}`;
  }
}
async function rt(p, { method = "GET", body, ms = 6e3 } = {}) {
  const base = runtimeUrl();
  let res;
  try {
    res = await fetch(base + p, {
      method,
      headers: { accept: "application/json", ...body === void 0 ? {} : { "content-type": "application/json" } },
      body: body === void 0 ? void 0 : JSON.stringify(body),
      signal: AbortSignal.timeout(ms)
    });
  } catch {
    throw new RuntimeDown(base);
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
  }
  if (!res.ok) throw new RuntimeError(res.status, json, p);
  return json;
}
async function health() {
  try {
    const h = await rt("/health", { ms: 2500 });
    return { up: true, url: runtimeUrl(), version: h?.build?.version || null };
  } catch (e) {
    if (e instanceof RuntimeError) return { up: true, url: runtimeUrl(), version: null };
    return { up: false, url: runtimeUrl(), version: null };
  }
}
const listeners = /* @__PURE__ */ new Set();
let streaming = null;
let connected = false;
function onRuntimeEvents(fn) {
  listeners.add(fn);
  if (!streaming) follow(0);
  return () => {
    listeners.delete(fn);
    if (!listeners.size && streaming) {
      streaming.abort();
      streaming = null;
      connected = false;
    }
  };
}
async function follow(failures) {
  const ctl = new AbortController();
  streaming = ctl;
  let opened = false;
  try {
    const res = await fetch(`${runtimeUrl()}/v1/events/stream`, { headers: { accept: "text/event-stream" }, signal: ctl.signal });
    if (!res.ok || !res.body) throw new Error(String(res.status));
    opened = connected = true;
    for (const fn of listeners) fn("stream.open", null);
    const text = new TextDecoder();
    let buf = "";
    for await (const chunk of res.body) {
      buf += text.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const frame = parseFrame(buf.slice(0, i));
        buf = buf.slice(i + 2);
        if (frame) for (const fn of listeners) fn(frame.event, frame.data);
      }
    }
  } catch {
  }
  connected = false;
  if (streaming !== ctl) return;
  for (const fn of listeners) fn("stream.closed", null);
  const n = opened ? 1 : failures + 1;
  setTimeout(() => {
    if (streaming === ctl) follow(n);
  }, Math.min(3e4, 1e3 * 2 ** Math.min(n, 5)));
}
function parseFrame(block) {
  let event = "message";
  const data = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  if (!data.length && event === "message") return null;
  const raw = data.join("\n");
  try {
    return { event, data: raw ? JSON.parse(raw) : null };
  } catch {
    return { event, data: raw };
  }
}
path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "boards.mjs");
const APP = "scout-boards";
function hello() {
  return { app: APP, instance: createHash("sha256").update(runtimeUrl()).digest("hex") };
}
const str = (v) => typeof v === "string" && v ? v : null;
const num = (v) => typeof v === "number" && Number.isFinite(v) ? v : null;
function shapeBoards(raw) {
  const list = Array.isArray(raw?.boards) ? raw.boards : [];
  return list.filter((b) => str(b?.id)).map((b) => ({
    id: b.id,
    name: str(b.name) || b.id,
    version: num(b.version),
    isDefault: b.isDefault === true
  }));
}
function pickBoard(boards, want) {
  return boards.find((b) => b.id === want) || boards.find((b) => b.isDefault) || boards[0] || null;
}
function shapeCard(c, columnIds) {
  const next = Array.isArray(c.next) ? c.next.map((n) => typeof n === "string" ? n : str(n?.id) || str(n?.station) || str(n?.column)).filter(Boolean) : null;
  const src = c.source && typeof c.source === "object" ? c.source : null;
  const flight = c.activeFlight && typeof c.activeFlight === "object" ? c.activeFlight : null;
  return {
    workId: String(c.workId),
    column: columnIds.has(c.column) ? c.column : null,
    revision: num(c.revision) ?? 0,
    reviewPending: c.reviewPending === true,
    next,
    title: str(c.title) || String(c.workId),
    summary: str(c.summary),
    state: str(c.state),
    acceptanceState: str(c.acceptanceState),
    priority: str(c.priority) ?? (num(c.priority) === null ? null : String(c.priority)),
    ownerId: str(c.ownerId),
    ownerName: str(c.ownerName),
    nextMoveOwnerId: str(c.nextMoveOwnerId),
    nextMoveOwnerName: str(c.nextMoveOwnerName),
    conversationId: str(c.conversationId),
    parentId: str(c.parentId),
    parentTitle: str(c.parentTitle),
    createdAt: num(c.createdAt),
    updatedAt: num(c.updatedAt),
    lastMeaningfulAt: num(c.lastMeaningfulAt),
    lastMeaningfulSummary: str(c.lastMeaningfulSummary),
    source: src ? { adapterId: str(src.adapterId), instanceId: str(src.instanceId), workItemId: str(src.workItemId), url: str(src.url) } : null,
    activeFlight: flight && str(flight.id) ? { id: flight.id, state: str(flight.state), harness: str(flight.harness), sessionId: str(flight.sessionId), startedAt: num(flight.startedAt) } : null
  };
}
function shapeBoard(raw) {
  const b = raw?.board || {};
  const columns = (Array.isArray(raw?.columns) ? raw.columns : []).filter((c) => str(c?.id)).map((c) => ({
    id: c.id,
    name: str(c.name) || c.id,
    state: str(c.state),
    purpose: str(c.purpose)
  }));
  const ids = new Set(columns.map((c) => c.id));
  const transitions = (Array.isArray(raw?.transitions) ? raw.transitions : []).filter((t) => (t?.from === "*" || ids.has(t?.from)) && ids.has(t?.to)).map((t) => ({ from: t.from, to: t.to, name: str(t.name) }));
  const cards = (Array.isArray(raw?.cards) ? raw.cards : []).filter((c) => c && c.workId != null).map((c) => shapeCard(c, ids));
  return {
    board: { id: str(b.id) || "", name: str(b.name) || str(b.id) || "Board", version: num(b.version), hash: str(b.hash), description: str(b.description) },
    columns,
    transitions,
    cards,
    ...Number.isSafeInteger(raw?.page?.totalCount) && { page: raw.page }
  };
}
const CARDS_PER_COLUMN = 12;
const PROBE_CHANNEL = "scout/probe";
function boardSource(url) {
  try {
    const u = new URL(url);
    const name = u.pathname.match(/\/boards\/([^/]+)/)?.[1];
    return { name: name ? decodeURIComponent(name) : null, team: u.searchParams.get("teamId") };
  } catch {
    return { name: null, team: null };
  }
}
function roomsFrom(connections2) {
  const out = [];
  for (const c of Array.isArray(connections2) ? connections2 : []) {
    for (const m of Array.isArray(c?.mirror) ? c.mirror : []) {
      if (!m?.conversationId || !m.channel || m.channel === PROBE_CHANNEL) continue;
      out.push({
        conversationId: m.conversationId,
        connectionId: c.id,
        channel: m.channel,
        board: boardSource(c.url).name,
        adapterId: "vercel-board",
        state: m.state || null,
        connectionState: c.state || null,
        posts: typeof m.messages === "number" ? m.messages : null,
        lastAt: typeof m.lastDeltaAt === "number" ? m.lastDeltaAt : null
      });
    }
  }
  return out;
}
const shortAgent = (id) => id.split(".").length > 1 ? id.replace(/\.[a-z0-9-]+$/i, "") : id;
const principalLabel = (p) => String(p || "").replace(/^vercel:user:/, "");
function who(actor, ctx, agentId = null) {
  if (agentId) return { kind: "agent", label: profileLabel(shortAgent(agentId)), detail: agentId, harness: ctx.harnesses?.[agentId] || null };
  if (!actor) return null;
  if (actor.principal === ctx.operatorPrincipal) return { kind: "operator", label: "You", detail: actor.actor || actor.principal, harness: null };
  const label = actor.profile && actor.profile !== "scout" ? `${actor.profile} via ${principalLabel(actor.principal)}` : principalLabel(actor.principal);
  return { kind: "person", label, detail: actor.actor || actor.principal, harness: null };
}
const profileLabel = (p) => p.replace(/^session[:-]([0-9a-z]{8})[0-9a-z-]*$/i, "session $1");
function whoTo(target, ctx, agentId = null) {
  if (agentId) return who(null, ctx, agentId);
  if (!target) return null;
  const principal = target.replace(/\+.*$/, "");
  if (principal === ctx.operatorPrincipal) return { kind: "operator", label: "You", detail: target, harness: null };
  const profile = target !== principal ? target.slice(principal.length + 1) : null;
  return { kind: profile ? "agent" : "person", label: profile ? profileLabel(profile) : principalLabel(principal), detail: target, harness: null };
}
function taskStateNow(task, now) {
  if (task.state !== "claimed" || !task.claim) return task.state;
  const until = Date.parse(task.claim.until);
  return Number.isFinite(until) && until <= now ? "ready" : "claimed";
}
const JOB_STATE = { ready: "ready", waiting: "waiting", claimed: "running", blocked: "blocked", completed: "done", failed: "failed", canceled: "cancelled" };
const FINISHED = /* @__PURE__ */ new Set(["done", "failed", "cancelled"]);
function isProbe(m) {
  return m.channel === PROBE_CHANNEL || m.labels && m.labels["scout.probe"] !== void 0 || String(m.text || "").startsWith("Scout custodian marker.");
}
function firstLine(text, max = 140) {
  if (!text) return null;
  let fenced = false;
  for (const raw of String(text).split("\n")) {
    const t = raw.trim();
    if (t.startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (fenced || !t || t.startsWith("|") || /^(?:[-*_]\s*){3,}$/.test(t)) continue;
    const line = t.replace(/^(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/, "").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/(\*\*|__|`)/g, "").replace(/\s+/g, " ").trim();
    if (!line) continue;
    if (line.length <= max) return line;
    const cut = line.slice(0, max - 1);
    const sp = cut.lastIndexOf(" ");
    return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:-]+$/, "")}…`;
  }
  return null;
}
const DELETED = "Deleted on the board";
function foldRoom({ messages = [], handoffs = [], operatorPrincipal = "", harnesses: harnesses2 = {}, now = Date.now() }) {
  const ctx = { operatorPrincipal, harnesses: harnesses2 };
  const byTask = /* @__PURE__ */ new Map();
  for (const h of handoffs) {
    const list = byTask.get(h.taskId) || [];
    if (!list.some((x) => x.id === h.id)) list.push(h);
    byTask.set(h.taskId, list);
  }
  for (const list of byTask.values()) list.sort((a, b) => a.at - b.at || String(a.cursor).localeCompare(String(b.cursor)));
  const replies = /* @__PURE__ */ new Map();
  for (const m of messages) {
    if (m.re === null || m.re === void 0 || isProbe(m)) continue;
    const agent = m.labels?.["scout.agent"] && m.labels["scout.agent"] !== "operator" ? m.labels["scout.agent"] : null;
    const list = replies.get(m.re) || [];
    list.push({ id: m.id, at: m.createdAt ?? null, by: who(m.by, ctx, agent), text: m.deleted ? DELETED : String(m.text || "") });
    replies.set(m.re, list);
  }
  const posts = [];
  const jobs = [];
  for (const m of messages) {
    if (m.re !== null && m.re !== void 0 || isProbe(m)) continue;
    const events2 = byTask.get(m.id) || [];
    const text = m.deleted ? DELETED : String(m.text || "");
    let job = null;
    if (m.task) {
      const boardState = taskStateNow(m.task, now);
      const state = JOB_STATE[boardState] || "waiting";
      const dispatch = [...events2].reverse().find((e) => e.kind === "claimed" || e.kind === "assigned");
      const finish = [...events2].reverse().find((e) => e.kind === "completed" || e.kind === "failed" || e.kind === "canceled");
      const scout = [...events2].reverse().find((e) => e.scout);
      const said = m.task.result ?? m.task.reason ?? finish?.result ?? finish?.reason ?? null;
      const title = firstLine(text, 160) || m.id;
      job = {
        taskId: m.id,
        title,
        step: m.labels?.step?.trim() || title,
        plan: m.labels?.["scout.plan"]?.trim() || null,
        state,
        boardState,
        needs: Array.isArray(m.task.needs) ? m.task.needs : [],
        createdAt: m.createdAt ?? null,
        dispatchedAt: dispatch && !dispatch.derived ? dispatch.at : null,
        finishedAt: FINISHED.has(state) ? finish && !finish.derived ? finish.at : m.editedAt ?? null : null,
        to: dispatch ? whoTo(dispatch.to, ctx, dispatch.scout?.agentId) : m.task.claim?.actor ? whoTo(m.task.claim.actor, ctx) : null,
        result: firstLine(said),
        flightId: scout?.scout?.flightId ?? null
      };
      jobs.push(job);
    }
    const steps = events2.filter((e) => e.kind !== "created" && e.kind !== "planned").map((e) => ({
      id: e.id,
      kind: e.kind,
      at: e.derived ? null : e.at,
      by: who(e.actor, ctx),
      to: ["claimed", "assigned", "completed", "failed"].includes(e.kind) ? whoTo(e.to, ctx, e.scout?.agentId) : null,
      note: firstLine(e.result ?? e.reason ?? null, 120)
    }));
    const own = replies.get(m.id) || [];
    posts.push({
      id: m.id,
      at: m.createdAt ?? null,
      by: who(m.by, ctx),
      text,
      task: job ? { state: job.state, to: job.to, result: job.result } : null,
      replies: own.sort((a, b) => (a.at ?? 0) - (b.at ?? 0)),
      steps
    });
  }
  const order = new Map(messages.map((m, i) => [m.id, i]));
  posts.sort((a, b) => (a.at ?? 0) - (b.at ?? 0) || order.get(a.id) - order.get(b.id));
  return { posts, runs: groupRuns(jobs), counts: countStates(jobs) };
}
function countStates(jobs) {
  const counts = {};
  for (const j of jobs) counts[j.state] = (counts[j.state] || 0) + 1;
  return counts;
}
const planName = (plan) => plan && !/[0-9a-f]{20,}/i.test(plan) ? plan : null;
function groupRuns(jobs) {
  const byKey = /* @__PURE__ */ new Map();
  for (const j of jobs) {
    const key = j.plan ? `plan:${j.plan}` : `task:${j.taskId}`;
    byKey.set(key, [...byKey.get(key) || [], j]);
  }
  const runs = [];
  for (const [key, list] of byKey) {
    const planned = list.slice().sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    const heads = planned.map((j) => j.title.includes(":") ? j.title.slice(0, j.title.indexOf(":")).trim() : null);
    const prefix = planned.length > 1 && heads[0] && heads.every((h) => h === heads[0]) ? heads[0] : null;
    const steps = planned.map((j) => prefix && j.step === j.title ? { ...j, step: j.title.slice(j.title.indexOf(":") + 1).trim() || j.title } : j);
    const starts = steps.map((j) => j.createdAt).filter((t) => t !== null);
    const ends = steps.map((j) => j.finishedAt);
    const done = steps.every((j) => FINISHED.has(j.state));
    runs.push({
      key,
      label: prefix || (planned.length === 1 ? steps[0].title : planName(list[0].plan) || steps[0].title),
      startedAt: starts.length ? Math.min(...starts) : null,
      finishedAt: done && ends.every((t) => t !== null) && ends.length ? Math.max(...ends) : null,
      counts: countStates(steps),
      jobs: steps
    });
  }
  return runs.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
}
function defaultView(channel, posts) {
  if (/(^|\/)decisions$/i.test(channel) || !posts.length) return "conversation";
  return posts.filter((p) => p.task).length * 2 >= posts.length ? "tasks" : "conversation";
}
function harnessesFrom(endpoints) {
  const list = Array.isArray(endpoints) ? endpoints : Object.values(endpoints || {});
  const out = {};
  for (const e of list) if (e?.agentId && e.harness && (!out[e.agentId] || e.state === "active")) out[e.agentId] = e.harness;
  return out;
}
const EVENT_GAP = 400;
const TICK = 1e4;
const RELEVANT = /^(collaboration\.|flight\.|vercel_board\.|agent\.endpoint\.)/;
const subs = /* @__PURE__ */ new Set();
let generation = 0;
let timer = null, busy = false, again = false, ticker = null, offEvents = null;
async function events(req, res, { board = "", room = "" } = {}) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" });
  res.write("retry: 2000\n\n");
  const sub = { res, board, room, sent: /* @__PURE__ */ new Map(), delivered: 0 };
  subs.add(sub);
  const keepalive = setInterval(() => res.write(": keepalive\n\n"), 2e4);
  req.on("close", () => {
    clearInterval(keepalive);
    subs.delete(sub);
    if (!subs.size) stop();
  });
  start();
  await push([sub]);
}
async function settle(p) {
  try {
    return { ok: true, data: await p };
  } catch (e) {
    return { ok: false, error: e.code || "failed", message: e.message, status: e.status || 500 };
  }
}
async function push(only = [...subs]) {
  if (!only.length) return;
  const round = ++generation;
  const state = await readState();
  const boards = /* @__PURE__ */ new Map(), rooms = /* @__PURE__ */ new Map();
  if (state.runtime.up && state.boards?.supported) {
    for (const s of only) if (!boards.has(s.board)) boards.set(s.board, settle(readBoard(s.board || void 0)));
  }
  if (state.runtime.up && state.rooms?.supported) {
    for (const s of only) if (s.room && !rooms.has(s.room)) rooms.set(s.room, settle(readRoom(s.room)));
  }
  for (const s of only) {
    const out = [["state", state]];
    if (boards.has(s.board)) out.push(["board", { key: s.board, ...await boards.get(s.board) }]);
    if (rooms.has(s.room)) out.push(["room", { key: s.room, ...await rooms.get(s.room) }]);
    if (!subs.has(s) || s.res.destroyed || s.res.writableEnded || round < s.delivered) continue;
    s.delivered = round;
    for (const [kind, data] of out) {
      const json = JSON.stringify(data);
      if (s.sent.get(kind) === json) continue;
      s.sent.set(kind, json);
      s.res.write(`event: ${kind}
data: ${json}

`);
    }
  }
}
function changed() {
  if (subs.size) soon(0);
}
function soon(ms) {
  if (!timer) timer = setTimeout(flush, ms);
}
async function flush() {
  timer = null;
  if (busy) {
    again = true;
    return;
  }
  busy = true;
  try {
    await push();
  } catch {
  } finally {
    busy = false;
  }
  if (again) {
    again = false;
    soon(EVENT_GAP);
  }
}
function start() {
  if (ticker) return;
  offEvents = onRuntimeEvents((kind) => {
    if (kind === "stream.open" || kind === "stream.closed" || RELEVANT.test(kind)) soon(EVENT_GAP);
  });
  ticker = setInterval(() => soon(0), TICK);
}
function stop() {
  offEvents?.();
  offEvents = null;
  clearInterval(ticker);
  ticker = null;
  clearTimeout(timer);
  timer = null;
}
const VERSION = "0.2.0";
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
function local(req) {
  if (!LOCAL.test(req.headers.host || "")) return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}
const WORK_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
class Refused extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const need = (ok2, message) => {
  if (!ok2) throw new Refused(400, "bad_request", message);
};
const BOARD_LIMIT = 500;
async function listBoards() {
  try {
    return shapeBoards(await rt("/v1/boards"));
  } catch (e) {
    if (e instanceof RuntimeError && e.status === 404) return null;
    throw e;
  }
}
async function readBoard(want, column = null, cursor = null) {
  need(cursor === null || column !== null, "A board cursor requires a column.");
  const boards = await listBoards();
  if (!boards) throw new Refused(404, "boards_unsupported", "This Scout's runtime doesn't serve boards.");
  const chosen = pickBoard(boards, want);
  if (!chosen) return { boards, board: null, columns: [], transitions: [], cards: [] };
  try {
    const q = new URLSearchParams({ limit: String(BOARD_LIMIT), perColumn: String(CARDS_PER_COLUMN) });
    if (column !== null) q.set("column", column);
    if (cursor !== null) q.set("cursor", cursor);
    const board = { boards, ...shapeBoard(await rt(`/v1/boards/${encodeURIComponent(chosen.id)}?${q}`)) };
    if (!board.page && column !== null) throw new Refused(409, "paging_unsupported", "Update Scout to page through a column.");
    if (!board.page && board.cards.length >= BOARD_LIMIT) board.partial = true;
    for (const c of board.cards) sourceOf.set(c.workId, c.source?.adapterId || null);
    await attachRooms(board.cards).catch(() => {
    });
    return board;
  } catch (e) {
    if (e instanceof RuntimeError && e.status === 404) throw new Refused(404, "no_such_board", `The runtime has no board ${chosen.id}.`);
    throw e;
  }
}
async function connections() {
  try {
    return (await rt("/v1/integrations/vercel-board/status"))?.connections || [];
  } catch (e) {
    if (e instanceof RuntimeError && (e.status === 404 || e.code === "vercel_board_unavailable")) return null;
    throw e;
  }
}
const roomCache = /* @__PURE__ */ new Map();
const MISS_MS = 6e4;
const connectionFor = (list, instanceId) => list.find((c) => c.id === `vercel-${instanceId}` || c.id === instanceId) || null;
async function boardTaskRoom(list, rooms, source) {
  const key = `${source.instanceId}\0${source.workItemId}`;
  const hit = roomCache.get(key);
  if (hit && (hit.roomId || Date.now() - hit.at < MISS_MS)) return hit.roomId;
  let roomId = null;
  const conn = connectionFor(list, source.instanceId);
  if (conn) {
    const q = new URLSearchParams({ connection: conn.id, task: source.workItemId, limit: "1" });
    const first = (await rt(`/v1/integrations/vercel-board/handoffs?${q}`).catch(() => null))?.handoffs?.[0];
    const room = first?.channel ? rooms.find((r) => r.connectionId === conn.id && r.channel === first.channel) : null;
    roomId = room?.conversationId || null;
  }
  if (roomCache.size >= 5e3) roomCache.clear();
  roomCache.set(key, { roomId, at: Date.now() });
  return roomId;
}
async function attachRooms(cards) {
  for (const c of cards) c.roomId = null;
  const list = await connections();
  if (!list?.length) return;
  const rooms = roomsFrom(list);
  const roomIds = new Set(rooms.map((r) => r.conversationId));
  const ask = [];
  for (const c of cards) {
    if (c.conversationId && roomIds.has(c.conversationId)) c.roomId = c.conversationId;
    else if (c.source?.adapterId === "vercel-board" && c.source.instanceId && c.source.workItemId) ask.push(c);
  }
  for (let i = 0; i < ask.length; i += 6) {
    await Promise.all(ask.slice(i, i + 6).map(async (c) => {
      c.roomId = await boardTaskRoom(list, rooms, c.source);
    }));
  }
}
async function listRooms() {
  const list = await connections();
  return list === null ? null : { connections: list.length, rooms: roomsFrom(list) };
}
let harnessCache = null;
async function harnesses() {
  if (harnessCache && Date.now() - harnessCache.at < 3e4) return harnessCache.value;
  const value = harnessesFrom((await rt("/v1/endpoints").catch(() => null))?.endpoints);
  harnessCache = { at: Date.now(), value };
  return value;
}
async function readRoom(conversationId) {
  const list = await connections();
  if (list === null) throw new Refused(404, "rooms_unsupported", "This Scout's runtime has no Vercel Board adapter.");
  for (const c of list) {
    const m = (c.mirror || []).find((x) => x.conversationId === conversationId);
    if (!m) continue;
    const q = (extra) => new URLSearchParams({ connection: c.id, ...extra }).toString();
    const [msgs, hand, who2] = await Promise.all([
      rt(`/v1/integrations/vercel-board/messages?${q({ channel: m.channel, limit: "500" })}`),
      rt(`/v1/integrations/vercel-board/handoffs?${q({ limit: "500" })}`),
      harnesses()
    ]);
    const fold = foldRoom({
      messages: msgs?.messages || [],
      handoffs: (hand?.handoffs || []).filter((h) => h.channel === m.channel),
      operatorPrincipal: c.principal || "",
      harnesses: who2
    });
    const [room] = roomsFrom([{ ...c, mirror: [m] }]);
    return { room, view: defaultView(m.channel, fold.posts), lastGoodReadAt: c.lastGoodReadAt ?? null, ...fold };
  }
  throw new Refused(404, "no_such_room", "Scout doesn't follow that room on this host.");
}
async function readState() {
  const runtime = await health();
  if (!runtime.up) return { runtime, boards: null, rooms: null };
  const [boards, rooms] = await Promise.all([
    listBoards().then((list) => ({ supported: list !== null, list: list || [] }), (e) => ({ supported: true, list: [], error: e.message })),
    listRooms().then(
      (r) => r ? { supported: true, connections: r.connections, list: r.rooms } : { supported: false, connections: 0, list: [] },
      (e) => ({ supported: true, connections: 0, list: [], error: e.message })
    )
  ]);
  return { runtime, boards, rooms };
}
async function readiness() {
  const [node, readable] = await Promise.all([
    rt("/v1/node", { ms: 2500 }).catch(() => null),
    rt("/v1/boards", { ms: 2500 }).then((d) => Array.isArray(d?.boards), () => false)
  ]);
  let writable = false;
  if (readable) {
    const workId = `boards-readiness-${randomUUID()}`;
    try {
      const out = await rt("/v1/work/move", {
        method: "POST",
        ms: 2500,
        body: { workId, to: "ready", actorId: "operator", dryRun: true }
      });
      writable = Boolean(out?.decision) && out.applied === false;
    } catch (e) {
      writable = e instanceof RuntimeError && e.status === 404 && e.code === `No work item ${workId}.`;
    }
  }
  return { listening: true, readable, writable, nodeId: typeof node?.id === "string" ? node.id : null };
}
const TRACKERS = { "vercel-board": "Vercel Board", linear: "Linear" };
const sourceOf = /* @__PURE__ */ new Map();
async function trackerOf(workId) {
  if (!sourceOf.has(workId)) {
    try {
      const { position } = await rt(`/v1/work/lifecycles?workId=${encodeURIComponent(workId)}`);
      if (position?.workId === workId && Object.hasOwn(position, "sourceAdapterId")) {
        sourceOf.set(workId, position.sourceAdapterId);
        return TRACKERS[position.sourceAdapterId] || null;
      }
    } catch (e) {
      if (!(e instanceof RuntimeError && e.status === 404)) throw e;
    }
    for (const b of await listBoards() || []) {
      const raw = await rt(`/v1/boards/${encodeURIComponent(b.id)}?limit=${BOARD_LIMIT}`).catch(() => null);
      for (const card of raw?.cards || []) sourceOf.set(card.workId, card.source?.adapterId || null);
      if (sourceOf.has(workId)) break;
    }
  }
  return TRACKERS[sourceOf.get(workId)] || null;
}
async function notFromTracker(workId, verb) {
  const tracker = await trackerOf(workId);
  if (tracker) throw new Refused(409, "tracker_owned", `This card follows a task on ${tracker}, which decides where it sits. It isn't ${verb} from Scout; its review is.`);
}
async function move(b) {
  need(typeof b.workId === "string" && WORK_ID.test(b.workId), "workId is required");
  need(typeof b.to === "string" && ID.test(b.to), "to is required");
  const body = { workId: b.workId, to: b.to, actorId: "operator", dryRun: b.dryRun === true };
  if (typeof b.note === "string" && b.note.trim()) body.note = b.note.trim().slice(0, 4e3);
  if (b.waitingOn && typeof b.waitingOn.label === "string" && b.waitingOn.label.trim()) body.waitingOn = { label: b.waitingOn.label.trim().slice(0, 400) };
  await notFromTracker(b.workId, "moved");
  return rt("/v1/work/move", { method: "POST", body });
}
async function review(b) {
  need(typeof b.workId === "string" && WORK_ID.test(b.workId), "workId is required");
  need(typeof b.moveId === "string" && ID.test(b.moveId), "moveId is required");
  need(["confirm", "reopen", "consult"].includes(b.verdict), "verdict is confirm, reopen or consult");
  need(Number.isInteger(b.revision), "revision is required");
  const body = { workId: b.workId, moveId: b.moveId, verdict: b.verdict, revision: b.revision, actorId: "operator" };
  if (typeof b.note === "string" && b.note.trim()) body.note = b.note.trim().slice(0, 4e3);
  return rt("/v1/work/review", { method: "POST", body });
}
async function claim(b) {
  need(typeof b.workId === "string" && WORK_ID.test(b.workId), "workId is required");
  const action = b.action ?? "claim";
  need(["claim", "release"].includes(action), "action is claim or release");
  const body = { workId: b.workId, action, actorId: "operator" };
  if (Number.isInteger(b.leaseGeneration)) body.leaseGeneration = b.leaseGeneration;
  await notFromTracker(b.workId, "claimed");
  return rt("/v1/work/claim", { method: "POST", body });
}
const READS = ["/api/hello", "/api/status", "/api/state", "/api/board", "/api/rooms", "/api/room", "/api/moves"];
const WRITES = ["/api/move", "/api/review", "/api/claim"];
async function route(method, pathname, query = new URLSearchParams(), body = {}) {
  try {
    if (method === "GET") {
      if (pathname === "/api/hello") return ok({ ...hello(), version: VERSION });
      if (pathname === "/api/status") return ok(await readiness());
      if (pathname === "/api/state") return ok(await readState());
      if (pathname === "/api/board") return ok(await readBoard(query.get("id") || void 0, query.get("column"), query.get("cursor")));
      if (pathname === "/api/rooms") {
        const r = await listRooms();
        if (!r) throw new Refused(404, "rooms_unsupported", "This Scout's runtime has no Vercel Board adapter.");
        return ok(r);
      }
      if (pathname === "/api/room") {
        const id = query.get("conversationId") || "";
        need(ID.test(id), "conversationId is required");
        return ok(await readRoom(id));
      }
      if (pathname === "/api/moves") {
        const id = query.get("workId") || "";
        need(WORK_ID.test(id), "workId is required");
        return ok(await rt(`/v1/work/moves?workId=${encodeURIComponent(id)}`));
      }
    }
    if (method === "POST") {
      if (pathname === "/api/move") return ok(await move(body));
      if (pathname === "/api/review") return ok(await review(body));
      if (pathname === "/api/claim") return ok(await claim(body));
    }
    if ([...READS, ...WRITES].includes(pathname)) return { status: 405, body: { error: "method_not_allowed" } };
    return { status: 404, body: { error: "not_found" } };
  } catch (e) {
    if (e instanceof Refused) return { status: e.status, body: { error: e.code, message: e.message } };
    if (e instanceof RuntimeDown) return { status: 503, body: { error: "runtime_down", message: e.message } };
    if (e instanceof RuntimeError) return { status: e.status, body: { ...e.body && typeof e.body === "object" ? e.body : {}, error: e.code, message: e.message } };
    return { status: 500, body: { error: "failed", message: String(e?.message || e) } };
  }
}
const ok = (body) => ({ status: 200, body });
const send = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};
function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => {
      b += c;
      if (b.length > 256e3) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(b || "{}"));
      } catch {
        resolve(null);
      }
    });
  });
}
async function handle(req, res) {
  const url = new URL(req.url, "http://local");
  if (!url.pathname.startsWith("/api/")) return false;
  if (!local(req)) {
    send(res, 403, { error: "local only" });
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/events") {
    await events(req, res, { board: url.searchParams.get("board") || "", room: url.searchParams.get("room") || "" });
    return true;
  }
  let body = {};
  if (req.method === "POST") {
    if (!String(req.headers["content-type"] || "").startsWith("application/json")) {
      send(res, 415, { error: "json only" });
      return true;
    }
    body = await readBody(req);
    if (!body || typeof body !== "object") {
      send(res, 400, { error: "bad_request", message: "the body isn't JSON" });
      return true;
    }
  }
  const out = await route(req.method, url.pathname, url.searchParams, body);
  send(res, out.status, out.body);
  if (req.method === "POST" && out.status === 200 && body.dryRun !== true) changed();
  return true;
}
const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8"
};
const THIN_SHARED_PATHS = /* @__PURE__ */ new Set([
  "/api/host-status",
  "/api/local-board",
  "/api/setup",
  "/api/recent-sessions",
  "/api/session-context",
  "/api/messages",
  "/v1/events/stream",
  "/v1/tail/events"
]);
function isThinSharedRoute(pathname) {
  return THIN_SHARED_PATHS.has(pathname) || pathname.startsWith("/api/session-ref/");
}
function cleanCardCopy(raw) {
  if (!raw) return "";
  return raw.replace(/^◈[^\n›]*›\s*(?:Previous task[^\n›]*›\s*)?/u, "").replace(/^[a-z0-9._-]+\.\s*Task:\s*/i, "").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").replace(/\s+/g, " ").trim();
}
function distinctOutcome(title, rawOutcome) {
  const outcome = cleanCardCopy(rawOutcome);
  if (!outcome || outcome.length < 4) return null;
  const normTitle = title.toLowerCase();
  const normOutcome = outcome.toLowerCase();
  if (normTitle === normOutcome) return null;
  const prefixLen = Math.min(34, normTitle.length, normOutcome.length);
  if (prefixLen >= 16 && normTitle.slice(0, prefixLen) === normOutcome.slice(0, prefixLen)) {
    return null;
  }
  return outcome;
}
function buildLocalActivityBoard() {
  const items = scanLocalFeedSessions({ maxPerHarness: 18, limit: 36 });
  const now = Date.now();
  const activeCutoff = now - 20 * 6e4;
  const cards = items.map((item) => {
    const hasPrOrBranch = item.prs && item.prs.length > 0 || item.branch && item.branch !== "main" && item.branch !== "master";
    const column = item.at >= activeCutoff ? "active" : hasPrOrBranch ? "branches" : "completed";
    const title = cleanCardCopy(item.asked || item.title) || item.title;
    const outcome = distinctOutcome(title, item.title !== item.asked ? item.title : null);
    return {
      id: item.id,
      sessionId: item.sessionId,
      column,
      harness: item.source,
      project: item.project,
      branch: item.branch,
      title,
      outcome,
      files: item.filesTouched.length,
      prs: item.prs,
      updatedAt: item.at
    };
  });
  return {
    columns: [
      { id: "active", name: "Active recently", state: "working", purpose: "Sessions updated in the last 20 minutes" },
      { id: "branches", name: "Pull requests & branches", state: "review", purpose: "Local sessions with pull requests or topic branches" },
      { id: "completed", name: "Completed turns", state: "done", purpose: "Recent finished agent sessions on this host" }
    ],
    cards
  };
}
const handleThinRoutes = createScoutThinHttpHandler({
  packageName: "@openscout/boards",
  product: "Boards",
  apiHandler: async (req, res, { pathname }) => {
    if (req.method === "GET" && pathname === "/api/host-status") {
      const base = runtimeUrl$1();
      const runtimeUp = await checkRuntime(base);
      const localSessions = scanLocalFeedSessions({ maxPerHarness: 15, limit: 30 }).length;
      sendJson(res, 200, { runtimeUp, runtimeUrl: base, localSessions });
      return true;
    }
    if (req.method === "GET" && pathname === "/api/local-board") {
      sendJson(res, 200, buildLocalActivityBoard());
      return true;
    }
    return false;
  }
});
function createBoardsServer() {
  return http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (isThinSharedRoute(url.pathname)) {
      if (!local(req)) {
        sendJson(res, 403, { error: "local only" });
        return;
      }
      if (await handleThinRoutes(req, res)) return;
    }
    if (await handle(req, res)) return;
    const u = url.pathname;
    const rel = path.normalize(u).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
    let file = path.join(DIST, rel);
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(DIST, "index.html");
    }
    if (!fs.existsSync(file)) {
      sendJson(res, 503, { error: "dist/index.html is missing. Run npm run build first." });
      return;
    }
    res.writeHead(200, {
      "content-type": TYPES[path.extname(file)] || "application/octet-stream",
      "cache-control": file.endsWith("index.html") ? "no-store" : "public, max-age=3600"
    });
    fs.createReadStream(file).pipe(res);
  });
}
function serve(port, host = "127.0.0.1") {
  const server = createBoardsServer();
  return new Promise((ok2, no) => server.once("error", no).listen(port, host, () => ok2(server)));
}
export {
  DIST,
  createBoardsServer,
  serve
};
