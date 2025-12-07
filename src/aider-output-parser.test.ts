import { describe, it, expect } from "vitest";
import {
  parseAiderOutput,
  convertEditBlocksToACPDiffs,
  formatAiderInfo,
  classifyMessage,
  type AiderInfo,
  type EditBlock,
} from "./aider-output-parser.js";

describe("parseAiderOutput", () => {
  describe("info extraction", () => {
    it("extracts Aider version", () => {
      const output = "Aider v0.50.0\nSome other text";
      const result = parseAiderOutput(output);
      expect(result.info.version).toBe("v0.50.0");
    });

    it("extracts main model", () => {
      const output = "Main model: gpt-4-turbo";
      const result = parseAiderOutput(output);
      expect(result.info.mainModel).toBe("gpt-4-turbo");
    });

    it("extracts weak model", () => {
      const output = "Weak model: gpt-3.5-turbo";
      const result = parseAiderOutput(output);
      expect(result.info.weakModel).toBe("gpt-3.5-turbo");
    });

    it("extracts git repo", () => {
      const output = "Git repo: /path/to/repo/.git";
      const result = parseAiderOutput(output);
      expect(result.info.gitRepo).toBe("/path/to/repo/.git");
    });

    it("extracts repo-map info", () => {
      const output = "Repo-map: using 1024 tokens";
      const result = parseAiderOutput(output);
      expect(result.info.repoMap).toBe("using 1024 tokens");
    });

    it("extracts token info", () => {
      const output = "Tokens: 500 sent, 200 received";
      const result = parseAiderOutput(output);
      expect(result.info.chatTokens).toBe("500 sent, 200 received");
    });

    it("extracts cost info", () => {
      const output = "Cost: $0.05 total";
      const result = parseAiderOutput(output);
      expect(result.info.cost).toBe("$0.05 total");
    });

    it("collects warnings", () => {
      const output = "Warning: API key expiring soon\nAnother warning about something";
      const result = parseAiderOutput(output);
      expect(result.info.warnings).toContain("Warning: API key expiring soon");
    });

    it("collects errors", () => {
      const output = "Error: File not found";
      const result = parseAiderOutput(output);
      expect(result.info.errors).toContain("Error: File not found");
    });
  });

  describe("whole file format parsing", () => {
    it("parses whole file edit block", () => {
      const output = `show_greeting.py
\`\`\`
import sys

def greeting(name):
    print("Hey", name)

if __name__ == '__main__':
    greeting(sys.argv[1])
\`\`\``;

      const result = parseAiderOutput(output);
      expect(result.editBlocks.length).toBe(1);
      expect(result.editBlocks[0].format).toBe("whole");
      expect(result.editBlocks[0].path).toBe("show_greeting.py");
      expect(result.editBlocks[0].newText).toContain("def greeting(name):");
    });
  });

  describe("diff format parsing", () => {
    it("parses SEARCH/REPLACE block", () => {
      const output = `mathweb/flask/app.py
\`\`\`
<<<<<<< SEARCH
from flask import Flask
=======
import math
from flask import Flask
>>>>>>> REPLACE
\`\`\``;

      const result = parseAiderOutput(output);
      expect(result.editBlocks.length).toBe(1);
      expect(result.editBlocks[0].format).toBe("diff");
      expect(result.editBlocks[0].path).toBe("mathweb/flask/app.py");
      expect(result.editBlocks[0].oldText).toBe("from flask import Flask");
      expect(result.editBlocks[0].newText).toContain("import math");
    });

    it("parses diff-fenced format", () => {
      const output = `\`\`\`
mathweb/flask/app.py
<<<<<<< SEARCH
from flask import Flask
=======
import math
from flask import Flask
>>>>>>> REPLACE
\`\`\``;

      const result = parseAiderOutput(output);
      expect(result.editBlocks.length).toBe(1);
      // Parser normalizes to "diff" format internally
      expect(result.editBlocks[0].format).toBe("diff");
      expect(result.editBlocks[0].path).toBe("mathweb/flask/app.py");
    });
  });

  describe("udiff format parsing", () => {
    it("parses unified diff format", () => {
      const output = `\`\`\`diff
--- mathweb/flask/app.py
+++ mathweb/flask/app.py
@@ ... @@
-class MathWeb:
+import sympy
+class MathWeb:
\`\`\``;

      const result = parseAiderOutput(output);
      expect(result.editBlocks.length).toBe(1);
      expect(result.editBlocks[0].format).toBe("udiff");
      expect(result.editBlocks[0].path).toBe("mathweb/flask/app.py");
      expect(result.editBlocks[0].oldText).toContain("class MathWeb:");
      expect(result.editBlocks[0].newText).toContain("import sympy");
    });
  });

  describe("prompt detection", () => {
    it("detects yes/no prompts", () => {
      const output = "Add file to the chat? (Y)es/(N)o";
      const result = parseAiderOutput(output);
      expect(result.prompts.length).toBe(1);
      expect(result.prompts[0]).toContain("(Y)es/(N)o");
    });
  });

  describe("empty input", () => {
    it("handles empty string", () => {
      const result = parseAiderOutput("");
      expect(result.editBlocks).toEqual([]);
      expect(result.codeBlocks).toEqual([]);
      expect(result.prompts).toEqual([]);
      expect(result.info.warnings).toEqual([]);
      expect(result.info.errors).toEqual([]);
    });
  });
});

