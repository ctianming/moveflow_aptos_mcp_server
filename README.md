# MoveFlow Aptos MCP Server

A Model Context Protocol (MCP) server that enables AI assistants to interact with the MoveFlow protocol on Aptos blockchain. This server provides a standardized interface for AI tools to create, manage, and interact with cryptocurrency streaming payments.

## Features

- **Stream Management**
  - Create payment streams (regular or one-time payments)
  - Withdraw funds from active streams
  - Close existing streams
  - Extend stream durations
  - Pause and resume streams
  - Query stream information

- **Batch Operations**
  - Create multiple streams at once
  - Withdraw from multiple streams simultaneously

- **MCP Tool Discovery**
  - Automatic tool discovery through MCP capability interface
  - Standardized input schema validation
  - Self-documenting API

## Available MCP Tools

The MoveFlow Aptos MCP server provides the following tools:

| Tool Name                | Description                    | Function                                                        |
| ------------------------ | ------------------------------ | --------------------------------------------------------------- |
| `create-stream`          | Create a new MoveFlow stream   | Creates a new cryptocurrency stream to transfer funds over time |
| `withdraw-stream`        | Withdraw funds from a stream   | Withdraws available funds from an active stream                 |
| `close-stream`           | Close a MoveFlow stream        | Terminates a stream and returns remaining funds to sender       |
| `extend-stream`          | Extend a stream's duration     | Increases the end time of an existing stream                    |
| `get-stream-info`        | Get stream information         | Retrieves details about a specific stream                       |
| `batch-create-streams`   | Create multiple streams        | Creates multiple streams in a single transaction                |
| `batch-withdraw-streams` | Withdraw from multiple streams | Withdraws from multiple streams in a single transaction         |
| `pause-stream`           | Pause a stream                 | Temporarily stops a stream's payments                           |
| `resume-stream`          | Resume a paused stream         | Restarts a paused stream                                        |

## Available Resources

The MoveFlow Aptos MCP server also provides access to blockchain resources:

| Resource URI                    | Description                                            |
| ------------------------------- | ------------------------------------------------------ |
| `moveflow://streams/active`     | Lists all active streams for the current account       |
| `moveflow://streams/{streamId}` | Retrieves detailed information about a specific stream |

These resources can be accessed directly by AI assistants supporting the MCP protocol, providing contextual information without requiring explicit tool calls.

## AI Assistant Integration

### Claude Desktop Integration

Add this server to your Claude Desktop configuration:

