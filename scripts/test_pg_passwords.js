const { execSync } = require('child_process');

const psqlPath = 'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe';
const candidates = [
  'postgres',
  'admin',
  'root',
  '123456',
  'password',
  'SuperSecretPass123!',
  'gateway_secure_readonly_2026',
  'gateway_action_writer_2026',
  ''
];

console.log('Testing passwords for user postgres on localhost:5432:');
for (const pass of candidates) {
  try {
    const res = execSync(
      `"${psqlPath}" -U postgres -h 127.0.0.1 -p 5432 -d postgres -c "SELECT 'AUTH_SUCCESS';" -t -A`,
      {
        encoding: 'utf8',
        env: { ...process.env, PGPASSWORD: pass },
        timeout: 2000
      }
    ).trim();
    if (res.includes('AUTH_SUCCESS')) {
      console.log(`✓ Password SUCCESS: "${pass}"`);
      process.exit(0);
    }
  } catch (e) {
    // continue
  }
}
console.log('None of the common passwords matched for user postgres on port 5432.');
