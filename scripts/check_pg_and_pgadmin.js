const { execSync } = require('child_process');

console.log('=== CHECKING PGADMIN & POSTGRES PROCESSES ===');
try {
  const tasklist = execSync('tasklist', { encoding: 'utf8' });
  const matching = tasklist.split('\n').filter(line => {
    const l = line.toLowerCase();
    return l.includes('pgadmin') || l.includes('postgres') || l.includes('docker') || l.includes('wsl');
  });
  console.log(matching.join('\n'));
} catch (e) {
  console.error('Error getting tasklist:', e.message);
}

console.log('\n=== CHECKING LISTENING PORTS (5432, 5433, 5050, 80, 8080) ===');
try {
  const netstat = execSync('netstat -ano', { encoding: 'utf8' });
  const relevantPorts = [':5432', ':5433', ':5050', ':8080', ':5678', ':4000'];
  const matchingPorts = netstat.split('\n').filter(line => {
    return relevantPorts.some(p => line.includes(p)) && line.includes('LISTENING');
  });
  console.log(matchingPorts.join('\n'));
} catch (e) {
  console.error('Error running netstat:', e.message);
}

console.log('\n=== TESTING LOCAL PSQL CONNECTIVITY ===');
const psqlPath = 'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe';
const targets = [
  { port: 5432, user: 'postgres', pass: 'postgres', db: 'postgres' },
  { port: 5432, user: 'gateway_readonly', pass: 'gateway_secure_readonly_2026', db: 'platform_db' },
  { port: 5433, user: 'postgres', pass: 'postgres', db: 'evogo_users' }
];

for (const target of targets) {
  try {
    const res = execSync(
      `"${psqlPath}" -U ${target.user} -h 127.0.0.1 -p ${target.port} -d ${target.db} -c "SELECT current_database(), current_user, inet_server_port();" -t -A`,
      {
        encoding: 'utf8',
        env: { ...process.env, PGPASSWORD: target.pass },
        timeout: 4000
      }
    ).trim();
    console.log(`✓ Port ${target.port} (${target.db}): CONNECTED -> ${res}`);
  } catch (err) {
    console.log(`✗ Port ${target.port} (${target.db}): FAILED -> ${err.message.split('\n')[0]}`);
  }
}