1. Open the Claude Desktop configuration file:
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`

2. Add the following configuration (adjust the path according to your setup):
```json
{
  "mcpServers": {
    "moveflow-aptos": {
      "command": "node",
      "args": ["/path/to/moveflow_aptos_mcp_server/build/index.js"],
      "env": {
        "APTOS_NODE_URL": "https://fullnode.mainnet.aptoslabs.com/v1",
        "APTOS_NETWORK": "mainnet",
        "READ_ONLY_MODE": "true" // Set to "true" for read-only mode, omit for transaction preparation mode
      },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

### Using with NPX

You can run this server directly using `npx` without installing it globally:

```bash
# Run with default settings
npx @moveflow/aptos-mcp-server

# Run with custom environment variables
npx @moveflow/aptos-mcp-server --env.APTOS_NETWORK=testnet --env.READ_ONLY_MODE=true

# For Claude Desktop integration:
```json
{
  "mcpServers": {
    "moveflow-aptos": {
      "command": "npx",
      "args": ["-y", "@moveflow/aptos-mcp-server"],
      "env": {
        "APTOS_NODE_URL": "https://fullnode.mainnet.aptoslabs.com/v1",
        "APTOS_NETWORK": "mainnet",
        "READ_ONLY_MODE": "true"
      }
    }
  }
}
```

### Other AI Plugin Integration

If you're developing your own AI plugin and want to integrate this MCP server, you can:

1. Add this repository as a dependency to your project
2. Start the server process
3. Communicate with the server through the MCP protocol

Example (TypeScript):
```typescript
import { spawn } from 'child_process';
import { Client } from '@modelcontextprotocol/sdk/client';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio';

// Start the MCP server
const serverProcess = spawn('node', ['path/to/build/index.js'], {
  env: {
    ...process.env,
    APTOS_NODE_URL: 'https://fullnode.mainnet.aptoslabs.com/v1',
    APTOS_NETWORK: 'mainnet',
    READ_ONLY_MODE: "true" // Enable read-only mode
  }
});

// Connect to the MCP server
const client = new Client({version: '1.0.0'}, {capabilities: {}});
const transport = new StdioClientTransport({childProcess: serverProcess});
await client.connect(transport);

// Now you can use the client object to call MCP methods
```

### Cline Integration

[Cline](https://github.com/cline/cline) is an autonomous coding agent in VS Code that supports MCP tools. To integrate the MoveFlow Aptos MCP server with Cline:

1. **Install the Cline Extension**:
   Install Cline from the VS Code extension marketplace

2. **Configure the MoveFlow Aptos MCP server**:
   Cline automatically searches for MCP servers in the `~/Documents/Cline/MCP` directory. You can:

   - **Method 1**: Create a server configuration file
     ```bash
     mkdir -p ~/Documents/Cline/MCP
     touch ~/Documents/Cline/MCP/moveflow-aptos.json
     ```

     Add the following content to `moveflow-aptos.json`:
     ```json
     {
       "name": "moveflow-aptos",
       "command": "node",
       "args": ["/path/to/moveflow_aptos_mcp_server/build/index.js"],
       "env": {
         "APTOS_NODE_URL": "https://fullnode.mainnet.aptoslabs.com/v1",
         "APTOS_NETWORK": "mainnet"
       }
     }
     ```

     **Note for VS Code Settings Configuration**:
     If you're configuring directly in VS Code settings instead of using the Cline MCP directory, use the following format:
     ```json
     {
       "mcpServers": {
         "moveflow-aptos": {
           "command": "node",
           "args": ["/home/amyseer/AI/mcp/mcp_servers/moveflow_aptos_mcp_server/build/index.js"],
           "env": {},
           "disabled": false,
           "autoApprove": []
         }
       }
     }
     ```

   - **Method 2**: Use Cline's natural language configuration
     In Cline, type:
     ```
     Add a tool that connects to Aptos blockchain using MoveFlow protocol
     ```
     Then follow the prompts to complete the configuration

3. **Set up private key** (optional):
   - For read-only operations, no private key is needed
   - For transaction operations, use environment variables or a `.env` file to set the private key, do **NOT** include the private key directly in the configuration file

4. **Using the server's features**:
   In Cline, you can access MoveFlow features using natural language, for example:
   ```
   Create a new payment stream on Aptos to address 0x123... for 100 APT over 30 days
   ```
   
   Or:
   ```
   Show me all my active MoveFlow streams on Aptos mainnet
   ```

⚠️ **Security Note**: Cline has its own security mechanisms and will ask for your permission before executing any operations. Nevertheless, it's recommended to follow the private key security best practices outlined in this document.

## Security Considerations - Security Architecture

This server implements a security architecture that eliminates private key storage:

### Client-Side Signing Model

The server has been designed to completely avoid storing private keys:

1. **Read-Only Mode**: 
   - Default mode of operation
   - Only allows querying blockchain data
   - Cannot execute any transactions
   - Enable with `READ_ONLY_MODE="true"`

2. **Transaction Preparation Mode**:
   - When `READ_ONLY_MODE` is omitted or set to "false"
   - Server prepares transactions but doesn't sign them
   - Transactions must be signed by client applications
   - Provides enhanced security by separating transaction preparation from signing

### Secure Transaction Architecture

The new architecture separates responsibility:
- Server: Validates inputs and prepares transaction objects
- Client: Manages private keys and signs transactions 
- API/Connector: Handles communication between server and client

This design eliminates the need for private key handling in the server process, making it significantly more secure for production use.

## Installation and Setup

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd moveflow_aptos_mcp_server
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the project:
   ```bash
   npm run build
   ```

4. Start the server:
   ```bash
   APTOS_NODE_URL="https://fullnode.mainnet.aptoslabs.com/v1" \
   APTOS_NETWORK="mainnet" \
   READ_ONLY_MODE="true" \
   node build/index.js
   ```

5. Verify the server is running:
   You should see the following output:
   ```
   Starting MoveFlow Aptos MCP Server...
   Initialized Stream with read-only mode
   MoveFlow Aptos MCP Server tools registered
   MoveFlow Aptos MCP Server started
   ```

## Configuration Reference

### Environment Variables

| Variable            | Description                                           | Required | Default                                   |
| ------------------- | ----------------------------------------------------- | -------- | ----------------------------------------- |
| `APTOS_NODE_URL`    | Aptos node URL                                        | Yes      | https://fullnode.mainnet.aptoslabs.com/v1 |
| `APTOS_NETWORK`     | Network type: "mainnet", "testnet", "devnet", "local" | Yes      | "mainnet"                                 |
| `READ_ONLY_MODE`    | Set to "true" to enable read-only mode                | No       | "false"                                   |
| `SIGNING_MODE`      | Signing mode: "direct" or "client"                    | No       | "client"                                  |
| `APTOS_PRIVATE_KEY` | Private key for direct signing mode                   | No*      | -                                         |
| `APTOS_FAUCET_URL`  | Test/Dev network faucet URL                           | No       | -                                         |

*Required only when `SIGNING_MODE` is set to "direct" and `READ_ONLY_MODE` is "false".

### Server Modes

- **Read-Only Mode**: When `READ_ONLY_MODE` is set to "true". Server can only query blockchain data.
- **Transaction Modes**: When `READ_ONLY_MODE` is set to "false", the server can operate in two modes:
  - **Client-Side Signing Mode** (Default): When `SIGNING_MODE` is set to "client" or omitted. Server prepares transactions but doesn't sign them. Transactions must be signed by client applications.
  - **Direct Signing Mode**: When `SIGNING_MODE` is set to "direct" and `APTOS_PRIVATE_KEY` is provided. Server uses the provided private key to sign and submit transactions directly. This mode is less secure but more convenient for testing and development.

## License

[MIT License](LICENSE)
