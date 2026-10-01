/**
 * Phase 33: Register User Selected Instance Names in platform_whatsapp_instances
 * 
 * Instance Mappings:
 * 1. point-of-sale        -> POS_RETAIL
 * 2. Bise-bwp             -> BISE_EDU
 * 3. hospital-assistant   -> HOSP_HEALTH
 */

const { execSync } = require('child_process');

function runPsql(sql) {
  return execSync('docker exec -i evolution-postgres psql -U postgres -d platform_db', {
    input: sql,
    encoding: 'utf8'
  });
}

console.log('Registering user-selected instance names in platform_db...');

const sql = `
  -- Update or insert instance mapping records with real owner phone numbers
  INSERT INTO platform_whatsapp_instances (business_code, instance_name, instance_token, owner_phone, status)
  VALUES 
    ('POS_RETAIL', 'point-of-sale', 'pos_token_12345', '923098414407', 'CONNECTED'),
    ('BISE_EDU', 'student-assistant', 'bise_token_12345', '923127118485', 'CONNECTED'),
    ('BISE_EDU', 'tahir_whatsapp_1', '752ed73c-2b38-4cbf-bb83-c51574fda2a8', '923127118485', 'CONNECTED'),
    ('HOSP_HEALTH', 'hospital-assistant', 'hosp_token_12345', '923201711081', 'CONNECTED'),
    ('HOSP_HEALTH', 'tahir-whatsapp-bot', 'abafe9a4-f13e-4fbb-bf88-f6c0b6bc77d6', '923201711081', 'CONNECTED')
  ON CONFLICT DO NOTHING;

  -- Ensure legacy aliases are also available
  INSERT INTO platform_whatsapp_instances (business_code, instance_name, instance_token, owner_phone, status)
  VALUES 
    ('POS_RETAIL', 'pos-instance', 'pos_token_12345', '923098414407', 'CONNECTED'),
    ('BISE_EDU', 'bise-instance', 'bise_token_12345', '923127118485', 'CONNECTED'),
    ('HOSP_HEALTH', 'hospital-instance', 'hosp_token_12345', '923201711081', 'CONNECTED')
  ON CONFLICT DO NOTHING;
`;

try {
  runPsql(sql);
  console.log('Successfully registered instance mappings in platform_whatsapp_instances:');
  const checkSql = "SELECT id, business_code, instance_name, instance_token, status FROM platform_whatsapp_instances ORDER BY id;";
  const res = runPsql(checkSql);
  console.log(res);
} catch (err) {
  console.error('Failed to register instances:', err.message);
  process.exit(1);
}
