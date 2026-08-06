#!/usr/bin/env node
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// cli/index.ts
var import_path10 = __toESM(require("path"));

// electron/services/paths.ts
var import_fs = __toESM(require("fs"));
var import_path = __toESM(require("path"));
var import_os = __toESM(require("os"));
function expandHome(p) {
  const home = import_os.default.homedir();
  if (p === "~") return home;
  if (p.startsWith("~/") || p.startsWith("~\\")) return import_path.default.join(home, p.slice(2));
  return p;
}
function splitPathList(raw) {
  return (raw || "").split(",").map((p) => expandHome(p.trim())).filter((p) => p.length > 0);
}
function candidateRoots() {
  const roots = [];
  const home = import_os.default.homedir();
  roots.push(...splitPathList(process.env.CLAUDE_CONFIG_DIR));
  roots.push(import_path.default.join(home, ".claude"));
  try {
    const siblings = import_fs.default.readdirSync(home, { withFileTypes: true }).filter(
      (e) => (e.isDirectory() || e.isSymbolicLink()) && e.name.startsWith(".claude") && e.name !== ".claude"
    ).map((e) => import_path.default.join(home, e.name)).sort();
    roots.push(...siblings);
  } catch {
  }
  roots.push(import_path.default.join(home, ".config", "claude"));
  return roots;
}
function detectProjectDirs(extra = []) {
  const seen = /* @__PURE__ */ new Set();
  const dirs = [];
  for (const raw of [...extra, ...candidateRoots()]) {
    if (!raw) continue;
    const root = expandHome(raw.trim());
    if (!root) continue;
    const p = import_path.default.resolve(
      root.endsWith("projects") ? root : import_path.default.join(root, "projects")
    );
    if (seen.has(p)) continue;
    seen.add(p);
    try {
      if (import_fs.default.statSync(p).isDirectory()) dirs.push(p);
    } catch {
    }
  }
  return dirs;
}

