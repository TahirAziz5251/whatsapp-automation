-- ==============================================================================
-- Master Domain Database Script: pos_db (Retail & Point of Sale Domain)
-- Single Canonical DDL, Variants, Idempotency & Edge-Case Seed Data
-- ==============================================================================

-- Optional vector extension (if installed):
-- CREATE EXTENSION IF NOT EXISTS vector;

-- 1. Categories
CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY,
    category_name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Products
CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    sku VARCHAR(50) UNIQUE NOT NULL,
    category_id INT REFERENCES categories(id),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Product Variants (Multi-Variant SKU Expansion: Interfaces, Colors, License Tiers)
CREATE TABLE IF NOT EXISTS product_variants (
    id SERIAL PRIMARY KEY,
    product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    variant_sku VARCHAR(50) UNIQUE NOT NULL,
    variant_name VARCHAR(100) NOT NULL,
    attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
    additional_price_pkr NUMERIC(10, 2) DEFAULT 0.00,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Prices (Strict Unique Constraint on Product + Currency for Deterministic Quotes)
CREATE TABLE IF NOT EXISTS prices (
    id SERIAL PRIMARY KEY,
    product_id INT REFERENCES products(id) ON DELETE CASCADE,
    price_pkr NUMERIC(10, 2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'PKR',
    effective_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_product_currency UNIQUE (product_id, currency)
);

-- 5. Inventory (Stock Tracking with Out-of-Stock and Low-Stock Thresholds)
CREATE TABLE IF NOT EXISTS inventory (
    id SERIAL PRIMARY KEY,
    product_id INT UNIQUE REFERENCES products(id) ON DELETE CASCADE,
    stock_quantity INT NOT NULL DEFAULT 0,
    reorder_level INT DEFAULT 5,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. Customers
CREATE TABLE IF NOT EXISTS customers (
    id SERIAL PRIMARY KEY,
    customer_phone VARCHAR(50) UNIQUE NOT NULL,
    full_name VARCHAR(100),
    city VARCHAR(100) DEFAULT 'Lahore',
    loyalty_points INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 7. Orders (With Strict Idempotency Key to Prevent Duplicate Order Replay)
CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    order_number VARCHAR(50) UNIQUE NOT NULL,
    idempotency_key VARCHAR(100) UNIQUE,
    customer_id INT REFERENCES customers(id),
    total_amount_pkr NUMERIC(10, 2) NOT NULL,
    status VARCHAR(30) DEFAULT 'PENDING',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 8. Order Items
CREATE TABLE IF NOT EXISTS order_items (
    id SERIAL PRIMARY KEY,
    order_id INT REFERENCES orders(id) ON DELETE CASCADE,
    product_id INT REFERENCES products(id),
    variant_id INT REFERENCES product_variants(id) ON DELETE SET NULL,
    quantity INT NOT NULL,
    unit_price_pkr NUMERIC(10, 2) NOT NULL,
    subtotal_pkr NUMERIC(10, 2) NOT NULL,
    CONSTRAINT unique_order_product_variant UNIQUE NULLS NOT DISTINCT (order_id, product_id, variant_id)
);

-- 9. Payments (With Provider, Audit References & Idempotency Key - Zero Raw Card Storage)
CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,
    order_id INT REFERENCES orders(id),
    provider VARCHAR(50) DEFAULT 'MANUAL',
    payment_method VARCHAR(50) NOT NULL,
    transaction_ref VARCHAR(100),
    idempotency_key VARCHAR(100) UNIQUE,
    amount_pkr NUMERIC(10, 2) NOT NULL,
    payment_status VARCHAR(30) DEFAULT 'COMPLETED',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 10. Transactions Log
CREATE TABLE IF NOT EXISTS transactions (
    id SERIAL PRIMARY KEY,
    order_id INT REFERENCES orders(id),
    type VARCHAR(30) NOT NULL,
    amount_pkr NUMERIC(10, 2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 11. Leads & Customer WhatsApp Inquiries
CREATE TABLE IF NOT EXISTS leads (
    customer_phone VARCHAR(50) PRIMARY KEY,
    push_name VARCHAR(100),
    city VARCHAR(100) DEFAULT 'Lahore',
    lead_stage VARCHAR(50) DEFAULT 'NEW_LEAD',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chat_history (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(50) NOT NULL,
    customer_phone VARCHAR(50) NOT NULL,
    sender VARCHAR(20) NOT NULL,
    message_text TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ==============================================================================
-- COLUMN MIGRATION SAFEGUARDS (ENSURES COMPATIBILITY ON UPGRADES)
-- ==============================================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(100) UNIQUE;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS variant_id INT REFERENCES product_variants(id) ON DELETE SET NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider VARCHAR(50) DEFAULT 'MANUAL';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(100) UNIQUE;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'unique_order_product_variant'
    ) THEN
        ALTER TABLE order_items ADD CONSTRAINT unique_order_product_variant UNIQUE NULLS NOT DISTINCT (order_id, product_id, variant_id);
    END IF;
END $$;

-- ==============================================================================
-- INDICES FOR PERFORMANCE & CONSTRAINTS
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_pos_prod_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_pos_var_sku ON product_variants(variant_sku);
CREATE INDEX IF NOT EXISTS idx_pos_cust_phone ON customers(customer_phone);
CREATE INDEX IF NOT EXISTS idx_pos_ord_num ON orders(order_number);
CREATE INDEX IF NOT EXISTS idx_pos_ord_idemp ON orders(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_pos_pay_idemp ON payments(idempotency_key);

-- ==============================================================================
-- REALISTIC DEVELOPMENT DUMMY SEED DATA (INCLUDING REQUIRED EDGE CASES)
-- ==============================================================================

-- Categories
INSERT INTO categories (category_name, description)
VALUES 
    ('Point of Sale Hardware', 'Scanners, Receipt Printers, Touch POS Terminals'),
    ('Software Licenses', 'Retail POS Desktop & Cloud Automation Licenses'),
    ('Consumables', 'Thermal Paper Rolls, Label Stickers'),
    ('Implementation Services', 'On-site installation and staff training')
ON CONFLICT (category_name) DO NOTHING;

-- Products (Including In-Stock, Low-Stock, Out-of-Stock, and Inactive Discontinued Items)
INSERT INTO products (sku, category_id, name, description, is_active)
VALUES 
    ('POS-HW-001', 1, 'Omnidirectional 2D Barcode Scanner', 'High-speed desktop hands-free 2D scanner', TRUE),
    ('POS-HW-002', 1, 'Thermal Receipt Printer 80mm Auto-Cut', 'Heavy-duty Ethernet & USB receipt printer', TRUE),
    ('POS-HW-003', 1, 'Touchscreen POS Terminal 15.6 Inch', 'Core i5 8GB RAM Dual Display POS Machine', TRUE),
    ('POS-SW-001', 2, 'GlimsTech POS Desktop Pro License', 'Lifetime offline POS software with PostgreSQL sync', TRUE),
    ('POS-CS-001', 3, 'Thermal Paper Rolls 80mm (Box of 50)', 'Premium BPA-free 80x80 thermal paper rolls', TRUE),
    ('POS-HW-004', 1, 'Mobile Wireless Handheld POS Terminal', 'Android portable terminal with built-in printer', TRUE), -- Out-of-stock edge case
    ('POS-LEGACY-01', 1, 'Legacy 1D Laser Scanner (Discontinued)', 'Old model 1D handheld scanner', FALSE) -- Inactive edge case
ON CONFLICT (sku) DO UPDATE 
SET name = EXCLUDED.name, is_active = EXCLUDED.is_active;

-- Reset sequence for products
SELECT setval('products_id_seq', (SELECT MAX(id) FROM products));

-- Product Variants (Multiple Variants per Product)
INSERT INTO product_variants (product_id, variant_sku, variant_name, attributes, additional_price_pkr, is_active)
VALUES
    ((SELECT id FROM products WHERE sku = 'POS-HW-001'), 'POS-HW-001-USB', 'Scanner USB Wired Interface', '{"connectivity": "USB", "color": "Matte Black"}'::jsonb, 0.00, TRUE),
    ((SELECT id FROM products WHERE sku = 'POS-HW-001'), 'POS-HW-001-BT', 'Scanner Bluetooth Wireless Interface', '{"connectivity": "Bluetooth+Wireless", "color": "Matte Black"}'::jsonb, 3500.00, TRUE),
    ((SELECT id FROM products WHERE sku = 'POS-HW-002'), 'POS-HW-002-USB', 'Thermal Printer USB Only', '{"interface": "USB", "cutter": "Auto-Cut"}'::jsonb, 0.00, TRUE),
    ((SELECT id FROM products WHERE sku = 'POS-HW-002'), 'POS-HW-002-LAN', 'Thermal Printer USB + Ethernet LAN', '{"interface": "USB+Ethernet", "cutter": "Auto-Cut"}'::jsonb, 2500.00, TRUE),
    ((SELECT id FROM products WHERE sku = 'POS-SW-001'), 'POS-SW-001-1YR', 'POS Software 1-Year Annual Subscription', '{"duration": "1_YEAR", "cloud_backup": true}'::jsonb, -15000.00, TRUE),
    ((SELECT id FROM products WHERE sku = 'POS-SW-001'), 'POS-SW-001-LIFE', 'POS Software Lifetime Perpetual License', '{"duration": "LIFETIME", "cloud_backup": true}'::jsonb, 0.00, TRUE)
ON CONFLICT (variant_sku) DO NOTHING;

-- Prices (Active Prices in PKR with Conflict Upsert)
INSERT INTO prices (product_id, price_pkr, currency)
VALUES 
    ((SELECT id FROM products WHERE sku = 'POS-HW-001'), 35000.00, 'PKR'),
    ((SELECT id FROM products WHERE sku = 'POS-HW-002'), 19500.00, 'PKR'),
    ((SELECT id FROM products WHERE sku = 'POS-HW-003'), 85000.00, 'PKR'),
    ((SELECT id FROM products WHERE sku = 'POS-SW-001'), 35000.00, 'PKR'),
    ((SELECT id FROM products WHERE sku = 'POS-CS-001'), 6500.00, 'PKR'),
    ((SELECT id FROM products WHERE sku = 'POS-HW-004'), 42000.00, 'PKR'),
    ((SELECT id FROM products WHERE sku = 'POS-LEGACY-01'), 8500.00, 'PKR')
ON CONFLICT (product_id, currency) DO UPDATE 
SET price_pkr = EXCLUDED.price_pkr, effective_date = CURRENT_TIMESTAMP;

-- Inventory (In-Stock, Low-Stock, and Out-of-Stock Edge Cases)
INSERT INTO inventory (product_id, stock_quantity, reorder_level)
VALUES 
    ((SELECT id FROM products WHERE sku = 'POS-HW-001'), 100, 10),  -- In-stock
    ((SELECT id FROM products WHERE sku = 'POS-HW-002'), 150, 20),  -- In-stock
    ((SELECT id FROM products WHERE sku = 'POS-HW-003'), 10, 2),    -- Adequate stock
    ((SELECT id FROM products WHERE sku = 'POS-SW-001'), 2, 5),     -- Low-stock edge case (< reorder level)
    ((SELECT id FROM products WHERE sku = 'POS-CS-001'), 200, 25),  -- In-stock
    ((SELECT id FROM products WHERE sku = 'POS-HW-004'), 0, 5),     -- Out-of-stock edge case
    ((SELECT id FROM products WHERE sku = 'POS-LEGACY-01'), 0, 0)   -- Discontinued
ON CONFLICT (product_id) DO UPDATE 
SET stock_quantity = EXCLUDED.stock_quantity, reorder_level = EXCLUDED.reorder_level;

-- Customers
INSERT INTO customers (id, customer_phone, full_name, city, loyalty_points)
VALUES 
    (1, '+923001234567', 'Ali Raza', 'Lahore', 150),
    (2, '+923219876543', 'Usman Khan', 'Karachi', 80),
    (3, '+923127118485', 'Zeeshan Ahmed', 'Islamabad', 220),
    (4, '+923334567890', 'Bilal Hassan', 'Rawalpindi', 45),
    (5, '+923098414407', 'GlimsTech POS Demo Admin', 'Lahore', 500)
ON CONFLICT (customer_phone) DO UPDATE
SET full_name = EXCLUDED.full_name;

SELECT setval('customers_id_seq', (SELECT MAX(id) FROM customers));

-- Orders (Edge Cases: PAID, DELIVERED, PENDING, and CANCELLED with Idempotency Keys & Catalog-Aligned Totals)
INSERT INTO orders (id, order_number, idempotency_key, customer_id, total_amount_pkr, status)
VALUES 
    (1, 'ORD-2026-001', 'IDEMP-ORD-001', (SELECT id FROM customers WHERE customer_phone = '+923001234567' LIMIT 1), 54500.00, 'PAID'),
    (2, 'ORD-2026-002', 'IDEMP-ORD-002', (SELECT id FROM customers WHERE customer_phone = '+923219876543' LIMIT 1), 85000.00, 'DELIVERED'),
    (3, 'ORD-2026-003', 'IDEMP-ORD-003', (SELECT id FROM customers WHERE customer_phone = '+923127118485' LIMIT 1), 35000.00, 'PENDING'),
    (4, 'ORD-2026-004', 'IDEMP-ORD-004', (SELECT id FROM customers WHERE customer_phone = '+923334567890' LIMIT 1), 22000.00, 'CANCELLED')
ON CONFLICT (order_number) DO UPDATE
SET total_amount_pkr = EXCLUDED.total_amount_pkr, status = EXCLUDED.status;

SELECT setval('orders_id_seq', (SELECT MAX(id) FROM orders));

-- Order Items (Aligned with Product Catalog Prices and Dynamic Foreign Key Subqueries)
INSERT INTO order_items (order_id, product_id, variant_id, quantity, unit_price_pkr, subtotal_pkr)
VALUES 
    (
        (SELECT id FROM orders WHERE order_number = 'ORD-2026-001' LIMIT 1),
        (SELECT id FROM products WHERE sku = 'POS-HW-001' LIMIT 1),
        (SELECT id FROM product_variants WHERE variant_sku = 'POS-HW-001-USB' LIMIT 1),
        1,
        35000.00,
        35000.00
    ),
    (
        (SELECT id FROM orders WHERE order_number = 'ORD-2026-001' LIMIT 1),
        (SELECT id FROM products WHERE sku = 'POS-HW-002' LIMIT 1),
        (SELECT id FROM product_variants WHERE variant_sku = 'POS-HW-002-USB' LIMIT 1),
        1,
        19500.00,
        19500.00
    ),
    (
        (SELECT id FROM orders WHERE order_number = 'ORD-2026-002' LIMIT 1),
        (SELECT id FROM products WHERE sku = 'POS-HW-003' LIMIT 1),
        NULL,
        1,
        85000.00,
        85000.00
    ),
    (
        (SELECT id FROM orders WHERE order_number = 'ORD-2026-003' LIMIT 1),
        (SELECT id FROM products WHERE sku = 'POS-HW-001' LIMIT 1),
        (SELECT id FROM product_variants WHERE variant_sku = 'POS-HW-001-USB' LIMIT 1),
        1,
        35000.00,
        35000.00
    ),
    (
        (SELECT id FROM orders WHERE order_number = 'ORD-2026-004' LIMIT 1),
        (SELECT id FROM products WHERE sku = 'POS-HW-002' LIMIT 1),
        (SELECT id FROM product_variants WHERE variant_sku = 'POS-HW-002-LAN' LIMIT 1),
        1,
        22000.00,
        22000.00
    )
ON CONFLICT (order_id, product_id, variant_id) DO UPDATE
SET quantity = EXCLUDED.quantity, unit_price_pkr = EXCLUDED.unit_price_pkr, subtotal_pkr = EXCLUDED.subtotal_pkr;

-- Payments (Edge Cases: COMPLETED, PENDING, and FAILED Payments - Dynamic Subqueries & Catalog-Aligned Amounts)
INSERT INTO payments (order_id, provider, payment_method, transaction_ref, idempotency_key, amount_pkr, payment_status)
VALUES 
    ((SELECT id FROM orders WHERE order_number = 'ORD-2026-001' LIMIT 1), 'HBL_DIRECT', 'BANK_TRANSFER', 'HBL-TRX-987123', 'IDEMP-PAY-001', 54500.00, 'COMPLETED'),
    ((SELECT id FROM orders WHERE order_number = 'ORD-2026-002' LIMIT 1), 'JAZZCASH_PGW', 'JAZZCASH', 'JC-TRX-554411', 'IDEMP-PAY-002', 85000.00, 'COMPLETED'),
    ((SELECT id FROM orders WHERE order_number = 'ORD-2026-003' LIMIT 1), 'EASYPAISA_PGW', 'EASYPAISA', 'EP-TRX-112233', 'IDEMP-PAY-003', 35000.00, 'PENDING'),
    ((SELECT id FROM orders WHERE order_number = 'ORD-2026-004' LIMIT 1), 'JAZZCASH_PGW', 'JAZZCASH', 'JC-TRX-FAIL-01', 'IDEMP-PAY-004', 22000.00, 'FAILED')
ON CONFLICT (idempotency_key) DO UPDATE
SET amount_pkr = EXCLUDED.amount_pkr, payment_status = EXCLUDED.payment_status;

-- ==============================================================================
-- DATABASE ROLES & ACCESS CONTROL GOVERNANCE (LEAST-PRIVILEGE SECURITY)
-- ==============================================================================

-- 1. Read-Only Least-Privilege Role for AI Data Gateway
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'gateway_readonly') THEN
        CREATE ROLE gateway_readonly WITH LOGIN PASSWORD 'gateway_secure_readonly_2026' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
    END IF;
END
$$;

GRANT CONNECT ON DATABASE pos_db TO gateway_readonly;
GRANT USAGE ON SCHEMA public TO gateway_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO gateway_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO gateway_readonly;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM gateway_readonly;
REVOKE CREATE ON SCHEMA public FROM gateway_readonly;

-- 2. State-Changing Write Role for Action Gateway (Audited & Gated Writes)
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'gateway_action_writer') THEN
        CREATE ROLE gateway_action_writer WITH LOGIN PASSWORD 'gateway_action_writer_2026' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
    END IF;
END
$$;

GRANT CONNECT ON DATABASE pos_db TO gateway_action_writer;
GRANT USAGE ON SCHEMA public TO gateway_action_writer;
GRANT SELECT, INSERT, UPDATE ON orders, order_items, payments, transactions, leads, customers, inventory TO gateway_action_writer;
GRANT SELECT ON products, product_variants, prices, categories TO gateway_action_writer;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gateway_action_writer;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM gateway_action_writer;
REVOKE CREATE ON SCHEMA public FROM gateway_action_writer;
