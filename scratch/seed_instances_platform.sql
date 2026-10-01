
-- Provision Master Instances in platform_whatsapp_instances
INSERT INTO platform_whatsapp_instances (business_code, instance_name, instance_token, phone_number, status)
VALUES 
  ('BISE_EDU', 'student-assistant', 'student_assistant_token_2026', '+923127118485', 'CONNECTED'),
  ('HOSP_HEALTH', 'hospital-assistant', 'hospital_assistant_token_2026', '+923201711081', 'CONNECTED'),
  ('POS_RETAIL', 'point-of-sale', 'pos_assistant_token_2026', '+923098414407', 'CONNECTED')
ON CONFLICT (instance_name) DO UPDATE
SET instance_token = EXCLUDED.instance_token, phone_number = EXCLUDED.phone_number, status = 'CONNECTED';