// electron/services/config.ts
var import_fs2 = __toESM(require("fs"));
var import_path2 = __toESM(require("path"));
var import_os2 = __toESM(require("os"));
var CONFIG_PATH = import_path2.default.join(import_os2.default.homedir(), ".config", "ccmon", "config.json");
function loadConfig() {
  try {
    return JSON.parse(import_fs2.default.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

// electron/services/settings.ts
var import_fs3 = __toESM(require("fs"));
var import_path3 = __toESM(require("path"));
var DEFAULTS = {
  theme: "dracula",
  costMode: "auto",
  //        auto | calculate | display
  timezone: "",
  //            '' = system zone; else an IANA name
  pricingOffline: false,
  //   true → never hit the network for pricing
  startOfWeek: "monday",
  //   weeks start monday — the sunday option is retired
  tokenLimit: "max",
  //       'max' | tokens-per-block number | null (off)
  blockHours: null,
  //        null = 5h, Anthropic's real billing window
  compactNumbers: true,
  privacyMode: false,
  //      true = blank every money figure (display only)
  currency: "USD",
  //         display currency (ISO code) — internals stay USD
  sources: null,
  //           null (primary account) | array of project dirs
  notifyNearCap: false,
  //    opt-in OS notifications when an account nears a cap
  closeToTray: false,
  //      opt-in: close hides to tray instead of quitting
  aiModel: "claude-sonnet-4-6",
  // advisor model (reuses the Claude Code login)
  accountWrapperPrefs: {}
  // per-root shell-wrapper rename/untrack overrides
};
var Settings = class {
  file;
  data;
  constructor(file) {
    this.file = file;
    this.data = { ...DEFAULTS, ...this.read(), startOfWeek: "monday" };
  }
  read() {
    try {
      return JSON.parse(import_fs3.default.readFileSync(this.file, "utf8"));
    } catch {
      return {};
    }
  }
  get() {
    return { ...this.data };
  }
  patch(partial) {
    this.data = { ...this.data, ...partial };
    try {
      import_fs3.default.mkdirSync(import_path3.default.dirname(this.file), { recursive: true });
      import_fs3.default.writeFileSync(this.file, JSON.stringify(this.data, null, 2), { mode: 384 });
    } catch {
    }
    return this.get();
  }
};

// electron/services/pricing.ts
var import_fs4 = __toESM(require("fs"));
var import_path5 = __toESM(require("path"));

// electron/services/data/litellm-claude.json
var litellm_claude_default = {
  "anthropic.claude-3-5-haiku-20241022-v1:0": {
    cache_creation_input_token_cost: 1e-6,
    cache_read_input_token_cost: 8e-8,
    input_cost_per_token: 8e-7,
    max_input_tokens: 2e5,
    output_cost_per_token: 4e-6
  },
  "anthropic.claude-3-5-sonnet-20240620-v1:0": {
    cache_creation_input_token_cost: 375e-8,
    cache_creation_input_token_cost_above_200k_tokens: 75e-7,
    cache_read_input_token_cost: 3e-7,
    cache_read_input_token_cost_above_200k_tokens: 6e-7,
    input_cost_per_token: 3e-6,
    input_cost_per_token_above_200k_tokens: 6e-6,
    max_input_tokens: 1e6,
    output_cost_per_token: 15e-6,
    output_cost_per_token_above_200k_tokens: 3e-5
  },
  "anthropic.claude-3-5-sonnet-20241022-v2:0": {
    cache_creation_input_token_cost: 375e-8,
    cache_creation_input_token_cost_above_200k_tokens: 75e-7,
    cache_read_input_token_cost: 3e-7,
    cache_read_input_token_cost_above_200k_tokens: 6e-7,
    input_cost_per_token: 3e-6,
    input_cost_per_token_above_200k_tokens: 6e-6,
    max_input_tokens: 1e6,
    output_cost_per_token: 15e-6,
    output_cost_per_token_above_200k_tokens: 3e-5
  },
  "anthropic.claude-3-7-sonnet-20240620-v1:0": {
    cache_creation_input_token_cost: 45e-7,
    cache_read_input_token_cost: 36e-8,
    input_cost_per_token: 36e-7,
    max_input_tokens: 2e5,
    output_cost_per_token: 18e-6
  },
  "anthropic.claude-3-7-sonnet-20250219-v1:0": {
    cache_creation_input_token_cost: 375e-8,
    cache_read_input_token_cost: 3e-7,
    input_cost_per_token: 3e-6,
    max_input_tokens: 2e5,
    output_cost_per_token: 15e-6
  },
  "anthropic.claude-3-haiku-20240307-v1:0": {
    cache_creation_input_token_cost: 3125e-10,
    cache_read_input_token_cost: 25e-9,
    input_cost_per_token: 25e-8,
    max_input_tokens: 2e5,
    output_cost_per_token: 125e-8
  },
  "anthropic.claude-3-opus-20240229-v1:0": {
    cache_creation_input_token_cost: 1875e-8,
    cache_read_input_token_cost: 15e-7,
    input_cost_per_token: 15e-6,
    max_input_tokens: 2e5,
    output_cost_per_token: 75e-6
  },
  "anthropic.claude-3-sonnet-20240229-v1:0": {
    cache_creation_input_token_cost: 375e-8,
    cache_read_input_token_cost: 3e-7,
    input_cost_per_token: 3e-6,
    max_input_tokens: 2e5,
    output_cost_per_token: 15e-6
  },
  "anthropic.claude-fable-5": {
    cache_creation_input_token_cost: 125e-7,
    cache_read_input_token_cost: 1e-6,
    input_cost_per_token: 1e-5,
    max_input_tokens: 1e6,
    output_cost_per_token: 5e-5
  },
  "anthropic.claude-haiku-4-5-20251001-v1:0": {
    cache_creation_input_token_cost: 125e-8,
    cache_read_input_token_cost: 1e-7,
    input_cost_per_token: 1e-6,
    max_input_tokens: 2e5,
    output_cost_per_token: 5e-6
  },
  "anthropic.claude-haiku-4-5@20251001": {
    cache_creation_input_token_cost: 125e-8,
    cache_read_input_token_cost: 1e-7,
    input_cost_per_token: 1e-6,
    max_input_tokens: 2e5,
    output_cost_per_token: 5e-6
  },
  "anthropic.claude-instant-v1": {
    input_cost_per_token: 8e-7,
    max_input_tokens: 1e5,
    output_cost_per_token: 24e-7
  },
  "anthropic.claude-mythos-preview": {
    input_cost_per_token: 0,
    max_input_tokens: 1e6,
    output_cost_per_token: 0
  },
  "anthropic.claude-opus-4-1-20250805-v1:0": {
    cache_creation_input_token_cost: 1875e-8,
    cache_read_input_token_cost: 15e-7,
    input_cost_per_token: 15e-6,
    max_input_tokens: 2e5,
    output_cost_per_token: 75e-6
  },
  "anthropic.claude-opus-4-20250514-v1:0": {
    cache_creation_input_token_cost: 1875e-8,
    cache_read_input_token_cost: 15e-7,
    input_cost_per_token: 15e-6,
    max_input_tokens: 2e5,
    output_cost_per_token: 75e-6
  },
  "anthropic.claude-opus-4-5-20251101-v1:0": {
    cache_creation_input_token_cost: 625e-8,
    cache_read_input_token_cost: 5e-7,
    input_cost_per_token: 5e-6,
    max_input_tokens: 2e5,
    output_cost_per_token: 25e-6
  },
  "anthropic.claude-opus-4-6-v1": {
    cache_creation_input_token_cost: 625e-8,
    cache_read_input_token_cost: 5e-7,
    input_cost_per_token: 5e-6,
    max_input_tokens: 1e6,
    output_cost_per_token: 25e-6
  },
  "anthropic.claude-opus-4-7": {
    cache_creation_input_token_cost: 625e-8,
    cache_read_input_token_cost: 5e-7,
    input_cost_per_token: 5e-6,
    max_input_tokens: 1e6,
    output_cost_per_token: 25e-6
  },
  "anthropic.claude-opus-4-8": {
    cache_creation_input_token_cost: 625e-8,
    cache_read_input_token_cost: 5e-7,
    input_cost_per_token: 5e-6,
    max_input_tokens: 1e6,
    output_cost_per_token: 25e-6
  },
  "anthropic.claude-opus-5": {
    cache_creation_input_token_cost: 625e-8,
    cache_read_input_token_cost: 5e-7,
    input_cost_per_token: 5e-6,
    max_input_tokens: 1e6,
    output_cost_per_token: 25e-6
  },
  "anthropic.claude-sonnet-4-20250514-v1:0": {
    cache_creation_input_token_cost: 375e-8,
    cache_creation_input_token_cost_above_200k_tokens: 75e-7,
    cache_read_input_token_cost: 3e-7,
    cache_read_input_token_cost_above_200k_tokens: 6e-7,
    input_cost_per_token: 3e-6,
    input_cost_per_token_above_200k_tokens: 6e-6,
    max_input_tokens: 1e6,
    output_cost_per_token: 15e-6,
    output_cost_per_token_above_200k_tokens: 225e-7
  },
  "anthropic.claude-sonnet-4-5-20250929-v1:0": {
    cache_creation_input_token_cost: 375e-8,
    cache_creation_input_token_cost_above_200k_tokens: 75e-7,
    cache_read_input_token_cost: 3e-7,
    cache_read_input_token_cost_above_200k_tokens: 6e-7,
    input_cost_per_token: 3e-6,
    input_cost_per_token_above_200k_tokens: 6e-6,
    max_input_tokens: 2e5,
    output_cost_per_token: 15e-6,
    output_cost_per_token_above_200k_tokens: 225e-7
  },
  "anthropic.claude-sonnet-4-6": {
    cache_creation_input_token_cost: 375e-8,
    cache_read_input_token_cost: 3e-7,
    input_cost_per_token: 3e-6,
    max_input_tokens: 1e6,
    output_cost_per_token: 15e-6
  },
  "anthropic.claude-sonnet-5": {
    cache_creation_input_token_cost: 25e-7,
    cache_read_input_token_cost: 2e-7,
    input_cost_per_token: 2e-6,
    max_input_tokens: 1e6,
    output_cost_per_token: 1e-5
  },
  "anthropic.claude-v1": {
    input_cost_per_token: 8e-6,
    max_input_tokens: 1e5,
    output_cost_per_token: 24e-6
  },
  "anthropic.claude-v2:1": {
    input_cost_per_token: 8e-6,
    max_input_tokens: 1e5,
    output_cost_per_token: 24e-6
  },
  "claude-3-7-sonnet-20250219": {
    cache_creation_input_token_cost: 375e-8,
    cache_read_input_token_cost: 3e-7,
    input_cost_per_token: 3e-6,
    max_input_tokens: 2e5,
    output_cost_per_token: 15e-6
  },
  "claude-3-haiku-20240307": {
    cache_creation_input_token_cost: 3e-7,
    cache_read_input_token_cost: 3e-8,
    input_cost_per_token: 25e-8,
    max_input_tokens: 2e5,
    output_cost_per_token: 125e-8
  },
  "claude-3-opus-20240229": {
    cache_creation_input_token_cost: 1875e-8,
    cache_read_input_token_cost: 15e-7,
    input_cost_per_token: 15e-6,
    max_input_tokens: 2e5,
    output_cost_per_token: 75e-6
  },
  "claude-4-opus-20250514": {
    cache_creation_input_token_cost: 1875e-8,
    cache_read_input_token_cost: 15e-7,
    input_cost_per_token: 15e-6,
    max_input_tokens: 2e5,
    output_cost_per_token: 75e-6
  },
  "claude-4-sonnet-20250514": {
    cache_creation_input_token_cost: 375e-8,
    cache_creation_input_token_cost_above_200k_tokens: 75e-7,
    cache_read_input_token_cost: 3e-7,
    cache_read_input_token_cost_above_200k_tokens: 6e-7,
    input_cost_per_token: 3e-6,
    input_cost_per_token_above_200k_tokens: 6e-6,
    max_input_tokens: 1e6,
    output_cost_per_token: 15e-6,
    output_cost_per_token_above_200k_tokens: 225e-7
  },
  "claude-fable-5": {
    cache_creation_input_token_cost: 125e-7,
    cache_read_input_token_cost: 1e-6,
    input_cost_per_token: 1e-5,
    max_input_tokens: 1e6,
    output_cost_per_token: 5e-5,
    provider_specific_entry: {
      us: 1.1
    }
  },
  "claude-haiku-4-5": {
    cache_creation_input_token_cost: 125e-8,
    cache_read_input_token_cost: 1e-7,
    input_cost_per_token: 1e-6,
    max_input_tokens: 2e5,
    output_cost_per_token: 5e-6
  },
  "claude-haiku-4-5-20251001": {
    cache_creation_input_token_cost: 125e-8,
    cache_read_input_token_cost: 1e-7,
    input_cost_per_token: 1e-6,
    max_input_tokens: 2e5,
    output_cost_per_token: 5e-6
  },
  "claude-opus-4-1": {
    cache_creation_input_token_cost: 1875e-8,
    cache_read_input_token_cost: 15e-7,
    input_cost_per_token: 15e-6,
    max_input_tokens: 2e5,
    output_cost_per_token: 75e-6
  },
  "claude-opus-4-1-20250805": {
    cache_creation_input_token_cost: 1875e-8,
    cache_read_input_token_cost: 15e-7,
    input_cost_per_token: 15e-6,
    max_input_tokens: 2e5,
    output_cost_per_token: 75e-6
  },
  "claude-opus-4-20250514": {
    cache_creation_input_token_cost: 1875e-8,
    cache_read_input_token_cost: 15e-7,
    input_cost_per_token: 15e-6,
    max_input_tokens: 2e5,
    output_cost_per_token: 75e-6
  },
  "claude-opus-4-5": {
    cache_creation_input_token_cost: 625e-8,
    cache_read_input_token_cost: 5e-7,
    input_cost_per_token: 5e-6,
    max_input_tokens: 2e5,
    output_cost_per_token: 25e-6
  },
  "claude-opus-4-5-20251101": {
    cache_creation_input_token_cost: 625e-8,
    cache_read_input_token_cost: 5e-7,
    input_cost_per_token: 5e-6,
    max_input_tokens: 2e5,
    output_cost_per_token: 25e-6
  },
  "claude-opus-4-6": {
    cache_creation_input_token_cost: 625e-8,
    cache_read_input_token_cost: 5e-7,
    input_cost_per_token: 5e-6,
    max_input_tokens: 1e6,
    output_cost_per_token: 25e-6,
    provider_specific_entry: {
      fast: 6,
      us: 1.1
    }
  },
  "claude-opus-4-6-20260205": {
    cache_creation_input_token_cost: 625e-8,
    cache_read_input_token_cost: 5e-7,
    input_cost_per_token: 5e-6,
    max_input_tokens: 1e6,
    output_cost_per_token: 25e-6,
    provider_specific_entry: {
      fast: 6,
      us: 1.1
    }
  },
  "claude-opus-4-7": {
    cache_creation_input_token_cost: 625e-8,
    cache_read_input_token_cost: 5e-7,
    input_cost_per_token: 5e-6,
    max_input_tokens: 1e6,
    output_cost_per_token: 25e-6,
    provider_specific_entry: {
      fast: 6,
      us: 1.1
    }
  },
  "claude-opus-4-7-20260416": {
    cache_creation_input_token_cost: 625e-8,
    cache_read_input_token_cost: 5e-7,
    input_cost_per_token: 5e-6,
    max_input_tokens: 1e6,
    output_cost_per_token: 25e-6,
    provider_specific_entry: {
      fast: 6,
      us: 1.1
    }
  },
  "claude-opus-4-8": {
    cache_creation_input_token_cost: 625e-8,
    cache_read_input_token_cost: 5e-7,
    input_cost_per_token: 5e-6,
    max_input_tokens: 1e6,
    output_cost_per_token: 25e-6,
    provider_specific_entry: {
      fast: 2,
      us: 1.1
    }
  },
  "claude-opus-5": {
    cache_creation_input_token_cost: 625e-8,
    cache_read_input_token_cost: 5e-7,
    input_cost_per_token: 5e-6,
    max_input_tokens: 1e6,
    output_cost_per_token: 25e-6,
    provider_specific_entry: {
      fast: 2,
      us: 1.1
    }
  },
  "claude-sonnet-4-20250514": {
    cache_creation_input_token_cost: 375e-8,
    cache_creation_input_token_cost_above_200k_tokens: 75e-7,
    cache_read_input_token_cost: 3e-7,
    cache_read_input_token_cost_above_200k_tokens: 6e-7,
    input_cost_per_token: 3e-6,
    input_cost_per_token_above_200k_tokens: 6e-6,
    max_input_tokens: 1e6,
    output_cost_per_token: 15e-6,
    output_cost_per_token_above_200k_tokens: 225e-7
  },
  "claude-sonnet-4-5": {
    cache_creation_input_token_cost: 375e-8,
    cache_creation_input_token_cost_above_200k_tokens: 75e-7,
    cache_read_input_token_cost: 3e-7,
    cache_read_input_token_cost_above_200k_tokens: 6e-7,
    input_cost_per_token: 3e-6,
    input_cost_per_token_above_200k_tokens: 6e-6,
    max_input_tokens: 2e5,
    output_cost_per_token: 15e-6,
    output_cost_per_token_above_200k_tokens: 225e-7
  },
  "claude-sonnet-4-5-20250929": {
    cache_creation_input_token_cost: 375e-8,
    cache_creation_input_token_cost_above_200k_tokens: 75e-7,
    cache_read_input_token_cost: 3e-7,
    cache_read_input_token_cost_above_200k_tokens: 6e-7,
    input_cost_per_token: 3e-6,
    input_cost_per_token_above_200k_tokens: 6e-6,
    max_input_tokens: 2e5,
    output_cost_per_token: 15e-6,
    output_cost_per_token_above_200k_tokens: 225e-7
  },
  "claude-sonnet-4-5-20250929-v1:0": {
    cache_creation_input_token_cost: 375e-8,
    cache_creation_input_token_cost_above_200k_tokens: 75e-7,
    cache_read_input_token_cost: 3e-7,
    cache_read_input_token_cost_above_200k_tokens: 6e-7,
    input_cost_per_token: 3e-6,
    input_cost_per_token_above_200k_tokens: 6e-6,
    max_input_tokens: 2e5,
    output_cost_per_token: 15e-6,
    output_cost_per_token_above_200k_tokens: 225e-7
  },
  "claude-sonnet-4-6": {
    cache_creation_input_token_cost: 375e-8,
    cache_read_input_token_cost: 3e-7,
    input_cost_per_token: 3e-6,
    max_input_tokens: 1e6,
    output_cost_per_token: 15e-6
  },
  "claude-sonnet-5": {
    cache_creation_input_token_cost: 25e-7,
    cache_read_input_token_cost: 2e-7,
    input_cost_per_token: 2e-6,
    max_input_tokens: 1e6,
    output_cost_per_token: 1e-5,
    provider_specific_entry: {
      us: 1.1
    }
  }
};

// electron/services/data/litellm-deepseek.json
var litellm_deepseek_default = {
  "deepseek-v4-flash": {
    cache_creation_input_token_cost: 14e-8,
    cache_read_input_token_cost: 28e-10,
    input_cost_per_token: 14e-8,
    max_input_tokens: 1e6,
    output_cost_per_token: 28e-8
  },
  "deepseek-v4-pro": {
    cache_creation_input_token_cost: 435e-9,
    cache_read_input_token_cost: 3625e-12,
    input_cost_per_token: 435e-9,
    max_input_tokens: 1e6,
    output_cost_per_token: 87e-8
  },
  "deepseek.v3-v1:0": {
    input_cost_per_token: 58e-8,
    max_input_tokens: 163840,
    output_cost_per_token: 168e-8
  },
  "deepseek.v3.2": {
    input_cost_per_token: 62e-8,
    max_input_tokens: 163840,
    output_cost_per_token: 185e-8
  },
  "deepseek/deepseek-chat": {
    cache_creation_input_token_cost: 0,
    cache_read_input_token_cost: 28e-9,
    input_cost_per_token: 28e-8,
    max_input_tokens: 131072,
    output_cost_per_token: 42e-8
  },
  "deepseek/deepseek-coder": {
    input_cost_per_token: 14e-8,
    max_input_tokens: 128e3,
    output_cost_per_token: 28e-8
  },
  "deepseek/deepseek-r1": {
    input_cost_per_token: 55e-8,
    max_input_tokens: 65536,
    output_cost_per_token: 219e-8
  },
  "deepseek/deepseek-reasoner": {
    cache_read_input_token_cost: 28e-9,
    input_cost_per_token: 28e-8,
    max_input_tokens: 131072,
    output_cost_per_token: 42e-8
  },
  "deepseek/deepseek-v3": {
    cache_creation_input_token_cost: 0,
    cache_read_input_token_cost: 7e-8,
    input_cost_per_token: 27e-8,
    max_input_tokens: 65536,
    output_cost_per_token: 11e-7
  },
  "deepseek/deepseek-v3.2": {
    input_cost_per_token: 28e-8,
    max_input_tokens: 163840,
    output_cost_per_token: 4e-7
  },
  "deepseek/deepseek-v4-flash": {
    cache_creation_input_token_cost: 0,
    cache_read_input_token_cost: 28e-10,
    input_cost_per_token: 14e-8,
    max_input_tokens: 1e6,
    output_cost_per_token: 28e-8
  },
  "deepseek/deepseek-v4-pro": {
    cache_creation_input_token_cost: 0,
    cache_read_input_token_cost: 3625e-12,
    input_cost_per_token: 435e-9,
    max_input_tokens: 1e6,
    output_cost_per_token: 87e-8
  }
};

// electron/services/data/modelsdev-anthropic.json
var modelsdev_anthropic_default = {
  "claude-3-5-haiku-20241022": {
    cost: {
      cache_read: 0.08,
      cache_write: 1,
      input: 0.8,
      output: 4
    },
    limit: {
      context: 2e5,
      output: 8192
    }
  },
  "claude-3-5-haiku-latest": {
    cost: {
      cache_read: 0.08,
      cache_write: 1,
      input: 0.8,
      output: 4
    },
    limit: {
      context: 2e5,
      output: 8192
    }
  },
  "claude-3-5-sonnet-20240620": {
    cost: {
      cache_read: 0.3,
      cache_write: 3.75,
      input: 3,
      output: 15
    },
    limit: {
      context: 2e5,
      output: 8192
    }
  },
  "claude-3-5-sonnet-20241022": {
    cost: {
      cache_read: 0.3,
      cache_write: 3.75,
      input: 3,
      output: 15
    },
    limit: {
      context: 2e5,
      output: 8192
    }
  },
  "claude-3-7-sonnet-20250219": {
    cost: {
      cache_read: 0.3,
      cache_write: 3.75,
      input: 3,
      output: 15
    },
    limit: {
      context: 2e5,
      output: 64e3
    }
  },
  "claude-3-haiku-20240307": {
    cost: {
      cache_read: 0.03,
      cache_write: 0.3,
      input: 0.25,
      output: 1.25
    },
    limit: {
      context: 2e5,
      output: 4096
    }
  },
  "claude-3-opus-20240229": {
    cost: {
      cache_read: 1.5,
      cache_write: 18.75,
      input: 15,
      output: 75
    },
    limit: {
      context: 2e5,
      output: 4096
    }
  },
  "claude-3-sonnet-20240229": {
    cost: {
      cache_read: 0.3,
      cache_write: 0.3,
      input: 3,
      output: 15
    },
    limit: {
      context: 2e5,
      output: 4096
    }
  },
  "claude-fable-5": {
    cost: {
      cache_read: 1,
      cache_write: 12.5,
      input: 10,
      output: 50
    },
    limit: {
      context: 1e6,
      output: 128e3
    }
  },
  "claude-haiku-4-5": {
    cost: {
      cache_read: 0.1,
      cache_write: 1.25,
      input: 1,
      output: 5
    },
    limit: {
      context: 2e5,
      output: 64e3
    }
  },
  "claude-haiku-4-5-20251001": {
    cost: {
      cache_read: 0.1,
      cache_write: 1.25,
      input: 1,
      output: 5
    },
    limit: {
      context: 2e5,
      output: 64e3
    }
  },
  "claude-opus-4-0": {
    cost: {
      cache_read: 1.5,
      cache_write: 18.75,
      input: 15,
      output: 75
    },
    limit: {
      context: 2e5,
      output: 32e3
    }
  },
  "claude-opus-4-1": {
    cost: {
      cache_read: 1.5,
      cache_write: 18.75,
      input: 15,
      output: 75
    },
    limit: {
      context: 2e5,
      output: 32e3
    }
  },
  "claude-opus-4-1-20250805": {
    cost: {
      cache_read: 1.5,
      cache_write: 18.75,
      input: 15,
      output: 75
    },
    limit: {
      context: 2e5,
      output: 32e3
    }
  },
  "claude-opus-4-20250514": {
    cost: {
      cache_read: 1.5,
      cache_write: 18.75,
      input: 15,
      output: 75
    },
    limit: {
      context: 2e5,
      output: 32e3
    }
  },
  "claude-opus-4-5": {
    cost: {
      cache_read: 0.5,
      cache_write: 6.25,
      input: 5,
      output: 25
    },
    limit: {
      context: 2e5,
      output: 64e3
    }
  },
  "claude-opus-4-5-20251101": {
    cost: {
      cache_read: 0.5,
      cache_write: 6.25,
      input: 5,
      output: 25
    },
    limit: {
      context: 2e5,
      output: 64e3
    }
  },
  "claude-opus-4-6": {
    cost: {
      cache_read: 0.5,
      cache_write: 6.25,
      input: 5,
      output: 25
    },
    limit: {
      context: 1e6,
      output: 128e3
    }
  },
  "claude-opus-4-7": {
    cost: {
      cache_read: 0.5,
      cache_write: 6.25,
      input: 5,
      output: 25
    },
    limit: {
      context: 1e6,
      output: 128e3
    }
  },
  "claude-opus-4-8": {
    cost: {
      cache_read: 0.5,
      cache_write: 6.25,
      input: 5,
      output: 25
    },
    limit: {
      context: 1e6,
      output: 128e3
    }
  },
  "claude-opus-5": {
    cost: {
      cache_read: 0.5,
      cache_write: 6.25,
      input: 5,
      output: 25
    },
    limit: {
      context: 1e6,
      output: 128e3
    }
  },
  "claude-sonnet-4-0": {
    cost: {
      cache_read: 0.3,
      cache_write: 3.75,
      input: 3,
      output: 15
    },
    limit: {
      context: 2e5,
      output: 64e3
    }
  },
  "claude-sonnet-4-20250514": {
    cost: {
      cache_read: 0.3,
      cache_write: 3.75,
      input: 3,
      output: 15
    },
    limit: {
      context: 2e5,
      output: 64e3
    }
  },
  "claude-sonnet-4-5": {
    cost: {
      cache_read: 0.3,
      cache_write: 3.75,
      input: 3,
      output: 15
    },
    limit: {
      context: 1e6,
      output: 64e3
    }
  },
  "claude-sonnet-4-5-20250929": {
    cost: {
      cache_read: 0.3,
      cache_write: 3.75,
      input: 3,
      output: 15
    },
    limit: {
      context: 1e6,
      output: 64e3
    }
  },
  "claude-sonnet-4-6": {
    cost: {
      cache_read: 0.3,
      cache_write: 3.75,
      input: 3,
      output: 15
    },
    limit: {
      context: 1e6,
      output: 128e3
    }
  },
  "claude-sonnet-5": {
    cost: {
      cache_read: 0.2,
      cache_write: 2.5,
      input: 2,
      output: 10
    },
    limit: {
      context: 1e6,
      output: 128e3
    }
  }
};

// electron/services/data/modelsdev-deepseek.json
var modelsdev_deepseek_default = {
  "deepseek-chat": {
    cost: {
      cache_read: 28e-4,
      input: 0.14,
      output: 0.28
    },
    limit: {
      context: 1e6,
      output: 384e3
    }
  },
  "deepseek-reasoner": {
    cost: {
      cache_read: 28e-4,
      input: 0.14,
      output: 0.28
    },
    limit: {
      context: 1e6,
      output: 384e3
    }
  },
  "deepseek-v4-flash": {
    cost: {
      cache_read: 28e-4,
      input: 0.14,
      output: 0.28
    },
    limit: {
      context: 1e6,
      output: 384e3
    }
  },
  "deepseek-v4-pro": {
    cost: {
      cache_read: 3625e-6,
      input: 0.435,
      output: 0.87
    },
    limit: {
      context: 1e6,
      output: 384e3
    }
  }
};

// electron/services/parser.ts
var import_path4 = __toESM(require("path"));

// shared/daykey.ts
var pad2 = (n) => String(n).padStart(2, "0");
var MAX_CACHE = 2e5;
var BUCKET_MS = 9e5;
var offsetCache = /* @__PURE__ */ new Map();
var formatters = /* @__PURE__ */ new Map();
function formatterFor(zone) {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
    formatters.set(zone, f);
  }
  return f;
}
function zoneOffsetMs(ts, zone) {
  const bucket = Math.floor(ts / BUCKET_MS);
  const key = `${zone}@${bucket}`;
  const hit = offsetCache.get(key);
  if (hit !== void 0) return hit;
  let offset = 0;
  try {
    const parts = formatterFor(zone).formatToParts(new Date(ts));
    const get = (type) => Number(parts.find((p) => p.type === type)?.value ?? "0");
    const hour = get("hour") % 24;
    const asUtc = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      hour,
      get("minute"),
      get("second")
    );
    offset = asUtc - Math.floor(ts / 1e3) * 1e3;
  } catch {
    offset = 0;
  }
  if (offsetCache.size >= MAX_CACHE) offsetCache.clear();
  offsetCache.set(key, offset);
  return offset;
}
var isSystem = (zone) => !zone;
function shifted(ts, zone) {
  return new Date(ts + zoneOffsetMs(ts, zone));
}
function zonedParts(ts, zone = null) {
  if (isSystem(zone)) {
    const d2 = new Date(ts);
    return {
      year: d2.getFullYear(),
      month: d2.getMonth() + 1,
      day: d2.getDate(),
      hour: d2.getHours(),
      weekday: (d2.getDay() + 6) % 7
    };
  }
  const d = shifted(ts, zone);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    weekday: (d.getUTCDay() + 6) % 7
  };
}
function dayKeyFor(ts, zone = null) {
  if (isSystem(zone)) {
    const d2 = new Date(ts);
    return `${d2.getFullYear()}-${pad2(d2.getMonth() + 1)}-${pad2(d2.getDate())}`;
  }
  const d = shifted(ts, zone);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
function isValidZone(zone) {
  if (!zone) return true;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

// electron/services/parser.ts
var pad22 = (n) => String(n).padStart(2, "0");
var pool = /* @__PURE__ */ new Map();
function intern(s) {
  const hit = pool.get(s);
  if (hit !== void 0) return hit;
  pool.set(s, s);
  return s;
}
function localDateKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad22(d.getMonth() + 1)}-${pad22(d.getDate())}`;
}
function decodeProjectDir(dirName) {
  return dirName.replace(/^-/, "/").replace(/-/g, "/");
}
var USAGE_LIMIT_RE = /Claude AI usage limit reached\|(\d+)/;
var LINE_MARKERS = ["usage", "isApiErrorMessage", "isCompactSummary", "tool_result"];
function mayCarryData(raw) {
  for (const m of LINE_MARKERS) if (raw.includes(m)) return true;
  return false;
}
function contentChars(content) {
  if (typeof content === "string") return content.length;
  if (Array.isArray(content)) {
    let n = 0;
    for (const b of content) {
      if (b && typeof b === "object" && typeof b.text === "string") {
        n += b.text.length;
      } else if (b != null) {
        n += JSON.stringify(b).length;
      }
    }
    return n;
  }
  return 0;
}
function parseLine(raw, file, lineNo, zone = null) {
  if (!mayCarryData(raw)) return null;
  let j;
  try {
    j = JSON.parse(raw);
  } catch {
    return null;
  }
  if (j.isApiErrorMessage) {
    const m = USAGE_LIMIT_RE.exec(raw);
    if (!m) return null;
    const ts2 = Date.parse(j.timestamp ?? "");
    return {
      kind: "reset",
      ts: Number.isFinite(ts2) ? ts2 : null,
      resetTs: Number(m[1]) * 1e3
    };
  }
  if (j.isCompactSummary) {
    const cts = Date.parse(j.timestamp ?? "");
    if (!Number.isFinite(cts)) return null;
    return {
      kind: "compact",
      ts: cts,
      sessionId: intern(j.sessionId || import_path4.default.basename(file, ".jsonl"))
    };
  }
  if (j.type === "user" && Array.isArray(j.message?.content)) {
    let chars = 0;
    for (const b of j.message.content) {
      if (b && b.type === "tool_result") chars += contentChars(b.content);
    }
    if (chars > 0) {
      const tts = Date.parse(j.timestamp ?? "");
      if (Number.isFinite(tts)) {
        return {
          kind: "toolresult",
          ts: tts,
          sessionId: intern(j.sessionId || import_path4.default.basename(file, ".jsonl")),
          chars
        };
      }
    }
  }
  if (j.type !== "assistant" || !j.message || !j.message.usage) return null;
  let model = j.message.model;
  if (!model || model === "<synthetic>") return null;
  const ts = Date.parse(j.timestamp ?? "");
  if (!Number.isFinite(ts)) return null;
  const u = j.message.usage;
  const fast = u.speed === "fast";
  if (fast) model += "-fast";
  const cw = u.cache_creation_input_tokens || 0;
  const cc = u.cache_creation;
  const w1h = cc && cc.ephemeral_1h_input_tokens || 0;
  let w5m = cc ? cc.ephemeral_5m_input_tokens || 0 : cw;
  if (cc && w5m + w1h < cw) w5m = cw - w1h;
  let tools;
  if (Array.isArray(j.message.content)) {
    for (const b of j.message.content) {
      if (b && b.type === "tool_use" && typeof b.name === "string") (tools ??= []).push(b.name);
    }
  }
  const msgId = j.message.id || null;
  return {
    kind: "entry",
    key: msgId && j.requestId ? `${msgId}:${j.requestId}` : msgId ? `m:${msgId}` : `f:${file}#${lineNo}`,
    msgId,
    ts,
    dateKey: intern(dayKeyFor(ts, zone)),
    model: intern(model),
    fast,
    project: intern(j.cwd || decodeProjectDir(import_path4.default.basename(import_path4.default.dirname(file)))),
    sessionId: intern(j.sessionId || import_path4.default.basename(file, ".jsonl")),
    sidechain: !!j.isSidechain,
    in: u.input_tokens || 0,
    out: u.output_tokens || 0,
    read: u.cache_read_input_tokens || 0,
    w5m,
    w1h,
    costUSD: typeof j.costUSD === "number" ? j.costUSD : null,
    tools,
    stop: typeof j.message.stop_reason === "string" ? j.message.stop_reason : null
  };
}

