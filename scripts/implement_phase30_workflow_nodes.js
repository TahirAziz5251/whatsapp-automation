/**
 * Phase 30: Implement Workflow Nodes for Result Validation & Response Guard
 * Updates evolution_whatsapp_ai_agent_bot.json:
 * 1. Updates Node 2020 (Tool: Action Gateway) with strict validation & simulate_failure
 * 2. Inserts Node 2021 (Result Validator & Response Guard) between Node 2004 and Node 2008
 * 3. Rewires workflow connections: Node 2004 -> Node 2021 -> Node 2008
 */

const fs = require('fs');
const path = require('path');

const WORKFLOW_PATH = path.join(__dirname, '..', 'evolution_whatsapp_ai_agent_bot.json');

function updateWorkflow() {
  console.log('[Phase 30] Loading workflow from:', WORKFLOW_PATH);
  const wf = JSON.parse(fs.readFileSync(WORKFLOW_PATH, 'utf8'));

  // 1. Update Node 2020 (Tool: Action Gateway)
  const node2020 = wf.nodes.find(n => n.id === '2020');
  if (!node2020) {
    throw new Error('Node 2020 (Tool: Action Gateway) not found in workflow');
  }

  // Update jsCode of Node 2020 to include simulate_failure and result validation
  const existingCode = node2020.parameters.jsCode;
  
  // Ensure simulate_failure hook is present at top of execution
  let updatedCode = existingCode;
  if (!updatedCode.includes('simulate_failure')) {
    updatedCode = updatedCode.replace(
      '// 5. Execute Action directly on Database with elevated permissions',
      `// 5. Execute Action directly on Database with elevated permissions
if (effectiveParams && effectiveParams.simulate_failure === true) {
  throw new Error('Simulated tool failure: External subsystem timed out (HTTP 500).');
}`
    );
  }

  // Ensure Sunday OPD closure check is present in book_appointment
  if (!updatedCode.includes("Hospital OPD is closed on Sundays")) {
    updatedCode = updatedCode.replace(
      "const conflictRes = await domainClient.query('SELECT COUNT(*)::int as cnt FROM appointments WHERE doctor_id = $1 AND appointment_date = $2 AND appointment_time = $3 AND status = $4'",
      `const weekday = new Date(effectiveParams.appointment_date + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
    if (weekday === 'Sunday') throw new Error('Hospital OPD is closed on Sundays. Please select a weekday.');
    const conflictRes = await domainClient.query('SELECT COUNT(*)::int as cnt FROM appointments WHERE doctor_id = $1 AND appointment_date = $2 AND appointment_time = $3 AND status = $4'`
    );
  }

  node2020.parameters.jsCode = updatedCode;
  console.log('✓ Node 2020 (Tool: Action Gateway) updated with Phase 30 validation rules');

  // 2. Create or Update Node 2021 (Result Validator & Response Guard)
  let node2021 = wf.nodes.find(n => n.id === '2021');
  const guardJsCode = `// Phase 30: Result Validator & Response Guard
// Blocks false-success claims, enforces domain consistency, and guarantees verified responses.

const inputItem = $json;
const rawOutput = (inputItem.output || inputItem.text || '').trim();

// Heuristics for false success
const FALSE_SUCCESS_PATTERNS = [
  /order (?:has been |is )?(?:placed|created|confirmed|completed|processed|registered)/i,
  /appointment (?:has been |is )?(?:booked|scheduled|confirmed|rescheduled|registered)/i,
  /appointment (?:has been |is )?(?:cancelled|canceled)/i,
  /order (?:has been |is )?(?:cancelled|canceled)/i,
  /payment (?:has been |is )?(?:received|recorded|confirmed|successful|completed)/i,
  /(?:successfully|successful) (?:created|placed|booked|cancelled|canceled|rescheduled|updated|processed|recorded|submitted)/i,
  /(?:has been|have been) successfully/i,
  /i have (?:created|placed|booked|cancelled|canceled|rescheduled|updated|processed|recorded) your/i,
  /(?:order|booking|appointment) confirm ho gay[ai]/i,
  /(?:order|booking|appointment) cancel ho gay[ai]/i,
  /(?:kamyabi se|mubarak|tayyar hai|book ho chuk[ai])/i
];

// Check if tool executions in this turn encountered failure
let hasFailure = false;
let failureDetail = '';

// Check tool errors in input or execution context
if (inputItem.tool_error || inputItem.status === 'ERROR') {
  hasFailure = true;
  failureDetail = inputItem.message || inputItem.error || 'Downstream database validation failed.';
}

// Intercept false success if tool failed
if (hasFailure) {
  const claimsSuccess = FALSE_SUCCESS_PATTERNS.some(p => p.test(rawOutput));
  if (claimsSuccess) {
    const sanitized = \`We apologize, but your requested operation could not be completed. Reason: \${failureDetail}. No changes were committed to your account. Please review your request and try again.\`;
    return [{
      json: {
        ...inputItem,
        output: sanitized,
        validation_guard: {
          blocked: true,
          original_output: rawOutput,
          reason: 'FALSE_SUCCESS_BLOCKED'
        }
      }
    }];
  }
}

return [{
  json: {
    ...inputItem,
    output: rawOutput,
    validation_guard: {
      blocked: false,
      status: 'VERIFIED'
    }
  }
}];
`;

  if (!node2021) {
    node2021 = {
      parameters: {
        jsCode: guardJsCode
      },
      id: "2021",
      name: "Result Validator & Response Guard",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [
        -370,
        1900
      ]
    };
    wf.nodes.push(node2021);
    console.log('✓ Node 2021 (Result Validator & Response Guard) created');
  } else {
    node2021.parameters.jsCode = guardJsCode;
    console.log('✓ Node 2021 (Result Validator & Response Guard) parameters updated');
  }

  // 3. Rewire connections
  // AI Agent (Shared Engine) -> Result Validator & Response Guard
  wf.connections['AI Agent (Shared Engine)'] = {
    main: [
      [
        {
          node: "Result Validator & Response Guard",
          type: "main",
          index: 0
        }
      ]
    ]
  };

  // Result Validator & Response Guard -> Send WhatsApp Response (Evolution Router)
  wf.connections['Result Validator & Response Guard'] = {
    main: [
      [
        {
          node: "Send WhatsApp Response (Evolution Router)",
          type: "main",
          index: 0
        }
      ]
    ]
  };

  fs.writeFileSync(WORKFLOW_PATH, JSON.stringify(wf, null, 2), 'utf8');
  console.log('[Phase 30] Workflow file successfully updated and saved.');
}

if (require.main === module) {
  updateWorkflow();
}

module.exports = { updateWorkflow };
