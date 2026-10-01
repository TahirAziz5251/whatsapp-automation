-- ==============================================================================
-- MASTER DATABASE CREATION SCRIPT FOR PGADMIN / POSTGRESQL
-- Run this script in pgAdmin while connected to the default "postgres" database.
-- ==============================================================================

-- 1. Create Evolution Go Databases
CREATE DATABASE evogo_users;
CREATE DATABASE evogo_auth;

-- 2. Create Multi-Tenant Control Plane & Domain Databases
CREATE DATABASE platform_db;
CREATE DATABASE bise_db;
CREATE DATABASE hospital_db;
CREATE DATABASE pos_db;