// electron/services/pricing.ts
var LITELLM_URL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
var LITELLM_PREFIXES = ["claude-", "anthropic.", "anthropic/", "deepseek/", "deepseek."];
var LITELLM_FIELDS = [
  "input_cost_per_token",
  "output_cost_per_token",
  "cache_creation_input_token_cost",
  "cache_read_input_token_cost",
  "input_cost_per_token_above_200k_tokens",
  "output_cost_per_token_above_200k_tokens",
  "cache_creation_input_token_cost_above_200k_tokens",
  "cache_read_input_token_cost_above_200k_tokens",
  "max_input_tokens",
  "provider_specific_entry"
];
var CACHE_FILE = "pricing-cache.json";
var CACHE_TTL_MS = 24 * 60 * 60 * 1e3;
var FETCH_TIMEOUT_MS = 1e4;
var TIER_THRESHOLD = 2e5;
var CACHE_1H_MULTIPLIER = 2;
var DEFAULT_FAST_MULTIPLIER = 2;
var DEFAULT_CONTEXT_LIMIT = 2e5;
function readJsonSafe(file) {
  try {
    return JSON.parse(import_fs4.default.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
function compactLitellm(raw) {
  const out = {};
  for (const [key, entry] of Object.entries(raw || {})) {
    if (!LITELLM_PREFIXES.some((p) => key.startsWith(p))) continue;
    if (!entry || typeof entry !== "object") continue;
    const src = entry;
    const row = {};
    for (const f of LITELLM_FIELDS) if (src[f] !== void 0) row[f] = src[f];
    const typed = row;
    if (typed.input_cost_per_token == null && typed.output_cost_per_token == null) continue;
    out[key] = typed;
  }
  return out;
}
async function fetchLitellm() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(LITELLM_URL, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`litellm fetch: HTTP ${res.status}`);
    return compactLitellm(await res.json());
  } finally {
    clearTimeout(timer);
  }
}
function candidates(model) {
  const out = [model];
  const push = (v) => {
    if (!out.includes(v)) out.push(v);
  };
  push(model.replace(/-\d{8}$/, ""));
  const bare = model.replace(/\[[^\]]*\]$/, "");
  push(bare);
  push(bare.replace(/-\d{8}$/, ""));
  return out;
}
function normalizeLitellm(e, source) {
  if (e.input_cost_per_token == null && e.output_cost_per_token == null) return null;
  const input = e.input_cost_per_token || 0;
  const tierInput = e.input_cost_per_token_above_200k_tokens;
  const hasTier = tierInput != null || e.output_cost_per_token_above_200k_tokens != null || e.cache_creation_input_token_cost_above_200k_tokens != null || e.cache_read_input_token_cost_above_200k_tokens != null;
  const ti = tierInput ?? input;
  return {
    source,
    input,
    output: e.output_cost_per_token || 0,
    cacheCreate: e.cache_creation_input_token_cost ?? input * 1.25,
    cacheRead: e.cache_read_input_token_cost ?? input * 0.1,
    cacheCreate1h: null,
    tiered: hasTier ? {
      input: ti,
      output: e.output_cost_per_token_above_200k_tokens ?? e.output_cost_per_token ?? 0,
      cacheCreate: e.cache_creation_input_token_cost_above_200k_tokens ?? ti * 1.25,
      cacheRead: e.cache_read_input_token_cost_above_200k_tokens ?? ti * 0.1
    } : null,
    contextLimit: e.max_input_tokens ?? null,
    fast: e.provider_specific_entry?.fast || null,
    fastApplied: 1
  };
}
function normalizeModelsDev(e) {
  const c = e?.cost;
  if (!c) return null;
  const input = (c.input || 0) / 1e6;
  return {
    source: "modelsdev",
    input,
    output: (c.output || 0) / 1e6,
    cacheCreate: c.cache_write != null ? c.cache_write / 1e6 : input * 1.25,
    cacheRead: c.cache_read != null ? c.cache_read / 1e6 : input * 0.1,
    cacheCreate1h: null,
    tiered: null,
    contextLimit: e.limit?.context || null,
    fast: null,
    fastApplied: 1
  };
}
function overrideRow(rate) {
  const input = (rate.in || 0) / 1e6;
  const output = (rate.out || 0) / 1e6;
  const tier = rate.tier;
  const ti = tier?.in != null ? tier.in / 1e6 : input;
  return {
    source: "override",
    input,
    output,
    cacheCreate: rate.w5m != null ? rate.w5m / 1e6 : input * 1.25,
    cacheRead: rate.read != null ? rate.read / 1e6 : input * 0.1,
    cacheCreate1h: rate.w1h != null ? rate.w1h / 1e6 : null,
    tiered: tier ? {
      input: ti,
      output: tier.out != null ? tier.out / 1e6 : output,
      cacheCreate: tier.w5m != null ? tier.w5m / 1e6 : ti * 1.25,
      cacheRead: tier.read != null ? tier.read / 1e6 : ti * 0.1
    } : null,
    contextLimit: rate.contextLimit ?? null,
    fast: rate.fast || null,
    fastApplied: 1
  };
}
function costWith(row, t) {
  const inTok = t.in || 0;
  const outTok = t.out || 0;
  const read = t.read || 0;
  const w5m = t.w5m || 0;
  const w1h = t.w1h || 0;
  const r = row.tiered && inTok + read + w5m + w1h > TIER_THRESHOLD ? row.tiered : row;
  const w1hRate = row.cacheCreate1h ?? r.input * CACHE_1H_MULTIPLIER;
  return inTok * r.input + outTok * r.output + read * r.cacheRead + w5m * r.cacheCreate + w1h * w1hRate;
}
function applyFast(row, mult) {
  return {
    ...row,
    input: row.input * mult,
    output: row.output * mult,
    cacheCreate: row.cacheCreate * mult,
    cacheRead: row.cacheRead * mult,
    cacheCreate1h: row.cacheCreate1h != null ? row.cacheCreate1h * mult : null,
    tiered: row.tiered && {
      input: row.tiered.input * mult,
      output: row.tiered.output * mult,
      cacheCreate: row.tiered.cacheCreate * mult,
      cacheRead: row.tiered.cacheRead * mult
    },
    fastApplied: mult
  };
}
var PricingEngine = class {
  cacheDir;
  offline;
  overrides = [];
  bundled;
  bundledDeepseek;
  modelsdev;
  modelsdevDeepseek;
  runtime = null;
  archive;
  source = "bundled";
  fetchedAtMs = null;
  resolveMemo = /* @__PURE__ */ new Map();
  dataMemo = /* @__PURE__ */ new Map();
  /** layer index → model → resolved row (archive layers are append-only) */
  archiveMemo = /* @__PURE__ */ new Map();
  unknownModels = /* @__PURE__ */ new Set();
  inflight = null;
  refreshErrorMsg = null;
  constructor({ cacheDir = null, offline = false, overrides = {}, archive = null } = {}) {
    this.cacheDir = cacheDir;
    this.offline = !!offline;
    this.archive = archive;
    for (const [pattern, rate] of Object.entries(overrides || {})) {
      try {
        this.overrides.push({ re: new RegExp(pattern, "i"), row: overrideRow(rate || {}) });
      } catch {
      }
    }
    this.bundled = litellm_claude_default;
    this.bundledDeepseek = litellm_deepseek_default;
    this.modelsdev = modelsdev_anthropic_default;
    this.modelsdevDeepseek = modelsdev_deepseek_default;
    if (cacheDir) {
      const c = readJsonSafe(import_path5.default.join(cacheDir, CACHE_FILE));
      if (c && typeof c.fetchedAt === "number" && c.models && typeof c.models === "object") {
        this.runtime = c.models;
        this.source = "litellm-cache";
        this.fetchedAtMs = c.fetchedAt;
      }
    }
  }
  /** Resolved per-token rate row, or null when no layer knows the model. */
  rates(model) {
    const row = this.resolve(model);
    if (row) this.unknownModels.delete(model);
    else this.unknownModels.add(model);
    return row;
  }
  /**
   * USD for one entry's token counts, or null for unknown models.
   * Formula: in×input + out×output + read×cacheRead + w5m×cacheCreate +
   * w1h×(input×2). When in+read+w5m+w1h > 200k and the model has
   * above-200k rates, the whole entry is priced at those rates.
   */
  cost(model, t) {
    const row = this.rates(model);
    if (!row) return null;
    return costWith(row, t);
  }
  /**
   * Like cost(), but at the rates of the entry's day when the pricing
   * archive has a layer covering it. Overrides still win (they're
   * timeless); models missing from the dated layer fall back to the normal
   * current-rates resolution, as do dates before the first layer.
   */
  costAt(model, t, dateKey) {
    const layer = this.archive?.layerFor(dateKey);
    if (!layer) return this.cost(model, t);
    const row = this.resolveInLayer(model, layer.idx, layer.models) ?? this.rates(model);
    if (!row) return null;
    return costWith(row, t);
  }
  /**
   * `contextLimit` override / max_input_tokens (LiteLLM) / limit.context
   * (models.dev) for the model, or 200000. The `-fast` suffix is ignored —
   * a fast variant has the same window as its base.
   *
   * An override wins here as it does for rates, but ONLY when it sets
   * `contextLimit`: a rates-only override must not shrink a model's window to
   * the default, so it falls through to the data layers.
   */
  contextLimit(model) {
    const base = model.endsWith("-fast") ? model.slice(0, -5) : model;
    const override = this.matchOverride(base)?.contextLimit;
    if (override) return override;
    const row = this.lookupData(base);
    return row?.contextLimit || DEFAULT_CONTEXT_LIMIT;
  }
  /** Models that resolved to null since creation (self-healing on refresh). */
  unknown() {
    return [...this.unknownModels];
  }
  /**
   * { source: 'litellm-live'|'litellm-cache'|'bundled', fetchedAt: ms|null,
   *   modelCount, lastError } — source describes the freshest LiteLLM layer
   * in use; modelCount is the distinct keys across all data layers;
   * lastError is the verbose reason the most recent refresh failed (null
   * after a success).
   */
  meta() {
    const keys = /* @__PURE__ */ new Set([
      ...Object.keys(this.bundled),
      ...Object.keys(this.bundledDeepseek),
      ...this.runtime ? Object.keys(this.runtime) : [],
      ...Object.keys(this.modelsdev),
      ...Object.keys(this.modelsdevDeepseek)
    ]);
    return {
      source: this.source,
      fetchedAt: this.fetchedAtMs,
      modelCount: keys.size,
      lastError: this.refreshErrorMsg
    };
  }
  /**
   * Force a LiteLLM refetch (ignores `offline`). Always resolves with
   * meta() — on failure the previous layer stays active and the verbose
   * reason lands in meta().lastError. Concurrent calls share one in-flight
   * fetch.
   */
  refresh() {
    if (!this.inflight) {
      this.inflight = fetchLitellm().then((models) => {
        this.applyFetched(models);
        this.refreshErrorMsg = null;
      }).catch((err) => {
        const e = err;
        this.refreshErrorMsg = e.name === "AbortError" ? `timeout after ${FETCH_TIMEOUT_MS / 1e3}s fetching the LiteLLM catalog` : `${e.name}: ${e.message || "fetch failed"}`;
        console.warn("[ccmon] pricing refresh failed:", this.refreshErrorMsg);
      }).finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight.then(() => this.meta());
  }
  applyFetched(models) {
    this.runtime = models;
    this.source = "litellm-live";
    this.fetchedAtMs = Date.now();
    this.resolveMemo.clear();
    this.dataMemo.clear();
    if (this.archive?.record(localDateKey(this.fetchedAtMs), models)) this.archiveMemo.clear();
    if (!this.cacheDir) return;
    try {
      import_fs4.default.mkdirSync(this.cacheDir, { recursive: true });
      import_fs4.default.writeFileSync(
        import_path5.default.join(this.cacheDir, CACHE_FILE),
        JSON.stringify({ fetchedAt: this.fetchedAtMs, models })
      );
    } catch {
    }
  }
  /**
   * Override lookup for one model name; first match wins (insertion order).
   *
   * A `-fast` variant resolves against the BASE name and then takes the
   * multiplier, mirroring the data path — otherwise an overridden model's fast
   * turns would silently bill at the base rate. Set `fast: 1` on the override
   * to price a fast variant absolutely instead.
   */
  matchOverride(model) {
    const isFast = model.endsWith("-fast");
    const name = isFast ? model.slice(0, -5) : model;
    for (const o of this.overrides) {
      if (!o.re.test(name)) continue;
      return isFast ? applyFast(o.row, o.row.fast || DEFAULT_FAST_MULTIPLIER) : o.row;
    }
    return null;
  }
  /** Full resolution: overrides → `-fast` base × multiplier → data layers. */
  resolve(model) {
    const memo = this.resolveMemo.get(model);
    if (memo !== void 0) return memo;
    let row = this.matchOverride(model);
    if (!row) {
      if (model.endsWith("-fast")) {
        const base = this.resolve(model.slice(0, -5));
        row = base ? applyFast(base, base.fast || DEFAULT_FAST_MULTIPLIER) : null;
      } else {
        row = this.lookupData(model);
      }
    }
    this.resolveMemo.set(model, row);
    return row;
  }
  /**
   * Resolution against one dated archive layer: overrides → `-fast` base ×
   * multiplier → the layer's catalog only. Returns null on a layer miss so
   * costAt can fall back to the normal current-rates path.
   */
  resolveInLayer(model, layerIdx, models) {
    let memo = this.archiveMemo.get(layerIdx);
    if (!memo) this.archiveMemo.set(layerIdx, memo = /* @__PURE__ */ new Map());
    const hit = memo.get(model);
    if (hit !== void 0) return hit;
    let row = this.matchOverride(model);
    if (!row) {
      if (model.endsWith("-fast")) {
        const base = this.resolveInLayer(model.slice(0, -5), layerIdx, models);
        row = base ? applyFast(base, base.fast || DEFAULT_FAST_MULTIPLIER) : null;
      } else {
        for (const key of candidates(model)) {
          if (!Object.prototype.hasOwnProperty.call(models, key)) continue;
          row = normalizeLitellm(models[key], `archive:${layerIdx}`);
          if (row) break;
        }
      }
    }
    memo.set(model, row);
    return row;
  }
  /** Data layers in order, all key candidates per layer before moving on. */
  lookupData(model) {
    const memo = this.dataMemo.get(model);
    if (memo !== void 0) return memo;
    const layers = [
      { models: this.bundled, litellm: true, source: "litellm-bundled" },
      { models: this.bundledDeepseek, litellm: true, source: "litellm-bundled-deepseek" },
      { models: this.runtime, litellm: true, source: this.source },
      { models: this.modelsdev, litellm: false, source: "modelsdev" },
      { models: this.modelsdevDeepseek, litellm: false, source: "modelsdev-deepseek" }
    ];
    let row = null;
    for (const layer of layers) {
      if (!layer.models) continue;
      const keys = candidates(model);
      if (layer.litellm) {
        const bare = model.replace(/\[[^\]]*\]$/, "");
        if (bare.startsWith("deepseek-")) {
          keys.push("deepseek/" + bare, "deepseek/" + bare.replace(/-\d{8}$/, ""));
        }
      }
      for (const key of keys) {
        if (!Object.prototype.hasOwnProperty.call(layer.models, key)) continue;
        row = layer.litellm ? normalizeLitellm(layer.models[key], layer.source) : normalizeModelsDev(layer.models[key]);
        if (row) break;
      }
      if (row) break;
    }
    this.dataMemo.set(model, row);
    return row;
  }
};
async function createPricingEngine(opts = {}) {
  const engine = new PricingEngine(opts);
  const fetchedAt = engine.meta().fetchedAt;
  const stale = fetchedAt == null || Date.now() - fetchedAt >= CACHE_TTL_MS;
  if (!engine.offline && stale) void engine.refresh();
  return engine;
}
function costForMode(entry, mode, engine) {
  if (mode === "display") return entry.costUSD ?? 0;
  if (mode === "calculate") return engine.costAt(entry.model, entry, entry.dateKey) ?? 0;
  return entry.costUSD ?? engine.costAt(entry.model, entry, entry.dateKey) ?? 0;
}

