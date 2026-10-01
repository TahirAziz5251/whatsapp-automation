// Generates review artifacts only. No SQL, Docker calls, migrations, or service changes.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'docs', 'phase3');
fs.mkdirSync(dir, { recursive: true });
const tables = [];
function table(name, phase, purpose, fields, extra = {}) {
  const columns = { business_id: { type: 'uuid', nullable: false }, id: { type: 'uuid', nullable: false } };
  for (const [key, value] of Object.entries(fields)) {
    columns[key] = { type: value.replace(/\?$/, ''), nullable: value.endsWith('?') };
  }
  columns.created_at = { type: 'timestamptz', nullable: false };
  const t = { name, phase, purpose, columns, primaryKey: ['business_id', 'id'], unique: [], foreignKeys: [], checks: [], indexes: [], rls: 'required', retention: 'classification-specific; production duration requires owner approval', ...extra };
  tables.push(t);
  return t;
}
const tenant = table('platform.businesses', 4, 'Trusted business boundary; not selected by user/LLM text.', { code: 'text', display_name: 'text', domain: 'text', timezone: 'text', status: 'text', config_version: 'integer' }, { unique: [['code']], checks: ["domain in sales,bise,hospital; status in active,disabled; config_version > 0"] });
delete tenant.columns.business_id;
tenant.primaryKey = ['id'];
table('platform.instances', 4, 'Trusted Evolution instance-to-business mapping; references credentials, never stores tokens.', { provider: 'text', external_instance_id: 'text', credential_ref: 'text', status: 'text' }, { unique: [['provider', 'external_instance_id']], checks: ['Unique trusted routing mapping across businesses; status active/disabled'] });
table('platform.contacts', 5, 'Tenant-local person/customer reference; does not imply verified identity.', { display_name: 'text?', status: 'text', updated_at: 'timestamptz' });
table('platform.channel_identities', 5, 'Channel participant linked to contact within an instance; shared numbers require separate subject grants.', { instance_id: 'uuid', contact_id: 'uuid', jid: 'text', address_kind: 'text' }, { unique: [['business_id', 'instance_id', 'jid']], checks: ['JID retained as identifier; LID is not assumed to be a phone number'] });
table('platform.conversations', 6, 'Conversation identity, scope and operator handoff state.', { instance_id: 'uuid', contact_id: 'uuid', chat_jid: 'text', status: 'text', version: 'integer', updated_at: 'timestamptz' }, { unique: [['business_id', 'instance_id', 'chat_jid'], ['business_id', 'id', 'contact_id'], ['business_id', 'id', 'instance_id']], checks: ['Initial pilot direct chats only; version > 0'] });
table('platform.sessions', 6, 'Bounded context and pending-intent state; never authoritative authorization from LLM memory.', { conversation_id: 'uuid', actor_contact_id: 'uuid', state: 'jsonb', version: 'integer', last_seen_at: 'timestamptz', expires_at: 'timestamptz', absolute_expires_at: 'timestamptz', revoked_at: 'timestamptz?' }, { unique: [['business_id', 'id', 'actor_contact_id']], checks: ['created_at <= last_seen_at < expires_at <= absolute_expires_at; absolute expiry immutable; version > 0; state schema/size allowlist enforced by service'], indexes: [['business_id', 'conversation_id', 'created_at']] });
table('platform.verification_grants', 8, 'Server-created actor-to-subject authorization, including explicit guardian/delegate permission.', { session_id: 'uuid', actor_contact_id: 'uuid', subject_contact_id: 'uuid', scope: 'text', method: 'text', evidence_ref: 'text', expires_at: 'timestamptz', revoked_at: 'timestamptz?' }, { unique: [['business_id','id','session_id']], checks: ['expires_at > created_at; no raw CNIC, OTP, or evidence documents stored; scope is registered'] });
table('platform.requests', 6, 'Durable normalized ingress and duplicate-event boundary.', { instance_id: 'uuid', provider_event_id: 'text', event_type: 'text', status: 'text', attempts: 'integer', lease_until: 'timestamptz?', next_attempt_at: 'timestamptz?', error_code: 'text?' }, { unique: [['business_id', 'instance_id', 'event_type', 'provider_event_id'], ['business_id','id','instance_id']], checks: ['attempts >= 0; identifier nonempty; no raw event payload'], indexes: [['status', 'next_attempt_at']] });
table('platform.messages', 6, 'Redacted persistent conversational history; provider IDs and request link support deduplication.', { instance_id: 'uuid', conversation_id: 'uuid', request_id: 'uuid?', direction: 'text', role: 'text', content: 'text', provider_message_id: 'text?', delivery_state: 'text', occurred_at: 'timestamptz' }, { unique: [['business_id', 'request_id', 'direction'], ['business_id','instance_id','provider_message_id','direction']], checks: ['direction inbound/outbound; role user/assistant/operator/system; initial one response per request; null request allowed for separately keyed proactive actions'], indexes: [['business_id', 'conversation_id', 'occurred_at', 'id']] });
table('platform.actions', 18, 'Confirmed immutable business intent and execution/idempotency state.', { session_id: 'uuid', verification_grant_id: 'uuid?', operation: 'text', idempotency_key: 'text', payload_hash: 'text', payload: 'jsonb', status: 'text', expires_at: 'timestamptz', version: 'integer', result_ref: 'text?' }, { unique: [['business_id', 'operation', 'idempotency_key']], checks: ['Same key/different payload rejects; expires_at > created_at; minimized typed payload; version > 0', 'Grant, if required, must belong to this session and match action subject/scope; validate on execution, not only action creation'] });
table('platform.approvals', 19, 'Expiring approval bound to action hash/version; operator identity is an external trusted principal.', { action_id: 'uuid', action_hash: 'text', action_version: 'integer', principal_ref: 'text', decision: 'text', expires_at: 'timestamptz', used_at: 'timestamptz?' }, { checks: ['decision approve/reject; authenticated approver has permission; one-time use checked transactionally'] });
table('platform.outbox', 6, 'Durable response dispatch; records accepted/unknown separately from delivered.', { message_id: 'uuid', dispatch_key: 'text', status: 'text', attempts: 'integer', next_attempt_at: 'timestamptz?', lease_until: 'timestamptz?', provider_ref: 'text?', last_error_code: 'text?' }, { unique: [['business_id', 'message_id'], ['business_id', 'dispatch_key']], checks: ['attempts >= 0; ambiguous send enters unknown, not blindly pending'], indexes: [['status', 'next_attempt_at']] });
table('platform.audit_events', 4, 'Append-only security/business metadata; no raw messages or credentials.', { request_ref: 'text?', actor_ref: 'text', event_type: 'text', resource_ref: 'text?', outcome: 'text', details: 'jsonb' }, { checks: ['Details key/size allowlist; runtime cannot UPDATE/DELETE audit rows'], indexes: [['business_id', 'created_at', 'id']] });
table('platform.tool_runs', 8, 'Trace tool outcome/evidence, latency and versions without duplicating sensitive result bodies.', { request_id: 'uuid', tool_name: 'text', tool_version: 'text', outcome: 'text', source_refs: 'jsonb', duration_ms: 'integer', error_code: 'text?' }, { checks: ['duration_ms >= 0; redact source references as required'], indexes: [['business_id', 'request_id']] });
table('platform.handoffs', 19, 'Operator ownership and bot pause/resume record.', { conversation_id: 'uuid', reason_code: 'text', status: 'text', assigned_principal_ref: 'text?', updated_at: 'timestamptz' });
table('crm.leads', 5, 'Lead state separate from appointments/orders; initial single active lead per contact.', { contact_id: 'uuid', stage: 'text', notes: 'text?', version: 'integer', updated_at: 'timestamptz' }, { unique: [['business_id', 'contact_id']], checks: ['Stage allowlist per business; version > 0; general inquiry cannot silently reset progressed lead'] });
table('crm.lead_events', 5, 'Append-only lead transition history with event deduplication and stable replay outcome.', { lead_id: 'uuid', source_event_key: 'text', from_stage: 'text?', to_stage: 'text', actor_ref: 'text', expected_version: 'integer', result_version: 'integer', payload_hash: 'text' }, { unique: [['business_id', 'source_event_key']], checks: ['expected_version >= 0; result_version = expected_version + 1; payload_hash is canonical SHA-256; repeated key with changed command rejects'], indexes: [['business_id','lead_id','created_at']] });
table('sales.products', 8, 'Public catalog identity and active status.', { product_code: 'text', name: 'text', description: 'text?', active: 'boolean' }, { unique: [['business_id', 'product_code']] });
table('sales.skus', 8, 'Sellable variant and current authoritative price; immutable order snapshots preserve past prices.', { product_id: 'uuid', sku: 'text', attributes: 'jsonb', price: 'numeric(14,2)', currency: 'char(3)', price_version: 'integer', active: 'boolean', updated_at: 'timestamptz' }, { unique: [['business_id', 'sku']], checks: ['price >= 0; currency uppercase ISO code; price_version > 0; numeric money, not float'] });
table('sales.inventory', 8, 'One stock pool per SKU for initial dummy pilot; warehouses deferred.', { sku_id: 'uuid', on_hand: 'integer', reserved: 'integer', version: 'integer', updated_at: 'timestamptz' }, { unique: [['business_id', 'sku_id']], checks: ['0 <= reserved <= on_hand; version > 0; available = on_hand - reserved, not independently stored'] });
table('sales.orders', 18, 'Confirmed order and explicit reservation expiry; no payment secrets.', { customer_id: 'uuid', action_id: 'uuid', order_number: 'text', status: 'text', currency: 'char(3)', total: 'numeric(14,2)', reservation_expires_at: 'timestamptz?', version: 'integer', updated_at: 'timestamptz' }, { unique: [['business_id', 'action_id'], ['business_id', 'order_number']], checks: ['total >= 0; version > 0; total equals immutable line totals via controlled transaction'] });
table('sales.order_items', 18, 'Immutable SKU, quantity and accepted unit-price snapshot.', { order_id: 'uuid', sku_id: 'uuid', quantity: 'integer', unit_price: 'numeric(14,2)', price_version: 'integer' }, { unique: [['business_id', 'order_id', 'sku_id']], checks: ['quantity > 0; unit_price >= 0; price_version > 0'] });
table('sales.payments', 18, 'Provider-authoritative payment status/reference; collection/refunds disabled in initial pilot.', { order_id: 'uuid', provider: 'text', provider_reference: 'text', status: 'text', amount: 'numeric(14,2)', currency: 'char(3)', provider_updated_at: 'timestamptz?', updated_at: 'timestamptz' }, { unique: [['business_id', 'provider', 'provider_reference']], checks: ['amount >= 0; transition/event authenticity checked; timeout -> unknown; no PAN/CVV/secrets'] });
table('bise.students', 8, 'Synthetic student subject; production source mapping later, not an asserted Board schema.', { contact_id: 'uuid', source_student_ref: 'text', display_name: 'text' }, { unique: [['business_id', 'contact_id'], ['business_id', 'source_student_ref']] });
table('bise.exams', 8, 'Unambiguous examination/year/session/attempt context.', { exam_code: 'text', year: 'integer', session: 'text', attempt: 'text', publication_state: 'text' }, { unique: [['business_id', 'exam_code', 'year', 'session', 'attempt']], checks: ['publication_state draft/published/withheld'] });
table('bise.registrations', 8, 'Roll number scoped to an examination; names never act as unique identifiers.', { student_id: 'uuid', exam_id: 'uuid', roll_number: 'text' }, { unique: [['business_id', 'exam_id', 'roll_number'], ['business_id', 'exam_id', 'student_id']] });
table('bise.results', 8, 'Source-issued result; null/unpublished/withheld are not zero marks.', { registration_id: 'uuid', status: 'text', total_marks: 'numeric(7,2)?', obtained_marks: 'numeric(7,2)?', grade: 'text?', source_version: 'text', published_at: 'timestamptz?' }, { unique: [['business_id', 'registration_id']], checks: ['If present: 0 <= obtained_marks <= total_marks; explicit absent/withheld/missing states; source authority determines grade'] });
table('bise.subject_marks', 8, 'Per-result subject component; theory/practical distinguished.', { result_id: 'uuid', subject_code: 'text', subject_name: 'text', component: 'text', total_marks: 'numeric(7,2)?', obtained_marks: 'numeric(7,2)?', status: 'text', grade: 'text?' }, { unique: [['business_id', 'result_id', 'subject_code', 'component']], checks: ['If present: 0 <= obtained_marks <= total_marks; do not infer missing marks/grades'] });
table('hospital.departments', 8, 'Approved administrative directory.', { code: 'text', name: 'text', description: 'text?', active: 'boolean' }, { unique: [['business_id', 'code']] });
table('hospital.doctors', 8, 'Approved directory with one primary department for initial synthetic pilot.', { department_id: 'uuid', doctor_code: 'text', display_name: 'text', specialization: 'text', active: 'boolean' }, { unique: [['business_id', 'doctor_code']] });
table('hospital.slots', 8, 'Materialized exclusive consultation slots in one pilot branch; times stored as instants.', { doctor_id: 'uuid', starts_at: 'timestamptz', ends_at: 'timestamptz', state: 'text', version: 'integer' }, { unique: [['business_id', 'doctor_id', 'starts_at']], checks: ['ends_at > starts_at; state open/blocked/retired; version > 0', 'EXCLUDE overlapping [start,end) ranges per business+doctor for non-retired slots; requires btree_gist at migration stage'], indexes: [['business_id', 'doctor_id', 'starts_at']] });
table('hospital.appointments', 18, 'Patient subject is a tenant contact; protected access requires a matching grant, including delegated access.', { patient_id: 'uuid', slot_id: 'uuid', action_id: 'uuid', booking_reference: 'text', status: 'text', hold_expires_at: 'timestamptz?', version: 'integer', updated_at: 'timestamptz' }, { unique: [['business_id', 'booking_reference'], ['business_id', 'action_id']], checks: ['Partial UNIQUE(business_id,slot_id) for active reserving statuses held/confirmed; version > 0; reschedule atomically retains same booking id', 'held requires hold_expires_at > created_at; expiry worker transitions status under lock; no clock-dependent index predicate'] });
table('hospital.appointment_events', 18, 'Durable booking transition history, including previous/new slot on reschedule.', { appointment_id: 'uuid', action_id: 'uuid', from_slot_id: 'uuid?', to_slot_id: 'uuid?', event_type: 'text', actor_ref: 'text' }, { unique: [['business_id', 'action_id']] });
table('hospital.calendar_sync_jobs', 18, 'Version-aware desired external projection and reconciliation; separate from appointment status.', { appointment_id: 'uuid', appointment_version: 'integer', provider: 'text', external_event_id: 'text?', operation: 'text', status: 'text', attempts: 'integer', next_attempt_at: 'timestamptz?', lease_until: 'timestamptz?', error_code: 'text?' }, { unique: [['business_id', 'appointment_id', 'appointment_version', 'provider']], checks: ['attempts >= 0; appointment_version > 0; stable external identity and stale-job suppression'], indexes: [['status', 'next_attempt_at']] });
table('knowledge.documents', 13, 'Stable approved-source identity, tenant and permitted audience.', { source_key: 'text', title: 'text', category: 'text', audience: 'text', source_ref: 'text' }, { unique: [['business_id', 'source_key']], checks: ['No student/patient/private transaction records admitted to shared knowledge'] });
table('knowledge.versions', 13, 'Immutable document version and approval/effectivity; unpublished indexes never exposed.', { document_id: 'uuid', version: 'integer', content_hash: 'text', status: 'text', effective_from: 'timestamptz', effective_to: 'timestamptz?', approver_ref: 'text?', source_text: 'text', embedding_model: 'text', embedding_revision: 'text', embedding_dimension: 'integer' }, { unique: [['business_id', 'document_id', 'version']], checks: ['version > 0; dimension > 0; effective_to null or > effective_from; no conflicting active published windows per document unless explicitly segmented'] });
table('knowledge.chunks', 13, 'Shared chunk identity for genuine BM25 and pgvector; dimension finalized before vector DDL.', { version_id: 'uuid', ordinal: 'integer', content: 'text', content_hash: 'text', embedding: 'vector(d)', index_state: 'text' }, { unique: [['business_id', 'version_id', 'ordinal']], checks: ['ordinal >= 0; d must match approved embedding dimension; tenant/audience/version filter on both retrieval paths'] });
table('knowledge.ingestion_jobs', 14, 'Idempotent extraction/embedding/indexing work with retries and atomic publish gate.', { version_id: 'uuid', pipeline_version: 'text', status: 'text', attempts: 'integer', next_attempt_at: 'timestamptz?', lease_until: 'timestamptz?', error_code: 'text?' }, { unique: [['business_id', 'version_id', 'pipeline_version']], checks: ['attempts >= 0; published only when both retrieval paths are ready'] });

