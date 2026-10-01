# Proposed ER diagrams — revision 2

Four separate databases on one initial PostgreSQL server. Every FK below is local to its database. Central-to-domain references are authenticated synchronization contracts, never SQL FKs. Each domain owns its sessions, grants, actions, audit and outboxes. Central sessions are directory projections only. Business ownership FKs are omitted for readability but remain mandatory in the catalog. This is a design, not deployed infrastructure.

## control_db.platform

```mermaid
erDiagram
    control_db_platform_businesses {
        uuid id PK
    }
    control_db_platform_instances {
        uuid id PK
        uuid business_id PK,FK
    }
    control_db_platform_audit_events {
        uuid id PK
        uuid business_id PK,FK
    }
    control_db_platform_configuration_outbox {
        uuid id PK
        uuid business_id PK,FK
    }
    control_db_platform_reporting_events {
        uuid id PK
        uuid business_id PK,FK
    }
    control_db_platform_session_directory {
        uuid id PK
        uuid business_id PK,FK
    }
```

## pos_db.platform

```mermaid
erDiagram
    pos_db_platform_businesses {
        uuid id PK
    }
    pos_db_platform_instances {
        uuid id PK
        uuid business_id PK,FK
    }
    pos_db_platform_contacts {
        uuid id PK
        uuid business_id PK,FK
    }
    pos_db_platform_channel_identities {
        uuid id PK
        uuid business_id PK,FK
    }
    pos_db_platform_conversations {
        uuid id PK
        uuid business_id PK,FK
    }
    pos_db_platform_sessions {
        uuid id PK
        uuid business_id PK,FK
    }
    pos_db_platform_verification_grants {
        uuid id PK
        uuid business_id PK,FK
    }
    pos_db_platform_requests {
        uuid id PK
        uuid business_id PK,FK
    }
    pos_db_platform_messages {
        uuid id PK
        uuid business_id PK,FK
    }
    pos_db_platform_actions {
        uuid id PK
        uuid business_id PK,FK
    }
    pos_db_platform_approvals {
        uuid id PK
        uuid business_id PK,FK
    }
    pos_db_platform_outbox {
        uuid id PK
        uuid business_id PK,FK
    }
    pos_db_platform_audit_events {
        uuid id PK
        uuid business_id PK,FK
    }
    pos_db_platform_tool_runs {
        uuid id PK
        uuid business_id PK,FK
    }
    pos_db_platform_handoffs {
        uuid id PK
        uuid business_id PK,FK
    }
    pos_db_platform_configuration_inbox {
        uuid id PK
        uuid business_id PK,FK
    }
    pos_db_platform_reporting_outbox {
        uuid id PK
        uuid business_id PK,FK
    }
    pos_db_platform_instances ||--o{ pos_db_platform_channel_identities : "instance_id"
    pos_db_platform_contacts ||--o{ pos_db_platform_channel_identities : "contact_id"
    pos_db_platform_instances ||--o{ pos_db_platform_conversations : "instance_id"
    pos_db_platform_contacts ||--o{ pos_db_platform_conversations : "contact_id"
    pos_db_platform_contacts ||--o{ pos_db_platform_sessions : "actor_contact_id"
    pos_db_platform_conversations ||--o{ pos_db_platform_sessions : "conversation_id+actor_contact_id"
    pos_db_platform_contacts ||--o{ pos_db_platform_verification_grants : "subject_contact_id"
    pos_db_platform_sessions ||--o{ pos_db_platform_verification_grants : "session_id+actor_contact_id"
    pos_db_platform_instances ||--o{ pos_db_platform_requests : "instance_id"
    pos_db_platform_instances ||--o{ pos_db_platform_messages : "instance_id"
    pos_db_platform_conversations ||--o{ pos_db_platform_messages : "conversation_id+instance_id"
    pos_db_platform_requests |o--o{ pos_db_platform_messages : "request_id+instance_id"
    pos_db_platform_sessions ||--o{ pos_db_platform_actions : "session_id"
    pos_db_platform_verification_grants |o--o{ pos_db_platform_actions : "verification_grant_id+session_id"
    pos_db_platform_actions ||--o{ pos_db_platform_approvals : "action_id"
    pos_db_platform_messages ||--o| pos_db_platform_outbox : "message_id"
    pos_db_platform_requests ||--o{ pos_db_platform_tool_runs : "request_id"
    pos_db_platform_conversations ||--o{ pos_db_platform_handoffs : "conversation_id"
```

## pos_db.crm

