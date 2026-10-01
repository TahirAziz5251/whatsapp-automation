/**
 * Phase 29: Setup Human Approval Infrastructure
 * 
 * 1. Creates platform_action_approvals table in platform_db.
 * 2. Grants SELECT, INSERT, UPDATE on platform_action_approvals to gateway_action_writer.
 * 3. Classifies sensitive operations in platform_tool_permissions:
 *    - POS_RETAIL: cancel_order (requires_approval = true)
 *    - HOSP_HEALTH: cancel_appointment (requires_approval = true)
 * 4. Adds approve_action and reject_action to platform_tool_permissions.
 */

const { execSync } = require('child_process');

function runPsql(sql, db = 'platform_db', user = 'postgres') {
  return execSync(
    `docker exec -i evolution-postgres psql -U ${user} -d ${db} -v ON_ERROR_STOP=1`,
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim();
}

console.log('========================================================================');
console.log('   SETTING UP PHASE 29 HUMAN APPROVAL CONTROLS INFRASTRUCTURE');
console.log('========================================================================\n');

// 1. Create platform_action_approvals table
const ddl = `
CREATE TABLE IF NOT EXISTS platform_action_approvals (
    id SERIAL PRIMARY KEY,
    approval_token VARCHAR(64) UNIQUE NOT NULL,
    business_code VARCHAR(50) NOT NULL REFERENCES platform_businesses(business_code),
    action VARCHAR(100) NOT NULL,
    requester_phone VARCHAR(50) NOT NULL,
    requester_name VARCHAR(100),
    action_payload JSONB NOT NULL,
    status VARCHAR(30) DEFAULT 'PENDING_APPROVAL',
    reason TEXT,
    approver_id VARCHAR(100),
    approver_notes TEXT,
    approved_at TIMESTAMP WITH TIME ZONE,
    executed_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (CURRENT_TIMESTAMP + INTERVAL '24 hours'),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_paa_token ON platform_action_approvals(approval_token);
CREATE INDEX IF NOT EXISTS idx_paa_status ON platform_action_approvals(status);
CREATE INDEX IF NOT EXISTS idx_paa_bcode ON platform_action_approvals(business_code);

-- Permissions for gateway_action_writer
GRANT SELECT, INSERT, UPDATE ON platform_action_approvals TO gateway_action_writer;
GRANT USAGE, SELECT ON SEQUENCE platform_action_approvals_id_seq TO gateway_action_writer;
GRANT SELECT ON platform_tool_permissions, platform_businesses TO gateway_action_writer;
`;

console.log('1. Creating platform_action_approvals table and applying grants...');
runPsql(ddl);
console.log('   [SUCCESS] platform_action_approvals created and permissions granted.\n');

// 2. Classify sensitive actions in platform_tool_permissions
const updatePermissions = `
-- Update POS_RETAIL: cancel_order requires approval
UPDATE platform_tool_permissions 
SET requires_approval = true 
WHERE business_code = 'POS_RETAIL' AND tool_name = 'cancel_order';

-- Update HOSP_HEALTH: cancel_appointment requires approval
UPDATE platform_tool_permissions 
SET requires_approval = true 
WHERE business_code = 'HOSP_HEALTH' AND tool_name = 'cancel_appointment';

-- Ensure approve_action and reject_action exist in tool permissions for all tenants
INSERT INTO platform_tool_permissions (business_code, tool_name, action_type, min_identity_level, requires_approval, is_allowed, access_level, resource_target)
VALUES 
    ('POS_RETAIL', 'approve_action', 'WRITE', 'SUPERVISOR', false, true, 'FULL', 'gateway:approval'),
    ('POS_RETAIL', 'reject_action', 'WRITE', 'SUPERVISOR', false, true, 'FULL', 'gateway:approval'),
    ('BISE_EDU', 'approve_action', 'WRITE', 'SUPERVISOR', false, true, 'FULL', 'gateway:approval'),
    ('BISE_EDU', 'reject_action', 'WRITE', 'SUPERVISOR', false, true, 'FULL', 'gateway:approval'),
    ('HOSP_HEALTH', 'approve_action', 'WRITE', 'SUPERVISOR', false, true, 'FULL', 'gateway:approval'),
    ('HOSP_HEALTH', 'reject_action', 'WRITE', 'SUPERVISOR', false, true, 'FULL', 'gateway:approval')
ON CONFLICT (business_code, tool_name) DO UPDATE SET
    action_type = EXCLUDED.action_type,
    min_identity_level = EXCLUDED.min_identity_level,
    requires_approval = EXCLUDED.requires_approval,
    is_allowed = EXCLUDED.is_allowed,
    access_level = EXCLUDED.access_level,
    resource_target = EXCLUDED.resource_target;
`;

console.log('2. Configuring approval requirements in platform_tool_permissions...');
runPsql(updatePermissions);
console.log('   [SUCCESS] Sensitive actions classified and approval tools registered.\n');

// Verify
const verify = runPsql(`
SELECT business_code, tool_name, requires_approval, is_allowed, min_identity_level 
FROM platform_tool_permissions 
WHERE requires_approval = true OR tool_name IN ('approve_action', 'reject_action')
ORDER BY business_code, tool_name;
`);
console.log('3. Verification of approval configuration:\n' + verify);
console.log('\n[PHASE 29 SETUP COMPLETE]');
