#!/usr/bin/env node
// boards-plugin/server.ts
import { existsSync as existsSync3, readFileSync as readFileSync3 } from "node:fs";
import { dirname as dirname3, join as join3 } from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

// ../../../scout/packages/runtime/dist/local-config.js
import { existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync as readFileSync2, renameSync as renameSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { dirname as dirname2, join as join2 } from "node:path";

// ../../../scout/packages/runtime/dist/support-paths.js
import { homedir as homedir2 } from "node:os";

// ../../../scout/packages/runtime/dist/instance.js
import { closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { homedir, hostname as osHostname } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
var OPENSCOUT_PROD_INSTANCE = "prod";
var OPENSCOUT_DEV_INSTANCE = "dev";
var OPENSCOUT_INSTANCES_DIRECTORY = "instances";
var OPENSCOUT_PROD_PORTS = {
  broker: 43110,
  roomListening: 43112,
  mcp: 43115,
  web: 43120,
  webTerminalRelay: 43121,
  vite: 43122,
  pairingBridge: 43130,
  pairingRelay: 43131,
  pairingFileServer: 43132,
  studio: 43140,
  jetstream: 43150,
  jetstreamMonitor: 43151
};
var OPENSCOUT_INSTANCE_PORT_BLOCK_START = 24400;
var OPENSCOUT_INSTANCE_PORT_BLOCK_SIZE = 50;
var OPENSCOUT_INSTANCE_PORT_BLOCK_COUNT = 120;
var INSTANCE_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

class OpenScoutInstanceError extends Error {
  violations;
  constructor(message, violations = []) {
    super(message);
    this.name = "OpenScoutInstanceError";
    this.violations = violations;
  }
}
function normalizeOpenScoutInstanceName(raw) {
  const trimmed = (raw ?? "").trim().toLowerCase();
  if (!trimmed || trimmed === "default" || trimmed === "production")
    return OPENSCOUT_PROD_INSTANCE;
  const normalized = trimmed.replace(/[\s_.]+/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "");
  if (!INSTANCE_NAME_PATTERN.test(normalized)) {
    throw new OpenScoutInstanceError(`Invalid OPENSCOUT_INSTANCE ${JSON.stringify(raw)}: use 1-40 characters of a-z, 0-9 and '-', ` + "starting and ending with a letter or digit (for example `dev` or `dev-feature`).");
  }
  return normalized;
}
function resolveOpenScoutInstanceName(env = process.env) {
  return normalizeOpenScoutInstanceName(env.OPENSCOUT_INSTANCE);
}
function isProdOpenScoutInstance(name) {
  return name === OPENSCOUT_PROD_INSTANCE;
}
function fnv1a(input) {
  let hash = 2166136261;
  for (let index = 0;index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}
var OPENSCOUT_INSTANCE_AVOIDED_PORTS = [
  24800,
  25565,
  25672,
  26257,
  27017,
  27018,
  27019,
  28015,
  30000
];
var LEGACY_LEDGER_FILE = ".ledger.json";
function openScoutInstanceRegistryDir(env = process.env, home = homedir()) {
  return env.OPENSCOUT_INSTANCE_REGISTRY?.trim() || join(home, ".openscout", OPENSCOUT_INSTANCES_DIRECTORY);
}
function slotsDir(env, home) {
  return join(openScoutInstanceRegistryDir(env, home), ".slots");
}
function claimsDir(env, home) {
  return join(openScoutInstanceRegistryDir(env, home), ".claims");
}
function slotPath(env, home, base) {
  return join(slotsDir(env, home), String(base));
}
function claimPath(env, home, name) {
  return join(claimsDir(env, home), `${name}.json`);
}
function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}
function parseClaim(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.portBase !== "number" || !Number.isInteger(parsed.portBase))
      return null;
    return {
      portBase: parsed.portBase,
      ...typeof parsed.root === "string" ? { root: parsed.root } : {},
      ...typeof parsed.checkout === "string" ? { checkout: parsed.checkout } : {},
      ...parsed.explicitBase === true ? { explicitBase: true } : {},
      claimedAt: typeof parsed.claimedAt === "number" ? parsed.claimedAt : 0
    };
  } catch {
    return null;
  }
}
function readClaim(env, home, name) {
  const path = claimPath(env, home, name);
  const raw = readText(path);
  if (raw === null)
    return { state: "missing" };
  const entry = parseClaim(raw);
  return entry ? { state: "ok", entry } : { state: "corrupt", path };
}
function readSlotOwner(env, home, base) {
  const raw = readText(slotPath(env, home, base));
  return raw === null ? null : raw.trim();
}
function listSlots(env, home) {
  const slots = {};
  let names = [];
  try {
    names = readdirSync(slotsDir(env, home));
  } catch {
    return slots;
  }
  for (const file of names) {
    if (!/^\d+$/.test(file))
      continue;
    const owner = readSlotOwner(env, home, Number(file));
    if (owner !== null)
      slots[Number(file)] = owner;
  }
  return slots;
}
function legacyLedgerPath(env, home) {
  return join(openScoutInstanceRegistryDir(env, home), LEGACY_LEDGER_FILE);
}
function registryView(env, home, name) {
  const instances = {};
  const legacy = readText(legacyLedgerPath(env, home));
  if (legacy !== null) {
    try {
      const parsed = JSON.parse(legacy);
      for (const [other, value] of Object.entries(parsed?.instances ?? {})) {
        const entry = parseClaim(JSON.stringify(value));
        if (entry)
          instances[other] = entry;
      }
    } catch {}
  }
  const own = readClaim(env, home, name);
  if (own.state === "ok")
    instances[name] = own.entry;
  else if (own.state === "corrupt" && openScoutInstanceNeedsLedger(name, env)) {
    throw corruptClaimError(name, own.path);
  }
  return { version: 1, instances, slots: listSlots(env, home) };
}
function corruptClaimError(name, path) {
  return new OpenScoutInstanceError(`The registry claim for OpenScout instance "${name}" (${path}) is unreadable. ` + "Run `scout instance repair` (it rebuilds the claim from the instance's slot and root), " + "or set OPENSCOUT_INSTANCE_PORT_BASE meanwhile.");
}
function blockIsAvoided(base) {
  return OPENSCOUT_INSTANCE_AVOIDED_PORTS.some((port) => port >= base && port < base + OPENSCOUT_INSTANCE_PORT_BLOCK_SIZE);
}
function slotBase(slot) {
  return OPENSCOUT_INSTANCE_PORT_BLOCK_START + slot * OPENSCOUT_INSTANCE_PORT_BLOCK_SIZE;
}
function candidateBases(name) {
  const slots = OPENSCOUT_INSTANCE_PORT_BLOCK_COUNT - 1;
  const start = fnv1a(name) % slots;
  const bases = [];
  for (let offset = 0;offset < slots; offset += 1) {
    const base = slotBase(1 + (start + offset) % slots);
    if (!blockIsAvoided(base))
      bases.push(base);
  }
  return bases;
}
function openScoutInstancePortBase(name, env = process.env, ledger = { version: 1, instances: {} }) {
  if (isProdOpenScoutInstance(name))
    return OPENSCOUT_PROD_PORTS.broker;
  const explicit = parsePort(env.OPENSCOUT_INSTANCE_PORT_BASE);
  if (explicit !== undefined)
    return explicit;
  if (name === OPENSCOUT_DEV_INSTANCE)
    return slotBase(0);
  const recorded = ledger.instances[name]?.portBase;
  if (typeof recorded === "number" && Number.isInteger(recorded))
    return recorded;
  const taken = new Set([slotBase(0)]);
  for (const [other, entry] of Object.entries(ledger.instances)) {
    if (other !== name)
      taken.add(entry.portBase);
  }
  for (const [base, owner] of Object.entries(ledger.slots ?? {})) {
    if (owner !== name)
      taken.add(Number(base));
  }
  const free = candidateBases(name).find((base) => !taken.has(base));
  if (free === undefined)
    throw noFreeBlockError(name);
  return free;
}
function noFreeBlockError(name) {
  return new OpenScoutInstanceError(`No free OpenScout instance port block for "${name}": every block is claimed. ` + "See `scout instance list` (it prunes dead instances) and free one with " + "`scout instance release <name>`, or set OPENSCOUT_INSTANCE_PORT_BASE.");
}
function openScoutInstanceNeedsLedger(name, env = process.env) {
  if (isProdOpenScoutInstance(name))
    return false;
  if (name === OPENSCOUT_DEV_INSTANCE)
    return false;
  return parsePort(env.OPENSCOUT_INSTANCE_PORT_BASE) === undefined;
}
var PRUNE_GRACE_MS = 60 * 60000;
function deriveOpenScoutInstancePorts(name, env = process.env, ledger) {
  const base = openScoutInstancePortBase(name, env, ledger);
  const ports = {};
  for (const [key, prodPort] of Object.entries(OPENSCOUT_PROD_PORTS)) {
    ports[key] = base + (prodPort - OPENSCOUT_PROD_PORTS.broker);
  }
  return ports;
}
function normalizeOpenScoutHostLabel(value) {
  const firstLabel = (value ?? "").trim().replace(/\.local\.?$/i, "").split(".").find((part) => part.trim().length > 0) ?? "";
  const normalized = firstLabel.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-");
  return normalized || "localhost";
}
function prodOpenScoutSupportDirectory(home, platform, env) {
  if (platform === "darwin")
    return join(home, "Library", "Application Support", "OpenScout");
  const xdgDataHome = env.XDG_DATA_HOME?.trim();
  return join(xdgDataHome || join(home, ".local", "share"), "openscout");
}
function deriveOpenScoutInstanceLayout(options = {}) {
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const platform = options.platform ?? process.platform;
  const name = options.name !== undefined ? normalizeOpenScoutInstanceName(options.name) : resolveOpenScoutInstanceName(env);
  const isProd = isProdOpenScoutInstance(name);
  const osHostLabel = normalizeOpenScoutHostLabel(options.hostname ?? osHostname());
  const hostLabelOverride = isProd ? "" : env.OPENSCOUT_INSTANCE_HOST_LABEL?.trim() ?? "";
  const hostLabel = hostLabelOverride ? normalizeOpenScoutHostLabel(hostLabelOverride) : osHostLabel;
  const ledger = isProd ? undefined : registryView(env, home, name);
  const ports = deriveOpenScoutInstancePorts(name, env, ledger);
  const meshId = env.OPENSCOUT_MESH_ID?.trim() || "openscout";
  if (isProd) {
    const openscoutHome = join(home, ".openscout");
    const supportDirectory = prodOpenScoutSupportDirectory(home, platform, env);
    const scoutHome = join(home, ".scout");
    const runtimeDirectory = join(supportDirectory, "runtime");
    return {
      name,
      isProd,
      root: null,
      openscoutHome,
      controlHome: join(openscoutHome, "control-plane"),
      supportDirectory,
      runtimeDirectory,
      relayHub: join(openscoutHome, "relay"),
      scoutHome,
      pairingHome: join(scoutHome, "pairing"),
      localEdgeDirectory: join(scoutHome, "local-edge"),
      brokerSocketPath: join(runtimeDirectory, "broker.sock"),
      appSocketPath: join(openscoutHome, "run", "scout-app.sock"),
      probesSocketPath: join(openscoutHome, "run", "scoutd-probes.sock"),
      ports,
      hostLabel,
      nodeName: options.hostname ?? osHostname(),
      nodeQualifier: hostLabel,
      nodeId: null,
      serviceLabel: "app.openscout",
      systemdUnitName: "scout.service",
      meshAllowed: true
    };
  }
  const explicitRoot = env.OPENSCOUT_INSTANCE_ROOT?.trim();
  const root = explicitRoot ? resolve(expandHome(explicitRoot, home)) : ledger?.instances[name]?.root ?? join(home, ".openscout", OPENSCOUT_INSTANCES_DIRECTORY, name);
  const supportDirectory = join(root, "support");
  const runtimeDirectory = join(supportDirectory, "runtime");
  const nodeQualifier = `${hostLabel}-${name}`;
  return {
    name,
    isProd,
    root,
    openscoutHome: root,
    controlHome: join(root, "control-plane"),
    supportDirectory,
    runtimeDirectory,
    relayHub: join(root, "relay"),
    scoutHome: root,
    pairingHome: join(root, "pairing"),
    localEdgeDirectory: join(root, "local-edge"),
    brokerSocketPath: join(runtimeDirectory, "broker.sock"),
    appSocketPath: join(root, "run", "scout-app.sock"),
    probesSocketPath: join(root, "run", "scoutd-probes.sock"),
    ports,
    hostLabel,
    nodeName: nodeQualifier,
    nodeQualifier,
    nodeId: `${nodeQualifier}-${normalizeOpenScoutHostLabel(meshId)}`,
    serviceLabel: `app.openscout.${name}`,
    systemdUnitName: `scout-${name}.service`,
    meshAllowed: readBoolean(env.OPENSCOUT_INSTANCE_MESH) === true
  };
}
function parsePort(value) {
  const raw = value?.trim();
  if (!raw)
    return;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : undefined;
}
function readBoolean(value) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized)
    return;
  if (["1", "true", "yes", "on"].includes(normalized))
    return true;
  if (["0", "false", "no", "off"].includes(normalized))
    return false;
  return;
}
function expandHome(value, home) {
  if (value === "~")
    return home;
  if (value.startsWith("~/"))
    return join(home, value.slice(2));
  return value;
}