// electron/services/pricing-archive.ts
var import_fs5 = __toESM(require("fs"));
var import_path6 = __toESM(require("path"));
var ARCHIVE_FILE = "pricing-archive.json";
var PricingArchive = class {
  file;
  layers = [];
  constructor(cacheDir) {
    this.file = import_path6.default.join(cacheDir, ARCHIVE_FILE);
    try {
      const raw = JSON.parse(import_fs5.default.readFileSync(this.file, "utf8"));
      if (Array.isArray(raw?.layers)) {
        this.layers = raw.layers.filter(
          (l) => l && typeof l.since === "string" && l.models && typeof l.models === "object"
        );
        this.layers.sort((a, b) => a.since < b.since ? -1 : 1);
      }
    } catch {
    }
  }
  /**
   * Record today's catalog. Appends a layer (or updates today's) only when
   * the table differs from the newest layer. Returns true when changed.
   */
  record(dateKey, models) {
    const last = this.layers[this.layers.length - 1];
    if (last && JSON.stringify(last.models) === JSON.stringify(models)) return false;
    if (last && last.since === dateKey) last.models = models;
    else this.layers.push({ since: dateKey, models });
    try {
      import_fs5.default.mkdirSync(import_path6.default.dirname(this.file), { recursive: true });
      import_fs5.default.writeFileSync(this.file, JSON.stringify({ layers: this.layers }));
    } catch {
    }
    return true;
  }
  /** Newest layer with since ≤ dateKey, or null (date precedes all knowledge). */
  layerFor(dateKey) {
    for (let i = this.layers.length - 1; i >= 0; i--) {
      if (this.layers[i].since <= dateKey) return { idx: i, models: this.layers[i].models };
    }
    return null;
  }
  get size() {
    return this.layers.length;
  }
};

// electron/services/watcher.ts
var import_fs6 = __toESM(require("fs"));
var import_path7 = __toESM(require("path"));
var import_events = require("events");
var import_string_decoder = require("string_decoder");
var import_chokidar = __toESM(require("chokidar"));

// electron/services/adapters/claude.ts
var claudeAdapter = {
  id: "claude",
  label: "Claude Code",
  detectRoots(extra = []) {
    return detectProjectDirs(extra);
  },
  // Every .jsonl under a projects/ root is a transcript. The tree is not flat —
  // subagent and workflow transcripts nest several levels deep and all carry
  // billable usage — so this stays a suffix test rather than a depth rule.
  owns(file) {
    return file.endsWith(".jsonl");
  },
  parseLine(raw, file, lineNo, zone) {
    return parseLine(raw, file, lineNo, zone);
  }
};

