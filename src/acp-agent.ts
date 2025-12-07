import * as protocol from "@agentclientprotocol/sdk";
import * as fs from "fs";
import * as path from "path";
import { SessionState } from "./types.js";
import { AiderProcessManager, AiderState } from "./aider-runner.js";
import {
  parseAiderOutput,
  formatAiderInfo,
  convertEditBlocksToACPDiffs,
} from "./aider-output-parser.js";

export class AiderAcpAgent implements protocol.Agent {
  private sessions: Map<string, SessionState> = new Map();
  private client: protocol.AgentSideConnection;

  constructor(client: protocol.AgentSideConnection) {
    this.client = client;
  }

  async initialize(
    request: protocol.InitializeRequest,
  ): Promise<protocol.InitializeResponse> {
    const supportedProtocolVersion = 1;
    const requestedProtocol = request.protocolVersion ?? supportedProtocolVersion;
    const negotiatedProtocol = Math.min(requestedProtocol, supportedProtocolVersion);

    return {
      protocolVersion: negotiatedProtocol,
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: {
          image: false,
          audio: false,
          embeddedContext: true,
        },
      },
      authMethods: [],
    };
  }

  async newSession(
    params: protocol.NewSessionRequest,
  ): Promise<protocol.NewSessionResponse> {
    const sessionId = `sess_${Date.now()}`;
    const workingDir = params.cwd || process.cwd();
    // const model = "openrouter/deepseek/deepseek-chat-v3.1:free"; // Or get from params
    // const model = "opentouer/deepseek/deepseek-chat-v3-0324:free"; // Or get from params
    const model = "gemini/gemini-2.5-flash"; // Or get from params

    const aiderProcess = new AiderProcessManager(workingDir, model);

    const session: SessionState = {
      id: sessionId,
      created: new Date(),
      model,
      files: [],
      workingDir,
      aiderProcess,
      commandQueue: [],
    };

    this.sessions.set(sessionId, session);
    this.setupAiderListeners(sessionId, aiderProcess);
    aiderProcess.start();

    return { sessionId };
  }

  async prompt(
    params: protocol.PromptRequest,
  ): Promise<protocol.PromptResponse> {
    const { sessionId, prompt } = params;
    const session = this.sessions.get(sessionId);

    if (!session || !session.aiderProcess) {
      throw new Error("Invalid session or Aider process not running");
    }

    // Clear any previous cancellation state for this turn
    session.cancelled = false;

    // Separar el contenido de texto y los recursos
    this.validateContentBlocks(prompt);

    const textContents = prompt.filter((item) => item.type === "text");
    const resources = prompt.filter(
      (item) => item.type === "resource" || item.type === "resource_link",
    );

    // Combinar todos los textos y eliminar espacios vacíos
    const promptText = textContents
      .map((item) => item.text?.trim() || "")
      .filter((text) => text.length > 0)
      .join(" ")
      .trim();

    // Almacenar el último prompt para filtrarlo de la salida
    session.lastPromptText = promptText;

    const agentState = session.aiderProcess.getState();

    // Si estamos esperando confirmación, manejar directamente
    if (agentState === AiderState.WAITING_FOR_CONFIRMATION) {
      session.aiderProcess.answerConfirmation(promptText);
      await this.waitForTurnCompletion(sessionId, session);
      return { stopReason: session.cancelled ? "cancelled" : "end_turn" };
    }

    // Manejar recursos primero (archivos)
    if (resources.length > 0) {
      await this.processResources(sessionId, session, resources);

      if (session.cancelled) {
        return { stopReason: "cancelled" };
      }
    }

    // Después de procesar todos los recursos, enviar el texto del prompt si existe
    if (promptText.trim().length > 0) {
      session.aiderProcess.sendCommand(promptText);
      // Esperar a que se complete el turno
      await this.waitForTurnCompletion(sessionId, session);

      return { stopReason: session.cancelled ? "cancelled" : "end_turn" };
    } else {
      // Si no hay texto, simplemente terminar
      return { stopReason: session.cancelled ? "cancelled" : "end_turn" };
    }
  }

  private setupAiderListeners(
    sessionId: string,
    processManager: AiderProcessManager,
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    processManager.on("data", (data: string) => {
      // Parse the complete data first to extract edit blocks
      const parsedOutput = parseAiderOutput(data);
      const { info, userMessage, editBlocks, codeBlocks, prompts } =
        parsedOutput;

      // Then filter only the remaining text for display, avoiding interference with edit blocks
      const processedLines = data
        .split("\n")
        .map((line) => {
          // Only filter command echoes ("> command"), not diff markers
          if (
            line.startsWith("> ") &&
            !line.includes(">>>") &&
            !line.includes("<<<")
          ) {
            return null;
          }
          // Don't process lines that are part of code blocks or edit blocks
          if (
            line.startsWith("```") ||
            line.includes("<<<<<<< SEARCH") ||
            line.includes(">>>>>>> REPLACE") ||
            line.includes("=======")
          ) {
            return null;
          }
          // Agregar emoji a mensajes de archivos añadidos
          if (line.startsWith("Added ")) {
            return `📁 ${line}`;
          }
          // Agregar emoji de advertencia a mensajes de archivos ya en el chat
          if (line.includes("is already in the chat")) {
            return `⚠️ ${line}`;
          }
          // Filtrar líneas que son solo nombres de archivo (sin prefijos)
          if (
            line.trim().length > 0 &&
            !line.includes(":") &&
            !line.includes(" ") &&
            line.includes(".") &&
            !line.startsWith("📁") &&
            !line.startsWith("⚠️")
          ) {
            return null;
          }
          return line;
        })
        .filter((line) => line !== null) as string[];

      const processedData = processedLines.join("\n");

      // Formatear información de Aider si está presente
      if (Object.keys(info).length > 0) {
        const formattedInfo = formatAiderInfo(info);
        if (formattedInfo.trim().length > 0) {
          this.client.sessionUpdate({
            sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: formattedInfo },
            },
          });
        }
      }

      // Mostrar solicitudes de confirmación/texto interactivo
      for (const promptLine of prompts) {
        this.client.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text: `**Aider requires input:**\n${promptLine}`,
            },
          },
        });
      }

      // Enviar mensaje del usuario si está presente
      if (userMessage.trim().length > 0) {
        this.client.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: userMessage },
          },
        });
      }

      // Enviar bloques de edición como tool calls con diffs ACP
      if (editBlocks.length > 0) {
        const acpDiffs = convertEditBlocksToACPDiffs(editBlocks);
        for (let i = 0; i < acpDiffs.length; i++) {
          const diff = acpDiffs[i];
          const toolCallId = `edit_${Date.now()}_${i}`;

          // Crear tool call para la edición
          this.client.sessionUpdate({
            sessionId,
            update: {
              sessionUpdate: "tool_call",
              toolCallId,
              title: `Editing ${diff.path}`,
              kind: "edit",
              status: "completed",
              content: [diff],
            },
          });
        }
      }

      // Enviar bloques de código si están presentes
      for (const codeBlock of codeBlocks) {
        this.client.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text: `\`\`\`${codeBlock.path}\n${codeBlock.content}\n\`\`\``,
            },
          },
        });
      }
    });

    processManager.on("error", (errorData: string) => {
      const errorStr = errorData.toString();

      // Ignore progress bars, they are not errors
      if (errorStr.includes("Scanning repo:")) {
        // TODO: Parse this and send as a proper progress notification
        return;
      }

      // Handle specific warnings without treating them as critical errors
      if (errorStr.includes("leaked semaphore objects")) {
        this.client.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text: `
**Warning:**
${errorStr}`,
            },
          },
        });
        return;
      }

      // For all other errors, report them
      this.client.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: `
**Error:**
${errorStr}`,
          },
        },
      });
    });

    processManager.on("confirmation_required", (question: string) => {
      this.client.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: `
**Aider requires input:**
${question}`,
          },
        },
      });
    });

    processManager.on("exit", (message: string) => {
      this.client.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text: `
**Aider process terminated:** ${message}`,
          },
        },
      });
      const session = this.sessions.get(sessionId);
      if (session) session.aiderProcess = undefined;
    });
  }

  // Cancel is a fire-and-forget notification
  async cancel(params: protocol.CancelNotification): Promise<void> {
    const session = this.sessions.get(params.sessionId);
    if (session && session.aiderProcess) {
      try {
        session.cancelled = true;
        // Send Control-C to interrupt current operation (not exit)
        session.aiderProcess.interrupt();
      } catch (e) {
        // If interrupt fails, fall back to stopping the process
        session.aiderProcess.stop();
      }
    }
  }

  async authenticate(params: protocol.AuthenticateRequest): Promise<void> {
    throw new Error("Authentication not implemented.");
  }

  private async processResources(
    sessionId: string,
    session: SessionState,
    resources: Array<protocol.ContentBlock>,
  ): Promise<void> {
    for (const block of resources) {
      if (session.cancelled) return;

      if (block.type === "resource_link") {
        const normalizedPath = this.normalizeResourceUri(block.uri, session.workingDir);
        if (!normalizedPath) {
          this.sendAgentMessage(
            sessionId,
            `⚠️ Unable to add referenced resource (missing URI): ${block.uri}`,
          );
          continue;
        }

        session.aiderProcess?.sendCommand(`/add ${normalizedPath}`);
        await this.waitForTurnCompletion(sessionId, session);
        continue;
      }

      if (block.type === "resource") {
        const normalizedPath = this.normalizeResourceUri(
          block.resource.uri,
          session.workingDir,
        );
        if (!normalizedPath) {
          this.sendAgentMessage(
            sessionId,
            `⚠️ Unable to materialize embedded resource (missing URI): ${block.resource.uri}`,
          );
          continue;
        }

        const wrote = await this.writeEmbeddedResource(
          sessionId,
          normalizedPath,
          block.resource,
        );
        if (!wrote) {
          continue;
        }

        session.aiderProcess?.sendCommand(`/add ${normalizedPath}`);
        await this.waitForTurnCompletion(sessionId, session);
      }
    }
  }

  private async writeEmbeddedResource(
    sessionId: string,
    targetPath: string,
    resource: protocol.EmbeddedResourceResource,
  ): Promise<boolean> {
    try {
      await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });

      if ("text" in resource) {
        await fs.promises.writeFile(targetPath, resource.text, "utf8");
        return true;
      }

      if ("blob" in resource) {
        const buffer = Buffer.from(resource.blob, "base64");
        await fs.promises.writeFile(targetPath, buffer);
        return true;
      }

      this.sendAgentMessage(
        sessionId,
        `⚠️ Unsupported embedded resource format for ${targetPath}.`,
      );
      return false;
    } catch (error) {
      this.sendAgentMessage(
        sessionId,
        `⚠️ Failed to write embedded resource to ${targetPath}: ${String(error)}`,
      );
      return false;
    }
  }

  private normalizeResourceUri(uri: string | undefined, workingDir: string): string | null {
    if (!uri) return null;

    const trimmed = uri.trim();
    if (trimmed.length === 0) return null;

    if (trimmed.startsWith("file://")) {
      try {
        const url = new URL(trimmed);
        return path.normalize(decodeURIComponent(url.pathname));
      } catch {
        return path.normalize(trimmed.slice(7));
      }
    }

    if (path.isAbsolute(trimmed)) {
      return path.normalize(trimmed);
    }

    return path.normalize(path.join(workingDir, trimmed));
  }

  private validateContentBlocks(blocks: Array<protocol.ContentBlock>): void {
    const unsupportedBlocks = blocks.filter((block) => {
      if (block.type === "text") return false;
      if (block.type === "resource" || block.type === "resource_link") return false;
      return true;
    });

    if (unsupportedBlocks.length > 0) {
      const unsupportedTypes = unsupportedBlocks.map((block) => block.type).join(", ");
      throw new Error(`Unsupported content types in prompt: ${unsupportedTypes}`);
    }

    for (const block of blocks) {
      if (block.type === "resource_link" && !block.uri?.trim()) {
        throw new Error("Resource link blocks must include a non-empty URI");
      }

      if (block.type === "resource" && !block.resource?.uri?.trim()) {
        throw new Error("Embedded resource blocks must include a non-empty URI");
      }
    }
  }

  private waitForTurnCompletion(
    sessionId: string,
    session: SessionState,
  ): Promise<void> {
    return new Promise((resolve) => {
      const cleanup = (): void => {
        session.aiderProcess?.removeListener("turn_completed", onComplete);
        session.aiderProcess?.removeListener("exit", onExit);
        session.aiderProcess?.removeListener("error", onError);
      };

      const onComplete = (): void => {
        cleanup();
        resolve();
      };

      const onExit = (): void => {
        cleanup();
        resolve();
      };

      const onError = (): void => {
        cleanup();
        // Report the interruption so the client has context
        this.sendAgentMessage(
          sessionId,
          "⚠️ Aider reported an error while processing the last command.",
        );
        resolve();
      };

      session.aiderProcess?.once("turn_completed", onComplete);
      session.aiderProcess?.once("exit", onExit);
      session.aiderProcess?.once("error", onError);
    });
  }

  private sendAgentMessage(sessionId: string, text: string): void {
    this.client.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text },
      },
    });
  }
}
