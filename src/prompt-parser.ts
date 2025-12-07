export interface SlashCommandSpec {
  name: string;
  requiresArgs: boolean;
  description: string;
}

export type SlashCommandResult =
  | { kind: "command"; spec: SlashCommandSpec; args: string; rawInput: string }
  | { kind: "missing_args"; spec: SlashCommandSpec; rawInput: string }
  | { kind: "unknown"; commandName: string; rawInput: string; available: string[] }
  | { kind: "malformed"; rawInput: string; available: string[] };

const slashCommandAllowlist: Record<string, SlashCommandSpec> = {
  // File management commands
  add: {
    name: "add",
    requiresArgs: true,
    description: "Add file(s) to the chat",
  },
  drop: {
    name: "drop",
    requiresArgs: true,
    description: "Remove file(s) from the chat",
  },
  ls: {
    name: "ls",
    requiresArgs: false,
    description: "List tracked files",
  },
  "read-only": {
    name: "read-only",
    requiresArgs: true,
    description: "Add file(s) as read-only reference",
  },

  // Mode commands
  ask: {
    name: "ask",
    requiresArgs: false,
    description: "Ask questions without editing files",
  },
  code: {
    name: "code",
    requiresArgs: false,
    description: "Request code changes (default mode)",
  },
  architect: {
    name: "architect",
    requiresArgs: false,
    description: "Use architect/editor mode with 2 models",
  },

  // Execution commands
  run: {
    name: "run",
    requiresArgs: true,
    description: "Execute a shell command via Aider",
  },
  test: {
    name: "test",
    requiresArgs: true,
    description: "Run a test command, add output on failure",
  },
  lint: {
    name: "lint",
    requiresArgs: false,
    description: "Lint and fix files in chat",
  },

  // Git commands
  commit: {
    name: "commit",
    requiresArgs: false,
    description: "Commit edits made outside the chat",
  },
  diff: {
    name: "diff",
    requiresArgs: false,
    description: "Display diff of changes since last message",
  },
  undo: {
    name: "undo",
    requiresArgs: false,
    description: "Undo the last git commit by aider",
  },

  // Session commands
  clear: {
    name: "clear",
    requiresArgs: false,
    description: "Clear the chat history",
  },
  reset: {
    name: "reset",
    requiresArgs: false,
    description: "Drop all files and clear chat history",
  },
  tokens: {
    name: "tokens",
    requiresArgs: false,
    description: "Report token usage for current context",
  },

  // Model commands
  model: {
    name: "model",
    requiresArgs: true,
    description: "Switch to a different LLM model",
  },

  // Help commands
  help: {
    name: "help",
    requiresArgs: false,
    description: "Get help about aider commands",
  },
};

export function parseSlashCommand(input: string): SlashCommandResult | null {
  const normalized = input.trim();
  if (!normalized.startsWith("/")) {
    return null;
  }

  if (normalized === "/") {
    return {
      kind: "malformed",
      rawInput: normalized,
      available: getAllowedSlashCommandNames(),
    };
  }

  const [firstToken, ...restTokens] = normalized.split(/\s+/);
  const commandName = firstToken.slice(1);
  const spec = slashCommandAllowlist[commandName];
  const args = restTokens.join(" ").trim();

  if (!spec) {
    return {
      kind: "unknown",
      commandName,
      rawInput: normalized,
      available: getAllowedSlashCommandNames(),
    };
  }

  if (spec.requiresArgs && args.length === 0) {
    return { kind: "missing_args", spec, rawInput: normalized };
  }

  return { kind: "command", spec, args, rawInput: normalized };
}

export function formatSlashCommand(result: Extract<SlashCommandResult, { kind: "command" }>): string {
  const trailing = result.args.length > 0 ? ` ${result.args}` : "";
  return `/${result.spec.name}${trailing}`;
}

export function getAllowedSlashCommandNames(): string[] {
  return Object.keys(slashCommandAllowlist).sort((a, b) => a.localeCompare(b));
}

export function testSlashCommandParser(): void {
  console.log("\n=== Testing Slash Command Parser ===");
  const samples = [
    "/add src/index.ts",
    "/ls",
    "/add",
    "/unknown feature",
    "A plain request without a slash",
  ];

  for (const sample of samples) {
    const result = parseSlashCommand(sample);
    if (!result) {
      console.log(`Input: "${sample}" -> No slash command detected`);
      continue;
    }

    console.log(`Input: "${sample}" ->`, result);
  }
}
