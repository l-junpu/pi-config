import type { AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { OverlayHandle } from "@earendil-works/pi-tui";
import { buildSessionContext, ExtensionRunner } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FileActivityTracker } from "./file-activity-tracker.ts";
import { getOverlayOptions } from "./side-chat-layout.ts";
import { SideChatOverlay, type ForkContext } from "./side-chat-overlay.ts";
import { extractWritePaths } from "./tool-wrapper.ts";

// Patch to capture the runner instance for extension tool access in side chat.
let capturedRunner: ExtensionRunner | null = null;
const origGetAllRegisteredTools = ExtensionRunner.prototype.getAllRegisteredTools;
ExtensionRunner.prototype.getAllRegisteredTools = function () {
  capturedRunner = this;
  return origGetAllRegisteredTools.call(this);
};

function getExtensionAgentTools(): AgentTool[] {
  if (!capturedRunner) return [];
  return capturedRunner.getAllRegisteredTools().map((rt): AgentTool => {
    const { definition } = rt;
    return {
      name: definition.name,
      label: definition.label,
      description: definition.description,
      parameters: definition.parameters,
      execute: (toolCallId, params, signal, onUpdate) =>
        definition.execute(toolCallId, params, signal, onUpdate, capturedRunner!.createContext()),
    };
  });
}

const DEFAULT_SHORTCUT = "alt+/";
const DEFAULT_FULLSCREEN_SHORTCUT = "alt+shift+m";
const OVERLAY_BLOCKED_ERROR = "PI_SIDE_CHAT_OVERLAY_BLOCKED";

function loadConfig(): { shortcut: string; fullscreenShortcut: string } {
  const configPath = join(dirname(fileURLToPath(import.meta.url)), "config.json");
  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    const shortcut = typeof config.shortcut === "string" ? config.shortcut.trim() : "";
    const fullscreenShortcut = typeof config.fullscreenShortcut === "string"
      ? config.fullscreenShortcut.trim()
      : "";
    return {
      shortcut: shortcut || DEFAULT_SHORTCUT,
      fullscreenShortcut: fullscreenShortcut || DEFAULT_FULLSCREEN_SHORTCUT,
    };
  } catch {
    return {
      shortcut: DEFAULT_SHORTCUT,
      fullscreenShortcut: DEFAULT_FULLSCREEN_SHORTCUT,
    };
  }
}