function fk(from, field, target) {
  tables.find(t => t.name === from).foreignKeys.push({ columns: ['business_id', field], target, targetColumns: ['business_id', 'id'], onDelete: 'RESTRICT' });
}
for (const t of tables.filter(t => t !== tenant)) t.foreignKeys.push({ columns: ['business_id'], target: tenant.name, targetColumns: ['id'], onDelete: 'RESTRICT' });
const refs = {
 'platform.channel_identities': { instance_id:'platform.instances',contact_id:'platform.contacts' },
 'platform.conversations': { instance_id:'platform.instances',contact_id:'platform.contacts' },
 'platform.sessions': { actor_contact_id:'platform.contacts' },
 'platform.verification_grants': { subject_contact_id:'platform.contacts' },
 'platform.requests': { instance_id:'platform.instances' },
 'platform.messages': { instance_id:'platform.instances' },
 'platform.actions': { session_id:'platform.sessions' },
 'platform.approvals': { action_id:'platform.actions' },
 'platform.outbox': { message_id:'platform.messages' },
 'platform.tool_runs': { request_id:'platform.requests' },
 'platform.handoffs': { conversation_id:'platform.conversations' },
 'crm.leads': { contact_id:'platform.contacts' },
 'crm.lead_events': { lead_id:'crm.leads' },
 'sales.skus': { product_id:'sales.products' },
 'sales.inventory': { sku_id:'sales.skus' },
 'sales.orders': { customer_id:'platform.contacts',action_id:'platform.actions' },
 'sales.order_items': { order_id:'sales.orders',sku_id:'sales.skus' },
 'sales.payments': { order_id:'sales.orders' },
 'bise.students': { contact_id:'platform.contacts' },
 'bise.registrations': { student_id:'bise.students',exam_id:'bise.exams' },
 'bise.results': { registration_id:'bise.registrations' },
 'bise.subject_marks': { result_id:'bise.results' },
 'hospital.doctors': { department_id:'hospital.departments' },
 'hospital.slots': { doctor_id:'hospital.doctors' },
 'hospital.appointments': { patient_id:'platform.contacts',slot_id:'hospital.slots',action_id:'platform.actions' },
 'hospital.appointment_events': { appointment_id:'hospital.appointments',action_id:'platform.actions',from_slot_id:'hospital.slots',to_slot_id:'hospital.slots' },
 'hospital.calendar_sync_jobs': { appointment_id:'hospital.appointments' },
 'knowledge.versions': { document_id:'knowledge.documents' },
 'knowledge.chunks': { version_id:'knowledge.versions' },
 'knowledge.ingestion_jobs': { version_id:'knowledge.versions' }
};
for (const [from, fields] of Object.entries(refs)) for (const [col, to] of Object.entries(fields)) fk(from, col, to);
tables.find(t=>t.name==='platform.sessions').foreignKeys.push({columns:['business_id','conversation_id','actor_contact_id'],target:'platform.conversations',targetColumns:['business_id','id','contact_id'],onDelete:'RESTRICT'});
tables.find(t=>t.name==='platform.verification_grants').foreignKeys.push({columns:['business_id','session_id','actor_contact_id'],target:'platform.sessions',targetColumns:['business_id','id','actor_contact_id'],onDelete:'RESTRICT'});
tables.find(t=>t.name==='platform.actions').foreignKeys.push({columns:['business_id','verification_grant_id','session_id'],target:'platform.verification_grants',targetColumns:['business_id','id','session_id'],onDelete:'RESTRICT'});
for(const [field,target] of [['conversation_id','platform.conversations'],['request_id','platform.requests']]) tables.find(t=>t.name==='platform.messages').foreignKeys.push({columns:['business_id',field,'instance_id'],target,targetColumns:['business_id','id','instance_id'],onDelete:'RESTRICT'});
// Reuse entity templates, not a shared operational database.
const templates = structuredClone(tables);
tables.length = 0;
const databases = ['control_db','pos_db','bise_db','hospital_db'].map(name=>({
 name, domain: ({control_db:'control',pos_db:'sales',bise_db:'bise',hospital_db:'hospital'})[name],
 vectorExtension: name==='control_db'?null:'vector', extensionPhase: name==='control_db'?null:12,
 runtimeRole: name.replace('_db','')+'_runtime', ownerRole: name.replace('_db','')+'_owner',
 runtimePrivileges: {superuser:false,bypassrls:false,createdb:false,createrole:false,ownsTables:false,crossDatabaseConnect:false},
 deployment: 'Proposed separate database; initially same PostgreSQL server'
}));
function extra(db,short,phase,purpose,fields,unique=[]){
 const t=table(short,phase,purpose,fields,{unique});
 t.database=db;t.template=short;t.name=db+'.'+short;t.schema=short.split('.')[0];t.authority='local';
 t.foreignKeys.push({columns:['business_id'],target:db+'.platform.businesses',targetColumns:['id'],onDelete:'RESTRICT'});
 return t;
}
for(const db of databases){
 const central=db.domain==='control';
 const selected=templates.filter(t=>central
  ? ['platform.businesses','platform.instances','platform.audit_events'].includes(t.name)
  : t.name.startsWith('platform.')||t.name.startsWith('knowledge.')||t.name.startsWith(db.domain+'.')||(db.domain==='sales'&&t.name.startsWith('crm.')));
 for(const original of selected){
  const t=structuredClone(original);t.template=t.name;t.database=db.name;t.schema=t.name.split('.')[0];t.name=db.name+'.'+t.name;
  t.foreignKeys.forEach(f=>f.target=db.name+'.'+f.target);t.authority='local';t.externalReferences=[];
  if(!central && ['platform.businesses','platform.instances'].includes(t.template)){
   t.authority='provisioned_projection';
   t.purpose='Read-only domain projection of central routing/configuration; only scoped configuration consumer may update.';
   t.columns.config_revision={type:'bigint',nullable:false};t.columns.valid_until={type:'timestamptz',nullable:false};
   delete t.columns.credential_ref;
   t.externalReferences.push({target:'control_db.'+t.template,localColumns:t.primaryKey,targetColumns:t.primaryKey,contract:'Versioned authenticated configuration events; never a cross-database FK; expired configuration denies dispatch.'});
  }
  tables.push(t);
 }
 if(central){
  extra(db.name,'platform.configuration_outbox',4,'Configuration publication intent committed with authoritative configuration and audit.',{config_revision:'bigint',event_type:'text',payload:'jsonb',payload_hash:'text',status:'text',attempts:'integer',next_attempt_at:'timestamptz?',lease_until:'timestamptz?'},[['business_id','config_revision']]);
  const events=extra(db.name,'platform.reporting_events',6,'Immutable minimized reporting inbox; same-key different hash quarantined.',{origin_database:'text',origin_event_ref:'uuid',aggregate_ref:'text',aggregate_version:'bigint',event_type:'text',payload:'jsonb',payload_hash:'text',occurred_at:'timestamptz',received_at:'timestamptz'},[['business_id','origin_database','origin_event_ref']]);
  events.externalReferences=[{target:'{authorized_domain_db}.platform.reporting_outbox',localColumns:['business_id','origin_event_ref'],targetColumns:['business_id','id'],contract:'Authenticated producer fixes origin_database; immutable event hash, deduplication and source reconciliation; no cross-database FK.'}];
  const directory=extra(db.name,'platform.session_directory',6,'Routing/status projection only; domain session remains authoritative.',{origin_database:'text',domain_session_ref:'uuid',state_version:'bigint',status:'text',updated_at:'timestamptz'},[['business_id','origin_database','domain_session_ref']]);
  directory.externalReferences=[{target:'{authorized_domain_db}.platform.sessions',localColumns:['business_id','domain_session_ref'],targetColumns:['business_id','id'],contract:'Versioned projection, never an authorization grant; dangling references marked unavailable after recovery.'}];
 }else{
  const inbox=extra(db.name,'platform.configuration_inbox',4,'Idempotent config receipt and local projection changes committed together.',{origin_event_ref:'uuid',config_revision:'bigint',payload_hash:'text',applied_at:'timestamptz'},[['business_id','origin_event_ref'],['business_id','config_revision']]);
  inbox.externalReferences=[{target:'control_db.platform.configuration_outbox',localColumns:['business_id','origin_event_ref'],targetColumns:['business_id','id'],contract:'Authenticated provisioning; local registry upsert and inbox record in same domain transaction; config revision replay protection.'}];
  extra(db.name,'platform.reporting_outbox',6,'Immutable reporting event inserted with local mutation/audit; delivery fields separately mutable.',{aggregate_ref:'text',aggregate_version:'bigint',event_type:'text',payload:'jsonb',payload_hash:'text',status:'text',attempts:'integer',next_attempt_at:'timestamptz?',lease_until:'timestamptz?'},[['business_id','aggregate_ref','aggregate_version','event_type']]);
 }
}
const model = {version:2,status:'PROPOSED_DESIGN_ONLY',productionMapping:'unknown; synthetic schema only',vectorEngine:'pgvector',lexicalEngine:'BM25 implementation pending evaluation',databases,
 boundaries:{crossDatabaseForeignKeys:false,distributedTransactions:false,localAuditOutboxIdempotency:true,centralReporting:'at-least-once delivery; idempotent inbox; versioned projection; reconciliation',tenantContext:'server-authorized business_id; never LLM supplied'},
 phase4Tables:tables.filter(t=>t.phase===4).map(t=>t.name),tables};