```mermaid
erDiagram
    pos_db_crm_leads {
        uuid id PK
        uuid business_id PK,FK
    }
    pos_db_crm_lead_events {
        uuid id PK
        uuid business_id PK,FK
    }
    pos_db_platform_contacts {
        uuid id PK
        uuid business_id PK,FK
    }
    pos_db_platform_contacts ||--o| pos_db_crm_leads : "contact_id"
    pos_db_crm_leads ||--o{ pos_db_crm_lead_events : "lead_id"
```

## pos_db.sales

```mermaid
erDiagram
    pos_db_sales_products {
        uuid id PK
        uuid business_id PK,FK
    }
    pos_db_sales_skus {
        uuid id PK
        uuid business_id PK,FK
    }
    pos_db_sales_inventory {
        uuid id PK
        uuid business_id PK,FK
    }
    pos_db_sales_orders {
        uuid id PK
        uuid business_id PK,FK
    }
    pos_db_sales_order_items {
        uuid id PK
        uuid business_id PK,FK
    }
    pos_db_sales_payments {
        uuid id PK
        uuid business_id PK,FK
    }
    pos_db_platform_contacts {
        uuid id PK
        uuid business_id PK,FK
    }
    pos_db_platform_actions {
        uuid id PK
        uuid business_id PK,FK
    }
    pos_db_sales_products ||--o{ pos_db_sales_skus : "product_id"
    pos_db_sales_skus ||--o| pos_db_sales_inventory : "sku_id"
    pos_db_platform_contacts ||--o{ pos_db_sales_orders : "customer_id"
    pos_db_platform_actions ||--o| pos_db_sales_orders : "action_id"
    pos_db_sales_orders ||--o{ pos_db_sales_order_items : "order_id"
    pos_db_sales_skus ||--o{ pos_db_sales_order_items : "sku_id"
    pos_db_sales_orders ||--o{ pos_db_sales_payments : "order_id"
```

## pos_db.knowledge

```mermaid
erDiagram
    pos_db_knowledge_documents {
        uuid id PK
        uuid business_id PK,FK
    }
    pos_db_knowledge_versions {
        uuid id PK
        uuid business_id PK,FK
    }
    pos_db_knowledge_chunks {
        uuid id PK
        uuid business_id PK,FK
    }
    pos_db_knowledge_ingestion_jobs {
        uuid id PK
        uuid business_id PK,FK
    }
    pos_db_knowledge_documents ||--o{ pos_db_knowledge_versions : "document_id"
    pos_db_knowledge_versions ||--o{ pos_db_knowledge_chunks : "version_id"
    pos_db_knowledge_versions ||--o{ pos_db_knowledge_ingestion_jobs : "version_id"
```

## bise_db.platform

```mermaid
erDiagram
    bise_db_platform_businesses {
        uuid id PK
    }
    bise_db_platform_instances {
        uuid id PK
        uuid business_id PK,FK
    }
    bise_db_platform_contacts {
        uuid id PK
        uuid business_id PK,FK
    }
    bise_db_platform_channel_identities {
        uuid id PK
        uuid business_id PK,FK
    }
    bise_db_platform_conversations {
        uuid id PK
        uuid business_id PK,FK
    }
    bise_db_platform_sessions {
        uuid id PK
        uuid business_id PK,FK
    }
    bise_db_platform_verification_grants {
        uuid id PK
        uuid business_id PK,FK
    }
    bise_db_platform_requests {
        uuid id PK
        uuid business_id PK,FK
    }
    bise_db_platform_messages {
        uuid id PK
        uuid business_id PK,FK
    }
    bise_db_platform_actions {
        uuid id PK
        uuid business_id PK,FK
    }
    bise_db_platform_approvals {
        uuid id PK
        uuid business_id PK,FK
    }
    bise_db_platform_outbox {
        uuid id PK
        uuid business_id PK,FK
    }
    bise_db_platform_audit_events {
        uuid id PK
        uuid business_id PK,FK
    }
    bise_db_platform_tool_runs {
        uuid id PK
        uuid business_id PK,FK
    }
    bise_db_platform_handoffs {
        uuid id PK
        uuid business_id PK,FK
    }
    bise_db_platform_configuration_inbox {
        uuid id PK
        uuid business_id PK,FK
    }
    bise_db_platform_reporting_outbox {
        uuid id PK
        uuid business_id PK,FK
    }
    bise_db_platform_instances ||--o{ bise_db_platform_channel_identities : "instance_id"
    bise_db_platform_contacts ||--o{ bise_db_platform_channel_identities : "contact_id"
    bise_db_platform_instances ||--o{ bise_db_platform_conversations : "instance_id"
    bise_db_platform_contacts ||--o{ bise_db_platform_conversations : "contact_id"
    bise_db_platform_contacts ||--o{ bise_db_platform_sessions : "actor_contact_id"
    bise_db_platform_conversations ||--o{ bise_db_platform_sessions : "conversation_id+actor_contact_id"
    bise_db_platform_contacts ||--o{ bise_db_platform_verification_grants : "subject_contact_id"
    bise_db_platform_sessions ||--o{ bise_db_platform_verification_grants : "session_id+actor_contact_id"
    bise_db_platform_instances ||--o{ bise_db_platform_requests : "instance_id"
    bise_db_platform_instances ||--o{ bise_db_platform_messages : "instance_id"
    bise_db_platform_conversations ||--o{ bise_db_platform_messages : "conversation_id+instance_id"
    bise_db_platform_requests |o--o{ bise_db_platform_messages : "request_id+instance_id"
    bise_db_platform_sessions ||--o{ bise_db_platform_actions : "session_id"
    bise_db_platform_verification_grants |o--o{ bise_db_platform_actions : "verification_grant_id+session_id"
    bise_db_platform_actions ||--o{ bise_db_platform_approvals : "action_id"
    bise_db_platform_messages ||--o| bise_db_platform_outbox : "message_id"
    bise_db_platform_requests ||--o{ bise_db_platform_tool_runs : "request_id"
    bise_db_platform_conversations ||--o{ bise_db_platform_handoffs : "conversation_id"
```