// electron/services/watcher.ts
var fsp = import_fs6.default.promises;
var CHUNK = 1 << 20;
var SCAN_CONCURRENCY = 8;
var MAX_TREE_DEPTH = 8;
var WATCH_HORIZON_MS = 7 * 24 * 3600 * 1e3;
var UsageWatcher = class extends import_events.EventEmitter {
  /** roots paired with the adapter that understands each one */
  roots;
  /** the root paths alone — what main, the CLI and parity already speak */
  dirs;
  watchEnabled;
  offsets = /* @__PURE__ */ new Map();
  //    file → bytes consumed
  remainders = /* @__PURE__ */ new Map();
  // file → trailing partial line
  lineNos = /* @__PURE__ */ new Map();
  //    file → lines consumed (fallback keys)
  fileSource = /* @__PURE__ */ new Map();
  // file → owning root dir
  byKey = /* @__PURE__ */ new Map();
  //  dedupe key → stored entry
  byMsg = /* @__PURE__ */ new Map();
  // messageId → stored entries
  /** latest "usage limit reached" reset time (ms) */
  resetTs = null;
  /** context-compaction markers (isCompactSummary lines), source-stamped */
  compactions = [];
  /**
   * tool_result volume folded into source root → local day → {count, chars} on
   * arrival (never billed). Replaces a per-marker array that grew to tens of
   * thousands of objects; the snapshot only needs counts/chars per day window.
   */
  toolResultBuckets = /* @__PURE__ */ new Map();
  /** running marker total — a cheap change signal for scopedData's memo key */
  toolResultCount = 0;
  busy = /* @__PURE__ */ new Map();
  // file → tail promise chain
  watchers = [];
  rescanning = false;
  /** mtime floor for discovery; null = index everything (see the option doc) */
  sinceMs;
  /** day-bucketing zone handed to the parser; null = system */
  timezone;
  constructor({ dirs, watch = true, sinceMs = null, timezone = null }) {
    super();
    this.roots = dirs.map(
      (d) => typeof d === "string" ? { dir: d, adapter: claudeAdapter } : d
    );
    this.dirs = this.roots.map((r) => r.dir);
    this.watchEnabled = watch;
    this.sinceMs = sinceMs;
    this.timezone = timezone;
  }
  /**
   * Switch the bucketing zone for lines parsed from now on. Entries already
   * indexed keep their old keys — main re-derives those separately, so the two
   * halves of a zone change stay in step.
   */
  setTimezone(zone) {
    this.timezone = zone;
  }
  /**
   * Upgrade `stored` from a duplicate `cand` when the candidate is the better
   * copy (ccusage `should_replace_deduped_entry`): non-sidechain beats
   * sidechain, else larger token total (later streaming chunks are cumulative),
   * else the fast-flagged copy. Returns true when fields were mutated.
   */
  merge(stored, cand) {
    const tot = (e) => e.in + e.out + e.read + e.w5m + e.w1h;
    const better = stored.sidechain !== cand.sidechain ? stored.sidechain : tot(cand) !== tot(stored) ? tot(cand) > tot(stored) : cand.fast && !stored.fast;
    if (!better) return false;
    stored.model = cand.model;
    stored.fast = cand.fast;
    stored.sidechain = cand.sidechain;
    stored.in = cand.in;
    stored.out = cand.out;
    stored.read = cand.read;
    stored.w5m = cand.w5m;
    stored.w1h = cand.w1h;
    stored.costUSD = cand.costUSD;
    stored.tools = cand.tools ?? stored.tools;
    stored.stop = cand.stop ?? stored.stop;
    return true;
  }
  /**
   * Which adapter owns a transcript, resolved through its root. Falls back to
   * Claude Code so a file that somehow escapes the root mapping still parses
   * the way it always did.
   */
  adapterOf(file) {
    const src = this.sourceOf(file);
    return this.roots.find((r) => r.dir === src)?.adapter ?? claudeAdapter;
  }
  /** Which configured root dir a transcript belongs to (memoized per file). */
  sourceOf(file) {
    let src = this.fileSource.get(file);
    if (src === void 0) {
      src = this.dirs.find((d) => file.startsWith(d + import_path7.default.sep)) || this.dirs[0] || null;
      this.fileSource.set(file, src);
    }
    return src;
  }
  /**
   * Merge the tool_result day buckets for the in-scope source roots (null = all)
   * into a single day → {count, chars} map. Buckets are copied so callers (the
   * range filter in aggregate) never mutate the retained accumulators.
   */
  toolResultsFor(scope) {
    const out = /* @__PURE__ */ new Map();
    for (const [src, byDay] of this.toolResultBuckets) {
      if (scope && !scope.has(src)) continue;
      for (const [day, b] of byDay) {
        const cur = out.get(day);
        if (cur) {
          cur.count += b.count;
          cur.chars += b.chars;
        } else {
          out.set(day, { count: b.count, chars: b.chars });
        }
      }
    }
    return out;
  }
  /** Dedupe gate: 'new' (index it), 'merged' (stored entry mutated), or false. */
  accept(entry) {
    const exact = this.byKey.get(entry.key);
    if (exact) return this.merge(exact, entry) && "merged";
    if (entry.msgId) {
      for (const stored of this.byMsg.get(entry.msgId) || []) {
        if (entry.sidechain || stored.sidechain) {
          this.byKey.set(entry.key, stored);
          return this.merge(stored, entry) && "merged";
        }
      }
    }
    this.byKey.set(entry.key, entry);
    if (entry.msgId) {
      const list = this.byMsg.get(entry.msgId);
      if (list) list.push(entry);
      else this.byMsg.set(entry.msgId, [entry]);
    }
    return "new";
  }
  // Recursive discovery. Layout is not flat — besides
  // projects/<project>/<session>.jsonl there are subagent transcripts at
  // <session-id>/subagents/agent-*.jsonl and
  // <session-id>/subagents/workflows/wf_*/agent-*.jsonl, all of which carry
  // real billable usage.
  async listFiles() {
    const files = [];
    let owns = claudeAdapter.owns;
    const walk = async (dir, depth) => {
      if (depth > MAX_TREE_DEPTH) return;
      let ents;
      try {
        ents = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const d of ents) {
        const p = import_path7.default.join(dir, d.name);
        if (d.isDirectory()) await walk(p, depth + 1);
        else if (d.isFile() && owns(p)) {
          if (this.sinceMs != null) {
            try {
              if ((await fsp.stat(p)).mtimeMs < this.sinceMs) continue;
            } catch {
              continue;
            }
          }
          files.push(p);
        }
      }
    };
    for (const root of this.roots) {
      owns = (f) => root.adapter.owns(f);
      await walk(root.dir, 0);
    }
    return files;
  }
  /** Read every complete line appended since the recorded offset. */
  async readNew(file) {
    const none = { entries: [], merged: 0 };
    const prevOff = this.offsets.get(file) || 0;
    let st;
    try {
      st = await fsp.stat(file);
    } catch {
      return none;
    }
    if (st.size < prevOff) {
      this.requestRescan(`truncated: ${import_path7.default.basename(file)}`);
      return none;
    }
    if (st.size === prevOff) return none;
    const out = [];
    let merged = 0;
    const adapter = this.adapterOf(file);
    const fh = await fsp.open(file, "r");
    try {
      const decoder = new import_string_decoder.StringDecoder("utf8");
      const buf = Buffer.alloc(Math.min(CHUNK, st.size - prevOff));
      let pos = prevOff;
      let acc = this.remainders.get(file) || "";
      while (pos < st.size) {
        const { bytesRead } = await fh.read(buf, 0, Math.min(buf.length, st.size - pos), pos);
        if (bytesRead <= 0) break;
        pos += bytesRead;
        acc += decoder.write(bytesRead === buf.length ? buf : buf.subarray(0, bytesRead));
        let nl;
        while ((nl = acc.indexOf("\n")) !== -1) {
          const line = acc.slice(0, nl).replace(/\r$/, "");
          acc = acc.slice(nl + 1);
          const lineNo = (this.lineNos.get(file) || 0) + 1;
          this.lineNos.set(file, lineNo);
          if (!line) continue;
          const parsed = adapter.parseLine(line, file, lineNo, this.timezone);
          if (!parsed) continue;
          if (parsed.kind === "reset") {
            if (!this.resetTs || parsed.resetTs > this.resetTs) this.resetTs = parsed.resetTs;
            continue;
          }
          if (parsed.kind === "compact") {
            parsed.source = this.sourceOf(file);
            this.compactions.push(parsed);
            continue;
          }
          if (parsed.kind === "toolresult") {
            const src = this.sourceOf(file) ?? "";
            const day = dayKeyFor(parsed.ts, this.timezone);
            let byDay = this.toolResultBuckets.get(src);
            if (!byDay) this.toolResultBuckets.set(src, byDay = /* @__PURE__ */ new Map());
            const b = byDay.get(day);
            if (b) {
              b.count += 1;
              b.chars += parsed.chars;
            } else {
              byDay.set(day, { count: 1, chars: parsed.chars });
            }
            this.toolResultCount += 1;
            continue;
          }
          parsed.source = this.sourceOf(file);
          parsed.agent = adapter.id;
          const verdict = this.accept(parsed);
          if (verdict === "new") out.push(parsed);
          else if (verdict === "merged") merged += 1;
        }
      }
      this.remainders.set(file, acc + decoder.end());
      this.offsets.set(file, pos);
    } finally {
      await fh.close();
    }
    return { entries: out, merged };
  }
  /** Serialize tails per file; coalesce bursts of change events. */
  tail(file) {
    const prev = this.busy.get(file) || Promise.resolve();
    const next = prev.then(async () => {
      const { entries, merged } = await this.readNew(file);
      if (entries.length || merged) this.emit("entries", { entries, merged });
    }).catch((err) => {
      const e = err;
      this.emit("error", new Error(`tailing ${file}: ${e.message}`, { cause: e }));
    });
    this.busy.set(file, next);
    return next;
  }
  async start() {
    const t0 = Date.now();
    const files = await this.listFiles();
    const all = [];
    let scanned = 0;
    let next = 0;
    const worker = async () => {
      while (next < files.length) {
        const f = files[next++];
        const { entries } = await this.readNew(f);
        for (const e of entries) all.push(e);
        scanned += 1;
        if (scanned % 20 === 0 || scanned === files.length) {
          this.emit("progress", { scanned, total: files.length, entries: all.length });
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(SCAN_CONCURRENCY, files.length || 1) }, worker)
    );
    all.sort((a, b) => a.ts - b.ts);
    this.emit("ready", { entries: all, files: files.length, ms: Date.now() - t0 });
    if (this.watchEnabled) this.watch();
    return all;
  }
  watch() {
    const cutoff = Date.now() - WATCH_HORIZON_MS;
    for (const dir of this.dirs) {
      const w = import_chokidar.default.watch(dir, {
        ignoreInitial: true,
        depth: MAX_TREE_DEPTH,
        alwaysStat: true,
        ignorePermissionErrors: true,
        // Old transcripts never change again — skipping them keeps the
        // inotify watch count proportional to recent sessions, not history.
        // (chokidar's anymatch typings omit the (path, stats) form, hence the cast)
        ignored: ((p, stats) => {
          if (stats && stats.isFile()) {
            return !p.endsWith(".jsonl") || stats.mtimeMs < cutoff;
          }
          return false;
        })
      });
      w.on("add", (p) => void this.tail(p));
      w.on("change", (p) => void this.tail(p));
      w.on("error", (err) => this.emit("error", err));
      this.watchers.push(w);
    }
  }
  /** Drop all state and re-index (file truncation, manual refresh). */
  requestRescan(reason) {
    if (this.rescanning) return;
    this.rescanning = true;
    this.emit("reset", { reason });
    Promise.all(this.watchers.map((w) => w.close())).catch(() => {
    }).then(() => {
      this.watchers = [];
      this.offsets.clear();
      this.remainders.clear();
      this.lineNos.clear();
      this.fileSource.clear();
      this.byKey.clear();
      this.byMsg.clear();
      this.resetTs = null;
      this.compactions.length = 0;
      this.toolResultBuckets.clear();
      this.toolResultCount = 0;
      this.busy.clear();
      return this.start();
    }).catch((err) => this.emit("error", err)).finally(() => {
      this.rescanning = false;
    });
  }
  async stop() {
    await Promise.all(this.watchers.map((w) => w.close()));
    this.watchers = [];
  }
};

// electron/services/blocks.ts
var BLOCK_MS = 5 * 3600 * 1e3;
var MIN_BLOCK_HOURS = 1;
var MAX_BLOCK_HOURS = 24;
function blockMsFor(hours) {
  if (!hours || !Number.isFinite(hours)) return BLOCK_MS;
  const h = Math.min(MAX_BLOCK_HOURS, Math.max(MIN_BLOCK_HOURS, Math.round(hours)));
  return h * 3600 * 1e3;
}
var RECENT_MS = 30 * 864e5;
var floorHour = (ts) => Math.floor(ts / 36e5) * 36e5;
var round2 = (n) => Math.round(n * 100) / 100;
function burnRate(b, totalTokens) {
  const mins = (b.lastTs - b.firstTs) / 6e4;
  if (b.entries < 2 || mins <= 0) return null;
  const indicator = (b.in + b.out) / mins;
  return {
    tokensPerMin: totalTokens / mins,
    tokensPerMinIndicator: indicator,
    costPerHour: b.cost / mins * 60,
    level: indicator < 2e3 ? "normal" : indicator < 5e3 ? "moderate" : "high"
  };
}
function resolveLimit(setting, active, maxCompletedTokens) {
  let value = null;
  let source = null;
  if (setting === "max") {
    value = maxCompletedTokens;
    source = "max";
  } else if (typeof setting === "number" && Number.isFinite(setting)) {
    value = setting;
    source = "custom";
  }
  if (value == null || source == null || !(value > 0)) return null;
  const currentPct = active.totalTokens / value * 100;
  const projectedPct = active.projection ? active.projection.totalTokens / value * 100 : currentPct;
  return {
    value,
    source,
    currentPct,
    projectedPct,
    status: projectedPct > 100 ? "exceeds" : projectedPct > 80 ? "warning" : "ok"
  };
}
function computeBlocks(entries, {
  now = Date.now(),
  tokenLimit = null,
  costOf = () => 0,
  blockHours = null
} = {}) {
  const blockMs = blockMsFor(blockHours);
  const raw = [];
  let cur = null;
  for (const e of entries) {
    if (cur && (e.ts - cur.start > blockMs || e.ts - cur.lastTs > blockMs)) {
      if (e.ts - cur.lastTs > blockMs) {
        raw.push({ isGap: true, start: cur.lastTs + blockMs, end: e.ts });
      }
      cur = null;
    }
    if (!cur) {
      const start = floorHour(e.ts);
      cur = {
        isGap: false,
        start,
        end: start + blockMs,
        entries: 0,
        cost: 0,
        in: 0,
        out: 0,
        read: 0,
        write: 0,
        firstTs: e.ts,
        lastTs: e.ts,
        models: /* @__PURE__ */ new Set()
      };
      raw.push(cur);
    }
    cur.entries += 1;
    cur.cost += costOf(e) || 0;
    cur.in += e.in;
    cur.out += e.out;
    cur.read += e.read;
    cur.write += e.w5m + e.w1h;
    cur.lastTs = e.ts;
    cur.models.add(e.model);
  }
  const cutoff = now - RECENT_MS;
  const blocks = [];
  let active = null;
  let count = 0;
  let maxBlockTokens = 0;
  let maxCompleted = 0;
  for (const b of raw) {
    if (b.isGap) {
      if (b.end > cutoff) {
        blocks.push({
          id: `gap-${new Date(b.start).toISOString()}`,
          start: b.start,
          end: b.end,
          actualEnd: null,
          isActive: false,
          isGap: true,
          entries: 0,
          cost: 0,
          in: 0,
          out: 0,
          read: 0,
          write: 0,
          totalTokens: 0,
          models: [],
          burn: null
        });
      }
      continue;
    }
    count += 1;
    const totalTokens = b.in + b.out + b.read + b.write;
    const isActive = now - b.lastTs < blockMs && now < b.end;
    if (totalTokens > maxBlockTokens) maxBlockTokens = totalTokens;
    if (!isActive && totalTokens > maxCompleted) maxCompleted = totalTokens;
    const burn = isActive ? burnRate(b, totalTokens) : null;
    if (b.end > cutoff) {
      blocks.push({
        id: new Date(b.start).toISOString(),
        start: b.start,
        end: b.end,
        actualEnd: b.lastTs,
        isActive,
        isGap: false,
        entries: b.entries,
        cost: b.cost,
        in: b.in,
        out: b.out,
        read: b.read,
        write: b.write,
        totalTokens,
        models: [...b.models],
        burn
      });
    }
    if (isActive) {
      const remainingMinutes = Math.round((b.end - now) / 6e4);
      active = {
        start: b.start,
        end: b.end,
        entries: b.entries,
        cost: b.cost,
        in: b.in,
        out: b.out,
        read: b.read,
        write: b.write,
        totalTokens,
        models: [...b.models],
        firstTs: b.firstTs,
        lastTs: b.lastTs,
        remainingMs: b.end - now,
        burn,
        projection: burn ? {
          totalTokens: Math.round(totalTokens + burn.tokensPerMin * remainingMinutes),
          totalCost: round2(b.cost + burn.costPerHour / 60 * remainingMinutes),
          remainingMinutes
        } : null,
        limit: null
        // resolved below, once maxCompleted is final
      };
    }
  }
  if (active) active.limit = resolveLimit(tokenLimit, active, maxCompleted);
  return { active, blocks, count, maxBlockTokens };
}

