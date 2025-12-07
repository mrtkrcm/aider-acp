import { describe, it, expect } from "vitest";
import {
  parseSlashCommand,
  formatSlashCommand,
  getAllowedSlashCommandNames,
  type SlashCommandResult,
} from "./prompt-parser.js";

describe("parseSlashCommand", () => {
  it("returns null for non-slash input", () => {
    expect(parseSlashCommand("hello world")).toBeNull();
    expect(parseSlashCommand("add file.ts")).toBeNull();
    expect(parseSlashCommand("")).toBeNull();
  });

  it("parses valid /add command with arguments", () => {
    const result = parseSlashCommand("/add src/index.ts");
    expect(result).toEqual({
      kind: "command",
      spec: { name: "add", requiresArgs: true, description: "Add file(s) to the chat" },
      args: "src/index.ts",
      rawInput: "/add src/index.ts",
    });
  });

  it("parses valid /ls command without arguments", () => {
    const result = parseSlashCommand("/ls");
    expect(result).toEqual({
      kind: "command",
      spec: { name: "ls", requiresArgs: false, description: "List tracked files" },
      args: "",
      rawInput: "/ls",
    });
  });

  it("parses /drop command with arguments", () => {
    const result = parseSlashCommand("/drop src/old.ts");
    expect(result).toEqual({
      kind: "command",
      spec: { name: "drop", requiresArgs: true, description: "Remove file(s) from the chat" },
      args: "src/old.ts",
      rawInput: "/drop src/old.ts",
    });
  });

  it("parses /run command with shell command", () => {
    const result = parseSlashCommand("/run npm test");
    expect(result).toEqual({
      kind: "command",
      spec: { name: "run", requiresArgs: true, description: "Execute a shell command via Aider" },
      args: "npm test",
      rawInput: "/run npm test",
    });
  });

  it("returns missing_args for /add without arguments", () => {
    const result = parseSlashCommand("/add");
    expect(result).toEqual({
      kind: "missing_args",
      spec: { name: "add", requiresArgs: true, description: "Add file(s) to the chat" },
      rawInput: "/add",
    });
  });

  it("returns missing_args for /drop without arguments", () => {
    const result = parseSlashCommand("/drop");
    expect(result?.kind).toBe("missing_args");
  });

  it("returns unknown for unrecognized command", () => {
    const result = parseSlashCommand("/unknown feature");
    expect(result).toEqual({
      kind: "unknown",
      commandName: "unknown",
      rawInput: "/unknown feature",
      available: getAllowedSlashCommandNames(),
    });
  });

  it("returns malformed for bare slash", () => {
    const result = parseSlashCommand("/");
    expect(result).toEqual({
      kind: "malformed",
      rawInput: "/",
      available: getAllowedSlashCommandNames(),
    });
  });

  it("trims whitespace from input", () => {
    const result = parseSlashCommand("  /ls  ");
    expect(result?.kind).toBe("command");
    expect((result as Extract<SlashCommandResult, { kind: "command" }>).spec.name).toBe("ls");
  });

  it("handles multiple spaces between command and args", () => {
    const result = parseSlashCommand("/add   file1.ts   file2.ts");
    expect(result?.kind).toBe("command");
    // Parser normalizes multiple spaces when splitting/joining with \s+
    expect((result as Extract<SlashCommandResult, { kind: "command" }>).args).toBe("file1.ts file2.ts");
  });

  // Mode commands
  it("parses /ask command without arguments", () => {
    const result = parseSlashCommand("/ask");
    expect(result?.kind).toBe("command");
    expect((result as Extract<SlashCommandResult, { kind: "command" }>).spec.name).toBe("ask");
  });

  it("parses /ask command with question", () => {
    const result = parseSlashCommand("/ask what does this function do?");
    expect(result?.kind).toBe("command");
    expect((result as Extract<SlashCommandResult, { kind: "command" }>).args).toBe("what does this function do?");
  });

  it("parses /code command", () => {
    const result = parseSlashCommand("/code");
    expect(result?.kind).toBe("command");
    expect((result as Extract<SlashCommandResult, { kind: "command" }>).spec.name).toBe("code");
  });

  it("parses /architect command", () => {
    const result = parseSlashCommand("/architect");
    expect(result?.kind).toBe("command");
    expect((result as Extract<SlashCommandResult, { kind: "command" }>).spec.name).toBe("architect");
  });

  // Git commands
  it("parses /commit command without message", () => {
    const result = parseSlashCommand("/commit");
    expect(result?.kind).toBe("command");
    expect((result as Extract<SlashCommandResult, { kind: "command" }>).spec.name).toBe("commit");
  });

  it("parses /commit command with message", () => {
    const result = parseSlashCommand("/commit fix: resolve null pointer");
    expect(result?.kind).toBe("command");
    expect((result as Extract<SlashCommandResult, { kind: "command" }>).args).toBe("fix: resolve null pointer");
  });

  it("parses /diff command", () => {
    const result = parseSlashCommand("/diff");
    expect(result?.kind).toBe("command");
    expect((result as Extract<SlashCommandResult, { kind: "command" }>).spec.name).toBe("diff");
  });

  it("parses /undo command", () => {
    const result = parseSlashCommand("/undo");
    expect(result?.kind).toBe("command");
    expect((result as Extract<SlashCommandResult, { kind: "command" }>).spec.name).toBe("undo");
  });

  // Execution commands
  it("parses /test command with test command", () => {
    const result = parseSlashCommand("/test npm run test");
    expect(result?.kind).toBe("command");
    expect((result as Extract<SlashCommandResult, { kind: "command" }>).spec.name).toBe("test");
    expect((result as Extract<SlashCommandResult, { kind: "command" }>).args).toBe("npm run test");
  });

  it("returns missing_args for /test without arguments", () => {
    const result = parseSlashCommand("/test");
    expect(result?.kind).toBe("missing_args");
  });

  it("parses /lint command", () => {
    const result = parseSlashCommand("/lint");
    expect(result?.kind).toBe("command");
    expect((result as Extract<SlashCommandResult, { kind: "command" }>).spec.name).toBe("lint");
  });

  // Session commands
  it("parses /clear command", () => {
    const result = parseSlashCommand("/clear");
    expect(result?.kind).toBe("command");
    expect((result as Extract<SlashCommandResult, { kind: "command" }>).spec.name).toBe("clear");
  });

  it("parses /reset command", () => {
    const result = parseSlashCommand("/reset");
    expect(result?.kind).toBe("command");
    expect((result as Extract<SlashCommandResult, { kind: "command" }>).spec.name).toBe("reset");
  });

  it("parses /tokens command", () => {
    const result = parseSlashCommand("/tokens");
    expect(result?.kind).toBe("command");
    expect((result as Extract<SlashCommandResult, { kind: "command" }>).spec.name).toBe("tokens");
  });

  // Model command
  it("parses /model command with model name", () => {
    const result = parseSlashCommand("/model gpt-4-turbo");
    expect(result?.kind).toBe("command");
    expect((result as Extract<SlashCommandResult, { kind: "command" }>).spec.name).toBe("model");
    expect((result as Extract<SlashCommandResult, { kind: "command" }>).args).toBe("gpt-4-turbo");
  });

  it("returns missing_args for /model without arguments", () => {
    const result = parseSlashCommand("/model");
    expect(result?.kind).toBe("missing_args");
  });

  // Help command
  it("parses /help command", () => {
    const result = parseSlashCommand("/help");
    expect(result?.kind).toBe("command");
    expect((result as Extract<SlashCommandResult, { kind: "command" }>).spec.name).toBe("help");
  });

  it("parses /help command with topic", () => {
    const result = parseSlashCommand("/help commands");
    expect(result?.kind).toBe("command");
    expect((result as Extract<SlashCommandResult, { kind: "command" }>).args).toBe("commands");
  });

  // Read-only command
  it("parses /read-only command with file", () => {
    const result = parseSlashCommand("/read-only README.md");
    expect(result?.kind).toBe("command");
    expect((result as Extract<SlashCommandResult, { kind: "command" }>).spec.name).toBe("read-only");
    expect((result as Extract<SlashCommandResult, { kind: "command" }>).args).toBe("README.md");
  });

  it("returns missing_args for /read-only without arguments", () => {
    const result = parseSlashCommand("/read-only");
    expect(result?.kind).toBe("missing_args");
  });
});

