/**
 * Phase 28: Setup Database Permissions & Tool Actions
 */

const { execSync } = require('child_process');

console.log('================ SETTING UP PHASE 28 DOMAIN ACTION ROLES & PERMISSIONS ================');

function runPsql(db, sql) {
  return execSync(
    `docker exec -i evolution-postgres psql -U postgres -d ${db} -v ON_ERROR_STOP=1 -t`,
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim();
}

// 1. Grant bise_db permissions to gateway_action_writer for applications & verifications
const bisePerms = `
GRANT CONNECT ON DATABASE bise_db TO gateway_action_writer;
GRANT USAGE ON SCHEMA public TO gateway_action_writer;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO gateway_action_writer;
GRANT INSERT, UPDATE ON applications, verification_requests, leads TO gateway_action_writer;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gateway_action_writer;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON results, students, exams, fees FROM gateway_action_writer;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM gateway_action_writer;
`;
runPsql('bise_db', bisePerms);
console.log('PASS: bise_db permissions granted for applications & verification_requests (results remain read-only).');

// 2. Grant pos_db inventory update permissions to gateway_action_writer
const posPerms = `
GRANT UPDATE ON inventory TO gateway_action_writer;
`;
runPsql('pos_db', posPerms);
console.log('PASS: pos_db inventory update permissions granted.');

// 3. Register Phase 28 Domain Actions in platform_tool_permissions
const permsSql = `
INSERT INTO platform_tool_permissions (business_code, tool_name, action_type, min_identity_level, requires_approval, is_allowed, access_level, resource_target)
VALUES 
    -- POS RETAIL Domain Actions
    ('POS_RETAIL', 'update_order', 'WRITE', 'ANONYMOUS', false, true, 'FULL', 'postgres:pos_db.orders'),
    ('POS_RETAIL', 'cancel_order', 'WRITE', 'ANONYMOUS', false, true, 'FULL', 'postgres:pos_db.orders'),
    ('POS_RETAIL', 'submit_verification_request', 'WRITE', 'STAFF', true, false, 'DENIED', 'postgres:bise_db.verification_requests'),
    ('POS_RETAIL', 'submit_service_application', 'WRITE', 'STAFF', true, false, 'DENIED', 'postgres:bise_db.applications'),
    ('POS_RETAIL', 'reschedule_appointment', 'WRITE', 'STAFF', true, false, 'DENIED', 'postgres:hospital_db.appointments'),

    -- BISE EDUCATION Domain Actions
    ('BISE_EDU', 'submit_verification_request', 'WRITE', 'ANONYMOUS', false, true, 'FULL', 'postgres:bise_db.verification_requests'),
    ('BISE_EDU', 'submit_service_application', 'WRITE', 'ANONYMOUS', false, true, 'FULL', 'postgres:bise_db.applications'),
    ('BISE_EDU', 'track_service_application', 'READ', 'ANONYMOUS', false, true, 'FULL', 'postgres:bise_db.applications'),
    ('BISE_EDU', 'update_order', 'WRITE', 'STAFF', true, false, 'DENIED', 'postgres:pos_db.orders'),
    ('BISE_EDU', 'cancel_order', 'WRITE', 'STAFF', true, false, 'DENIED', 'postgres:pos_db.orders'),
    ('BISE_EDU', 'reschedule_appointment', 'WRITE', 'STAFF', true, false, 'DENIED', 'postgres:hospital_db.appointments'),

    -- HOSPITAL HEALTHCARE Domain Actions
    ('HOSP_HEALTH', 'create_appointment', 'WRITE', 'ANONYMOUS', false, true, 'FULL', 'postgres:hospital_db.appointments'),
    ('HOSP_HEALTH', 'reschedule_appointment', 'WRITE', 'ANONYMOUS', false, true, 'FULL', 'postgres:hospital_db.appointments'),
    ('HOSP_HEALTH', 'update_order', 'WRITE', 'STAFF', true, false, 'DENIED', 'postgres:pos_db.orders'),
    ('HOSP_HEALTH', 'cancel_order', 'WRITE', 'STAFF', true, false, 'DENIED', 'postgres:pos_db.orders'),
    ('HOSP_HEALTH', 'submit_verification_request', 'WRITE', 'STAFF', true, false, 'DENIED', 'postgres:bise_db.verification_requests'),
    ('HOSP_HEALTH', 'submit_service_application', 'WRITE', 'STAFF', true, false, 'DENIED', 'postgres:bise_db.applications')
ON CONFLICT (business_code, tool_name) DO UPDATE SET
    action_type = EXCLUDED.action_type,
    min_identity_level = EXCLUDED.min_identity_level,
    requires_approval = EXCLUDED.requires_approval,
    is_allowed = EXCLUDED.is_allowed,
    access_level = EXCLUDED.access_level,
    resource_target = EXCLUDED.resource_target;
`;
runPsql('platform_db', permsSql);
console.log('PASS: platform_tool_permissions registered for Phase 28 domain actions.');

console.log('================ PHASE 28 ROLES AND PERMISSIONS CONFIGURED SUCCESSFULLY ================');