// ../../../scout/packages/runtime/dist/support-paths.js
function defaultOpenScoutSupportDirectory(home = homedir2()) {
  return deriveOpenScoutInstanceLayout({ home }).supportDirectory;
}
function envPath(key) {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
}
function resolveOpenScoutHome() {
  return envPath("OPENSCOUT_HOME") ?? deriveOpenScoutInstanceLayout().openscoutHome;
}

// ../../../scout/packages/runtime/dist/node-identity-wire.js
var NODE_CARD_TTL_MS = 24 * 60 * 60 * 1000;
// ../../../scout/packages/runtime/dist/node-identity.js
var stableNodeQualifierCache = new Map;

// ../../../scout/packages/runtime/dist/local-config.js
var LOCAL_CONFIG_VERSION = 1;
var DEFAULT_SCOUT_WEB_PORTAL_HOST = "scout.local";
var DEFAULT_SCOUT_WEB_DEV_HOST = `dev.${DEFAULT_SCOUT_WEB_PORTAL_HOST}`;
var OPENSCOUT_PORTS = {
  broker: 43110,
  roomListening: 43112,
  mcp: 43115,
  web: 43120,
  webTerminalRelay: 43121,
  vite: 43122,
  pairingBridge: 43130,
  pairingRelay: 43131,
  pairingFileServer: 43132,
  studio: 43140,
  jetstream: 43150,
  jetstreamMonitor: 43151
};
var DEFAULT_LOCAL_CONFIG = {
  version: LOCAL_CONFIG_VERSION,
  host: "127.0.0.1",
  webLocalName: undefined,
  ports: {
    broker: OPENSCOUT_PORTS.broker,
    web: OPENSCOUT_PORTS.web,
    pairing: OPENSCOUT_PORTS.pairingBridge
  }
};
function localConfigHome() {
  return resolveOpenScoutHome();
}
function localConfigPath() {
  return join2(localConfigHome(), "config.json");
}
function loadLocalConfig() {
  const configPath = localConfigPath();
  if (!existsSync2(configPath))
    return { version: LOCAL_CONFIG_VERSION };
  try {
    return validateLocalConfig(JSON.parse(readFileSync2(configPath, "utf8")));
  } catch {
    return { version: LOCAL_CONFIG_VERSION };
  }
}
function validateLocalConfig(input) {
  if (!input || typeof input !== "object")
    return { version: LOCAL_CONFIG_VERSION };
  const raw = input;
  const out = { version: LOCAL_CONFIG_VERSION };
  if (typeof raw.host === "string" && raw.host.trim().length > 0) {
    out.host = raw.host.trim();
  }
  if (typeof raw.webLocalName === "string" && raw.webLocalName.trim().length > 0) {
    out.webLocalName = raw.webLocalName.trim();
  }
  if (raw.webLanScope === "full" || raw.webLanScope === "pairing" || raw.webLanScope === "chat") {
    out.webLanScope = raw.webLanScope;
  }
  if (typeof raw.webLanOnly === "boolean")
    out.webLanOnly = raw.webLanOnly;
  if (raw.ports && typeof raw.ports === "object") {
    const ports = raw.ports;
    const p = {};
    if (isValidPort(ports.broker))
      p.broker = ports.broker;
    if (isValidPort(ports.web))
      p.web = ports.web;
    if (isValidPort(ports.pairing))
      p.pairing = ports.pairing;
    if (Object.keys(p).length > 0)
      out.ports = p;
  }
  return out;
}
function isValidPort(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value < 65536;
}
function parseEnvPort(name) {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return;
  }
  const parsed = Number.parseInt(raw, 10);
  return isValidPort(parsed) ? parsed : undefined;
}
function resolveEffectiveLocalConfig() {
  const file = loadLocalConfig();
  const host = process.env.OPENSCOUT_BROKER_HOST?.trim() || process.env.OPENSCOUT_HOST?.trim() || file.host;
  const ports = {
    broker: parseEnvPort("OPENSCOUT_BROKER_PORT") ?? file.ports?.broker,
    web: parseEnvPort("OPENSCOUT_WEB_PORT") ?? parseEnvPort("SCOUT_WEB_PORT") ?? file.ports?.web,
    pairing: parseEnvPort("OPENSCOUT_PAIRING_PORT") ?? file.ports?.pairing
  };
  return {
    version: LOCAL_CONFIG_VERSION,
    ...host ? { host } : {},
    ...file.webLocalName ? { webLocalName: file.webLocalName } : {},
    ...ports.broker || ports.web || ports.pairing ? { ports } : {}
  };
}
function instanceDefaultPorts() {
  const ports = deriveOpenScoutInstanceLayout().ports;
  return { broker: ports.broker, web: ports.web, pairing: ports.pairingBridge };
}
function resolveWebPort() {
  return resolveEffectiveLocalConfig().ports?.web ?? instanceDefaultPorts().web;
}

