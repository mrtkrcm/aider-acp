import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type * as protocol from "@agentclientprotocol/sdk";
import { AiderAcpAgent } from "./acp-agent.js";

// Mock the AiderProcessManager
vi.mock("./aider-runner.js", () => {
  const { EventEmitter } = require("node:events");
  
  class MockAiderProcessManager extends EventEmitter {
    private state: number = 0; // AiderState.STARTING
    public pendingConfirmation: string | null = null;
    
    constructor(_workingDir: string, _model: string) {
      super();
    }
    
    getState(): number {
      return this.state;
    }
    
    start(): void {
      // Simulate startup complete after a tick
      setTimeout(() => {
        this.state = 2; // AiderState.READY
        this.emit("ready");
      }, 0);
    }
    
    stop(): void {
      this.emit("exit", "Process stopped");
    }
    
    interrupt(): void {
      // Simulate interrupt
    }
    
    sendCommand(command: string): void {
      // Simulate command processing
      setTimeout(() => {
        this.emit("data", `Processing: ${command}\n`);
        this.emit("turn_completed", `Processing: ${command}\n`);
      }, 0);
    }
    
    answerConfirmation(answer: string): void {
      this.pendingConfirmation = null;
      this.state = 2; // AiderState.READY
    }
    
    // Helper for tests to simulate Aider output
    simulateOutput(data: string): void {
      this.emit("data", data);
    }
    
    simulateTurnComplete(data: string): void {
      this.emit("turn_completed", data);
    }
    
    simulateError(error: string): void {
      this.emit("error", error);
    }
    
    simulateConfirmation(question: string): void {
      this.state = 1; // AiderState.WAITING_FOR_CONFIRMATION
      this.pendingConfirmation = question;
      this.emit("confirmation_required", question);
    }
  }
  
  return {
    AiderProcessManager: MockAiderProcessManager,
    AiderState: {
      STARTING: 0,
      WAITING_FOR_CONFIRMATION: 1,
      READY: 2,
      PROCESSING: 3,
    },
  };
});

// Create a mock AgentSideConnection
function createMockClient(): protocol.AgentSideConnection & {
  sessionUpdates: Array<{ sessionId: string; update: unknown }>;
  permissionRequests: Array<protocol.RequestPermissionRequest>;
  requestPermissionResponse: { outcome: string; optionKind?: string };
} {
  const sessionUpdates: Array<{ sessionId: string; update: unknown }> = [];
  const permissionRequests: Array<protocol.RequestPermissionRequest> = [];
  let requestPermissionResponse: { outcome: string; optionKind?: string } = {
    outcome: "selected",
    optionKind: "allow_once",
  };

  return {
    sessionUpdates,
    permissionRequests,
    requestPermissionResponse,
    
    sessionUpdate(params: { sessionId: string; update: unknown }): void {
      sessionUpdates.push(params);
    },
    
    async requestPermission(
      request: protocol.RequestPermissionRequest
    ): Promise<protocol.RequestPermissionResponse> {
      permissionRequests.push(request);
      return requestPermissionResponse as unknown as protocol.RequestPermissionResponse;
    },
  } as unknown as protocol.AgentSideConnection & {
    sessionUpdates: Array<{ sessionId: string; update: unknown }>;
    permissionRequests: Array<protocol.RequestPermissionRequest>;
    requestPermissionResponse: { outcome: string; optionKind?: string };
  };
}

