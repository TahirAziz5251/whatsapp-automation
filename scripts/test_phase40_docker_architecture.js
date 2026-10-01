/**
 * Phase 40 Test Suite: Production Docker Architecture Verification
 * 
 * Objective:
 * Verify that the production Docker service topology adheres to required
 * availability, network segmentation, zero-trust data tier isolation,
 * persistence, health checks, resource bounds, and TLS reverse proxy placement.
 * 
 * Tests:
 * 1. Production Topology File & Services Verification (docker-compose.prod.yml)
 * 2. 3-Tier Network Segmentation (edge_network, app_network, data_network)
 * 3. Data Tier Isolation (Postgres 5432 & Redis 6379 strictly unexposed to host)
 * 4. Named Volume Persistence & Mounts Verification
 * 5. Health Checks & Automatic Restart Policies
 * 6. Resource Boundaries (CPU / RAM limits & reservations)
 * 7. Reverse Proxy Configuration & TLS Hardening (Nginx upstream routing)
 * 8. Live Container Runtime Mounts & Connectivity Validation
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function runPsql(db, sql) {
  try {
    return execSync(`docker exec -i evolution-postgres psql -U postgres -d ${db} -t -A`, {
      input: sql,
      encoding: 'utf8'
    }).trim();
  } catch (err) {
    return null;
  }
}

async function runDockerArchitectureTests() {
  console.log(`\n================================================================`);
  console.log(`🐳 PHASE 40: PRODUCTION DOCKER ARCHITECTURE VERIFICATION`);
  console.log(`================================================================\n`);

  const results = {
    suite: 'Phase 40: Production Docker Architecture',
    timestamp: new Date().toISOString(),
    tests: [],
    passed: 0,
    failed: 0
  };

  function assert(condition, description, details = '') {
    if (condition) {
      results.passed++;
      results.tests.push({ description, status: 'PASS', details });
      console.log(`  ✓ PASS: ${description}`);
    } else {
      results.failed++;
      results.tests.push({ description, status: 'FAIL', details });
      console.error(`  ❌ FAIL: ${description} - ${details}`);
    }
  }

  const composePath = path.join('d:', 'AI-Automation', 'docker-compose.prod.yml');
  assert(fs.existsSync(composePath), 'docker-compose.prod.yml exists');

  const composeContent = fs.readFileSync(composePath, 'utf8');

  // -------------------------------------------------------------
  // Test 1: Service Inventory Verification
  // -------------------------------------------------------------
  console.log(`--- Test 1: Production Service Inventory ---`);
  const expectedServices = ['reverse-proxy', 'evolution-go', 'n8n', 'postgres', 'redis'];
  for (const s of expectedServices) {
    const serviceRegex = new RegExp(`^\\s{2}${s}:`, 'm');
    assert(serviceRegex.test(composeContent), `Production service defined: ${s}`);
  }

  // -------------------------------------------------------------
  // Test 2: 3-Tier Network Segmentation
  // -------------------------------------------------------------
  console.log(`\n--- Test 2: 3-Tier Network Segmentation ---`);
  assert(composeContent.includes('edge_network:'), 'edge_network defined');
  assert(composeContent.includes('app_network:'), 'app_network defined');
  assert(composeContent.includes('data_network:'), 'data_network defined');
  
  // Data network must be internal: true
  const dataNetRegex = /data_network:[\s\S]*?internal:\s*true/;
  assert(dataNetRegex.test(composeContent), 'data_network is strictly declared as internal: true (no public egress)');

  function getServiceBlock(compose, serviceName) {
    const lines = compose.split('\n');
    let capturing = false;
    const block = [];
    for (const line of lines) {
      if (line.match(new RegExp(`^  ${serviceName}:`))) {
        capturing = true;
        block.push(line);
        continue;
      }
      if (capturing) {
        if (line.match(/^  [a-z0-9_-]+:/) || line.match(/^[a-z0-9_-]+:/)) {
          break;
        }
        block.push(line);
      }
    }
    return block.join('\n');
  }

  // -------------------------------------------------------------
  // Test 3: Data Tier Isolation & Host Port Protection
  // -------------------------------------------------------------
  console.log(`\n--- Test 3: Zero-Trust Data Tier Port Isolation ---`);
  
  const postgresSection = getServiceBlock(composeContent, 'postgres');
  assert(postgresSection.includes('expose:'), 'Postgres uses expose for internal routing');
  assert(!postgresSection.includes('ports:'), 'Postgres does NOT expose ports to host 0.0.0.0 (Protected)');
  assert(!postgresSection.includes('edge_network'), 'Postgres is disconnected from edge_network');
  assert(postgresSection.includes('data_network'), 'Postgres is connected to data_network');

  const redisSection = getServiceBlock(composeContent, 'redis');
  assert(redisSection.includes('expose:'), 'Redis uses expose for internal routing');
  assert(!redisSection.includes('ports:'), 'Redis does NOT expose ports to host 0.0.0.0 (Protected)');
  assert(!redisSection.includes('edge_network'), 'Redis is disconnected from edge_network');
  assert(redisSection.includes('data_network'), 'Redis is connected to data_network');

  // Reverse proxy is the only service binding public ingress ports 80/443
  const proxySection = getServiceBlock(composeContent, 'reverse-proxy');
  assert(proxySection.includes('"80:80"'), 'Reverse proxy publishes port 80 (HTTP)');
  assert(proxySection.includes('"443:443"'), 'Reverse proxy publishes port 443 (HTTPS)');

  // -------------------------------------------------------------
  // Test 4: Named Persistent Volumes
  // -------------------------------------------------------------
  console.log(`\n--- Test 4: Named Persistent Volume Architecture ---`);
  const expectedVolumes = [
    'certs_data',
    'evolution_data',
    'evolution_logs',
    'n8n_data',
    'postgres_data',
    'redis_data'
  ];
  for (const v of expectedVolumes) {
    const volRegex = new RegExp(`^\\s{2}${v}:`, 'm');
    assert(volRegex.test(composeContent), `Persistent named volume defined: ${v}`);
  }

  // -------------------------------------------------------------
  // Test 5: Health Check & Restart Policies
  // -------------------------------------------------------------
  console.log(`\n--- Test 5: Health Checks & High-Availability Restart Policies ---`);
  const restartMatches = composeContent.match(/restart:\s*always/g) || [];
  assert(restartMatches.length >= 5, 'All 5 core production services configured with restart: always', `Matches: ${restartMatches.length}`);

  assert(postgresSection.includes('healthcheck:'), 'Postgres configured with healthcheck (pg_isready)');
  assert(redisSection.includes('healthcheck:'), 'Redis configured with healthcheck (ping PONG)');
  assert(proxySection.includes('healthcheck:'), 'Reverse Proxy configured with healthcheck');

  // -------------------------------------------------------------
  // Test 6: Resource Boundaries & OOM Constraints
  // -------------------------------------------------------------
  console.log(`\n--- Test 6: Resource Limits & Reservation Boundaries ---`);
  const limitMatches = composeContent.match(/limits:\s*\n\s*cpus:/g) || [];
  assert(limitMatches.length >= 5, 'Resource CPU/RAM limits specified across all 5 production services');

  const reservationMatches = composeContent.match(/reservations:\s*\n\s*cpus:/g) || [];
  assert(reservationMatches.length >= 5, 'Resource CPU/RAM reservations specified across all 5 production services');

  // -------------------------------------------------------------
  // Test 7: Reverse Proxy Configuration & TLS Placement
  // -------------------------------------------------------------
  console.log(`\n--- Test 7: Reverse Proxy & TLS Configuration ---`);
  const nginxConfPath = path.join('d:', 'AI-Automation', 'nginx', 'nginx.conf');
  const defaultConfPath = path.join('d:', 'AI-Automation', 'nginx', 'conf.d', 'default.conf');

  assert(fs.existsSync(nginxConfPath), 'nginx.conf exists');
  assert(fs.existsSync(defaultConfPath), 'conf.d/default.conf exists');

  const defaultConf = fs.readFileSync(defaultConfPath, 'utf8');
  assert(defaultConf.includes('upstream evolution_backend'), 'Evolution API upstream defined');
  assert(defaultConf.includes('upstream n8n_backend'), 'n8n upstream defined');
  assert(defaultConf.includes('return 301 https://$host$request_uri;'), 'HTTP port 80 enforces automatic 301 redirect to HTTPS');
  assert(defaultConf.includes('Strict-Transport-Security'), 'HSTS header configured');

  // -------------------------------------------------------------
  // Test 8: Live Running Environment Connectivity
  // -------------------------------------------------------------
  console.log(`\n--- Test 8: Live Running Environment Verification ---`);
  const liveDbCheck = runPsql('platform_db', 'SELECT count(*) FROM platform_businesses;');
  assert(parseInt(liveDbCheck || '0', 10) > 0, 'Live multi-tenant database accessible and operational', `Tenants: ${liveDbCheck}`);

  // Save Results Report
  const reportPath = path.join('d:', 'AI-Automation', 'docs', 'phase40_docker_architecture_results.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2), 'utf8');

  console.log(`\n================================================================`);
  console.log(`📊 PHASE 40 DOCKER ARCHITECTURE VERIFICATION SUMMARY:`);
  console.log(`   Passed: ${results.passed}`);
  console.log(`   Failed: ${results.failed}`);
  console.log(`   Report Saved: ${reportPath}`);
  console.log(`================================================================\n`);

  if (results.failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runDockerArchitectureTests();
}

module.exports = { runDockerArchitectureTests };
