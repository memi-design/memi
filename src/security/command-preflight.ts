import type { MemiCapability, MemiExecutionPolicy } from "./execution-policy.js";

export interface CommandInvocation {
  commandPath: readonly string[];
  options: Readonly<Record<string, unknown>>;
  args: readonly unknown[];
}

export interface CommandPreflightResult {
  optionOverrides: Readonly<Record<string, unknown>>;
}

export async function preflightCommand(
  policy: MemiExecutionPolicy,
  invocation: CommandInvocation,
): Promise<CommandPreflightResult> {
  const path = invocation.commandPath.join(".");
  const overrides: Record<string, unknown> = {};
  const require = (...requirements: readonly [MemiCapability, string][]) => {
    for (const [capability, operation] of requirements) {
      policy.assert(capability, operation);
    }
  };

  switch (path) {
    case "diagnose":
      if (policy.profile === "locked") {
        overrides.write = false;
      } else if (invocation.options.write !== false) {
        require(["project-write", "write diagnosis reports"]);
      }
      break;
    case "doctor":
      if (invocation.options.repairPlugin) {
        require(["home-write", "repair the Figma plugin"]);
      }
      break;
    case "self-update":
      require(["network", "check npm for updates"]);
      if (!invocation.options.check && !invocation.options.silent) {
        require(
          ["dynamic-install", "install the resolved CLI version"],
          ["shell", "run the package manager"],
          ["home-write", "replace the global CLI installation"],
        );
      }
      break;
    case "upgrade":
      require(["network", "check standalone binary releases"]);
      if (!invocation.options.check) {
        require(
          ["dynamic-install", "install the resolved standalone version"],
          ["shell", "replace the standalone executable"],
          ["home-write", "replace the standalone executable"],
        );
      }
      break;
    case "setup.plugin":
      require(["home-write", "install the packaged Figma plugin"]);
      break;
    case "setup":
      require(
        ["network", "validate setup credentials"],
        ["figma", "configure the Figma bridge"],
        ["project-write", "write project configuration"],
        ["home-write", "install user configuration"],
      );
      break;
    case "connect":
      require(
        ["figma", "connect to Figma"],
        ["network", "open the Figma bridge"],
        ["project-write", "write the Figma bridge lock"],
      );
      if (invocation.options.background) {
        require(["shell", "start the bridge in the background"]);
      }
      break;
    case "compose":
      require(["network", "run model composition"]);
      if (invocation.options.figma !== false) {
        require(["figma", "run Figma composition steps"]);
      }
      require(["project-write", "persist composition results"]);
      break;
    case "view":
      if (!invocation.options.print && !invocation.options.json) {
        require(
          ["browser", "open a registry URL"],
          ["shell", "launch the system URL handler"],
        );
      }
      break;
    case "mcp":
    case "mcp.start":
      require(
        ["network", "start the MCP server"],
        ["project-write", "enable write-capable MCP tools"],
        ["shell", "enable subprocess-capable MCP tools"],
      );
      if (invocation.options.figma !== false) {
        require(["figma", "enable Figma MCP tools"]);
      }
      break;
    case "mcp.config":
      if (invocation.options.install) {
        require([
          invocation.options.global ? "home-write" : "project-write",
          "install MCP configuration",
        ]);
      }
      break;
    case "notes.install": {
      require(["project-write", "install a Memoire Note"]);
      const source = String(invocation.args[0] ?? "");
      if (isRemoteNoteSource(source)) {
        require(["network", "download a remote Memoire Note"]);
      }
      break;
    }
    case "notes.update":
      require(
        ["network", "check remote Memoire Notes"],
        ["project-write", "update installed Memoire Notes"],
      );
      break;
    case "notes.create":
    case "notes.remove":
      require(["project-write", "modify installed Memoire Notes"]);
      break;
    case "agent.install":
      if (!invocation.options.dryRun) {
        require(
          ["dynamic-install", "install agent integration files"],
          [invocation.options.global ? "home-write" : "project-write", "write agent integration files"],
        );
      }
      break;
    case "agent.spawn":
      require(["shell", "spawn an agent process"]);
      if (invocation.options.remote) {
        require(["network", "connect to a remote agent host"]);
      }
      break;
    case "update":
      require(
        ["network", "download registry updates"],
        ["project-write", "update registry components"],
      );
      break;
    case "uninstall":
      require(
        ["home-write", "remove user Memi data"],
        ["project-write", "remove project Memi data"],
      );
      break;
    default:
      break;
  }

  return { optionOverrides: Object.freeze({ ...overrides }) };
}

function isRemoteNoteSource(source: string): boolean {
  return /^(?:github:|https?:\/\/|git\+|ssh:|git@)/i.test(source);
}