// shared/range.ts
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dayKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function noon(now, zone) {
  return /* @__PURE__ */ new Date(`${dayKeyFor(now, zone)}T12:00:00`);
}
function monthLabel(d) {
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
function shortLabel(key) {
  const [, m, d] = key.split("-");
  return `${MONTHS[Number(m) - 1]} ${Number(d)}`;
}
function resolveRange(range, now, zone = null) {
  const today = noon(now, zone);
  const todayKey = dayKey(today);
  const back = (days) => {
    const d = noon(now, zone);
    d.setDate(d.getDate() - days);
    return dayKey(d);
  };
  const preset = range?.preset ?? "all";
  switch (preset) {
    case "today":
      return { preset, startKey: todayKey, endKey: todayKey, label: "today" };
    case "7d":
      return { preset, startKey: back(6), endKey: todayKey, label: "last 7 days" };
    case "30d":
      return { preset, startKey: back(29), endKey: todayKey, label: "last 30 days" };
    case "90d":
      return { preset, startKey: back(89), endKey: todayKey, label: "last 90 days" };
    case "month": {
      const s = noon(now, zone);
      s.setDate(1);
      return { preset, startKey: dayKey(s), endKey: todayKey, label: monthLabel(s) };
    }
    case "lastMonth": {
      const s = noon(now, zone);
      s.setDate(1);
      s.setMonth(s.getMonth() - 1);
      const e = noon(now, zone);
      e.setDate(0);
      return { preset, startKey: dayKey(s), endKey: dayKey(e), label: monthLabel(s) };
    }
    case "custom": {
      let startKey = range.customStart || null;
      let endKey = range.customEnd || null;
      if (startKey && endKey && startKey > endKey) [startKey, endKey] = [endKey, startKey];
      const label = startKey && endKey ? startKey === endKey ? shortLabel(startKey) : `${shortLabel(startKey)} \u2013 ${shortLabel(endKey)}` : startKey ? `since ${shortLabel(startKey)}` : endKey ? `until ${shortLabel(endKey)}` : "all time";
      return { preset, startKey, endKey, label };
    }
    case "all":
    default:
      return { preset: "all", startKey: null, endKey: null, label: "all time" };
  }
}
function dayKeyInRange(dateKey, range) {
  if (range.startKey && dateKey < range.startKey) return false;
  if (range.endKey && dateKey > range.endKey) return false;
  return true;
}
function isBoundedRange(range) {
  return range.startKey != null || range.endKey != null;
}

// electron/services/aggregate.ts
var DAY_MS = 864e5;
var DAYS_WINDOW = 35;
var MAX_RANGE_DAYS = 200;
var PROJECT_DAYS = 14;
var WEEKLY_BUCKETS = 12;
var MONTHLY_BUCKETS = 12;
var HEAT_DAYS = 30;
var FEED_SEED = 15;
var SESSION_LIMIT = 500;
var PROJECT_LIMIT = 40;
var CONTEXT_WINDOW_MS = 48 * 3600 * 1e3;
var TTL_5M_MS = 5 * 6e4;
var TTL_1H_MS = 60 * 6e4;
var WHATIF_CANDIDATES = 6;
var TOOL_LIMIT = 20;
var TOOL_DAILY_LIMIT = 8;
function dayKeysBack(n, now, zone = null) {
  const d = dateAtNoon(dayKeyFor(now, zone));
  const keys = [];
  for (let i = 0; i < n; i++) {
    keys.unshift(localDateKey(d.getTime()));
    d.setDate(d.getDate() - 1);
  }
  return keys;
}
function dateAtNoon(dateKey) {
  return /* @__PURE__ */ new Date(`${dateKey}T12:00:00`);
}
function dayKeysForRange(range, now, zone = null) {
  if (!range || !isBoundedRange(range)) return dayKeysBack(DAYS_WINDOW, now, zone);
  const end = range.endKey ? dateAtNoon(range.endKey) : dateAtNoon(dayKeyFor(now, zone));
  const start = range.startKey ? dateAtNoon(range.startKey) : (() => {
    const d = new Date(end);
    d.setDate(d.getDate() - (DAYS_WINDOW - 1));
    return d;
  })();
  const keys = [];
  const cur = new Date(end);
  while (cur.getTime() >= start.getTime() && keys.length < MAX_RANGE_DAYS) {
    keys.unshift(localDateKey(cur.getTime()));
    cur.setDate(cur.getDate() - 1);
  }
  return keys.length ? keys : [localDateKey(end.getTime())];
}
function weekStartKey(dateKey, startOfWeek) {
  const d = dateAtNoon(dateKey);
  const back = startOfWeek === "monday" ? (d.getDay() + 6) % 7 : d.getDay();
  d.setDate(d.getDate() - back);
  return localDateKey(d.getTime());
}
function toFeedEvent(e, cost) {
  return {
    key: e.key,
    ts: e.ts,
    model: e.model,
    project: e.project,
    sessionId: e.sessionId,
    sidechain: e.sidechain,
    in: e.in,
    out: e.out,
    read: e.read,
    write: e.w5m + e.w1h,
    ctx: e.in + e.read + e.w5m + e.w1h,
    // context-window footprint of this turn
    cost: cost || 0
  };
}
var sumRow = () => ({ cost: 0, in: 0, out: 0, read: 0, write: 0, entries: 0 });
function addTo(row, e, cost, write) {
  row.cost += cost;
  row.in += e.in;
  row.out += e.out;
  row.read += e.read;
  row.write += write;
  row.entries += 1;
}
function computeStreaks(activeKeys, todayKey, yesterdayKey) {
  let longest = 0;
  let run2 = 0;
  let prev = null;
  for (const k of activeKeys) {
    run2 = prev && dateAtNoon(k).getTime() - dateAtNoon(prev).getTime() === DAY_MS ? run2 + 1 : 1;
    if (run2 > longest) longest = run2;
    prev = k;
  }
  const active = new Set(activeKeys);
  let cursor = active.has(todayKey) ? todayKey : active.has(yesterdayKey) ? yesterdayKey : null;
  let current = 0;
  while (cursor && active.has(cursor)) {
    current += 1;
    const d = dateAtNoon(cursor);
    d.setDate(d.getDate() - 1);
    cursor = localDateKey(d.getTime());
  }
  return { current, longest };
}
function accountSpend(entries, {
  pricing = null,
  costMode = "auto",
  now = Date.now(),
  timezone = null
} = {}) {
  const costOf = (e) => pricing ? costForMode(e, costMode, pricing) : e.costUSD || 0;
  const todayKey = dayKeyFor(now, timezone);
  const weekCut = now - 7 * DAY_MS;
  const monthCut = now - 30 * DAY_MS;
  const map = /* @__PURE__ */ new Map();
  for (const e of entries) {
    const src = e.source ?? "";
    let a = map.get(src);
    if (!a) {
      a = {
        cost: 0,
        in: 0,
        out: 0,
        read: 0,
        write: 0,
        entries: 0,
        sessions: /* @__PURE__ */ new Set(),
        firstTs: e.ts,
        lastTs: e.ts,
        today: 0,
        week: 0,
        month: 0
      };
      map.set(src, a);
    }
    const cost = costOf(e);
    a.cost += cost;
    a.in += e.in;
    a.out += e.out;
    a.read += e.read;
    a.write += e.w5m + e.w1h;
    a.entries += 1;
    a.sessions.add(e.sessionId);
    if (e.ts < a.firstTs) a.firstTs = e.ts;
    if (e.ts > a.lastTs) a.lastTs = e.ts;
    if (e.dateKey === todayKey) a.today += cost;
    if (e.ts >= weekCut) a.week += cost;
    if (e.ts >= monthCut) a.month += cost;
  }
  const out = {};
  for (const [src, a] of map) {
    if (!src) continue;
    out[src] = {
      cost: a.cost,
      tokens: a.in + a.out,
      allTokens: a.in + a.out + a.read + a.write,
      entries: a.entries,
      sessions: a.sessions.size,
      firstTs: a.entries ? a.firstTs : null,
      lastTs: a.entries ? a.lastTs : null,
      today: a.today,
      week: a.week,
      month: a.month
    };
  }
  return out;
}
function buildSnapshot(entries, {
  now = Date.now(),
  sourceDirs = [],
  version = "",
  pricing = null,
  settings = {},
  resetTs = null,
  compactions = null,
  toolResults = null,
  accountEntries,
  range = null
} = {}) {
  const costMode = settings.costMode || "auto";
  const startOfWeek = settings.startOfWeek === "monday" ? "monday" : "sunday";
  const zone = settings.timezone || null;
  const costOf = (e) => pricing ? costForMode(e, costMode, pricing) : e.costUSD || 0;
  const costMemo = /* @__PURE__ */ new WeakMap();
  const costOfMemo = (e) => costMemo.get(e) ?? costOf(e);
  const resolvedRange = range ?? { preset: "all", startKey: null, endKey: null, label: "all time" };
  const bounded = isBoundedRange(resolvedRange);
  if (bounded) {
    entries = entries.filter((e) => dayKeyInRange(e.dateKey, resolvedRange));
    if (compactions) {
      compactions = compactions.filter((c) => dayKeyInRange(dayKeyFor(c.ts, zone), resolvedRange));
    }
    if (toolResults) {
      const f = /* @__PURE__ */ new Map();
      for (const [day, b] of toolResults) if (dayKeyInRange(day, resolvedRange)) f.set(day, b);
      toolResults = f;
    }
  }
  const dayKeys = dayKeysForRange(resolvedRange, now, zone);
  const DAY_SLOTS = dayKeys.length;
  const dayIndex = new Map(dayKeys.map((k, i) => [k, i]));
  const todayKey = dayKeys[dayKeys.length - 1];
  const yesterdayKey = dayKeys[dayKeys.length - 2];
  const daysWindow = new Set(dayKeys);
  const projDayKeys = dayKeys.slice(-PROJECT_DAYS);
  const projDaySet = new Set(projDayKeys);
  const weekSet = new Set(dayKeys.slice(-7));
  const heatCutoff = bounded && resolvedRange.startKey ? dateAtNoon(resolvedRange.startKey).getTime() : now - HEAT_DAYS * DAY_MS;
  const totals = { cost: 0, in: 0, out: 0, read: 0, write: 0 };
  const allSessions = /* @__PURE__ */ new Set();
  const dayMap = /* @__PURE__ */ new Map();
  const weekKeyMemo = /* @__PURE__ */ new Map();
  const weekMap = /* @__PURE__ */ new Map();
  const monthMap = /* @__PURE__ */ new Map();
  const modelMap = /* @__PURE__ */ new Map();
  const projMap = /* @__PURE__ */ new Map();
  const sessMap = /* @__PURE__ */ new Map();
  const hourly = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const hourlyCost = Array.from({ length: 7 }, () => new Array(24).fill(0));
  let cacheSavedUSD = 0;
  const idle = { events: 0, tokens: 0, extraUSD: 0 };
  const sidechain = { cost: 0, entries: 0 };
  const toolMap = /* @__PURE__ */ new Map();
  const toolDayMap = /* @__PURE__ */ new Map();
  let toolTurns = 0;
  let toolInvocations = 0;
  const stopReasons = {};
  const compactBySession = /* @__PURE__ */ new Map();
  const compactQueue = /* @__PURE__ */ new Map();
  for (const c of compactions || []) {
    compactBySession.set(c.sessionId, (compactBySession.get(c.sessionId) || 0) + 1);
    let q = compactQueue.get(c.sessionId);
    if (!q) compactQueue.set(c.sessionId, q = []);
    q.push(c.ts);
  }
  for (const q of compactQueue.values()) q.sort((a, b) => a - b);
  const compactionReread = { costUSD: 0, turns: 0 };
  const rereadSplit = { in: 0, out: 0, read: 0, w5m: 0, w1h: 0 };
  const rereadCostOf = (e) => {
    if (!pricing) return 0;
    const row = pricing.rates(e.model);
    if (!row) return 0;
    rereadSplit.in = e.in;
    rereadSplit.read = e.read;
    return costWith(row, rereadSplit);
  };
  const rec = { compared: 0, recorded: 0, calculated: 0 };
  const recByDay = /* @__PURE__ */ new Map();
  const recByModel = /* @__PURE__ */ new Map();
  const calcOf = (e) => pricing ? pricing.costAt(e.model, e, e.dateKey) : null;
  for (const e of entries) {
    const write = e.w5m + e.w1h;
    const cost = costOf(e);
    costMemo.set(e, cost);
    if (e.costUSD != null) {
      const calc = calcOf(e);
      if (calc != null) {
        rec.compared += 1;
        rec.recorded += e.costUSD;
        rec.calculated += calc;
        const d2 = recByDay.get(e.dateKey);
        if (d2) {
          d2.recorded += e.costUSD;
          d2.calculated += calc;
          d2.entries += 1;
        } else {
          recByDay.set(e.dateKey, { recorded: e.costUSD, calculated: calc, entries: 1 });
        }
        const m2 = recByModel.get(e.model);
        if (m2) {
          m2.recorded += e.costUSD;
          m2.calculated += calc;
          m2.entries += 1;
        } else {
          recByModel.set(e.model, { recorded: e.costUSD, calculated: calc, entries: 1 });
        }
      }
    }
    totals.cost += cost;
    totals.in += e.in;
    totals.out += e.out;
    totals.read += e.read;
    totals.write += write;
    allSessions.add(e.sessionId);
    if (e.sidechain) {
      sidechain.cost += cost;
      sidechain.entries += 1;
    }
    const cq = compactQueue.get(e.sessionId);
    if (cq && cq.length && cq[0] <= e.ts) {
      let popped = 0;
      while (cq.length && cq[0] <= e.ts) {
        cq.shift();
        popped += 1;
      }
      if (popped > 0) {
        compactionReread.turns += 1;
        compactionReread.costUSD += rereadCostOf(e);
      }
    }
    if (e.stop) stopReasons[e.stop] = (stopReasons[e.stop] || 0) + 1;
    if (e.tools?.length) {
      toolTurns += 1;
      toolInvocations += e.tools.length;
      const di = dayIndex.get(e.dateKey);
      const bumpDay = (name) => {
        if (di === void 0) return;
        let arr = toolDayMap.get(name);
        if (!arr) toolDayMap.set(name, arr = new Array(DAY_SLOTS).fill(0));
        arr[di] += 1;
      };
      if (e.tools.length === 1) {
        const name = e.tools[0];
        let t = toolMap.get(name);
        if (!t) toolMap.set(name, t = { name, invocations: 0, entries: 0, cost: 0 });
        t.invocations += 1;
        t.entries += 1;
        t.cost += cost;
        bumpDay(name);
      } else {
        const seen = /* @__PURE__ */ new Set();
        for (const name of e.tools) {
          let t = toolMap.get(name);
          if (!t) toolMap.set(name, t = { name, invocations: 0, entries: 0, cost: 0 });
          t.invocations += 1;
          bumpDay(name);
          if (!seen.has(name)) {
            seen.add(name);
            t.entries += 1;
            t.cost += cost;
          }
        }
      }
    }
    if (e.read && pricing) {
      const r = pricing.rates(e.model);
      if (r) cacheSavedUSD += e.read * (r.input - r.cacheRead);
    }
    let d = dayMap.get(e.dateKey);
    if (!d) {
      d = { ...sumRow(), sessions: /* @__PURE__ */ new Set(), models: null };
      dayMap.set(e.dateKey, d);
    }
    addTo(d, e, cost, write);
    d.sessions.add(e.sessionId);
    if (daysWindow.has(e.dateKey)) {
      if (!d.models) d.models = /* @__PURE__ */ new Map();
      let dm = d.models.get(e.model);
      if (!dm) d.models.set(e.model, dm = sumRow());
      addTo(dm, e, cost, write);
    }
    let wk = weekKeyMemo.get(e.dateKey);
    if (!wk) {
      wk = weekStartKey(e.dateKey, startOfWeek);
      weekKeyMemo.set(e.dateKey, wk);
    }
    let w = weekMap.get(wk);
    if (!w) weekMap.set(wk, w = { ...sumRow(), days: /* @__PURE__ */ new Set() });
    addTo(w, e, cost, write);
    w.days.add(e.dateKey);
    const mk = e.dateKey.slice(0, 7);
    let mo = monthMap.get(mk);
    if (!mo) monthMap.set(mk, mo = { ...sumRow(), days: /* @__PURE__ */ new Set() });
    addTo(mo, e, cost, write);
    mo.days.add(e.dateKey);
    let m = modelMap.get(e.model);
    if (!m) {
      m = { model: e.model, ...sumRow(), sessions: /* @__PURE__ */ new Set(), firstTs: e.ts, lastTs: e.ts };
      modelMap.set(e.model, m);
    }
    addTo(m, e, cost, write);
    m.sessions.add(e.sessionId);
    if (e.ts < m.firstTs) m.firstTs = e.ts;
    if (e.ts > m.lastTs) m.lastTs = e.ts;
    let p = projMap.get(e.project);
    if (!p) {
      p = {
        path: e.project,
        ...sumRow(),
        todayCost: 0,
        weekCost: 0,
        sessions: /* @__PURE__ */ new Set(),
        lastTs: 0,
        sidechainCost: 0,
        daily: null
      };
      projMap.set(e.project, p);
    }
    addTo(p, e, cost, write);
    if (e.sidechain) p.sidechainCost += cost;
    if (e.dateKey === todayKey) p.todayCost += cost;
    if (weekSet.has(e.dateKey)) p.weekCost += cost;
    p.sessions.add(e.sessionId);
    if (e.ts > p.lastTs) p.lastTs = e.ts;
    if (projDaySet.has(e.dateKey)) {
      if (!p.daily) p.daily = /* @__PURE__ */ new Map();
      p.daily.set(e.dateKey, (p.daily.get(e.dateKey) || 0) + cost);
    }
    if (e.w5m || e.w1h) {
      const prevTs = sessMap.get(e.sessionId)?.lastTs;
      if (prevTs !== void 0) {
        const gap = e.ts - prevTs;
        const w5 = gap > TTL_5M_MS ? e.w5m : 0;
        const w1 = gap > TTL_1H_MS ? e.w1h : 0;
        if (w5 || w1) {
          idle.events += 1;
          idle.tokens += w5 + w1;
          const r = pricing?.rates(e.model);
          if (r) {
            if (w5) idle.extraUSD += w5 * Math.max(0, r.cacheCreate - r.cacheRead);
            if (w1) idle.extraUSD += w1 * Math.max(0, (r.cacheCreate1h ?? r.input * 2) - r.cacheRead);
          }
        }
      }
    }
    let s = sessMap.get(e.sessionId);
    if (!s) {
      s = {
        id: e.sessionId,
        project: e.project,
        ...sumRow(),
        firstTs: e.ts,
        lastTs: e.ts,
        models: /* @__PURE__ */ new Set(),
        lastModel: e.model,
        lastCtx: 0
      };
      sessMap.set(e.sessionId, s);
    }
    addTo(s, e, cost, write);
    s.models.add(e.model);
    if (e.ts < s.firstTs) s.firstTs = e.ts;
    if (e.ts >= s.lastTs) {
      s.lastTs = e.ts;
      s.project = e.project;
      s.lastModel = e.model;
      s.lastCtx = e.in + e.read + e.w5m + e.w1h;
    }
    if (e.ts >= heatCutoff) {
      const { weekday: wd, hour: hr } = zonedParts(e.ts, zone);
      hourly[wd][hr] += e.in + e.out;
      hourlyCost[wd][hr] += cost;
    }
  }
  const days = dayKeys.map((k) => {
    const d = dayMap.get(k);
    if (!d) {
      return {
        date: k,
        cost: 0,
        in: 0,
        out: 0,
        read: 0,
        write: 0,
        tokens: 0,
        allTokens: 0,
        entries: 0,
        sessions: 0,
        models: []
      };
    }
    return {
      date: k,
      cost: d.cost,
      in: d.in,
      out: d.out,
      read: d.read,
      write: d.write,
      tokens: d.in + d.out,
      allTokens: d.in + d.out + d.read + d.write,
      entries: d.entries,
      sessions: d.sessions.size,
      models: d.models ? [...d.models.entries()].map(([model, r]) => ({ model, ...r })).sort((a, b) => b.cost - a.cost) : []
    };
  });
  const today = days[days.length - 1];
  const yesterday = days[days.length - 2];
  const week = days.slice(-7).reduce(
    (acc, d) => ({ cost: acc.cost + d.cost, tokens: acc.tokens + d.tokens }),
    { cost: 0, tokens: 0 }
  );
  const weekly = [...weekMap.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).slice(-WEEKLY_BUCKETS).map(([weekKey, w]) => ({
    week: weekKey,
    cost: w.cost,
    in: w.in,
    out: w.out,
    read: w.read,
    write: w.write,
    tokens: w.in + w.out,
    entries: w.entries,
    days: w.days.size
  }));
  const monthly = [...monthMap.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).slice(-MONTHLY_BUCKETS).map(([month, m]) => ({
    month,
    cost: m.cost,
    in: m.in,
    out: m.out,
    read: m.read,
    write: m.write,
    tokens: m.in + m.out,
    entries: m.entries,
    days: m.days.size
  }));
  const models = [...modelMap.values()].map((m) => {
    const row = pricing?.rates(m.model);
    return {
      model: m.model,
      cost: m.cost,
      in: m.in,
      out: m.out,
      read: m.read,
      write: m.write,
      entries: m.entries,
      sessions: m.sessions.size,
      firstTs: m.firstTs,
      lastTs: m.lastTs,
      inputRate: row ? row.input * 1e6 : null,
      outputRate: row ? row.output * 1e6 : null
    };
  }).sort((a, b) => b.cost - a.cost);
  const projects = [...projMap.values()].sort((a, b) => b.lastTs - a.lastTs).slice(0, PROJECT_LIMIT).map((p) => ({
    path: p.path,
    cost: p.cost,
    todayCost: p.todayCost,
    weekCost: p.weekCost,
    in: p.in,
    out: p.out,
    read: p.read,
    write: p.write,
    tokens: p.in + p.out,
    entries: p.entries,
    sessions: p.sessions.size,
    lastTs: p.lastTs,
    sidechainCost: p.sidechainCost,
    daily: projDayKeys.map((k) => ({ date: k, cost: p.daily?.get(k) || 0 }))
  }));
  const allSessionRows = [...sessMap.values()].sort((a, b) => b.lastTs - a.lastTs);
  const ctxCutoff = now - CONTEXT_WINDOW_MS;
  const sessions = allSessionRows.slice(0, SESSION_LIMIT).map((s) => {
    let context = null;
    if (s.lastTs >= ctxCutoff && pricing) {
      const limit = pricing.contextLimit(s.lastModel);
      context = { tokens: s.lastCtx, limit, pct: limit ? s.lastCtx / limit * 100 : 0 };
    }
    return {
      id: s.id,
      project: s.project,
      firstTs: s.firstTs,
      lastTs: s.lastTs,
      durationMs: s.lastTs - s.firstTs,
      cost: s.cost,
      in: s.in,
      out: s.out,
      read: s.read,
      write: s.write,
      tokens: s.in + s.out,
      entries: s.entries,
      models: [...s.models],
      compactions: compactBySession.get(s.id) || 0,
      context
    };
  });
  const whatIf = [];
  if (pricing) {
    const candidates2 = [];
    const candRows = [];
    for (const m of models.slice(0, WHATIF_CANDIDATES)) {
      const row = pricing.rates(m.model);
      if (row) {
        candidates2.push(m.model);
        candRows.push(row);
      }
    }
    const sums = new Array(candidates2.length).fill(0);
    const dailySums = candidates2.map(() => new Array(DAY_SLOTS).fill(0));
    const splits = { in: 0, out: 0, read: 0, w5m: 0, w1h: 0 };
    for (const e of entries) {
      splits.in = e.in;
      splits.out = e.out;
      splits.read = e.read;
      splits.w5m = e.w5m;
      splits.w1h = e.w1h;
      const di = dayIndex.get(e.dateKey);
      for (let i = 0; i < candidates2.length; i++) {
        const c = costWith(candRows[i], splits);
        sums[i] += c;
        if (di !== void 0) dailySums[i][di] += c;
      }
    }
    candidates2.forEach(
      (m, i) => whatIf.push({ model: m, totalCost: sums[i], delta: sums[i] - totals.cost, daily: dailySums[i] })
    );
    whatIf.sort((a, b) => a.totalCost - b.totalCost);
  }
  const blockInfo = computeBlocks(entries, {
    now,
    tokenLimit: settings.tokenLimit !== void 0 ? settings.tokenLimit : "max",
    costOf: costOfMemo,
    blockHours: settings.blockHours ?? null
  });
  const block = blockInfo.active;
  if (block) block.usageLimitResetTs = resetTs && resetTs > now ? resetTs : null;
  let maxDay = null;
  for (const [date, d] of dayMap) {
    if (!maxDay || d.cost > maxDay.cost) maxDay = { date, cost: d.cost };
  }
  let longestSession = null;
  for (const s of sessMap.values()) {
    const durationMs = s.lastTs - s.firstTs;
    if (!longestSession || durationMs > longestSession.durationMs) {
      longestSession = { id: s.id, project: s.project, durationMs };
    }
  }
  const activeKeys = [...dayMap.keys()].sort();
  const firstTs = entries.length ? entries[0].ts : null;
  const lastTs = entries.length ? entries[entries.length - 1].ts : null;
  const totalDays = activeKeys.length > 1 ? Math.round(
    (dateAtNoon(activeKeys[activeKeys.length - 1]).getTime() - dateAtNoon(activeKeys[0]).getTime()) / DAY_MS
  ) + 1 : activeKeys.length;
  const records = {
    maxDay,
    maxBlockTokens: blockInfo.maxBlockTokens,
    longestSession,
    activeDays: activeKeys.length,
    totalDays,
    streak: computeStreaks(activeKeys, todayKey, yesterdayKey),
    avgDailyCost: activeKeys.length ? totals.cost / activeKeys.length : 0
  };
  const reconcile = {
    compared: rec.compared,
    total: entries.length,
    coverage: entries.length ? rec.compared / entries.length : 0,
    recorded: rec.recorded,
    calculated: rec.calculated,
    drift: rec.calculated - rec.recorded,
    driftPct: rec.recorded ? (rec.calculated - rec.recorded) / rec.recorded : 0,
    byDay: [...recByDay.entries()].map(([key, v]) => ({ key, ...v })).sort((a2, b2) => a2.key < b2.key ? -1 : 1),
    byModel: [...recByModel.entries()].map(([key, v]) => ({ key, ...v })).sort(
      (a2, b2) => Math.abs(b2.calculated - b2.recorded) - Math.abs(a2.calculated - a2.recorded)
    )
  };
  const accountSpendMap = accountSpend(accountEntries ?? entries, {
    pricing,
    costMode,
    now,
    timezone: zone
  });
  let toolResultChars = 0;
  let toolResultCount = 0;
  if (toolResults) {
    for (const b of toolResults.values()) {
      toolResultChars += b.chars;
      toolResultCount += b.count;
    }
  }
  const toolResultsRollup = {
    count: toolResultCount,
    chars: toolResultChars,
    estTokens: Math.round(toolResultChars / 4)
  };
  return {
    generatedAt: now,
    version,
    sourceDirs,
    entryCount: entries.length,
    costMode,
    unknownModels: pricing ? pricing.unknown() : [],
    range: resolvedRange,
    totals: {
      ...totals,
      tokens: totals.in + totals.out,
      allTokens: totals.in + totals.out + totals.read + totals.write,
      entries: entries.length,
      sessions: allSessions.size,
      firstTs,
      lastTs
    },
    today: {
      ...today,
      vsYesterdayPct: yesterday && yesterday.cost > 0 ? (today.cost - yesterday.cost) / yesterday.cost * 100 : null
    },
    week,
    days,
    weekly,
    monthly,
    hourly,
    hourlyCost,
    models,
    projects,
    sessions,
    block,
    blocks: blockInfo.blocks,
    blockCount: blockInfo.count,
    // top-level so the UI can show "limit hit · resets in Xm" even when the
    // rejected requests produced no entries (= no active block)
    usageLimitResetTs: resetTs && resetTs > now ? resetTs : null,
    cache: {
      readTokens: totals.read,
      writeTokens: totals.write,
      hitRate: totals.read + totals.in > 0 ? totals.read / (totals.read + totals.in) : 0,
      savedUSD: cacheSavedUSD,
      wouldHaveCostUSD: totals.cost + cacheSavedUSD,
      idle
    },
    whatIf,
    sidechain,
    toolUse: {
      rows: [...toolMap.values()].sort((a, b) => b.invocations - a.invocations).slice(0, TOOL_LIMIT),
      daily: [...toolDayMap.entries()].map(([name, days2]) => ({ name, days: days2, total: days2.reduce((a, b) => a + b, 0) })).sort((a, b) => b.total - a.total).slice(0, TOOL_DAILY_LIMIT).map(({ name, days: days2 }) => ({ name, days: days2 })),
      turns: toolTurns,
      invocations: toolInvocations
    },
    stopReasons,
    compactions: (compactions || []).length,
    compactionReread,
    toolResults: toolResultsRollup,
    reconcile,
    records,
    recentEvents: entries.slice(-FEED_SEED).map((e) => toFeedEvent(e, costOfMemo(e))),
    accountSpend: accountSpendMap
  };
}

// electron/services/export.ts
function csvField(v) {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
var iso = (ts) => ts ? new Date(ts).toISOString() : "";
function table(rows, cols) {
  const head = cols.map((c) => csvField(c.header)).join(",");
  const body = rows.map((r) => cols.map((c) => csvField(c.value(r))).join(","));
  return { csv: [head, ...body].join("\n") + "\n", rows: rows.length };
}
function snapshotToCsv(snapshot, kind) {
  switch (kind) {
    case "days":
      return table(snapshot.days, [
        { header: "date", value: (d) => d.date },
        { header: "cost_usd", value: (d) => d.cost },
        { header: "input", value: (d) => d.in },
        { header: "output", value: (d) => d.out },
        { header: "cache_read", value: (d) => d.read },
        { header: "cache_write", value: (d) => d.write },
        { header: "tokens", value: (d) => d.tokens },
        { header: "all_tokens", value: (d) => d.allTokens },
        { header: "entries", value: (d) => d.entries },
        { header: "sessions", value: (d) => d.sessions }
      ]);
    case "sessions":
      return table(snapshot.sessions, [
        { header: "session_id", value: (s) => s.id },
        { header: "project", value: (s) => s.project },
        { header: "first", value: (s) => iso(s.firstTs) },
        { header: "last", value: (s) => iso(s.lastTs) },
        { header: "duration_ms", value: (s) => s.durationMs },
        { header: "cost_usd", value: (s) => s.cost },
        { header: "input", value: (s) => s.in },
        { header: "output", value: (s) => s.out },
        { header: "cache_read", value: (s) => s.read },
        { header: "cache_write", value: (s) => s.write },
        { header: "entries", value: (s) => s.entries }
      ]);
    case "projects":
      return table(snapshot.projects, [
        { header: "project", value: (p) => p.path },
        { header: "cost_usd", value: (p) => p.cost },
        { header: "today_usd", value: (p) => p.todayCost },
        { header: "week_usd", value: (p) => p.weekCost },
        { header: "tokens", value: (p) => p.tokens },
        { header: "entries", value: (p) => p.entries },
        { header: "sessions", value: (p) => p.sessions },
        { header: "last", value: (p) => iso(p.lastTs) }
      ]);
    case "models":
      return table(snapshot.models, [
        { header: "model", value: (m) => m.model },
        { header: "cost_usd", value: (m) => m.cost },
        { header: "input", value: (m) => m.in },
        { header: "output", value: (m) => m.out },
        { header: "cache_read", value: (m) => m.read },
        { header: "cache_write", value: (m) => m.write },
        { header: "entries", value: (m) => m.entries },
        { header: "sessions", value: (m) => m.sessions }
      ]);
  }
}

// electron/services/account-setup.ts
var import_path8 = __toESM(require("path"));
function visibleAccountDirs(dirs, prefs = {}) {
  const visible = dirs.filter((dir) => !prefs[import_path8.default.dirname(dir)]?.hidden);
  return visible.length ? visible : dirs;
}

// cli/args.ts
var COMMANDS = ["json", "csv", "statusline", "help", "version"];
var RANGE_PRESETS = ["today", "7d", "30d", "90d", "month", "lastMonth", "all"];
var COST_MODES = ["auto", "calculate", "display"];
var EXPORT_KINDS = ["days", "sessions", "projects", "models"];
var DEFAULTS2 = {
  command: "help",
  kind: null,
  range: null,
  since: null,
  until: null,
  costMode: null,
  offline: false,
  pretty: false,
  sections: null,
  sources: [],
  timezone: null,
  sessionLength: null,
  scanDays: null
};
var DEFAULT_SCAN_DAYS = 2;
function normalizeDayKey(raw) {
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}
var ok = (args) => ({ args, error: null });
var fail = (error) => ({ args: null, error });
function parseArgs(argv) {
  if (argv.includes("--help") || argv.includes("-h")) return ok({ ...DEFAULTS2, command: "help" });
  if (argv.includes("--version") || argv.includes("-v")) {
    return ok({ ...DEFAULTS2, command: "version" });
  }
  if (!argv.length) return ok({ ...DEFAULTS2, command: "help" });
  const out = { ...DEFAULTS2, sources: [] };
  const rest = [...argv];
  const head = rest[0];
  if (!head || head.startsWith("-")) {
    return fail(`expected a command, got "${head ?? ""}" \u2014 try: ${COMMANDS.join(", ")}`);
  }
  if (!COMMANDS.includes(head)) {
    return fail(`unknown command "${head}" \u2014 try: ${COMMANDS.join(", ")}`);
  }
  out.command = head;
  rest.shift();
  if (out.command === "csv") {
    const kind = rest[0];
    if (!kind || kind.startsWith("-")) {
      return fail(`csv needs a table: ${EXPORT_KINDS.join(" | ")}`);
    }
    if (!EXPORT_KINDS.includes(kind)) {
      return fail(`unknown csv table "${kind}" \u2014 try: ${EXPORT_KINDS.join(" | ")}`);
    }
    out.kind = kind;
    rest.shift();
  }
  const takeValue = (i) => {
    const v = rest[i + 1];
    return v === void 0 || v.startsWith("--") ? null : v;
  };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    switch (a) {
      case "--offline":
        out.offline = true;
        break;
      case "--pretty":
        out.pretty = true;
        break;
      case "--range": {
        const v = takeValue(i);
        if (!v) return fail(`--range needs a value: ${RANGE_PRESETS.join(" | ")}`);
        if (!RANGE_PRESETS.includes(v)) {
          return fail(`unknown range "${v}" \u2014 try: ${RANGE_PRESETS.join(" | ")}`);
        }
        out.range = v;
        i += 1;
        break;
      }
      case "--since":
      case "--until": {
        const v = takeValue(i);
        if (!v) return fail(`${a} needs a date (YYYY-MM-DD or YYYYMMDD)`);
        const key = normalizeDayKey(v);
        if (!key) return fail(`${a}: "${v}" is not a date (YYYY-MM-DD or YYYYMMDD)`);
        if (a === "--since") out.since = key;
        else out.until = key;
        i += 1;
        break;
      }
      case "--cost-mode": {
        const v = takeValue(i);
        if (!v) return fail(`--cost-mode needs a value: ${COST_MODES.join(" | ")}`);
        if (!COST_MODES.includes(v)) {
          return fail(`unknown cost mode "${v}" \u2014 try: ${COST_MODES.join(" | ")}`);
        }
        out.costMode = v;
        i += 1;
        break;
      }
      case "--section": {
        const v = takeValue(i);
        if (!v) return fail("--section needs a comma-separated list of snapshot keys");
        const keys = v.split(",").map((s) => s.trim()).filter(Boolean);
        if (!keys.length) return fail("--section needs at least one key");
        out.sections = [...out.sections ?? [], ...keys];
        i += 1;
        break;
      }
      case "--source": {
        const v = takeValue(i);
        if (!v) return fail("--source needs a directory");
        out.sources.push(v);
        i += 1;
        break;
      }
      case "--timezone":
      case "-z": {
        const v = takeValue(i);
        if (!v) return fail("--timezone needs an IANA zone name, e.g. UTC or Asia/Tokyo");
        if (!isValidZone(v)) return fail(`--timezone: "${v}" is not a zone this runtime knows`);
        out.timezone = v;
        i += 1;
        break;
      }
      case "--session-length": {
        const v = takeValue(i);
        if (!v) return fail("--session-length needs a whole number of hours (1-24)");
        if (!/^\d+$/.test(v) || Number(v) < 1 || Number(v) > 24) {
          return fail(`--session-length: "${v}" is not a whole number of hours in 1-24`);
        }
        out.sessionLength = Number(v);
        i += 1;
        break;
      }
      case "--scan-days": {
        const v = takeValue(i);
        if (!v) return fail("--scan-days needs a whole number of days (0 = no window)");
        if (!/^\d+$/.test(v)) return fail(`--scan-days: "${v}" is not a whole number of days`);
        out.scanDays = Number(v);
        i += 1;
        break;
      }
      default:
        return fail(`unknown option "${a}"`);
    }
  }
  if ((out.since || out.until) && out.range) {
    return fail("--range cannot be combined with --since/--until");
  }
  if (out.since && out.until && out.since > out.until) {
    return fail(`--since ${out.since} is after --until ${out.until}`);
  }
  if (out.sections && out.command !== "json") {
    return fail("--section only applies to `ccmon json`");
  }
  if (out.scanDays != null && out.command !== "statusline") {
    return fail("--scan-days only applies to `ccmon statusline`");
  }
  return ok(out);
}
var HELP = `ccmon \u2014 Claude Code usage, headless

USAGE
  ccmon <command> [options]

COMMANDS
  json                    the full analytics snapshot as JSON
  csv <table>             one table as CSV (${EXPORT_KINDS.join(" | ")})
  statusline              one compact line; reads the Claude Code
                          statusline hook payload on stdin
  help, version

OPTIONS
  --range <preset>        ${RANGE_PRESETS.join(" | ")}
  --since <date>          YYYY-MM-DD or YYYYMMDD (implies a custom range)
  --until <date>          same
  --cost-mode <mode>      ${COST_MODES.join(" | ")}
  --section <keys>        json only: comma-separated snapshot keys to keep
  --timezone <zone>, -z   IANA zone for day bucketing (default: the app's
                          setting, which defaults to the system zone)
  --session-length <h>    block window in hours (default 5 \u2014 only 5 matches
                          Anthropic's real billing window)
  --scan-days <n>         statusline only: read transcripts touched in the last
                          n days (default ${DEFAULT_SCAN_DAYS}, 0 = whole history)
  --source <dir>          extra data root (repeatable)
  --offline               never touch the network for pricing
  --pretty                indent JSON output
  -h, --help / -v, --version

NOTES
  Settings come from the desktop app's stored settings; flags override them.
  Nothing is written and no network call is made unless pricing needs a refresh
  (--offline disables that too). Live plan limits are read from the app's
  persisted history rather than polled, so the CLI never touches your login.

  \`statusline\` reads only recently-touched transcripts so it can answer inside
  a shell prompt. Today's spend and the active block are exact under that
  window; the per-session figure covers the window only, so a session older
  than --scan-days reads low. \`json\` and \`csv\` always read everything.

EXAMPLES
  ccmon json --range 30d --section totals,models --pretty
  ccmon json | jq '.totals.cost'
  ccmon csv days --since 20260101 > days.csv
  ccmon statusline   # in ~/.claude/settings.json statusLine.command
`;

// electron/services/status-text.ts
var usd = (n) => `$${(n || 0).toFixed(2)}`;
var money = (n, privacy = false) => privacy ? "$\u2022\u2022\u2022" : usd(n);
function compactTokens(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return String(n);
}
function humanDuration(ms) {
  const total = Math.max(0, Math.round(ms / 6e4));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

// cli/statusline.ts
function parseHookPayload(stdin) {
  const trimmed = stdin.trim();
  if (!trimmed) return {};
  try {
    const v = JSON.parse(trimmed);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
function formatStatusline(snap, hook, privacy = false) {
  const parts = [];
  const model = hook.model?.display_name || hook.model?.id;
  if (model) parts.push(model);
  const spend = [];
  const session = hook.session_id ? snap.sessions.find((s) => s.id === hook.session_id) : void 0;
  if (session) spend.push(`${money(session.cost, privacy)} session`);
  spend.push(`${money(snap.today.cost, privacy)} today`);
  if (snap.block) {
    spend.push(`${money(snap.block.cost, privacy)} block (${humanDuration(snap.block.remainingMs)} left)`);
  } else {
    spend.push("no active block");
  }
  parts.push(spend.join(" / "));
  if (snap.block?.burn) {
    parts.push(`${money(snap.block.burn.costPerHour, privacy)}/hr ${snap.block.burn.level}`);
  }
  const used = hook.context_window?.used_tokens;
  const max = hook.context_window?.max_tokens;
  if (typeof used === "number" && typeof max === "number" && max > 0) {
    parts.push(`ctx ${compactTokens(used)} (${Math.round(used / max * 100)}%)`);
  } else if (session?.context) {
    parts.push(`ctx ${compactTokens(session.context.tokens)} (${Math.round(session.context.pct)}%)`);
  }
  const reset = snap.block?.usageLimitResetTs ?? snap.usageLimitResetTs;
  if (reset && reset > snap.generatedAt) {
    parts.push(`limit resets in ${humanDuration(reset - snap.generatedAt)}`);
  }
  return parts.join(" | ");
}

// cli/userdata.ts
var import_os3 = __toESM(require("os"));
var import_path9 = __toESM(require("path"));
var APP_NAME = "ccmon";
function appDataRoot(platform = process.platform, env = process.env, home = import_os3.default.homedir()) {
  if (platform === "win32") return env.APPDATA || import_path9.default.join(home, "AppData", "Roaming");
  if (platform === "darwin") return import_path9.default.join(home, "Library", "Application Support");
  return env.XDG_CONFIG_HOME || import_path9.default.join(home, ".config");
}
function userDataDir(platform = process.platform, env = process.env, home = import_os3.default.homedir()) {
  if (env.CCMON_USER_DATA) return env.CCMON_USER_DATA;
  return import_path9.default.join(appDataRoot(platform, env, home), APP_NAME);
}

// package.json
var package_default = {
  name: "ccmon",
  productName: "ccmon",
  version: "1.12.0",
  description: "Real-time Claude Code usage monitor \u2014 local, private, lofi.",
  homepage: "https://github.com/iskandarputra/ccmon",
  author: "Iskandar Putra <iskandarputra1995@gmail.com>",
  license: "MIT",
  main: "dist-electron/main.cjs",
  scripts: {
    dev: "tsx scripts/dev.ts",
    icon: "tsx scripts/gen-icon.ts",
    smoke: "tsx scripts/smoke.ts",
    cli: "tsx cli/index.ts",
    test: "vitest run",
    parity: "tsx scripts/parity.ts",
    "test:watch": "vitest",
    typecheck: "tsc -p tsconfig.node.json && tsc -p tsconfig.web.json",
    "build:renderer": "vite build",
    "build:electron": "tsx scripts/build-electron.ts",
    build: "npm run build:renderer && npm run build:electron",
    "pricing:update": "tsx scripts/update-pricing-snapshots.ts",
    promo: "tsx scripts/promo/record.ts --demo && tsx scripts/promo/encode.ts",
    "promo:record": "tsx scripts/promo/record.ts --demo",
    "promo:encode": "tsx scripts/promo/encode.ts",
    dist: "npm run icon && npm run build && electron-builder --publish never",
    "dist:linux": "npm run icon && npm run build && electron-builder --linux --publish never",
    "dist:win": "npm run icon && npm run build && electron-builder --win --publish never",
    "dist:dir": "npm run icon && npm run build && electron-builder --dir --publish never",
    "build:cli": "tsx scripts/build-electron.ts --cli-only"
  },
  dependencies: {
    chokidar: "^3.6.0"
  },
  devDependencies: {
    "@fontsource/inter": "^5.1.0",
    "@fontsource/jetbrains-mono": "^5.1.0",
    "@fontsource/space-grotesk": "^5.2.10",
    "@react-three/drei": "^9.122.0",
    "@react-three/fiber": "^8.18.0",
    "@types/node": "^22.19.21",
    "@types/react": "^18.3.31",
    "@types/react-dom": "^18.3.7",
    "@types/three": "^0.184.1",
    "@types/ws": "^8.18.1",
    "@vitejs/plugin-react": "^6.0.2",
    electron: "^42.4.0",
    "electron-builder": "^26.15.2",
    esbuild: "^0.28.0",
    react: "^18.3.1",
    "react-dom": "^18.3.1",
    recharts: "^2.12.7",
    three: "^0.184.0",
    tsx: "^4.22.4",
    typescript: "^6.0.3",
    vite: "^8.0.16",
    vitest: "^4.1.8",
    ws: "^8.21.0",
    zustand: "^4.5.5"
  },
  bin: {
    ccmon: "dist-cli/index.cjs"
  }
};

// cli/index.ts
async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}
function rangeFor(args, stored) {
  if (args.since || args.until) {
    return { preset: "custom", customStart: args.since, customEnd: args.until };
  }
  if (args.range) return { preset: args.range };
  return stored ?? { preset: "all" };
}
function pickSections(snap, sections) {
  const all = snap;
  const unknown = sections.filter((s) => !(s in all));
  if (unknown.length) {
    const known = Object.keys(all).sort().join(", ");
    throw new Error(`unknown section(s): ${unknown.join(", ")}
available: ${known}`);
  }
  const out = {};
  for (const s of sections) out[s] = all[s];
  return out;
}
async function buildForCli(args) {
  const userData = userDataDir();
  const cfg = loadConfig();
  const settings = new Settings(import_path10.default.join(userData, "settings.json")).get();
  const costMode = args.costMode ?? settings.costMode;
  const timezone = args.timezone ?? settings.timezone ?? null;
  const offline = args.offline || settings.pricingOffline;
  const detected = detectProjectDirs([...args.sources, ...cfg.claudeDirs || []]);
  if (!detected.length) {
    throw new Error(
      "no Claude Code data directories found \u2014 set CLAUDE_CONFIG_DIR or pass --source <dir>"
    );
  }
  const dirs = visibleAccountDirs(detected, settings.accountWrapperPrefs ?? {});
  const pricing = await createPricingEngine({
    cacheDir: userData,
    offline,
    overrides: cfg.pricing || {},
    archive: new PricingArchive(userData)
  });
  const scanDays = args.command === "statusline" ? args.scanDays ?? DEFAULT_SCAN_DAYS : 0;
  const sinceMs = scanDays > 0 ? Date.now() - scanDays * 864e5 : null;
  const watcher = new UsageWatcher({
    dirs,
    watch: false,
    sinceMs,
    timezone: timezone || null
  });
  const entries = await watcher.start();
  const now = Date.now();
  const snap = buildSnapshot(entries, {
    now,
    sourceDirs: dirs,
    version: package_default.version,
    pricing,
    settings: {
      ...settings,
      costMode,
      timezone: timezone || "",
      blockHours: args.sessionLength ?? settings.blockHours ?? null
    },
    resetTs: watcher.resetTs,
    compactions: watcher.compactions,
    toolResults: watcher.toolResultsFor(null),
    range: resolveRange(rangeFor(args, null), now, timezone || null)
  });
  return { snap, privacy: !!settings.privacyMode };
}
async function run(argv) {
  const { args, error } = parseArgs(argv);
  if (error || !args) {
    process.stderr.write(`ccmon: ${error}

Run \`ccmon --help\`.
`);
    return 2;
  }
  if (args.command === "help") {
    process.stdout.write(HELP);
    return 0;
  }
  if (args.command === "version") {
    process.stdout.write(`${package_default.version}
`);
    return 0;
  }
  const hookRaw = args.command === "statusline" ? await readStdin() : "";
  const { snap, privacy } = await buildForCli(args);
  if (args.command === "statusline") {
    process.stdout.write(
      `${formatStatusline(snap, parseHookPayload(hookRaw), privacy)}
`
    );
    return 0;
  }
  if (args.command === "csv") {
    const { csv } = snapshotToCsv(snap, args.kind);
    process.stdout.write(csv);
    return 0;
  }
  const body = args.sections ? pickSections(snap, args.sections) : snap;
  process.stdout.write(`${JSON.stringify(body, null, args.pretty ? 2 : 0)}
`);
  return 0;
}
function isStatusline(argv) {
  return argv[0] === "statusline";
}
run(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
}).catch((err) => {
  if (isStatusline(process.argv.slice(2))) {
    process.exitCode = 0;
    return;
  }
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`ccmon: ${msg}
`);
  process.exitCode = 1;
});
//# sourceMappingURL=index.cjs.map
