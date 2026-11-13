/**
 * ============================================================================
 * services/mcpManager.js — Dynamic MCP (Model Context Protocol) Client Manager
 * ============================================================================
 * Manages connections to external MCP servers using @modelcontextprotocol/sdk.
 * Features:
 *   - Supports stdio transport ({ command, args, env }) and sse/http transport ({ url })
 *   - Auto-discovers and caches tools via client.listTools()
 *   - Persists config in data/mcp_config.json
 *   - Error resilient: offline servers log errors without crashing Express
 *   - Unified tool execution: executeTool(serverName, toolName, args)
 * ============================================================================
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
const { SSEClientTransport } = require("@modelcontextprotocol/sdk/client/sse.js");

const DATA_DIR = path.resolve(__dirname, "..", "data");
const MCP_CONFIG_FILE = path.join(DATA_DIR, "mcp_config.json");

class MCPManager {
  constructor() {
    this.clients = new Map(); // serverName -> { client, transport, tools, config }
    this.initConfigFile();
  }

  initConfigFile() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(MCP_CONFIG_FILE)) {
      fs.writeFileSync(MCP_CONFIG_FILE, JSON.stringify({ mcpServers: {} }, null, 2));
    }
  }

  readConfig() {
    try {
      this.initConfigFile();
      return JSON.parse(fs.readFileSync(MCP_CONFIG_FILE, "utf-8"));
    } catch (_e) {
      return { mcpServers: {} };
    }
  }

  saveConfig(config) {
    try {
      fs.writeFileSync(MCP_CONFIG_FILE, JSON.stringify(config, null, 2));
    } catch (e) {
      console.error("❌ [mcpManager] Failed to write mcp_config.json:", e.message);
    }
  }

  /**
   * Connect to an MCP server (stdio or sse).
   * @param {string} name 
   * @param {object} serverConfig { command, args, env, url }
   */
  async connectServer(name, serverConfig) {
    console.log(`🔌 [mcpManager] Connecting to MCP server "${name}"...`);

    // Disconnect existing if already running
    if (this.clients.has(name)) {
      await this.disconnectServer(name);
    }

    try {
      let transport;

      if (serverConfig.url) {
        // SSE / HTTP Transport
        transport = new SSEClientTransport(new URL(serverConfig.url));
      } else if (serverConfig.command) {
        // Stdio Transport
        transport = new StdioClientTransport({
          command: serverConfig.command,
          args: serverConfig.args || [],
          env: { ...process.env, ...(serverConfig.env || {}) },
        });
      } else {
        throw new Error("Invalid MCP server config: either 'url' (SSE) or 'command' (stdio) is required.");
      }

      const client = new Client(
        { name: "mili-agent", version: "3.0.0" },
        { capabilities: { tools: {} } }
      );

      await client.connect(transport);
      console.log(`✅ [mcpManager] Connected transport for "${name}". Listing tools...`);

      const toolsResult = await client.listTools();
      const tools = toolsResult?.tools || [];
      console.log(`🛠️ [mcpManager] Server "${name}" discovered ${tools.length} tool(s).`);

      this.clients.set(name, {
        client,
        transport,
        tools,
        config: serverConfig,
        connectedAt: new Date().toISOString(),
      });

      // Save to config file
      const currentConfig = this.readConfig();
      currentConfig.mcpServers[name] = serverConfig;
      this.saveConfig(currentConfig);

      return {
        success: true,
        serverName: name,
        toolsCount: tools.length,
        tools: tools.map((t) => ({ name: t.name, description: t.description })),
      };
    } catch (err) {
      console.error(`❌ [mcpManager] Failed to connect server "${name}":`, err.message);
      return {
        success: false,
        serverName: name,
        error: err.message,
      };
    }
  }

  /**
   * Disconnect an MCP server.
   */
  async disconnectServer(name) {
    if (!this.clients.has(name)) {
      return { success: false, message: `Server "${name}" is not active.` };
    }

    try {
      const entry = this.clients.get(name);
      if (entry.client) {
        await entry.client.close();
      }
      this.clients.delete(name);

      // Remove from config file
      const currentConfig = this.readConfig();
      if (currentConfig.mcpServers && currentConfig.mcpServers[name]) {
        delete currentConfig.mcpServers[name];
        this.saveConfig(currentConfig);
      }

      console.log(`🛑 [mcpManager] Disconnected server "${name}".`);
      return { success: true, serverName: name };
    } catch (err) {
      console.error(`❌ [mcpManager] Error closing server "${name}":`, err.message);
      this.clients.delete(name);
      return { success: false, error: err.message };
    }
  }

  /**
   * Returns a unified list of all active tools across all connected servers.
   */
  getAllTools() {
    const list = [];
    for (const [serverName, entry] of this.clients.entries()) {
      if (entry.tools && Array.isArray(entry.tools)) {
        for (const t of entry.tools) {
          list.push({
            serverName,
            toolName: t.name,
            fullName: `${serverName}__${t.name}`,
            description: t.description || "",
            inputSchema: t.inputSchema || {},
          });
        }
      }
    }
    return list;
  }

  /**
   * Get server status list.
   */
  getServersStatus() {
    const config = this.readConfig();
    const result = [];
    const allNames = new Set([...Object.keys(config.mcpServers || {}), ...this.clients.keys()]);

    for (const name of allNames) {
      const active = this.clients.get(name);
      result.push({
        name,
        connected: Boolean(active),
        toolsCount: active ? active.tools.length : 0,
        tools: active ? active.tools.map((t) => t.name) : [],
        config: active ? active.config : (config.mcpServers[name] || {}),
        connectedAt: active ? active.connectedAt : null,
      });
    }

    return result;
  }

  /**
   * Execute a tool on a connected server.
   */
  async executeTool(serverName, toolName, args = {}) {
    const entry = this.clients.get(serverName);
    if (!entry || !entry.client) {
      throw new Error(`MCP server "${serverName}" is not currently connected.`);
    }

    console.log(`⚡ [mcpManager] Calling tool "${toolName}" on server "${serverName}" with:`, args);
    try {
      const result = await entry.client.callTool({
        name: toolName,
        arguments: args,
      });
      return result;
    } catch (err) {
      console.error(`❌ [mcpManager] Tool execution failed: ${serverName}/${toolName}:`, err.message);
      throw err;
    }
  }

  /**
   * Auto-connect persisted servers on startup.
   */
  async autoConnectPersisted() {
    const config = this.readConfig();
    const servers = config.mcpServers || {};
    const names = Object.keys(servers);
    if (names.length === 0) return;

    console.log(`🔌 [mcpManager] Found ${names.length} persisted MCP server(s). Connecting in background...`);
    for (const name of names) {
      await this.connectServer(name, servers[name]);
    }
  }
}

// Singleton instance
const mcpManager = new MCPManager();

module.exports = {
  mcpManager,
  MCPManager,
};