fs.writeFileSync(path.join(dir,'schema-catalog.json'),JSON.stringify(model,null,2)+'\n');
let md='# Proposed data dictionary\n\nGenerated from `scripts/build-phase3-design.cjs`. This is a review catalog, not executable SQL. `?` marks a nullable field. Constraints written as prose require concrete SQL/service implementation and real database tests in the assigned phase. `vector(d)` remains a deliberate unresolved design parameter. All IDs are application-generated UUIDs; all timestamps represent instants.\n\n';
for(const t of tables){
 md+=`## ${t.name} — Phase ${t.phase}\n\n${t.purpose}\n\n| Column | Proposed type | Nullable |\n| --- | --- | --- |\n`;
 for(const [name,c] of Object.entries(t.columns))md+=`| ${name} | ${c.type} | ${c.nullable?'yes':'no'} |\n`;
 md+=`\nPrimary key: ${t.primaryKey.join(', ')}.\n\n`;
 md+=`Database: ${t.database}. Authority: ${t.authority}. Reusable template: ${t.template}.\n\n`;
 for(const r of t.externalReferences||[])md+=`- Logical external reference (NOT a SQL FK): ${r.target}; ${r.contract}\n`;
 for(const u of t.unique)md+=`- Unique: (${u.join(', ')}).\n`;
 for(const f of t.foreignKeys)md+=`- FK: (${f.columns.join(', ')}) → ${f.target} (${f.targetColumns.join(', ')}); delete ${f.onDelete}.\n`;
 for(const c of t.checks)md+=`- Required invariant: ${c}.\n`;
 for(const i of t.indexes)md+=`- Candidate nonunique index: (${i.join(', ')}); measure against actual queries.\n`;
 md+='\nRLS and service authorization required; retention is defined by data class in the design review.\n\n';
}
fs.writeFileSync(path.join(dir,'DATA_DICTIONARY.md'),md);
let erd='# Proposed ER diagrams — revision 2\n\nFour separate databases on one initial PostgreSQL server. Every FK below is local to its database. Central-to-domain references are authenticated synchronization contracts, never SQL FKs. Each domain owns its sessions, grants, actions, audit and outboxes. Central sessions are directory projections only. Business ownership FKs are omitted for readability but remain mandatory in the catalog. This is a design, not deployed infrastructure.\n\n';
for(const group of [...new Set(tables.map(t=>t.database+'.'+t.schema))]){
 erd+=`## ${group}\n\n\`\`\`mermaid\nerDiagram\n`;
 const ts=tables.filter(t=>t.name.startsWith(group+'.'));
 const entities=new Set(ts.map(t=>t.name));
 for(const t of ts)for(const f of t.foreignKeys)if(!f.target.endsWith('.platform.businesses'))entities.add(f.target);
 for(const name of entities)erd+=`    ${name.replaceAll('.','_')} {\n        uuid id PK\n${!name.endsWith('.platform.businesses')?'        uuid business_id PK,FK\n':''}    }\n`;
 for(const t of ts)for(const f of t.foreignKeys)if(!f.target.endsWith('.platform.businesses')){
  const optional=f.columns.some(c=>t.columns[c].nullable);
  const unique=[t.primaryKey,...t.unique].some(k=>k.every(c=>f.columns.includes(c)));
  erd+=`    ${f.target.replaceAll('.','_')} ${optional?'|o':'||'}--${unique?'o|':'o{'} ${t.name.replaceAll('.','_')} : "${f.columns.filter(c=>c!=='business_id').join('+')}"\n`;
 }
 erd+='```\n\n';
}
fs.writeFileSync(path.join(dir,'ERD.md'),erd);
console.log(`Generated design catalog, dictionary and ERDs: ${tables.length} proposed entities. No database operations.`);
