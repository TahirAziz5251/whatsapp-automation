/**
 * Phase 27: Setup Database Roles & Tool Permissions for Action Gateway
 */

const { execSync } = require('child_process');

console.log('================ SETTING UP PHASE 27 ACTION GATEWAY ROLES & PERMISSIONS ================');

function runPsql(db, sql) {
  return execSync(
    `docker exec -i evolution-postgres psql -U postgres -d ${db} -v ON_ERROR_STOP=1 -t`,
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim();
}

// 1. Create gateway_action_writer Role
const roleSql = `
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'gateway_action_writer') THEN
        CREATE ROLE gateway_action_writer WITH LOGIN PASSWORD 'gateway_action_writer_2026' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
    END IF;
END
$$;
`;
runPsql('postgres', roleSql);
console.log('PASS: Role gateway_action_writer created/verified in postgres cluster.');

// 2. Grant permissions in pos_db
const posPerms = `
GRANT CONNECT ON DATABASE pos_db TO gateway_action_writer;
GRANT USAGE ON SCHEMA public TO gateway_action_writer;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO gateway_action_writer;
GRANT INSERT, UPDATE ON orders, order_items, payments, transactions, leads, customers TO gateway_action_writer;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gateway_action_writer;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM gateway_action_writer;
REVOKE CREATE ON SCHEMA public FROM gateway_action_writer;
`;
runPsql('pos_db', posPerms);
console.log('PASS: Permissions granted in pos_db (SELECT all; INSERT/UPDATE on orders, items, payments, leads, customers).');

// 3. Grant permissions in hospital_db
const hospPerms = `
GRANT CONNECT ON DATABASE hospital_db TO gateway_action_writer;
GRANT USAGE ON SCHEMA public TO gateway_action_writer;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO gateway_action_writer;
GRANT INSERT, UPDATE ON appointments, appointment_history, patients TO gateway_action_writer;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gateway_action_writer;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM gateway_action_writer;
REVOKE CREATE ON SCHEMA public FROM gateway_action_writer;
`;
runPsql('hospital_db', hospPerms);
console.log('PASS: Permissions granted in hospital_db (SELECT all; INSERT/UPDATE on appointments, patients, history).');

// 4. Grant permissions in platform_db
const platPerms = `
GRANT CONNECT ON DATABASE platform_db TO gateway_action_writer;
GRANT USAGE ON SCHEMA public TO gateway_action_writer;
GRANT INSERT, SELECT ON platform_audit_metadata TO gateway_action_writer;
GRANT USAGE, SELECT ON SEQUENCE platform_audit_metadata_id_seq TO gateway_action_writer;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM gateway_action_writer;
REVOKE CREATE ON SCHEMA public FROM gateway_action_writer;
`;
runPsql('platform_db', platPerms);
console.log('PASS: Permissions granted in platform_db (platform_audit_metadata).');

// 5. Explicitly Revoke Writes in bise_db (Examination results are immutable)
const bisePerms = `
GRANT CONNECT ON DATABASE bise_db TO gateway_action_writer;
GRANT USAGE ON SCHEMA public TO gateway_action_writer;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO gateway_action_writer;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM gateway_action_writer;
REVOKE CREATE ON SCHEMA public FROM gateway_action_writer;
`;
runPsql('bise_db', bisePerms);
console.log('PASS: bise_db writes strictly denied to gateway_action_writer (read-only for results).');

// 6. Update platform_tool_permissions for Action Gateway
const toolPermsSql = `
INSERT INTO platform_tool_permissions (business_code, tool_name, action_type, min_identity_level, requires_approval, is_allowed, access_level, resource_target)
VALUES 
    -- POS RETAIL Action Permissions
    ('POS_RETAIL', 'action_gateway', 'WRITE', 'ANONYMOUS', false, true, 'FULL', 'gateway:actions'),
    ('POS_RETAIL', 'create_order', 'WRITE', 'ANONYMOUS', false, true, 'FULL', 'postgres:pos_db.orders'),
    ('POS_RETAIL', 'record_payment', 'WRITE', 'ANONYMOUS', false, true, 'FULL', 'postgres:pos_db.payments'),
    ('POS_RETAIL', 'book_appointment', 'WRITE', 'STAFF', true, false, 'DENIED', 'postgres:hospital_db.appointments'),
    ('POS_RETAIL', 'cancel_appointment', 'WRITE', 'STAFF', true, false, 'DENIED', 'postgres:hospital_db.appointments'),

    -- BISE EDUCATION Action Permissions (Immutable results, no orders or clinical appointments)
    ('BISE_EDU', 'action_gateway', 'WRITE', 'ANONYMOUS', false, true, 'SCOPED', 'gateway:actions'),
    ('BISE_EDU', 'create_order', 'WRITE', 'STAFF', true, false, 'DENIED', 'postgres:pos_db.orders'),
    ('BISE_EDU', 'record_payment', 'WRITE', 'STAFF', true, false, 'DENIED', 'postgres:pos_db.payments'),
    ('BISE_EDU', 'book_appointment', 'WRITE', 'STAFF', true, false, 'DENIED', 'postgres:hospital_db.appointments'),
    ('BISE_EDU', 'cancel_appointment', 'WRITE', 'STAFF', true, false, 'DENIED', 'postgres:hospital_db.appointments'),

    -- HOSPITAL HEALTHCARE Action Permissions
    ('HOSP_HEALTH', 'action_gateway', 'WRITE', 'ANONYMOUS', false, true, 'FULL', 'gateway:actions'),
    ('HOSP_HEALTH', 'book_appointment', 'WRITE', 'ANONYMOUS', false, true, 'FULL', 'postgres:hospital_db.appointments'),
    ('HOSP_HEALTH', 'cancel_appointment', 'WRITE', 'ANONYMOUS', false, true, 'FULL', 'postgres:hospital_db.appointments'),
    ('HOSP_HEALTH', 'create_order', 'WRITE', 'STAFF', true, false, 'DENIED', 'postgres:pos_db.orders'),
    ('HOSP_HEALTH', 'record_payment', 'WRITE', 'STAFF', true, false, 'DENIED', 'postgres:pos_db.payments')
ON CONFLICT (business_code, tool_name) DO UPDATE SET
    action_type = EXCLUDED.action_type,
    min_identity_level = EXCLUDED.min_identity_level,
    requires_approval = EXCLUDED.requires_approval,
    is_allowed = EXCLUDED.is_allowed,
    access_level = EXCLUDED.access_level,
    resource_target = EXCLUDED.resource_target;
`;
runPsql('platform_db', toolPermsSql);
console.log('PASS: platform_tool_permissions updated for Action Gateway and sub-actions.');

console.log('================ ALL ROLES AND PERMISSIONS CONFIGURED SUCCESSFULLY ================');
