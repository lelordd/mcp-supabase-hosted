# Self-Hosted Supabase MCP Server

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![smithery badge](https://smithery.ai/badge/@HenkDz/selfhosted-supabase-mcp)](https://smithery.ai/server/@HenkDz/selfhosted-supabase-mcp)

## Overview

This project provides a [Model Context Protocol (MCP)](https://github.com/modelcontextprotocol/specification) server designed specifically for interacting with **self-hosted Supabase instances**. It bridges the gap between MCP clients (like IDE extensions) and your local or privately hosted Supabase projects, enabling database introspection, management, and interaction directly from your development environment.

This server was built from scratch, drawing lessons from adapting the official Supabase cloud MCP server, to provide a minimal, focused implementation tailored for the self-hosted use case.

## Purpose

The primary goal of this server is to enable developers using self-hosted Supabase installations to leverage MCP-based tools for tasks such as:

*   Querying database schemas and data.
*   Managing database migrations.
*   Inspecting database statistics and connections.
*   Managing authentication users.
*   Interacting with Supabase Storage.
*   Generating type definitions.

It avoids the complexities of the official cloud server related to multi-project management and cloud-specific APIs, offering a streamlined experience for single-project, self-hosted environments.

## Features (Implemented Tools)

The server exposes the following tools to MCP clients:

*   **Schema & Migrations**
    *   `list_tables`: Lists tables in the database schemas.
    *   `list_extensions`: Lists installed PostgreSQL extensions.
    *   `list_migrations`: Lists applied Supabase migrations.
    *   `apply_migration`: Applies a SQL migration script.
*   **Database Operations & Stats**
    *   `execute_sql`: Executes an arbitrary SQL query (via RPC or direct connection).
    *   `get_database_connections`: Shows active database connections (`pg_stat_activity`).
    *   `get_database_stats`: Retrieves database statistics (`pg_stat_*`).
*   **Project Configuration**
    *   `get_project_url`: Returns the configured Supabase URL.
    *   `verify_jwt_secret`: Checks if the JWT secret is configured.
*   **Development & Extension Tools**
    *   `generate_typescript_types`: Generates TypeScript types from the database schema.
    *   `rebuild_hooks`: Attempts to restart the `pg_net` worker (if used).
*   **Auth User Management**
    *   `list_auth_users`: Lists users from `auth.users`.
    *   `get_auth_user`: Retrieves details for a specific user.
    *   `create_auth_user`: Creates a new user (Requires direct DB access, insecure password handling).
    *   `delete_auth_user`: Deletes a user (Requires direct DB access).
    *   `update_auth_user`: Updates user details (Requires direct DB access, insecure password handling).
*   **Storage Insights**
    *   `list_storage_buckets`: Lists all storage buckets.
    *   `list_storage_objects`: Lists objects within a specific bucket.
*   **Realtime Inspection**
    *   `list_realtime_publications`: Lists PostgreSQL publications (often `supabase_realtime`).

*(Note: `get_logs` was initially planned but skipped due to implementation complexities in a self-hosted environment).*

## Setup and Installation

### Installing via Smithery

To install Self-Hosted Supabase MCP Server for Claude Desktop automatically via [Smithery](https://smithery.ai/server/@HenkDz/selfhosted-supabase-mcp):

```bash
npx -y @smithery/cli install @HenkDz/selfhosted-supabase-mcp --client claude
```

### Prerequisites

*   Node.js (Version 18.x or later recommended)
*   npm (usually included with Node.js)
*   Access to your self-hosted Supabase instance (URL, keys, potentially direct DB connection string).

### Steps

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd selfhosted-supabase-mcp
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    ```
3.  **Build the project:**
    ```bash
    npm run build
    ```
    This compiles the TypeScript code to JavaScript in the `dist` directory.

## Configuration

The server requires configuration details for your Supabase instance. These can be provided via command-line arguments or environment variables. CLI arguments take precedence.

**Required:**

*   `--url <url>` or `SUPABASE_URL=<url>`: The main HTTP URL of your Supabase project (e.g., `http://localhost:8000`).
*   `--anon-key <key>` or `SUPABASE_ANON_KEY=<key>`: Your Supabase project's anonymous key.

**Optional (but Recommended/Required for certain tools):**

*   `--service-key <key>` or `SUPABASE_SERVICE_ROLE_KEY=<key>`: Your Supabase project's service role key. Needed for operations requiring elevated privileges, like attempting to automatically create the `execute_sql` helper function if it doesn't exist.
*   `--db-url <url>` or `DATABASE_URL=<url>`: The direct PostgreSQL connection string for your Supabase database (e.g., `postgresql://postgres:password@localhost:5432/postgres`). Required for tools needing direct database access or transactions (`apply_migration`, Auth tools, Storage tools, querying `pg_catalog`, etc.).
*   `--jwt-secret <secret>` or `SUPABASE_AUTH_JWT_SECRET=<secret>`: Your Supabase project's JWT secret. Needed for tools like `verify_jwt_secret`.
*   `--tools-config <path>`: Path to a JSON file specifying which tools to enable (whitelist). If omitted, all tools defined in the server are enabled. The file should have the format `{"enabledTools": ["tool_name_1", "tool_name_2"]}`.

### Important Notes:

*   **`execute_sql` Helper Function:** Many tools rely on a `public.execute_sql` function within your Supabase database for secure and efficient SQL execution via RPC. The server attempts to check for this function on startup. If it's missing *and* a `service-key` (or `SUPABASE_SERVICE_ROLE_KEY`) *and* `db-url` (or `DATABASE_URL`) are provided, it will attempt to create the function and grant necessary permissions. If creation fails or keys aren't provided, tools relying solely on RPC may fail.
*   **Direct Database Access:** Tools interacting directly with privileged schemas (`auth`, `storage`) or system catalogs (`pg_catalog`) generally require the `DATABASE_URL` to be configured for a direct `pg` connection.

## Usage

Run the server using Node.js, providing the necessary configuration:

```bash
# Using CLI arguments (example)
node dist/index.js --url http://localhost:8000 --anon-key <your-anon-key> --db-url postgresql://postgres:password@localhost:5432/postgres [--service-key <your-service-key>]

# Example with tool whitelisting via config file
node dist/index.js --url http://localhost:8000 --anon-key <your-anon-key> --tools-config ./mcp-tools.json

# Or configure using environment variables and run:
# export SUPABASE_URL=http://localhost:8000
# export SUPABASE_ANON_KEY=<your-anon-key>
# export DATABASE_URL=postgresql://postgres:password@localhost:5432/postgres
# export SUPABASE_SERVICE_ROLE_KEY=<your-service-key>
# The --tools-config option MUST be passed as a CLI argument if used
node dist/index.js

# Using npm start script (if configured in package.json to pass args/read env)
npm start -- --url ... --anon-key ...
```

The server communicates via standard input/output (stdio) and is designed to be invoked by an MCP client application (e.g., an IDE extension like Cursor). The client will connect to the server's stdio stream to list and call the available tools.

## Client Configuration Examples

Below are examples of how to configure popular MCP clients to use this self-hosted server. 

**Important:** 
*   Replace placeholders like `<your-supabase-url>`, `<your-anon-key>`, `<your-db-url>`, `<path-to-dist/index.js>` etc., with your actual values.
*   Ensure the path to the compiled server file (`dist/index.js`) is correct for your system.
*   Be cautious about storing sensitive keys directly in configuration files, especially if committed to version control. Consider using environment variables or more secure methods where supported by the client.

### Cursor

1.  Create or open the file `.cursor/mcp.json` in your project root.
2.  Add the following configuration:

    ```json
    {
      "mcpServers": {
        "selfhosted-supabase": { 
          "command": "node",
          "args": [
            "<path-to-dist/index.js>", // e.g., "F:/Projects/mcp-servers/self-hosted-supabase-mcp/dist/index.js"
            "--url",
            "<your-supabase-url>", // e.g., "http://localhost:8000"
            "--anon-key",
            "<your-anon-key>",
            // Optional - Add these if needed by the tools you use
            "--service-key",
            "<your-service-key>",
            "--db-url",
            "<your-db-url>", // e.g., "postgresql://postgres:password@host:port/postgres"
            "--jwt-secret",
            "<your-jwt-secret>",
            // Optional - Whitelist specific tools
            "--tools-config",
            "<path-to-your-mcp-tools.json>" // e.g., "./mcp-tools.json"
          ]
        }
      }
    }
    ```

### Visual Studio Code (Copilot)

VS Code Copilot allows using environment variables populated via prompted inputs, which is more secure for keys.

1.  Create or open the file `.vscode/mcp.json` in your project root.
2.  Add the following configuration:

    ```json
    {
      "inputs": [
        { "type": "promptString", "id": "sh-supabase-url", "description": "Self-Hosted Supabase URL", "default": "http://localhost:8000" },
        { "type": "promptString", "id": "sh-supabase-anon-key", "description": "Self-Hosted Supabase Anon Key", "password": true },
        { "type": "promptString", "id": "sh-supabase-service-key", "description": "Self-Hosted Supabase Service Key (Optional)", "password": true, "required": false },
        { "type": "promptString", "id": "sh-supabase-db-url", "description": "Self-Hosted Supabase DB URL (Optional)", "password": true, "required": false },
        { "type": "promptString", "id": "sh-supabase-jwt-secret", "description": "Self-Hosted Supabase JWT Secret (Optional)", "password": true, "required": false },
        { "type": "promptString", "id": "sh-supabase-server-path", "description": "Path to self-hosted-supabase-mcp/dist/index.js" },
        { "type": "promptString", "id": "sh-supabase-tools-config", "description": "Path to tools config JSON (Optional, e.g., ./mcp-tools.json)", "required": false }
      ],
      "servers": {
        "selfhosted-supabase": {
          "command": "node",
          // Arguments are passed via environment variables set below OR direct args for non-env options
          "args": [
            "${input:sh-supabase-server-path}",
            // Use direct args for options not easily map-able to standard env vars like tools-config
            // Check if tools-config input is provided before adding the argument
            ["--tools-config", "${input:sh-supabase-tools-config}"] 
            // Alternatively, pass all as args if simpler:
            // "--url", "${input:sh-supabase-url}",
            // "--anon-key", "${input:sh-supabase-anon-key}",
            // ... etc ... 
           ],
          "env": {
            "SUPABASE_URL": "${input:sh-supabase-url}",
            "SUPABASE_ANON_KEY": "${input:sh-supabase-anon-key}",
            "SUPABASE_SERVICE_ROLE_KEY": "${input:sh-supabase-service-key}",
            "DATABASE_URL": "${input:sh-supabase-db-url}",
            "SUPABASE_AUTH_JWT_SECRET": "${input:sh-supabase-jwt-secret}"
            // The server reads these environment variables as fallbacks if CLI args are missing
          }
        }
      }
    }
    ```
3.  When you use Copilot Chat in Agent mode (@workspace), it should detect the server. You will be prompted to enter the details (URL, keys, path) when the server is first invoked.

### Other Clients (Windsurf, Cline, Claude)

Adapt the configuration structure shown for Cursor or the official Supabase documentation, replacing the `command` and `args` with the `node` command and the arguments for this server, similar to the Cursor example:

```json
{
  "mcpServers": {
    "selfhosted-supabase": { 
      "command": "node",
      "args": [
        "<path-to-dist/index.js>", 
        "--url", "<your-supabase-url>", 
        "--anon-key", "<your-anon-key>", 
        // Optional args...
        "--service-key", "<your-service-key>", 
        "--db-url", "<your-db-url>", 
        "--jwt-secret", "<your-jwt-secret>",
        // Optional tools config
        "--tools-config", "<path-to-your-mcp-tools.json>"
      ]
    }
  }
}
```
Consult the specific documentation for each client on where to place the `mcp.json` or equivalent configuration file.

## Docker Integration with Self-Hosted Supabase

This MCP server can be integrated directly into a self-hosted Supabase Docker Compose stack, making it available alongside other Supabase services via the Kong API gateway.

### Architecture Overview

When integrated with Docker:
- The MCP server runs in HTTP transport mode (not stdio)
- It's exposed through Kong at `/mcp/v1/*`
- JWT authentication is handled by the MCP server itself
- The server has direct access to the database and all Supabase keys

### Setup Steps

#### 1. Add the MCP Server as a Git Submodule

From your Supabase Docker directory:

```bash
git submodule add https://github.com/HenkDz/selfhosted-supabase-mcp.git selfhosted-supabase-mcp
```

#### 2. Create the Dockerfile

Create `volumes/mcp/Dockerfile`:

```dockerfile
# Dockerfile for selfhosted-supabase-mcp HTTP mode
# Multi-stage build using Bun runtime for self-hosted Supabase

FROM oven/bun:1.1-alpine AS builder

WORKDIR /app

# Copy package files from submodule
COPY selfhosted-supabase-mcp/package.json selfhosted-supabase-mcp/bun.lock* ./

# Install dependencies
RUN bun install --frozen-lockfile || bun install

# Copy source code
COPY selfhosted-supabase-mcp/src ./src
COPY selfhosted-supabase-mcp/tsconfig.json ./

# Build the application
RUN bun build src/index.ts --outdir dist --target bun

# Production stage
FROM oven/bun:1.1-alpine AS runner

WORKDIR /app

# Create non-root user for security
RUN addgroup --system --gid 1001 mcp && \
    adduser --system --uid 1001 --ingroup mcp mcp

# Copy built application from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Set ownership
RUN chown -R mcp:mcp /app

USER mcp

# Default environment variables
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3100/health || exit 1

# Expose HTTP port
EXPOSE 3100

# Start the MCP server in HTTP mode
CMD ["bun", "run", "dist/index.js"]
```

#### 3. Add the MCP Service to docker-compose.yml

Add this service definition to your `docker-compose.yml`:

```yaml
## MCP Server - Model Context Protocol for AI integrations
## DISABLED BY DEFAULT - Add 'mcp' to COMPOSE_PROFILES to enable
mcp:
  container_name: ${COMPOSE_PROJECT_NAME:-supabase}-mcp
  profiles:
    - mcp
  build:
    context: .
    dockerfile: ./volumes/mcp/Dockerfile
  restart: unless-stopped
  healthcheck:
    test:
      [
        "CMD",
        "wget",
        "--no-verbose",
        "--tries=1",
        "--spider",
        "http://localhost:3100/health"
      ]
    timeout: 5s
    interval: 10s
    retries: 3
  depends_on:
    db:
      condition: service_healthy
    rest:
      condition: service_started
  environment:
    SUPABASE_URL: http://kong:8000
    SUPABASE_ANON_KEY: ${ANON_KEY}
    SUPABASE_SERVICE_ROLE_KEY: ${SERVICE_ROLE_KEY}
    SUPABASE_AUTH_JWT_SECRET: ${JWT_SECRET}
    DATABASE_URL: postgresql://postgres:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}
  command:
    [
      "bun",
      "run",
      "dist/index.js",
      "--transport", "http",
      "--port", "3100",
      "--host", "0.0.0.0",
      "--url", "http://kong:8000",
      "--anon-key", "${ANON_KEY}",
      "--service-key", "${SERVICE_ROLE_KEY}",
      "--jwt-secret", "${JWT_SECRET}",
      "--db-url", "postgresql://postgres:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}"
    ]
```

#### 4. Add Kong API Gateway Routes

Add the MCP routes to `volumes/api/kong.yml` in the `services` section:

```yaml
## MCP Server routes - Model Context Protocol for AI integrations
## Authentication is handled by the MCP server itself (JWT validation)
- name: mcp-v1
  _comment: 'MCP Server: /mcp/v1/* -> http://mcp:3100/*'
  url: http://mcp:3100/
  routes:
    - name: mcp-v1-all
      strip_path: true
      paths:
        - /mcp/v1/
  plugins:
    - name: cors
      config:
        origins:
          - "$SITE_URL_PATTERN"
          - "http://localhost:3000"
          - "http://127.0.0.1:3000"
        methods:
          - GET
          - POST
          - DELETE
          - OPTIONS
        headers:
          - Accept
          - Authorization
          - Content-Type
          - X-Client-Info
          - apikey
          - Mcp-Session-Id
        exposed_headers:
          - Mcp-Session-Id
        credentials: true
        max_age: 3600
```

#### 5. Enable the MCP Service

The MCP service uses Docker Compose profiles, so it's disabled by default. To enable it:

**Option A: Set in `.env` file:**
```bash
COMPOSE_PROFILES=mcp
```

**Option B: Enable at runtime:**
```bash
docker compose --profile mcp up -d
```

### Accessing the MCP Server

Once running, the MCP server is available at:
- **Internal (from other containers):** `http://mcp:3100`
- **External (via Kong):** `http://localhost:8000/mcp/v1/`

### Authentication

When running in HTTP mode, the MCP server validates JWTs using the configured `JWT_SECRET`. Clients must include a valid Supabase JWT in the `Authorization` header:

```
Authorization: Bearer <supabase-jwt>
```

The JWT's `role` claim determines access:
- `service_role`: Full access to all tools (regular, privileged, sensitive)
- `authenticated`: Access to regular tools only
- `anon`: Access to regular tools only

### Health Check

The MCP server exposes a health endpoint:
```bash
curl http://localhost:8000/mcp/v1/health
```

### Security Considerations

When deploying via Docker:
1. The MCP server runs as a non-root user (`mcp:mcp`)
2. JWT authentication is enforced for all tool calls
3. Privileged tools (like `execute_sql`) require `service_role` JWT
4. CORS is configured via Kong - adjust origins for your deployment

## Development

*   **Language:** TypeScript
*   **Build:** `tsc` (TypeScript Compiler) or `bun build`
*   **Runtime:** Node.js or Bun
*   **Dependencies:** Managed via `npm` or `bun` (`package.json`)
*   **Core Libraries:** `@supabase/supabase-js`, `pg` (node-postgres), `zod` (validation), `commander` (CLI args), `@modelcontextprotocol/sdk` (MCP server framework).

## License

This project is licensed under the MIT License. See the LICENSE file for details. 
