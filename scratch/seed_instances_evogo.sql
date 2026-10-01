
-- Ensure UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Provision Instances in Evolution Go evogo_users DB
INSERT INTO instances (id, name, token, webhook, events, connected, jid, client_name, created_at)
VALUES 
  (COALESCE((SELECT id FROM instances WHERE name = 'student-assistant'), gen_random_uuid()::text), 'student-assistant', 'student_assistant_token_2026', 'http://n8n:5678/webhook/evolution-whatsapp-agent', '["MESSAGES_UPSERT","SEND_MESSAGE"]', true, '923127118485@s.whatsapp.net', 'admin', NOW()),
  (COALESCE((SELECT id FROM instances WHERE name = 'hospital-assistant'), gen_random_uuid()::text), 'hospital-assistant', 'hospital_assistant_token_2026', 'http://n8n:5678/webhook/evolution-whatsapp-agent', '["MESSAGES_UPSERT","SEND_MESSAGE"]', true, '923201711081@s.whatsapp.net', 'admin', NOW()),
  (COALESCE((SELECT id FROM instances WHERE name = 'point-of-sale'), gen_random_uuid()::text), 'point-of-sale', 'pos_assistant_token_2026', 'http://n8n:5678/webhook/evolution-whatsapp-agent', '["MESSAGES_UPSERT","SEND_MESSAGE"]', true, '923098414407@s.whatsapp.net', 'admin', NOW())
ON CONFLICT (name) DO UPDATE
SET token = EXCLUDED.token, webhook = EXCLUDED.webhook, events = EXCLUDED.events, connected = true, jid = EXCLUDED.jid, client_name = EXCLUDED.client_name;
