/**
 * Phase 39: Platform Health, Monitoring & Observability Engine
 * 
 * Objective:
 * Detect service degradation, container failures, database bottlenecks,
 * and business workflow errors before users report them.
 * 
 * Monitored Vectors:
 * 1. Docker Container Health & Lifecycle (postgres, redis, evolution-go, n8n)
 * 2. PostgreSQL Multi-Database Health (platform_db, pos_db, bise_db, hospital_db)
 * 3. Redis In-Memory Cache & Connectivity (PING, memory, clients)
 * 4. Evolution API WhatsApp Gateway Status
 * 5. n8n Engine Execution & Endpoint Health
 * 6. Multi-Tenant Business Action Error Rates & SLA Delays
 * 7. Backup Freshness & RPO Compliance
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');

function runCommand(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: 'utf8', ...opts }).trim();
  } catch (err) {
    return null;
  }
}

function checkHttp(url, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    try {
      const parsed = new URL(url);
      const req = http.request({
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname || '/',
        method: 'GET',
        timeout: timeoutMs,
        headers: { 'User-Agent': 'PlatformHealthMonitor/1.0' }
      }, (res) => {
        res.resume(); // Consume data so socket closes immediately
        resolve({
          status: res.statusCode < 500 ? 'HEALTHY' : 'DEGRADED',
          statusCode: res.statusCode,
          latencyMs: Date.now() - startTime
        });
      });

      req.on('error', (e) => {
        resolve({ status: 'DOWN', error: e.message, latencyMs: Date.now() - startTime });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ status: 'TIMEOUT', latencyMs: timeoutMs });
      });

      req.end();
    } catch (err) {
      resolve({ status: 'ERROR', error: err.message, latencyMs: Date.now() - startTime });
    }
  });
}

async function collectPlatformMetrics() {
  const timestamp = new Date().toISOString();
  const report = {
    timestamp,
    overall_status: 'HEALTHY',
    containers: {},
    databases: {},
    redis: {},
    services: {},
    business_telemetry: {},
    backup_status: {},
    alerts: []
  };

  // 1. Docker Container Health Probe
  const expectedContainers = [
    'evolution-postgres',
    'evolution-redis',
    'evolution-go',
    'n8n',
    'n8n-automation-db-1'
  ];

  const psOutput = runCommand('docker ps --format "{{.Names}}|{{.Status}}|{{.RunningFor}}"');
  const runningMap = {};
  if (psOutput) {
    psOutput.split('\n').filter(Boolean).forEach(line => {
      const [name, status, runningFor] = line.split('|');
      runningMap[name] = { status, runningFor };
    });
  }

  for (const cName of expectedContainers) {
    if (runningMap[cName]) {
      report.containers[cName] = {
        state: 'RUNNING',
        status: runningMap[cName].status,
        running_for: runningMap[cName].runningFor
      };
    } else {
      report.containers[cName] = { state: 'STOPPED' };
      report.alerts.push({
        severity: 'CRITICAL',
        component: `Container:${cName}`,
        metric: 'Container Not Running',
        message: `Container ${cName} is stopped or missing from docker daemon.`,
        actionable_remediation: `Execute 'docker-compose up -d ${cName}' or inspect logs with 'docker logs ${cName}'.`
      });
    }
  }

  // 2. PostgreSQL Multi-Database Probe
  const dbs = ['platform_db', 'pos_db', 'bise_db', 'hospital_db'];
  for (const db of dbs) {
    const startDb = Date.now();
    const queryRes = runCommand(`docker exec -i evolution-postgres psql -U postgres -d ${db} -t -A -c "SELECT 1;"`);
    const dbLatency = Date.now() - startDb;

    if (queryRes === '1') {
      const connCount = parseInt(runCommand(`docker exec -i evolution-postgres psql -U postgres -d ${db} -t -A -c "SELECT count(*) FROM pg_stat_activity WHERE datname='${db}';"` ) || '1', 10);
      report.databases[db] = {
        status: 'HEALTHY',
        latency_ms: dbLatency,
        active_connections: connCount
      };

      if (dbLatency > 2000) {
        report.alerts.push({
          severity: 'WARNING',
          component: `Database:${db}`,
          metric: 'High Database Query Latency',
          message: `Simple ping on ${db} took ${dbLatency}ms (threshold: 2000ms).`,
          actionable_remediation: `Check for slow unindexed queries in pg_stat_activity and vacuum analyze tables.`
        });
      }
    } else {
      report.databases[db] = { status: 'DOWN', latency_ms: dbLatency };
      report.alerts.push({
        severity: 'CRITICAL',
        component: `Database:${db}`,
        metric: 'PostgreSQL Connectivity Failure',
        message: `Database ${db} is unreachable on evolution-postgres.`,
        actionable_remediation: `Verify PostgreSQL container health: 'docker exec evolution-postgres pg_isready'. Check logs: 'docker logs evolution-postgres'.`
      });
    }
  }

  // 3. Redis Health Probe
  const redisPing = runCommand('docker exec evolution-redis redis-cli PING');
  if (redisPing === 'PONG') {
    const infoOutput = runCommand('docker exec evolution-redis redis-cli INFO memory');
    const memoryMatch = infoOutput ? infoOutput.match(/used_memory_human:(.+)/) : null;
    const usedMemory = memoryMatch ? memoryMatch[1].trim() : 'UNKNOWN';

    report.redis = {
      status: 'HEALTHY',
      ping: 'PONG',
      used_memory: usedMemory
    };
  } else {
    report.redis = { status: 'DOWN' };
    report.alerts.push({
      severity: 'CRITICAL',
      component: 'Redis:evolution-redis',
      metric: 'Redis Ping Failure',
      message: 'Redis server failed to respond to PING.',
      actionable_remediation: `Inspect Redis container logs: 'docker logs evolution-redis'. Restart service: 'docker restart evolution-redis'.`
    });
  }

  // 4. HTTP Services Connectivity
  const n8nHttp = await checkHttp('http://localhost:5678/healthz');
  report.services['n8n_web'] = n8nHttp;
  if (n8nHttp.status === 'DOWN') {
    report.alerts.push({
      severity: 'CRITICAL',
      component: 'Service:n8n',
      metric: 'n8n HTTP Endpoint Unreachable',
      message: `n8n Web UI failed to respond on port 5678: ${n8nHttp.error}`,
      actionable_remediation: `Check if n8n container is crashing: 'docker logs --tail 50 n8n'. Restart: 'docker restart n8n'.`
    });
  }

  const evoHttp = await checkHttp('http://localhost:4000');
  report.services['evolution_api'] = evoHttp;
  if (evoHttp.status === 'DOWN') {
    report.alerts.push({
      severity: 'WARNING',
      component: 'Service:evolution-go',
      metric: 'Evolution API Port 4000 Unreachable',
      message: `Evolution API server not responding: ${evoHttp.error}`,
      actionable_remediation: `Verify evolution-go container status: 'docker logs --tail 50 evolution-go'. Check .env instance keys.`
    });
  }

  // 5. Business Telemetry & Error Rates
  try {
    const errorCountStr = runCommand(`docker exec -i evolution-postgres psql -U postgres -d platform_db -t -A -c "SELECT count(*) FROM platform_audit_metadata WHERE execution_result IN ('ERROR', 'FAILED', 'SECURITY_BLOCK');"`);
    const errorCount = parseInt(errorCountStr || '0', 10);

    const pendingApprovalsStr = runCommand(`docker exec -i evolution-postgres psql -U postgres -d platform_db -t -A -c "SELECT count(*) FROM platform_action_approvals WHERE status = 'PENDING';"`);
    const pendingApprovals = parseInt(pendingApprovalsStr || '0', 10);

    report.business_telemetry = {
      audit_error_events: errorCount,
      pending_supervisor_approvals: pendingApprovals
    };

    if (pendingApprovals > 20) {
      report.alerts.push({
        severity: 'WARNING',
        component: 'Business:ApprovalQueue',
        metric: 'High Pending Approvals',
        message: `${pendingApprovals} actions are currently awaiting human supervisor approval.`,
        actionable_remediation: `Alert human supervisor via WhatsApp or dashboard to review pending items in platform_action_approvals.`
      });
    }
  } catch (err) {
    report.business_telemetry = { error: err.message };
  }

  // 6. Backup Freshness Status
  try {
    const backupsDir = path.join('d:', 'AI-Automation', 'backups');
    const entries = fs.readdirSync(backupsDir)
      .filter(f => f.startsWith('dr-backup-'))
      .map(f => ({ name: f, time: fs.statSync(path.join(backupsDir, f)).mtime.getTime() }))
      .sort((a, b) => b.time - a.time);

    if (entries.length > 0) {
      const latest = entries[0];
      const ageHours = (Date.now() - latest.time) / (1000 * 3600);
      report.backup_status = {
        latest_backup: latest.name,
        age_hours: parseFloat(ageHours.toFixed(2)),
        status: ageHours < 24 ? 'FRESH' : 'STALE'
      };

      if (ageHours >= 24) {
        report.alerts.push({
          severity: 'WARNING',
          component: 'Storage:BackupFreshness',
          metric: 'Stale Disaster Recovery Backup',
          message: `Latest backup ${latest.name} is ${ageHours.toFixed(1)} hours old (exceeds 24h SLA).`,
          actionable_remediation: `Execute automated backup script immediately: 'node scripts/disaster_recovery_backup.js'.`
        });
      }
    } else {
      report.backup_status = { status: 'NO_BACKUPS_FOUND' };
      report.alerts.push({
        severity: 'CRITICAL',
        component: 'Storage:BackupFreshness',
        metric: 'Missing DR Backups',
        message: 'No disaster recovery backups found in d:\\AI-Automation\\backups.',
        actionable_remediation: `Trigger full platform backup: 'node scripts/disaster_recovery_backup.js'.`
      });
    }
  } catch (err) {
    report.backup_status = { error: err.message };
  }

  // Determine overall status
  if (report.alerts.some(a => a.severity === 'CRITICAL')) {
    report.overall_status = 'CRITICAL';
  } else if (report.alerts.some(a => a.severity === 'WARNING')) {
    report.overall_status = 'DEGRADED';
  } else {
    report.overall_status = 'HEALTHY';
  }

  return report;
}

if (require.main === module) {
  collectPlatformMetrics().then(report => {
    console.log(JSON.stringify(report, null, 2));
  });
}

module.exports = { collectPlatformMetrics, checkHttp };
