const { execSync } = require('child_process');

const psqlPath = 'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe';
const env = { ...process.env, PGPASSWORD: 'gateway_secure_readonly_2026' };

console.log('=== POSTGRESQL 18 CLUSTER INSPECTION (PORT 5432) ===');

try {
  const version = execSync(
    `"${psqlPath}" -U gateway_readonly -h localhost -p 5432 -d platform_db -c "SELECT version();" -t -A`,
    { encoding: 'utf8', env }
  ).trim();
  console.log('Server version:', version);

  const databases = execSync(
    `"${psqlPath}" -U gateway_readonly -h localhost -p 5432 -d platform_db -c "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname;" -t -A`,
    { encoding: 'utf8', env }
  ).trim().split('\n');
  console.log('Databases available:', databases);

  const users = execSync(
    `"${psqlPath}" -U gateway_readonly -h localhost -p 5432 -d platform_db -c "SELECT rolname, rolsuper, rolcanlogin FROM pg_roles ORDER BY rolname;" -t -A`,
    { encoding: 'utf8', env }
  ).trim().split('\n');
  console.log('Roles/Users in cluster:', users);

  // Check each business DB
  for (const dbName of ['platform_db', 'bise_db', 'hospital_db', 'pos_db']) {
    try {
      const tables = execSync(
        `"${psqlPath}" -U gateway_readonly -h localhost -p 5432 -d ${dbName} -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';" -t -A`,
        { encoding: 'utf8', env }
      ).trim();
      console.log(`Database "${dbName}": ${tables} public table(s) accessible`);
    } catch (e) {
      console.log(`Database "${dbName}": Could not access with gateway_readonly (${e.message.split('\n')[0]})`);
    }
  }

} catch (err) {
  console.error('Inspection failed:', err.message);
}