describe("formatSlashCommand", () => {
  it("formats command with args", () => {
    const result: Extract<SlashCommandResult, { kind: "command" }> = {
      kind: "command",
      spec: { name: "add", requiresArgs: true, description: "Add file(s) to the chat" },
      args: "src/index.ts",
      rawInput: "/add src/index.ts",
    };
    expect(formatSlashCommand(result)).toBe("/add src/index.ts");
  });

  it("formats command without args", () => {
    const result: Extract<SlashCommandResult, { kind: "command" }> = {
      kind: "command",
      spec: { name: "ls", requiresArgs: false, description: "List tracked files" },
      args: "",
      rawInput: "/ls",
    };
    expect(formatSlashCommand(result)).toBe("/ls");
  });
});

describe("getAllowedSlashCommandNames", () => {
  it("returns sorted list of allowed commands", () => {
    const names = getAllowedSlashCommandNames();
    expect(names).toEqual([
      "add",
      "architect",
      "ask",
      "clear",
      "code",
      "commit",
      "diff",
      "drop",
      "help",
      "lint",
      "ls",
      "model",
      "read-only",
      "reset",
      "run",
      "test",
      "tokens",
      "undo",
    ]);
  });

  it("returns a new array each time", () => {
    const names1 = getAllowedSlashCommandNames();
    const names2 = getAllowedSlashCommandNames();
    expect(names1).not.toBe(names2);
    expect(names1).toEqual(names2);
  });
});