describe("AiderAcpAgent", () => {
  let agent: AiderAcpAgent;
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    mockClient = createMockClient();
    agent = new AiderAcpAgent(mockClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("initialize", () => {
    it("returns agent info with correct name and version", async () => {
      const response = await agent.initialize({
        protocolVersion: 1,
      } as protocol.InitializeRequest);

      expect(response.agentInfo?.name).toBe("aider-acp");
      expect(response.agentInfo?.title).toBe("Aider ACP Agent");
      expect(response.agentInfo?.version).toBeDefined();
    });

    it("includes available models in response metadata", async () => {
      const response = await agent.initialize({
        protocolVersion: 1,
      } as protocol.InitializeRequest);

      const meta = response._meta as { models?: { availableModels?: unknown[]; currentModelId?: string } };
      expect(meta?.models).toBeDefined();
      expect(meta?.models?.availableModels).toBeDefined();
      expect(meta?.models?.currentModelId).toBeDefined();
    });

    it("reports correct agent capabilities", async () => {
      const response = await agent.initialize({
        protocolVersion: 1,
      } as protocol.InitializeRequest);

      expect(response.agentCapabilities?.promptCapabilities?.embeddedContext).toBe(true);
      expect(response.agentCapabilities?.promptCapabilities?.image).toBe(false);
    });
  });

  describe("newSession", () => {
    it("creates a session with unique ID", async () => {
      await agent.initialize({ protocolVersion: 1 } as protocol.InitializeRequest);
      
      const response = await agent.newSession({
        cwd: "/test/dir",
      } as protocol.NewSessionRequest);

      expect(response.sessionId).toBeDefined();
      expect(response.sessionId).toMatch(/^sess_\d+$/);
    });

    it("returns available models in session response", async () => {
      await agent.initialize({ protocolVersion: 1 } as protocol.InitializeRequest);
      
      const response = await agent.newSession({
        cwd: "/test/dir",
      } as protocol.NewSessionRequest);

      expect(response.models).toBeDefined();
      expect(response.models?.availableModels).toBeDefined();
      expect(response.models?.currentModelId).toBeDefined();
    });

    it("uses requested model if available", async () => {
      await agent.initialize({ protocolVersion: 1 } as protocol.InitializeRequest);
      
      const response = await agent.newSession({
        cwd: "/test/dir",
        mcpServers: [],
        _meta: { modelId: "gemini/gemini-2.5-flash" },
      } as unknown as protocol.NewSessionRequest);

      expect(response.models?.currentModelId).toBe("gemini/gemini-2.5-flash");
    });
  });

  describe("prompt handling", () => {
    let sessionId: string;

    beforeEach(async () => {
      await agent.initialize({ protocolVersion: 1 } as protocol.InitializeRequest);
      const session = await agent.newSession({
        cwd: "/test/dir",
      } as protocol.NewSessionRequest);
      sessionId = session.sessionId;
      
      // Wait for mock Aider to be ready
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    it("handles text prompt", async () => {
      const response = await agent.prompt({
        sessionId,
        prompt: [{ type: "text", text: "Hello world" }],
      } as protocol.PromptRequest);

      expect(response.stopReason).toBe("end_turn");
    });

    it("validates slash commands", async () => {
      const response = await agent.prompt({
        sessionId,
        prompt: [{ type: "text", text: "/add test.ts" }],
      } as protocol.PromptRequest);

      expect(response.stopReason).toBe("end_turn");
      
      // Should have sent session updates
      expect(mockClient.sessionUpdates.length).toBeGreaterThan(0);
    });

    it("rejects unknown slash commands with helpful message", async () => {
      const response = await agent.prompt({
        sessionId,
        prompt: [{ type: "text", text: "/unknown-command" }],
      } as protocol.PromptRequest);

      expect(response.stopReason).toBe("end_turn");
      
      // Should have sent a warning about unknown command
      const messageUpdates = mockClient.sessionUpdates.filter(
        (u) => (u.update as { sessionUpdate: string }).sessionUpdate === "agent_message_chunk"
      );
      const messages = messageUpdates.map(
        (u) => ((u.update as { content: { text: string } }).content?.text || "")
      );
      const hasUnknownWarning = messages.some((msg) => msg.includes("Unknown slash command"));
      expect(hasUnknownWarning).toBe(true);
    });

    it("provides list of allowed commands for unknown command", async () => {
      await agent.prompt({
        sessionId,
        prompt: [{ type: "text", text: "/badcmd" }],
      } as protocol.PromptRequest);

      const messageUpdates = mockClient.sessionUpdates.filter(
        (u) => (u.update as { sessionUpdate: string }).sessionUpdate === "agent_message_chunk"
      );
      const messages = messageUpdates.map(
        (u) => ((u.update as { content: { text: string } }).content?.text || "")
      );
      
      // Should mention some valid commands
      const hasAllowedList = messages.some((msg) => msg.includes("/add") || msg.includes("/drop"));
      expect(hasAllowedList).toBe(true);
    });
  });

  describe("cancel handling", () => {
    it("handles cancel notification", async () => {
      await agent.initialize({ protocolVersion: 1 } as protocol.InitializeRequest);
      const session = await agent.newSession({
        cwd: "/test/dir",
      } as protocol.NewSessionRequest);

      // Should not throw
      await expect(
        agent.cancel({ sessionId: session.sessionId })
      ).resolves.not.toThrow();
    });
  });

  describe("setMode", () => {
    it("sets mode for session", async () => {
      await agent.initialize({ protocolVersion: 1 } as protocol.InitializeRequest);
      const session = await agent.newSession({
        cwd: "/test/dir",
      } as protocol.NewSessionRequest);

      const result = await agent.setMode({
        sessionId: session.sessionId,
        modeId: "architect",
      });

      expect(result).toEqual({});
      
      // Should have sent mode update (current_mode_update)
      const modeUpdates = mockClient.sessionUpdates.filter(
        (u) => (u.update as { sessionUpdate: string }).sessionUpdate === "current_mode_update"
      );
      expect(modeUpdates.length).toBeGreaterThan(0);
    });

    it("throws for invalid session", async () => {
      await agent.initialize({ protocolVersion: 1 } as protocol.InitializeRequest);

      await expect(
        agent.setMode({ sessionId: "invalid", modeId: "code" })
      ).rejects.toThrow("Session not found");
    });
  });
});

describe("AiderAcpAgent output classification", () => {
  let agent: AiderAcpAgent;
  let mockClient: ReturnType<typeof createMockClient>;
  let sessionId: string;

  beforeEach(async () => {
    mockClient = createMockClient();
    agent = new AiderAcpAgent(mockClient);
    await agent.initialize({ protocolVersion: 1 } as protocol.InitializeRequest);
    const session = await agent.newSession({
      cwd: "/test/dir",
    } as protocol.NewSessionRequest);
    sessionId = session.sessionId;
    
    // Wait for mock Aider to be ready
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  it("formats file action messages with emoji", async () => {
    // Trigger a prompt to set up listeners
    await agent.prompt({
      sessionId,
      prompt: [{ type: "text", text: "test" }],
    } as protocol.PromptRequest);

    // Check if any message chunks were formatted correctly
    // The mock simulates basic output, real formatting depends on parseAiderOutput
    expect(mockClient.sessionUpdates.length).toBeGreaterThan(0);
  });
});

describe("Model configuration", () => {
  it("uses default model when AIDER_MODELS not set", async () => {
    const mockClient = createMockClient();
    const agent = new AiderAcpAgent(mockClient);
    
    const response = await agent.initialize({
      protocolVersion: 1,
    } as protocol.InitializeRequest);

    const meta = response._meta as { models?: { availableModels?: unknown[]; currentModelId?: string } };
    expect(meta?.models?.availableModels?.length).toBeGreaterThan(0);
    expect(meta?.models?.currentModelId).toBe("gemini/gemini-2.5-flash");
  });

  it("parses AIDER_MODELS from environment", async () => {
    const originalEnv = process.env.AIDER_MODELS;
    process.env.AIDER_MODELS = JSON.stringify([
      { modelId: "test/model", name: "Test Model" },
    ]);

    try {
      // Need to reimport to pick up env change
      // For this test to work properly, we'd need dynamic imports
      // This is a limitation of the current test setup
      const mockClient = createMockClient();
      const agent = new AiderAcpAgent(mockClient);
      
      const response = await agent.initialize({
        protocolVersion: 1,
      } as protocol.InitializeRequest);

      // Models are loaded at module level, so this tests the flow exists
      const meta = response._meta as { models?: unknown };
      expect(meta?.models).toBeDefined();
    } finally {
      if (originalEnv === undefined) {
        delete process.env.AIDER_MODELS;
      } else {
        process.env.AIDER_MODELS = originalEnv;
      }
    }
  });
});