## bise_db.bise

```mermaid
erDiagram
    bise_db_bise_students {
        uuid id PK
        uuid business_id PK,FK
    }
    bise_db_bise_exams {
        uuid id PK
        uuid business_id PK,FK
    }
    bise_db_bise_registrations {
        uuid id PK
        uuid business_id PK,FK
    }
    bise_db_bise_results {
        uuid id PK
        uuid business_id PK,FK
    }
    bise_db_bise_subject_marks {
        uuid id PK
        uuid business_id PK,FK
    }
    bise_db_platform_contacts {
        uuid id PK
        uuid business_id PK,FK
    }
    bise_db_platform_contacts ||--o| bise_db_bise_students : "contact_id"
    bise_db_bise_students ||--o{ bise_db_bise_registrations : "student_id"
    bise_db_bise_exams ||--o{ bise_db_bise_registrations : "exam_id"
    bise_db_bise_registrations ||--o| bise_db_bise_results : "registration_id"
    bise_db_bise_results ||--o{ bise_db_bise_subject_marks : "result_id"
```

## bise_db.knowledge

```mermaid
erDiagram
    bise_db_knowledge_documents {
        uuid id PK
        uuid business_id PK,FK
    }
    bise_db_knowledge_versions {
        uuid id PK
        uuid business_id PK,FK
    }
    bise_db_knowledge_chunks {
        uuid id PK
        uuid business_id PK,FK
    }
    bise_db_knowledge_ingestion_jobs {
        uuid id PK
        uuid business_id PK,FK
    }
    bise_db_knowledge_documents ||--o{ bise_db_knowledge_versions : "document_id"
    bise_db_knowledge_versions ||--o{ bise_db_knowledge_chunks : "version_id"
    bise_db_knowledge_versions ||--o{ bise_db_knowledge_ingestion_jobs : "version_id"
```

## hospital_db.platform

