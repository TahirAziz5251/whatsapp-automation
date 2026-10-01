/**
 * BISE Student Examination Information Service
 * 
 * Implements:
 * 1. Multi-factor Identity Verification (Roll Number + B-Form/CNIC)
 * 2. 15-minute Authenticated Session Management
 * 3. Parameterized & Stored Procedure Execution (Least-Privilege)
 * 4. PII Masking (Masks CNIC/B-Form to 35201-*******-1)
 * 5. Subject-Wise Marks & Examination Details Breakdown
 * 6. Audit Logging into platform_audit_metadata
 * 7. Strict Refusals & Anti-Hallucination Controls
 */

const { Client } = require('/usr/local/lib/node_modules/n8n/node_modules/pg');

const BISE_DB_CONFIG = {
  connectionString: 'postgresql://gateway_readonly:gateway_secure_readonly_2026@evolution-postgres:5432/bise_db'
};

const PLATFORM_DB_CONFIG = {
  connectionString: 'postgresql://postgres:postgres@evolution-postgres:5432/platform_db'
};

const SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Extracts verification attributes from incoming message text
 */
function extractStudentVerificationData(text) {
  if (!text || typeof text !== 'string') return null;

  // Extract 6-digit Roll Number
  const rollMatch = text.match(/\b(?:roll\s*(?:no|number)?[:\s]*)?([1-9][0-9]{5})\b/i);
  const rollNumber = rollMatch ? rollMatch[1] : null;

  // Extract 13-digit B-Form / CNIC (with or without hyphens)
  const cnicMatch = text.match(/\b([0-9]{5}-?[0-9]{7}-?[0-9])\b/);
  let rawCnic = cnicMatch ? cnicMatch[1] : null;
  let normalizedCnic = rawCnic ? rawCnic.replace(/[^0-9]/g, '') : null;

  // Extract Student Name if provided (e.g. "My name is Ali Ahmad" or "Name: Ali Ahmad")
  const nameMatch = text.match(/(?:my name is|name[:\s]+)([a-zA-Z ]{2,40})/i);
  const studentName = nameMatch ? nameMatch[1].trim() : null;

  // Extract Exam Year/Session if specified
  const yearMatch = text.match(/\b(20[2-3][0-9])\b/);
  const examYear = yearMatch ? parseInt(yearMatch[1], 10) : null;

  const sessionMatch = text.match(/\b(annual|supplementary|supply)\b/i);
  const examSession = sessionMatch ? (sessionMatch[1].toUpperCase().startsWith('SUPP') ? 'SUPPLY' : 'ANNUAL') : null;

  return {
    rollNumber,
    rawCnic,
    normalizedCnic,
    studentName,
    examYear,
    examSession
  };
}

/**
 * Verifies student identity against the authorized Board database
 */