// boards-plugin/server.ts
var VERSION = "0.1.0";
var VIEW_URI = "ui://scout-boards/work-board.html";
var here = dirname3(fileURLToPath(import.meta.url));
function webUrl() {
  const explicit = process.env.SCOUT_WEB_URL?.trim();
  if (explicit)
    return explicit.replace(/\/+$/, "");
  return `http://127.0.0.1:${resolveWebPort()}`;
}
function webToken() {
  const fromEnv = process.env.OPENSCOUT_WEB_AUTH_TOKEN?.trim();
  if (fromEnv)
    return fromEnv;
  const support = process.env.OPENSCOUT_SUPPORT_DIRECTORY ?? defaultOpenScoutSupportDirectory();
  const path = join3(support, "runtime", "web-auth-token");
  try {
    return existsSync3(path) ? readFileSync3(path, "utf8").trim() || null : null;
  } catch {
    return null;
  }
}

class WebError extends Error {
}
async function web(method, path, body) {
  const token = webToken();
  if (!token)
    throw new WebError("Scout isn't set up on this host: there is no web credential. Run `scout setup`, then try again.");
  let response;
  try {
    response = await fetch(`${webUrl()}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, accept: "application/json", ...body === undefined ? {} : { "content-type": "application/json" } },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(1e4)
    });
  } catch {
    throw new WebError(`Scout's web app isn't answering at ${webUrl()}. Start Scout on this host, then try again.`);
  }
  const text = await response.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!response.ok)
    throw new WebError(data && typeof data.error === "string" && data.error || `${method} ${path} answered ${response.status}`);
  return data;
}
var WORK_ID = "[A-Za-z0-9][A-Za-z0-9._:-]{0,127}";
var READS = [
  /^\/api\/work\/board(\?lifecycle=[A-Za-z0-9._%:-]{1,200})?$/,
  /^\/api\/work\/moves(\?workId=[A-Za-z0-9._%:-]{1,200})?$/,
  /^\/api\/agents\?detail=summary$/,
  /^\/api\/onboarding\/state$/
];
var WRITES = [new RegExp(`^/api/work/${WORK_ID}/(move|review|continue)$`)];
var PREVIEWS = [new RegExp(`^/api/work/${WORK_ID}/move$`)];
var allowed = (rules, path) => typeof path === "string" && path.length < 400 && rules.some((rule) => rule.test(path));
var TOOLS = [
  {
    name: "work_board",
    title: "Work board",
    description: "Show Scout's work board on this host: the lifecycle's stations as columns and the work items as cards, as the Scout app draws it. The person can move cards, review moves and continue work from it. Returns the columns and their cards as text too.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    _meta: { ui: { resourceUri: VIEW_URI } }
  },
  {
    name: "api_read",
    description: "The board view's reads from Scout. Called by the view, not the model.",
    inputSchema: { type: "object", required: ["path"], properties: { path: { type: "string" }, preview: { type: "object", description: "A move to check without making it." } } },
    annotations: { readOnlyHint: true },
    _meta: { ui: { resourceUri: VIEW_URI, visibility: ["app"] } }
  },
  {
    name: "api_write",
    description: "The board view's moves, reviews and continues, sent to Scout's runtime. Called by the view, not the model.",
    inputSchema: {
      type: "object",
      required: ["method", "path"],
      properties: { method: { type: "string", enum: ["POST"] }, path: { type: "string" }, body: { type: "object" } }
    },
    _meta: { ui: { resourceUri: VIEW_URI, visibility: ["app"] } }
  }
];
var CARDS_PER_COLUMN = 12;
function boardForModel(board) {
  return {
    lifecycle: board.lifecycle.name,
    cardCount: board.cards.length,
    columns: board.lifecycle.stations.map((station) => {
      const cards = board.cards.filter((card) => card.station === station.id);
      return {
        id: station.id,
        name: station.name,
        count: cards.length,
        cards: cards.slice(0, CARDS_PER_COLUMN).map((card) => ({
          id: card.item.id,
          title: card.item.title,
          owner: card.item.ownerName,
          reviewPending: card.reviewPending
        }))
      };
    })
  };
}
function describeBoard(board) {
  const lines = [`${board.lifecycle}: ${board.cardCount} ${board.cardCount === 1 ? "card" : "cards"}.`];
  for (const column of board.columns) {
    if (!column.count)
      continue;
    lines.push("", `${column.name} (${column.count})`);
    for (const card of column.cards) {
      lines.push(`- ${card.title} [${card.id}]${card.owner ? `, ${card.owner}` : ""}${card.reviewPending ? ", review pending" : ""}`);
    }
    if (column.count > column.cards.length)
      lines.push(`- and ${column.count - column.cards.length} more`);
  }
  return lines.join(`
`);
}
async function callTool(name, args = {}) {
  if (name === "work_board") {
    const board = boardForModel(await web("GET", "/api/work/board"));
    return {
      content: [{ type: "text", text: `${describeBoard(board)}

The person sees this board in the thread.` }],
      structuredContent: { kind: "work-board", webUrl: webUrl(), shownToPerson: true, board }
    };
  }
  if (name === "api_read") {
    if (args.preview !== undefined) {
      if (!allowed(PREVIEWS, args.path) || typeof args.preview !== "object" || args.preview === null)
        throw new WebError(`The board doesn't preview ${String(args.path)}.`);
      const data = await web("POST", args.path, { ...args.preview, dryRun: true });
      return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: { data } };
    }
    if (!allowed(READS, args.path))
      throw new WebError(`The board doesn't read ${String(args.path)}.`);
    const data = await web("GET", args.path);
    return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: { data } };
  }
  if (name === "api_write") {
    if (args.method !== "POST" || !allowed(WRITES, args.path))
      throw new WebError(`The board doesn't send ${String(args.method)} ${String(args.path)}.`);
    const data = await web("POST", args.path, args.body ?? {});
    return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: { data } };
  }
  throw new WebError(`There is no tool ${name}.`);
}
function viewHtml() {
  return readFileSync3(join3(here, "view", "work-board.html"), "utf8");
}
var out = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}
`);
function serveMcp() {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", async (line) => {
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      return;
    }
    if (m.id === undefined)
      return;
    try {
      switch (m.method) {
        case "initialize":
          return out({ id: m.id, result: {
            protocolVersion: m.params?.protocolVersion || "2025-06-18",
            capabilities: { tools: {}, resources: {} },
            serverInfo: { name: "scout-boards", version: VERSION },
            instructions: "Scout boards shows the person Scout's work board on this host. Call `work_board` when they ask what work is in flight, what is waiting on review, or to see the board."
          } });
        case "ping":
          return out({ id: m.id, result: {} });
        case "tools/list":
          return out({ id: m.id, result: { tools: TOOLS } });
        case "resources/list":
          return out({ id: m.id, result: { resources: [{ uri: VIEW_URI, name: "Work board", mimeType: "text/html;profile=mcp-app" }] } });
        case "resources/read":
          if (m.params?.uri !== VIEW_URI)
            return out({ id: m.id, error: { code: -32002, message: `no resource ${m.params?.uri}` } });
          return out({ id: m.id, result: { contents: [{ uri: VIEW_URI, mimeType: "text/html;profile=mcp-app", text: viewHtml() }] } });
        case "tools/call":
          try {
            return out({ id: m.id, result: await callTool(m.params?.name, m.params?.arguments) });
          } catch (error) {
            return out({ id: m.id, result: { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true } });
          }
        default:
          return out({ id: m.id, error: { code: -32601, message: `no method ${m.method}` } });
      }
    } catch (error) {
      out({ id: m.id, error: { code: -32603, message: error instanceof Error ? error.message : String(error) } });
    }
  });
}
serveMcp();
export {
  serveMcp
};