```mermaid
erDiagram
    hospital_db_platform_businesses {
        uuid id PK
    }
    hospital_db_platform_instances {
        uuid id PK
        uuid business_id PK,FK
    }
    hospital_db_platform_contacts {
        uuid id PK
        uuid business_id PK,FK
    }
    hospital_db_platform_channel_identities {
        uuid id PK
        uuid business_id PK,FK
    }
    hospital_db_platform_conversations {
        uuid id PK
        uuid business_id PK,FK
    }
    hospital_db_platform_sessions {
        uuid id PK
        uuid business_id PK,FK
    }
    hospital_db_platform_verification_grants {
        uuid id PK
        uuid business_id PK,FK
    }
    hospital_db_platform_requests {
        uuid id PK
        uuid business_id PK,FK
    }
    hospital_db_platform_messages {
        uuid id PK
        uuid business_id PK,FK
    }
    hospital_db_platform_actions {
        uuid id PK
        uuid business_id PK,FK
    }
    hospital_db_platform_approvals {
        uuid id PK
        uuid business_id PK,FK
    }
    hospital_db_platform_outbox {
        uuid id PK
        uuid business_id PK,FK
    }
    hospital_db_platform_audit_events {
        uuid id PK
        uuid business_id PK,FK
    }
    hospital_db_platform_tool_runs {
        uuid id PK
        uuid business_id PK,FK
    }
    hospital_db_platform_handoffs {
        uuid id PK
        uuid business_id PK,FK
    }
    hospital_db_platform_configuration_inbox {
        uuid id PK
        uuid business_id PK,FK
    }
    hospital_db_platform_reporting_outbox {
        uuid id PK
        uuid business_id PK,FK
    }
    hospital_db_platform_instances ||--o{ hospital_db_platform_channel_identities : "instance_id"
    hospital_db_platform_contacts ||--o{ hospital_db_platform_channel_identities : "contact_id"
    hospital_db_platform_instances ||--o{ hospital_db_platform_conversations : "instance_id"
    hospital_db_platform_contacts ||--o{ hospital_db_platform_conversations : "contact_id"
    hospital_db_platform_contacts ||--o{ hospital_db_platform_sessions : "actor_contact_id"
    hospital_db_platform_conversations ||--o{ hospital_db_platform_sessions : "conversation_id+actor_contact_id"
    hospital_db_platform_contacts ||--o{ hospital_db_platform_verification_grants : "subject_contact_id"
    hospital_db_platform_sessions ||--o{ hospital_db_platform_verification_grants : "session_id+actor_contact_id"
    hospital_db_platform_instances ||--o{ hospital_db_platform_requests : "instance_id"
    hospital_db_platform_instances ||--o{ hospital_db_platform_messages : "instance_id"
    hospital_db_platform_conversations ||--o{ hospital_db_platform_messages : "conversation_id+instance_id"
    hospital_db_platform_requests |o--o{ hospital_db_platform_messages : "request_id+instance_id"
    hospital_db_platform_sessions ||--o{ hospital_db_platform_actions : "session_id"
    hospital_db_platform_verification_grants |o--o{ hospital_db_platform_actions : "verification_grant_id+session_id"
    hospital_db_platform_actions ||--o{ hospital_db_platform_approvals : "action_id"
    hospital_db_platform_messages ||--o| hospital_db_platform_outbox : "message_id"
    hospital_db_platform_requests ||--o{ hospital_db_platform_tool_runs : "request_id"
    hospital_db_platform_conversations ||--o{ hospital_db_platform_handoffs : "conversation_id"
```

## hospital_db.hospital

```mermaid
erDiagram
    hospital_db_hospital_departments {
        uuid id PK
        uuid business_id PK,FK
    }
    hospital_db_hospital_doctors {
        uuid id PK
        uuid business_id PK,FK
    }
    hospital_db_hospital_slots {
        uuid id PK
        uuid business_id PK,FK
    }
    hospital_db_hospital_appointments {
        uuid id PK
        uuid business_id PK,FK
    }
    hospital_db_hospital_appointment_events {
        uuid id PK
        uuid business_id PK,FK
    }
    hospital_db_hospital_calendar_sync_jobs {
        uuid id PK
        uuid business_id PK,FK
    }
    hospital_db_platform_contacts {
        uuid id PK
        uuid business_id PK,FK
    }
    hospital_db_platform_actions {
        uuid id PK
        uuid business_id PK,FK
    }
    hospital_db_hospital_departments ||--o{ hospital_db_hospital_doctors : "department_id"
    hospital_db_hospital_doctors ||--o{ hospital_db_hospital_slots : "doctor_id"
    hospital_db_platform_contacts ||--o{ hospital_db_hospital_appointments : "patient_id"
    hospital_db_hospital_slots ||--o{ hospital_db_hospital_appointments : "slot_id"
    hospital_db_platform_actions ||--o| hospital_db_hospital_appointments : "action_id"
    hospital_db_hospital_appointments ||--o{ hospital_db_hospital_appointment_events : "appointment_id"
    hospital_db_platform_actions ||--o| hospital_db_hospital_appointment_events : "action_id"
    hospital_db_hospital_slots |o--o{ hospital_db_hospital_appointment_events : "from_slot_id"
    hospital_db_hospital_slots |o--o{ hospital_db_hospital_appointment_events : "to_slot_id"
    hospital_db_hospital_appointments ||--o{ hospital_db_hospital_calendar_sync_jobs : "appointment_id"
```

## hospital_db.knowledge

```mermaid
erDiagram
    hospital_db_knowledge_documents {
        uuid id PK
        uuid business_id PK,FK
    }
    hospital_db_knowledge_versions {
        uuid id PK
        uuid business_id PK,FK
    }
    hospital_db_knowledge_chunks {
        uuid id PK
        uuid business_id PK,FK
    }
    hospital_db_knowledge_ingestion_jobs {
        uuid id PK
        uuid business_id PK,FK
    }
    hospital_db_knowledge_documents ||--o{ hospital_db_knowledge_versions : "document_id"
    hospital_db_knowledge_versions ||--o{ hospital_db_knowledge_chunks : "version_id"
    hospital_db_knowledge_versions ||--o{ hospital_db_knowledge_ingestion_jobs : "version_id"
```