async function verifyAndFetchStudentResult({ rollNumber, cnic, studentName = null, examYear = null, examSession = null }) {
  if (!rollNumber) {
    return {
      success: false,
      error_code: 'MISSING_ROLL_NUMBER',
      message: 'Please provide your 6-digit Roll Number to proceed.'
    };
  }

  if (!cnic) {
    return {
      success: false,
      error_code: 'MISSING_CNIC_BFORM',
      message: 'Security Verification Required: Please provide your 13-digit B-Form or CNIC number (e.g., 35201-XXXXXXX-X) to verify student identity.'
    };
  }

  const client = new Client(BISE_DB_CONFIG);
  try {
    await client.connect();

    const query = `
      SELECT * FROM get_verified_student_examination_result($1, $2, $3, $4);
    `;
    const res = await client.query(query, [rollNumber, cnic, examYear, examSession]);

    if (res.rows.length === 0) {
      return {
        success: false,
        error_code: 'VERIFICATION_FAILED',
        message: 'Identity Verification Failed: The provided Roll Number and B-Form/CNIC combination does not match any official Board examination records. Please verify your credentials or contact Board support.'
      };
    }

    const row = res.rows[0];

    // Optional multi-factor Student Name validation
    if (studentName && studentName.trim().length > 0) {
      const normInputName = studentName.toLowerCase().replace(/[^a-z]/g, '');
      const normDbName = row.student_name.toLowerCase().replace(/[^a-z]/g, '');
      if (!normDbName.includes(normInputName) && !normInputName.includes(normDbName)) {
        return {
          success: false,
          error_code: 'NAME_MISMATCH',
          message: `Identity Verification Failed: The provided student name '${studentName}' does not match official Board records registered for roll number ${rollNumber}.`
        };
      }
    }

    return {
      success: true,
      data: {
        student_name: row.student_name,
        father_name: row.father_name,
        registration_number: row.registration_number,
        masked_b_form_cnic: row.masked_cnic || row.masked_b_form_cnic,
        roll_number: row.roll_number,
        exam_title: row.exam_title,
        exam_year: row.exam_year,
        exam_session: row.exam_session,
        marks_obtained: row.marks_obtained,
        total_marks: row.total_marks,
        grade: row.grade,
        status: row.status
      }
    };
  } catch (err) {
    return {
      success: false,
      error_code: 'DB_ERROR',
      message: 'Unable to communicate with the Board verification database. Please try again later.',
      details: err.message
    };
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Fetches verified subject-wise breakdown for authenticated student
 */
async function fetchSubjectWiseMarks({ rollNumber, cnic }) {
  const client = new Client(BISE_DB_CONFIG);
  try {
    await client.connect();
    const query = `SELECT * FROM get_verified_student_subject_marks($1, $2);`;
    const res = await client.query(query, [rollNumber, cnic]);
    return {
      success: true,
      subjects: res.rows
    };
  } catch (err) {
    return {
      success: false,
      error_code: 'SUBJECT_DB_ERROR',
      message: 'Failed to retrieve subject-wise marks.',
      details: err.message
    };
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Manages 15-minute temporary authenticated session in platform_session_metadata
 */
async function getOrUpdateStudentSession(sessionKey, arg2 = null, arg3 = null) {
  const client = new Client(PLATFORM_DB_CONFIG);
  try {
    await client.connect();

    let customerPhone = '923001234567';
    let verificationResult = null;

    if (arg2 && typeof arg2 === 'object' && arg2.success !== undefined) {
      verificationResult = arg2;
    } else {
      customerPhone = (typeof arg2 === 'string' && arg2) ? arg2 : '923001234567';
      verificationResult = arg3;
    }

    const actualKey = sessionKey.includes(':') ? sessionKey : `BISE_EDU:${sessionKey}`;

    if (verificationResult && verificationResult.success) {
      // Create / update authenticated session
      const studentData = verificationResult.data;
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
      const meta = {
        authenticated: true,
        roll_number: studentData.roll_number,
        student_name: studentData.student_name,
        masked_cnic: studentData.masked_b_form_cnic,
        authenticated_at: new Date().toISOString(),
        expires_at: expiresAt
      };

      await client.query(`
        INSERT INTO platform_session_metadata (session_key, business_code, customer_phone, current_intent, context_state, last_interaction)
        VALUES ($1, 'BISE_EDU', $2, 'STUDENT_EXAM_VERIFIED', $3, NOW())
        ON CONFLICT (session_key) DO UPDATE
        SET context_state = EXCLUDED.context_state,
            current_intent = EXCLUDED.current_intent,
            last_interaction = NOW();
      `, [actualKey, customerPhone, JSON.stringify(meta)]);

      return {
        isAuthenticated: true,
        session: meta
      };
    }

    // Check existing session
    const res = await client.query(`
      SELECT context_state FROM platform_session_metadata WHERE session_key = $1 AND business_code = 'BISE_EDU';
    `, [actualKey]);

    if (res.rows.length === 0) {
      return { isAuthenticated: false, session: null };
    }

    const state = typeof res.rows[0].context_state === 'string'
      ? JSON.parse(res.rows[0].context_state)
      : res.rows[0].context_state;

    if (!state || !state.authenticated) {
      return { isAuthenticated: false, session: null };
    }

    const expiresAt = new Date(state.expires_at).getTime();
    if (Date.now() > expiresAt) {
      // Session Expired
      return { isAuthenticated: false, session: null, expired: true };
    }

    return { isAuthenticated: true, session: state };
  } catch (e) {
    return { isAuthenticated: false, error: e.message };
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Log student verification audit event
 */
async function logStudentVerificationAudit({
  requestId,
  customerPhone,
  rollNumber,
  verificationStatus,
  actionType,
  latencyMs
}) {
  const client = new Client(PLATFORM_DB_CONFIG);
  try {
    await client.connect();
    await client.query(`
      INSERT INTO platform_audit_metadata 
      (business_code, instance_name, customer_phone, inbound_payload, outbound_payload, processing_time_ms)
      VALUES ($1, $2, $3, $4, $5, $6);
    `, [
      'BISE_EDU',
      'tahir-whatsapp-business-account',
      customerPhone || 'unknown',
      JSON.stringify({ request_id: requestId, action: actionType, roll_number: rollNumber }),
      JSON.stringify({ status: verificationStatus }),
      latencyMs || 0
    ]);
  } catch (err) {
    console.error('Audit Log Error:', err.message);
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Formats official WhatsApp student examination result message
 */
function formatWhatsAppResult(data) {
  return `🎓 *BOARD OF INTERMEDIATE & SECONDARY EDUCATION*
*Official Student Examination Result*

👤 *Candidate Name:* ${data.student_name}
👨‍👦 *Father's Name:* ${data.father_name}
🆔 *Registration No:* ${data.registration_number}
🔒 *B-Form/CNIC:* ${data.masked_b_form_cnic}
📝 *Roll Number:* ${data.roll_number}

📚 *Examination:* ${data.exam_title}
📅 *Session:* ${data.exam_session} ${data.exam_year}

📊 *Result Summary:*
• *Total Marks:* ${data.total_marks}
• *Marks Obtained:* ${data.marks_obtained}
• *Grade:* ${data.grade}
• *Status:* ${data.status}

🔒 *Official Verification Notice:*
_This is a digitally verified board result. Your session is authenticated for 15 minutes. You may ask for subject-wise marks, fee inquiries, or migration certificate information._`;
}

/**
 * Formats subject-wise breakdown message
 */
function formatWhatsAppSubjectMarks(studentData, subjects) {
  let text = `📚 *SUBJECT-WISE MARKS BREAKDOWN*\n`;
  text += `👤 *Candidate:* ${studentData.student_name} | *Roll No:* ${studentData.roll_number}\n\n`;
  
  subjects.forEach((s, idx) => {
    text += `${idx + 1}. *${s.subject_name}:* ${s.obtained_marks}/${s.total_marks} (Grade: ${s.grade || '-'})\n`;
  });

  text += `\n*Total Obtained:* ${studentData.marks_obtained}/${studentData.total_marks}\n`;
  text += `*Final Status:* ${studentData.status} (Grade ${studentData.grade})`;
  return text;
}

module.exports = {
  extractStudentVerificationData,
  verifyAndFetchStudentResult,
  fetchSubjectWiseMarks,
  getOrUpdateStudentSession,
  logStudentVerificationAudit,
  formatWhatsAppResult,
  formatWhatsAppSubjectMarks
};