describe("convertEditBlocksToACPDiffs", () => {
  it("converts relative paths to absolute using workingDir", () => {
    const blocks: EditBlock[] = [
      { format: "diff", path: "src/index.ts", oldText: "old", newText: "new" },
    ];
    const result = convertEditBlocksToACPDiffs(blocks, "/project");
    expect(result[0].path).toBe("/project/src/index.ts");
  });

  it("preserves absolute paths", () => {
    const blocks: EditBlock[] = [
      { format: "whole", path: "/abs/path/file.ts", newText: "content" },
    ];
    const result = convertEditBlocksToACPDiffs(blocks, "/project");
    expect(result[0].path).toBe("/abs/path/file.ts");
  });

  it("uses process.cwd() when workingDir is empty", () => {
    const blocks: EditBlock[] = [
      { format: "whole", path: "file.ts", newText: "content" },
    ];
    const result = convertEditBlocksToACPDiffs(blocks, "");
    expect(result[0].path).toContain("file.ts");
    expect(result[0].path.startsWith("/")).toBe(true);
  });

  it("sets oldText to null when not provided", () => {
    const blocks: EditBlock[] = [
      { format: "whole", path: "file.ts", newText: "content" },
    ];
    const result = convertEditBlocksToACPDiffs(blocks, "/project");
    expect(result[0].oldText).toBeNull();
  });

  it("preserves oldText when provided", () => {
    const blocks: EditBlock[] = [
      { format: "diff", path: "file.ts", oldText: "old content", newText: "new content" },
    ];
    const result = convertEditBlocksToACPDiffs(blocks, "/project");
    expect(result[0].oldText).toBe("old content");
  });
});

describe("formatAiderInfo", () => {
  it("formats complete info", () => {
    const info: AiderInfo = {
      version: "v0.50.0",
      mainModel: "gpt-4",
      weakModel: "gpt-3.5",
      gitRepo: "/path/to/repo",
      repoMap: "using tokens",
      chatTokens: "500",
      cost: "$0.10",
      warnings: ["warning 1"],
      errors: ["error 1"],
    };
    const result = formatAiderInfo(info);
    expect(result).toContain("**Aider**: v0.50.0");
    expect(result).toContain("**Main Model**: gpt-4");
    expect(result).toContain("**Weak Model**: gpt-3.5");
    expect(result).toContain("**Repo**: /path/to/repo");
    expect(result).toContain("**Repo-map**: using tokens");
    expect(result).toContain("**Tokens**: 500");
    expect(result).toContain("**Cost**: $0.10");
    expect(result).toContain("⚠️ warning 1");
    expect(result).toContain("❌ error 1");
  });

  it("returns empty string for empty info", () => {
    const info: AiderInfo = {
      warnings: [],
      errors: [],
    };
    const result = formatAiderInfo(info);
    expect(result).toBe("");
  });

  it("handles partial info", () => {
    const info: AiderInfo = {
      version: "v0.50.0",
      warnings: [],
      errors: [],
    };
    const result = formatAiderInfo(info);
    expect(result).toContain("**Aider**: v0.50.0");
    expect(result).not.toContain("Main Model");
  });
});

