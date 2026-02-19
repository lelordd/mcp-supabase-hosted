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

Tools are categorized by privilege level:
- **Regular** tools are accessible by any authenticated Supabase JWT (`authenticated` or `service_role` role).
- **Privileged** tools require a `service_role` JWT (HTTP mode) or direct database/service-key access (stdio mode).

### Schema & Migrations
| Tool | Description | Privilege |
|------|-------------|-----------|
| `list_tables` | Lists tables in the database schemas | Regular |
| `list_extensions` | Lists installed PostgreSQL extensions | Regular |
| `list_available_extensions` | Lists all available (installable) extensions | Regular |
| `list_migrations` | Lists applied migrations from `supabase_migrations.schema_migrations` | Regular |
| `apply_migration` | Applies a SQL migration and records it in `supabase_migrations.schema_migrations` | **Privileged** |
| `list_table_columns` | Lists columns for a specific table | Regular |
| `list_indexes` | Lists indexes for a specific table | Regular |
| `list_constraints` | Lists constraints for a specific table | Regular |
| `list_foreign_keys` | Lists foreign keys for a specific table | Regular |
| `list_triggers` | Lists triggers for a specific table | Regular |
| `list_database_functions` | Lists user-defined database functions | Regular |
| `get_function_definition` | Gets the source definition of a function | Regular |
| `get_trigger_definition` | Gets the source definition of a trigger | Regular |

### Database Operations & Stats
| Tool | Description | Privilege |
|------|-------------|-----------|
| `execute_sql` | Executes an arbitrary SQL query | **Privileged** |
| `explain_query` | Runs `EXPLAIN ANALYZE` on a query | **Privileged** |
| `get_database_connections` | Shows active connections (`pg_stat_activity`) | Regular |
| `get_database_stats` | Retrieves database statistics (`pg_stat_*`) | Regular |
| `get_index_stats` | Shows index usage statistics | Regular |
| `get_vector_index_stats` | Shows pgvector index statistics | Regular |

### Security & RLS
| Tool | Description | Privilege |
|------|-------------|-----------|
| `list_rls_policies` | Lists Row-Level Security policies for a table | Regular |
| `get_rls_status` | Shows RLS enabled/disabled status for tables | Regular |
| `get_advisors` | Retrieves security and performance advisory notices | Regular |

### Project Configuration
| Tool | Description | Privilege |
|------|-------------|-----------|
| `get_project_url` | Returns the configured Supabase URL | Regular |
| `verify_jwt_secret` | Checks if the JWT secret is configured | Regular |

### Development & Extension Tools
| Tool | Description | Privilege |
|------|-------------|-----------|
| `generate_typescript_types` | Generates TypeScript types from the database schema | Regular |
| `rebuild_hooks` | Restarts the `pg_net` worker (if used) | **Privileged** |
| `get_logs` | Retrieves recent log entries (analytics stack or CSV fallback) | Regular |

### Auth User Management
| Tool | Description | Privilege |
|------|-------------|-----------|
| `list_auth_users` | Lists users from `auth.users` | Regular |
| `get_auth_user` | Retrieves details for a specific user | Regular |
| `create_auth_user` | Creates a new user in `auth.users` (password bcrypt-hashed via pgcrypto) | **Privileged** |
| `update_auth_user` | Updates user details (password bcrypt-hashed if changed) | **Privileged** |
| `delete_auth_user` | Deletes a user from `auth.users` | **Privileged** |

### Storage
| Tool | Description | Privilege |
|------|-------------|-----------|
| `list_storage_buckets` | Lists all storage buckets | Regular |
| `list_storage_objects` | Lists objects within a specific bucket | Regular |
| `get_storage_config` | Retrieves storage bucket configuration | Regular |
| `update_storage_config` | Updates storage bucket settings | **Privileged** |

### Realtime Inspection
| Tool | Description | Privilege |
|------|-------------|-----------|
| `list_realtime_publications` | Lists PostgreSQL publications (e.g. `supabase_realtime`) | Regular |

### Extension-Specific Tools
| Tool | Description | Privilege |
|------|-------------|-----------|
| `list_cron_jobs` | Lists scheduled jobs (requires `pg_cron` extension) | Regular |
| `get_cron_job_history` | Shows recent execution history for a cron job | Regular |
| `list_vector_indexes` | Lists pgvector indexes (requires `pgvector` extension) | Regular |

### Edge Functions
| Tool | Description | Privilege |
|------|-------------|-----------|
| `list_edge_functions` | Lists deployed Edge Functions | Regular |
| `get_edge_function_details` | Gets details and metadata for an Edge Function | Regular |
| `list_edge_function_logs` | Retrieves recent logs for an Edge Function | Regular |

---

### About `supabase_migrations.schema_migrations`

The `list_migrations` and `apply_migration` tools rely on the `supabase_migrations.schema_migrations` table. This table is **created and managed by the Supabase CLI** — it is not part of the MCP server itself.

**How the table is created:**

The table is automatically created when you initialise or run migrations using the Supabase CLI:
```bash
supabase db push        # pushes local migrations to a remote database
supabase migration up   # applies pending local migration files
```