export default function sideChatExtension(pi: ExtensionAPI) {
  const config = loadConfig();
  const tracker = new FileActivityTracker();
  let activeOverlay: SideChatOverlay | null = null;
  let overlayHandle: OverlayHandle | null = null;
  let lastMessages: AgentMessage[] | null = null;
  let sideModel: Model<any> | null = null;

  pi.on("tool_execution_start", (event, ctx) => {
    if (["write", "edit", "bash"].includes(event.toolName)) {
      const paths = extractWritePaths(event.toolName, event.args);
      paths.forEach((p) => tracker.trackWrite(p, ctx.cwd));
    }
  });

  const toggleSideChat = async (ctx: ExtensionContext) => {
    if (activeOverlay) {
      if (overlayHandle?.isFocused()) {
        overlayHandle.unfocus();
      } else {
        overlayHandle?.focus();
      }
      return;
    }
    return openSideChat(ctx);
  };

  const openSideChat = async (ctx: ExtensionContext, clear = false) => {
    if (!ctx.model) {
      ctx.ui.notify("Cannot open side chat: no model configured", "error");
      return;
    }

    const sessionContext = buildSessionContext(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId());
    const forkContext: ForkContext = {
      messages: clear ? [] : (lastMessages ?? sessionContext.messages),
      restored: !clear && lastMessages !== null,
      model: sideModel ?? ctx.model,
      systemPrompt: ctx.getSystemPrompt(),
      thinkingLevel: pi.getThinkingLevel(),
      cwd: ctx.cwd,
      extensionTools: getExtensionAgentTools(),
    };
    const overlayOptions = getOverlayOptions("compact");

    try {
      const action = await ctx.ui.custom<"close" | "refork" | "clear">(
        (tui, theme, _keybindings, done) => {
          if (tui.hasOverlay()) {
            setTimeout(() => {
              ctx.ui.notify("Close or background the current overlay first", "warning");
            }, 0);
            throw new Error(OVERLAY_BLOCKED_ERROR);
          }

          activeOverlay = new SideChatOverlay({
            tui,
            theme,
            forkContext,
            tracker,
            modelRegistry: ctx.modelRegistry,
            sessionManager: ctx.sessionManager,
            shortcut: config.shortcut,
            fullscreenShortcut: config.fullscreenShortcut,
            onDisplayModeChange: (mode) => {
              // pi-tui retains this object and reads its fields on each render.
              Object.assign(overlayOptions, getOverlayOptions(mode));
            },
            onOverlapWarning: (path) => showOverlapWarning(ctx.ui, path),
            onUnfocus: () => overlayHandle?.unfocus(),
            onClose: (action, messages) => {
              lastMessages = action === "close" ? messages : null;
              activeOverlay = null;
              overlayHandle = null;
              done(action);
            },
          });
          return activeOverlay;
        },
        {
          overlay: true,
          overlayOptions,
          onHandle: (handle) => {
            overlayHandle = handle;
            handle.focus();
          },
        },
      );
      if (action === "refork") return openSideChat(ctx);
      if (action === "clear") return openSideChat(ctx, true);
    } catch (error) {
      if (error instanceof Error && error.message === OVERLAY_BLOCKED_ERROR) {
        return;
      }
      activeOverlay = null;
      overlayHandle = null;
      throw error;
    }
  };

  pi.registerShortcut(config.shortcut, {
    description: "Toggle side chat focus (open if closed)",
    handler: toggleSideChat,
  });

  pi.registerShortcut(config.fullscreenShortcut, {
    description: "Toggle side chat fullscreen mode",
    handler: () => activeOverlay?.toggleDisplayMode(),
  });

  pi.registerCommand("side", {
    description: "Open side chat (fork conversation)",
    handler: (_, ctx) => toggleSideChat(ctx),
  });

  pi.registerCommand("side-model", {
    description: "Choose a model for the side chat (independent of the main model)",
    handler: async (_, ctx) => {
      if (!ctx.model) {
        ctx.ui.notify("No model configured", "error");
        return;
      }

      const available = ctx.modelRegistry.getAvailable();
      const useMainOption = formatUseMainOption(ctx.model);
      const modelOptions = available.map(formatModelOption);
      const options = [useMainOption, ...modelOptions];

      const activeLabel = sideModel ? formatModelId(sideModel) : "main session's model";
      const choice = await ctx.ui.select(`Side chat model (active: ${activeLabel})`, options);
      if (choice === undefined) return;

      if (choice === useMainOption) {
        sideModel = null;
      } else {
        const index = modelOptions.indexOf(choice);
        const found = index >= 0 ? available[index] : undefined;
        if (!found) {
          ctx.ui.notify("Could not resolve selected model", "error");
          return;
        }
        sideModel = found;
      }

      if (activeOverlay) {
        activeOverlay.setModel(sideModel ?? ctx.model);
      }

      ctx.ui.notify(
        sideModel
          ? `Side chat model set to ${formatModelId(sideModel)}`
          : "Side chat will use main session's model",
        "info",
      );
    },
  });
}

function formatModelId(model: Model<any>): string {
  return `${model.provider}/${model.id}`;
}

function formatModelOption(model: Model<any>): string {
  return `${formatModelId(model)} — ${model.name}`;
}

function formatUseMainOption(model: Model<any>): string {
  return `Use main session's model (${formatModelId(model)})`;
}

function showOverlapWarning(ui: ExtensionUIContext, path: string): Promise<boolean> {
  return ui.confirm(
    "File Overlap",
    `Main agent has modified:\n  ${path}\n\nEditing may cause conflicts. Proceed?`
  );
}