describe("classifyMessage", () => {
  describe("command_echo", () => {
    it("classifies lines starting with > as command echo", () => {
      const result = classifyMessage("> /add test.ts");
      expect(result.type).toBe("command_echo");
      expect(result.text).toBe("> /add test.ts");
    });

    it("classifies lines starting with $ as command echo", () => {
      const result = classifyMessage("$ npm run test");
      expect(result.type).toBe("command_echo");
      expect(result.text).toBe("$ npm run test");
    });
  });

  describe("prompt", () => {
    it("classifies Y/N prompts correctly", () => {
      expect(classifyMessage("Add test.ts to the chat? (Y)es/(N)o").type).toBe("prompt");
      expect(classifyMessage("Continue? [Y/n]").type).toBe("prompt");
      expect(classifyMessage("Proceed? [y/N]").type).toBe("prompt");
    });
  });

  describe("error", () => {
    it("classifies error messages", () => {
      expect(classifyMessage("Error: file not found").type).toBe("error");
      expect(classifyMessage("ERROR: invalid syntax").type).toBe("error");
      expect(classifyMessage("Can't initialize git repo in /path").type).toBe("error");
      expect(classifyMessage("Unable to read file").type).toBe("error");
    });
  });

  describe("warning", () => {
    it("classifies warning messages", () => {
      expect(classifyMessage("Warning: deprecated API").type).toBe("warning");
      expect(classifyMessage("WARNING: low disk space").type).toBe("warning");
      expect(classifyMessage("No suitable Python version found").type).toBe("warning");
    });
  });

  describe("file_action", () => {
    it("classifies file action messages", () => {
      expect(classifyMessage("Added test.ts to the chat").type).toBe("file_action");
      expect(classifyMessage("Removed util.ts from the chat").type).toBe("file_action");
      expect(classifyMessage("Dropping config.json from the chat").type).toBe("file_action");
      expect(classifyMessage("Add helper.ts to the chat?").type).toBe("file_action");
      expect(classifyMessage("Create new file src/index.ts?").type).toBe("file_action");
      expect(classifyMessage("Read-only: docs/README.md").type).toBe("file_action");
    });
  });

  describe("info", () => {
    it("classifies info messages", () => {
      expect(classifyMessage("Aider v0.50.0").type).toBe("info");
      expect(classifyMessage("Main model: gpt-4-turbo").type).toBe("info");
      expect(classifyMessage("Weak model: gpt-3.5-turbo").type).toBe("info");
      expect(classifyMessage("Git repo: /path/.git").type).toBe("info");
      expect(classifyMessage("Repo-map: using 1024 tokens").type).toBe("info");
      expect(classifyMessage("Use /help for help").type).toBe("info");
      expect(classifyMessage("Models: gpt-4, claude-3").type).toBe("info");
    });
  });

  describe("progress", () => {
    it("classifies progress/token messages", () => {
      expect(classifyMessage("Tokens: 500 sent, 200 received").type).toBe("progress");
      expect(classifyMessage("Cost: $0.05 total").type).toBe("progress");
      expect(classifyMessage("Message sent 1500 tokens to API").type).toBe("progress");
      expect(classifyMessage("Response received 800 tokens").type).toBe("progress");
    });
  });

  describe("content", () => {
    it("classifies regular content as content", () => {
      expect(classifyMessage("Here is my response").type).toBe("content");
      expect(classifyMessage("I'll help you with that code").type).toBe("content");
    });

    it("classifies empty lines as content", () => {
      expect(classifyMessage("").type).toBe("content");
      expect(classifyMessage("   ").type).toBe("content");
    });
  });

  it("preserves raw line in result", () => {
    const line = "  Main model: gpt-4-turbo  ";
    const result = classifyMessage(line);
    expect(result.raw).toBe(line);
    expect(result.text).toBe("Main model: gpt-4-turbo");
  });
});

describe("parseAiderOutput classifiedMessages", () => {
  it("includes classifiedMessages in output", () => {
    const output = "Aider v0.50.0\nHere is my response";
    const result = parseAiderOutput(output);
    expect(result.classifiedMessages).toBeDefined();
    expect(result.classifiedMessages.length).toBeGreaterThan(0);
  });

  it("classifies multiple lines correctly", () => {
    const output = `Aider v0.50.0
Main model: gpt-4-turbo
Added test.ts to the chat
Here is my response`;
    const result = parseAiderOutput(output);
    
    const types = result.classifiedMessages.map(m => m.type);
    expect(types).toContain("info");
    expect(types).toContain("file_action");
    expect(types).toContain("content");
  });
});
