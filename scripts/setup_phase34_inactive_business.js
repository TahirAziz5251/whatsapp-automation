/**
 * Phase 34: Setup Inactive Test Business in platform_db
 */

const { execSync } = require('child_process');

function runPsql(sql) {
  return execSync('docker exec -i evolution-postgres psql -U postgres -d platform_db', {
    input: sql,
    encoding: 'utf8'
  });
}

console.log('Setting up INACTIVE_CORP in platform_businesses for isolation testing...');

const sql = `
  INSERT INTO platform_businesses (business_code, name, industry_type, status)
  VALUES ('INACTIVE_CORP', 'Decommissioned Test Corp', 'TEST', 'INACTIVE')
  ON CONFLICT (business_code) DO UPDATE SET status = 'INACTIVE';
`;

try {
  runPsql(sql);
  console.log('SUCCESS: INACTIVE_CORP registered with status = INACTIVE.');
  const check = runPsql("SELECT business_code, name, status FROM platform_businesses WHERE business_code = 'INACTIVE_CORP';");
  console.log(check);
} catch (err) {
  console.error('Failed to register inactive business:', err.message);
  process.exit(1);
}