If you have never run the Supabase CLI against your database, the table will not exist and `list_migrations` will return an error. You can create it manually with:
```sql
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
    version text NOT NULL PRIMARY KEY,
    name    text NOT NULL DEFAULT '',
    inserted_at timestamptz NOT NULL DEFAULT now()
);
```

**Schema difference vs. official Supabase:**

The Supabase cloud platform tracks additional columns (e.g. `statements`, `dirty`). This MCP server uses the minimal schema (version + name + inserted_at) that is compatible with the Supabase CLI's local-development workflow. If your existing table has extra columns they are simply ignored.

## Setup and Installation

### Installing via Smithery

To install Self-Hosted Supabase MCP Server for Claude Desktop automatically via [Smithery](https://smithery.ai/server/@HenkDz/selfhosted-supabase-mcp):

```bash
npx -y @smithery/cli install @HenkDz/selfhosted-supabase-mcp --client claude
```

### Prerequisites

*   [Bun](https://bun.sh/) v1.1 or later (replaces Node.js/npm — used for runtime and builds)
*   Access to your self-hosted Supabase instance (URL, keys, and optionally a direct PostgreSQL connection string).

### Steps

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd selfhosted-supabase-mcp
    ```
2.  **Install dependencies:**
    ```bash
    bun install
    ```
3.  **Build the project:**
    ```bash
    bun run build
    ```
    This compiles the TypeScript source to JavaScript in the `dist` directory.

## Configuration

The server requires configuration details for your Supabase instance. These can be provided via command-line arguments or environment variables. CLI arguments take precedence.

**Required:**

*   `--url <url>` or `SUPABASE_URL=<url>`: The main HTTP URL of your Supabase project (e.g., `http://localhost:8000`).
*   `--anon-key <key>` or `SUPABASE_ANON_KEY=<key>`: Your Supabase project's anonymous key.

**Optional (but Recommended/Required for certain tools):**

*   `--service-key <key>` or `SUPABASE_SERVICE_ROLE_KEY=<key>`: Your Supabase project's service role key. Required for privileged tools and for auto-creating the `execute_sql` helper function on startup.
*   `--db-url <url>` or `DATABASE_URL=<url>`: The direct PostgreSQL connection string for your Supabase database (e.g., `postgresql://postgres:password@localhost:5432/postgres`). Required for tools needing direct database access (`apply_migration`, Auth tools, Storage tools, `pg_catalog` queries).
*   `--jwt-secret <secret>` or `SUPABASE_AUTH_JWT_SECRET=<secret>`: Your Supabase project's JWT secret. Required when using `--transport http` and needed by the `verify_jwt_secret` tool.
*   `--tools-config <path>`: Path to a JSON file specifying which tools to enable (whitelist). If omitted, all tools are enabled. Format: `{"enabledTools": ["tool_name_1", "tool_name_2"]}`.

**HTTP transport options (when using `--transport http`):**

*   `--port <number>`: HTTP server port (default: `3000`).
*   `--host <string>`: HTTP server host (default: `127.0.0.1`).
*   `--cors-origins <origins>`: Comma-separated list of allowed CORS origins. Defaults to localhost only.
*   `--rate-limit-window <ms>`: Rate limit window in milliseconds (default: `60000`).
*   `--rate-limit-max <count>`: Max requests per rate limit window (default: `100`).
*   `--request-timeout <ms>`: Request timeout in milliseconds (default: `30000`).

### Important Notes:

*   **`execute_sql` Helper Function:** Many tools rely on a `public.execute_sql` function within your Supabase database for SQL execution via RPC. The server attempts to check for this function on startup. If it's missing *and* a `service-key` *and* `db-url` are provided, it will attempt to create the function automatically. If creation fails or keys aren't provided, tools relying solely on RPC may fail.
*   **Direct Database Access:** Tools interacting directly with privileged schemas (`auth`, `storage`) or system catalogs (`pg_catalog`) generally require `DATABASE_URL` to be configured.
*   **Coolify / reverse-proxy deployments:**
    *   The `DATABASE_URL` must use the internal hostname reachable from wherever the MCP server process runs, not the public-facing domain.
    *   An `ECONNRESET` error during startup means the `DATABASE_URL` cannot be reached from the server's network context.
    *   The server will still start successfully and all tools that don't require a direct DB connection will continue to work normally.

## Security

### HTTP transport (recommended for remote access)

When running with `--transport http`, the server enforces:
- **JWT authentication** on all `/mcp` endpoints using your `SUPABASE_AUTH_JWT_SECRET`.
- **Privilege-based access control (RBAC)** — the `role` claim in the JWT determines which tools are accessible:
  - `service_role`: Full access (all tools including privileged ones).
  - `authenticated`: Regular tools only.
  - `anon`: No tool access.
- **Rate limiting** — configurable request rate limit per IP address.
- **CORS** — configurable allow-list of origins (defaults to localhost only).
- **Security headers** — `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, etc.
- **Request timeouts** — configurable timeout to prevent resource exhaustion.

### Stdio transport (local development)

Stdio mode has **no authentication** — all tools (including privileged ones) are accessible. It is intended for trusted local clients only (e.g., an IDE extension running on your local machine). A warning is printed on startup when this mode is used.

### Password handling for auth user tools

`create_auth_user` and `update_auth_user` accept a plain-text password from the MCP client, then immediately hash it with **bcrypt** (via PostgreSQL's `pgcrypto` extension: `crypt($password, gen_salt('bf'))`) before storing it in `auth.users`. The plain-text password is never stored. Passwords are passed as query parameters (not string-interpolated into SQL), preventing SQL injection.

> **Note:** The password travels over the MCP transport in plain text between the MCP client and server. This is inherent to the MCP protocol interface and unavoidable at this layer. Use the HTTP transport with TLS termination (e.g., behind Kong/nginx) for network protection.

### SQL execution security

All database operations in the MCP server use parameterized queries (`$1`, `$2`, ...) to prevent SQL injection. The `execute_sql` tool is an intentional exception — it executes arbitrary SQL by design (it is the tool's purpose). This tool is restricted to `service_role` privilege level to limit exposure.

## Usage

### Stdio mode (local MCP clients)

Run the server using Bun, providing the necessary configuration:

```bash
# Using CLI arguments (stdio mode — default)
bun run dist/index.js --url http://localhost:8000 --anon-key <your-anon-key> \
  --db-url postgresql://postgres:password@localhost:5432/postgres \
  --service-key <your-service-key>

# Example with tool whitelisting via config file
bun run dist/index.js --url http://localhost:8000 --anon-key <your-anon-key> \
  --tools-config ./mcp-tools.json

# Or configure using environment variables and run:
# export SUPABASE_URL=http://localhost:8000
# export SUPABASE_ANON_KEY=<your-anon-key>
# export DATABASE_URL=postgresql://postgres:password@localhost:5432/postgres
# export SUPABASE_SERVICE_ROLE_KEY=<your-service-key>
bun run dist/index.js
```

### HTTP mode (Docker / remote access)

```bash
bun run dist/index.js \
  --transport http \
  --port 3100 \
  --host 0.0.0.0 \
  --url http://kong:8000 \
  --anon-key <your-anon-key> \
  --service-key <your-service-key> \
  --jwt-secret <your-jwt-secret> \
  --db-url postgresql://postgres:password@db:5432/postgres
```

HTTP mode requires `--jwt-secret`. All `/mcp` requests must include a valid Supabase JWT in the `Authorization: Bearer <token>` header.

The server communicates via stdio (default) or HTTP (Streamable HTTP Transport) and is designed to be invoked by an MCP client application (e.g., an IDE extension like Cursor). The client will connect to the server's stdio stream or HTTP endpoint to list and call the available tools.

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
          "command": "bun",
          "args": [
            "run",
            "<path-to-dist/index.js>", // e.g., "/home/user/selfhosted-supabase-mcp/dist/index.js"
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
          "command": "bun",
          "args": [
            "run",
            "${input:sh-supabase-server-path}",
            "--tools-config", "${input:sh-supabase-tools-config}"
           ],
          "env": {
            "SUPABASE_URL": "${input:sh-supabase-url}",
            "SUPABASE_ANON_KEY": "${input:sh-supabase-anon-key}",
            "SUPABASE_SERVICE_ROLE_KEY": "${input:sh-supabase-service-key}",
            "DATABASE_URL": "${input:sh-supabase-db-url}",
            "SUPABASE_AUTH_JWT_SECRET": "${input:sh-supabase-jwt-secret}"
          }
        }
      }
    }
    ```
3.  When you use Copilot Chat in Agent mode (@workspace), it should detect the server. You will be prompted to enter the details (URL, keys, path) when the server is first invoked.

### Other Clients (Windsurf, Cline, Claude)

Adapt the configuration structure shown for Cursor or the official Supabase documentation, replacing the `command` and `args` with the `bun run` command and the arguments for this server, similar to the Cursor example:

```json
{
  "mcpServers": {
    "selfhosted-supabase": { 
      "command": "bun",
      "args": [
        "run",
        "<path-to-dist/index.js>", 
        "--url", "<your-supabase-url>", 
        "--anon-key", "<your-anon-key>", 
        "--service-key", "<your-service-key>", 
        "--db-url", "<your-db-url>", 
        "--jwt-secret", "<your-jwt-secret>",
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
- `service_role`: Full access to all tools (regular + privileged)
- `authenticated`: Access to regular tools only
- `anon`: No tool access

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
*   **Build:** `bun build` (via `bun run build`)
*   **Runtime:** [Bun](https://bun.sh/) v1.1+
*   **Test runner:** `bun test`
*   **Dependencies:** Managed via `bun` (`bun.lock`)
*   **Core Libraries:** `@supabase/supabase-js`, `pg` (node-postgres), `zod` (validation), `commander` (CLI args), `@modelcontextprotocol/sdk` (MCP server framework), `express`, `jsonwebtoken`.

## License

This project is licensed under the MIT License. See the LICENSE file for details. 
