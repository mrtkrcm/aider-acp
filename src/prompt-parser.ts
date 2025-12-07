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
  run: {
    name: "run",
    requiresArgs: true,
    description: "Execute a shell command via Aider",
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
  return Object.keys(slashCommandAllowlist).sort();
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
