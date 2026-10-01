# 🔌 Backend Connections, Connection Pooling & Timeout Safeguards Specification

**Status**: Step 8 PASS & Verified  
**Implementation Cycle**: AUDIT ➔ DESIGN ➔ BACKUP ➔ IMPLEMENT ➔ TEST ➔ VERIFY ➔ DOCUMENT ➔ PASS  
**Target Cluster**: Native Windows PostgreSQL 18 (`localhost:5432` / `host.docker.internal:5432`)

---

## 1. Connection Strings Directory

### 1.1 Local Windows Host Access (`localhost:5432`)
Used by backend microservices, local CLI scripts, and diagnostic tools running on Windows:

| Database | Role | Connection String (`DATABASE_URL`) | Purpose |
| :--- | :--- | :--- | :--- |
| `platform_db` | `platform_app` | `postgresql://platform_app:<password>@localhost:5432/platform_db` | Master Control Plane DDL/DML |
| `pos_db` | `pos_app` | `postgresql://pos_app:<password>@localhost:5432/pos_db` | Retail POS & Inventory Domain |
| `bise_db` | `bise_app` | `postgresql://bise_app:<password>@localhost:5432/bise_db` | Education & Results Domain |
| `hospital_db` | `hospital_app` | `postgresql://hospital_app:<password>@localhost:5432/hospital_db` | Healthcare & Clinic Domain |

### 1.2 Containerized Docker Access (`host.docker.internal:5432`)
Used by containerized services (n8n, Evolution API, FAISS Service) communicating across Docker Desktop to the host:

| Database | Role | Container Connection String |
| :--- | :--- | :--- |
| `platform_db` | `platform_app` | `postgresql://platform_app:<password>@host.docker.internal:5432/platform_db` |
| `pos_db` | `pos_app` | `postgresql://pos_app:<password>@host.docker.internal:5432/pos_db` |
| `bise_db` | `bise_app` | `postgresql://bise_app:<password>@host.docker.internal:5432/bise_db` |
| `hospital_db` | `hospital_app` | `postgresql://hospital_app:<password>@host.docker.internal:5432/hospital_db` |

### 1.3 Least-Privilege Gateway Connections (AI Agent Query Nodes)
Used by n8n workflow tools and AI agents to enforce read-only safety and audited state mutations:

- **Read-Only Data Gateway** (`gateway_readonly` / `gateway_secure_readonly_2026`):
  - `postgresql://gateway_readonly:gateway_secure_readonly_2026@host.docker.internal:5432/pos_db`
  - `postgresql://gateway_readonly:gateway_secure_readonly_2026@host.docker.internal:5432/bise_db`
  - `postgresql://gateway_readonly:gateway_secure_readonly_2026@host.docker.internal:5432/hospital_db`
- **State-Changing Action Gateway** (`gateway_action_writer` / `gateway_action_writer_2026`):
  - `postgresql://gateway_action_writer:gateway_action_writer_2026@host.docker.internal:5432/pos_db`
  - `postgresql://gateway_action_writer:gateway_action_writer_2026@host.docker.internal:5432/hospital_db`

---

## 2. Environment Variables Architecture

All credentials and pool parameters are governed through the master `.env` configuration file:

```env
# Database Cluster Host
DB_HOST=localhost
DB_PORT=5432
DOCKER_DB_HOST=host.docker.internal
DOCKER_DB_PORT=5432

# Connection Pool Defaults
DB_POOL_MIN=2
DB_POOL_MAX=20
DB_IDLE_TIMEOUT_MS=30000
DB_CONNECTION_TIMEOUT_MS=5000

# Runtime Timeout Safeguards
DB_STATEMENT_TIMEOUT_MS=15000
DB_LOCK_TIMEOUT_MS=5000
DB_IDLE_IN_TRANSACTION_TIMEOUT_MS=20000
```

---

## 3. Connection Pooling & Timeout Safeguards Specification

### 3.1 Connection Pool Bounds
- **Maximum Connections (`max: 20`)**: Prevents any single microservice or n8n workflow run from exhausting PostgreSQL's `max_connections` limit.
- **Minimum Warm Connections (`min: 2`)**: Keeps active sockets warm to eliminate cold-start TCP/SSL handshakes during customer chat turns.
- **Connection Timeout (`5000ms`)**: Fails fast if the database instance is unreachable, avoiding indefinite HTTP hanging for WhatsApp users.
- **Idle Socket Timeout (`30000ms`)**: Reclaims unused connections back to the OS after 30 seconds of inactivity.

### 3.2 Dual-Layer Timeout Safeguards
Timeouts are enforced at **both the Application Level and Database Engine Level**:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        DUAL-LAYER TIMEOUT DEFENSE                      │
├────────────────────────────────────────────────────────────────────────┤
│ Layer 1: Application Pool Timeout                                      │
│   • Connection Acquisition: 5s                                         │
│   • Query Promise Timeout: 15s                                         │
├────────────────────────────────────────────────────────────────────────┤
│ Layer 2: PostgreSQL Server-Enforced Safeguards                         │
│   • statement_timeout = 15s (terminates runaway queries)               │
│   • lock_timeout = 5s (prevents blocking transactions)                 │
│   • idle_in_transaction_session_timeout = 20s (kills leaked locks)     │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Client Implementation Blueprints

### Node.js (`pg` Pool Manager)
```javascript
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.POS_DB_URL,
  max: parseInt(process.env.DB_POOL_MAX || '20', 10),
  min: parseInt(process.env.DB_POOL_MIN || '2', 10),
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT_MS || '30000', 10),
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT_MS || '5000', 10),
  statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '15000', 10)
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};
```

### Python (`psycopg2.pool`)
```python
import os
import psycopg2.pool

db_pool = psycopg2.pool.ThreadedConnectionPool(
    minconn=int(os.getenv("DB_POOL_MIN", 2)),
    maxconn=int(os.getenv("DB_POOL_MAX", 20)),
    dsn=os.getenv("POS_DB_URL"),
    options="-c statement_timeout=15000 -c lock_timeout=5000"
)
```
