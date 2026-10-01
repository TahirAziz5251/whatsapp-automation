-- ==============================================================================
-- BACKEND CONNECTION SAFEGUARDS & TIMEOUT POLICIES
-- Enforces Statement Timeout, Lock Timeout & Idle-in-Transaction Timeout
-- at both the Database and Role Levels for Strict Production Stability
-- ==============================================================================

-- 1. Database-Level Timeout Policies (Applies to all sessions on each database)
ALTER DATABASE platform_db SET statement_timeout = '15s';
ALTER DATABASE platform_db SET lock_timeout = '5s';
ALTER DATABASE platform_db SET idle_in_transaction_session_timeout = '20s';

ALTER DATABASE pos_db SET statement_timeout = '15s';
ALTER DATABASE pos_db SET lock_timeout = '5s';
ALTER DATABASE pos_db SET idle_in_transaction_session_timeout = '20s';

ALTER DATABASE bise_db SET statement_timeout = '15s';
ALTER DATABASE bise_db SET lock_timeout = '5s';
ALTER DATABASE bise_db SET idle_in_transaction_session_timeout = '20s';

ALTER DATABASE hospital_db SET statement_timeout = '15s';
ALTER DATABASE hospital_db SET lock_timeout = '5s';
ALTER DATABASE hospital_db SET idle_in_transaction_session_timeout = '20s';

-- 2. Role-Level Timeout Policies (Least-Privilege Enforcement)
ALTER ROLE platform_app SET statement_timeout = '15s';
ALTER ROLE platform_app SET lock_timeout = '5s';
ALTER ROLE platform_app SET idle_in_transaction_session_timeout = '20s';

ALTER ROLE pos_app SET statement_timeout = '15s';
ALTER ROLE pos_app SET lock_timeout = '5s';
ALTER ROLE pos_app SET idle_in_transaction_session_timeout = '20s';

ALTER ROLE bise_app SET statement_timeout = '15s';
ALTER ROLE bise_app SET lock_timeout = '5s';
ALTER ROLE bise_app SET idle_in_transaction_session_timeout = '20s';

ALTER ROLE hospital_app SET statement_timeout = '15s';
ALTER ROLE hospital_app SET lock_timeout = '5s';
ALTER ROLE hospital_app SET idle_in_transaction_session_timeout = '20s';

-- Strict read-only query timeout for AI agents (10 seconds)
ALTER ROLE gateway_readonly SET statement_timeout = '10s';
ALTER ROLE gateway_readonly SET lock_timeout = '3s';
ALTER ROLE gateway_readonly SET idle_in_transaction_session_timeout = '10s';

-- Action writer timeout (15 seconds)
ALTER ROLE gateway_action_writer SET statement_timeout = '15s';
ALTER ROLE gateway_action_writer SET lock_timeout = '5s';
ALTER ROLE gateway_action_writer SET idle_in_transaction_session_timeout = '20s';

-- 3. Verification Query: Confirm Policies are Active
SELECT 
    rolname, 
    rolconfig 
FROM pg_roles 
WHERE rolname IN ('platform_app', 'pos_app', 'bise_app', 'hospital_app', 'gateway_readonly', 'gateway_action_writer')
ORDER BY rolname;
