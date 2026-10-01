\set ON_ERROR_STOP on

SET search_path TO public;

SELECT
    current_user,
    current_database(),
    current_schema();

SHOW search_path;
-- SAFE DATA PROFILING QUERIES FOR POS_DB
-- Only counts, aggregations, null counts, duplicate counts, and distributions.
-- ZERO SENSITIVE CUSTOMER FINANCIAL DATA EXPOSURE.

SELECT '=== 1. MASTER RECORD COUNTS ===' AS section;
SELECT 
    (SELECT COUNT(*) FROM categories) AS total_categories,
    (SELECT COUNT(*) FROM products) AS total_products,
    (SELECT COUNT(*) FROM product_variants) AS total_product_variants,
    (SELECT COUNT(*) FROM prices) AS total_price_records,
    (SELECT COUNT(*) FROM inventory) AS total_inventory_records,
    (SELECT COUNT(*) FROM customers) AS total_customers,
    (SELECT COUNT(*) FROM orders) AS total_orders,
    (SELECT COUNT(*) FROM payments) AS total_payments;

SELECT '=== 2. NULL VALUE & DATA INTEGRITY CHECKS ===' AS section;
SELECT 
    COUNT(*) FILTER (WHERE sku IS NULL) AS null_skus,
    COUNT(*) FILTER (WHERE name IS NULL) AS null_names,
    COUNT(*) FILTER (WHERE category_id IS NULL) AS null_categories
FROM public.products

SELECT 
    COUNT(*) FILTER (WHERE price_pkr IS NULL) AS null_prices,
    COUNT(*) FILTER (WHERE price_pkr <= 0) AS invalid_prices
FROM prices;

SELECT 
    COUNT(*) FILTER (WHERE stock_quantity IS NULL) AS null_stock,
    COUNT(*) FILTER (WHERE stock_quantity < 0) AS negative_stock
FROM inventory;

SELECT '=== 3. DUPLICATE & IDEMPOTENCY CHECKS ===' AS section;
-- Are there duplicate SKUs?
SELECT sku, COUNT(*) AS duplicate_sku_count
FROM products
GROUP BY sku
HAVING COUNT(*) > 1;

-- Are there duplicate variant SKUs?
SELECT variant_sku, COUNT(*) AS duplicate_variant_count
FROM product_variants
GROUP BY variant_sku
HAVING COUNT(*) > 1;

-- Are there duplicate customer phone numbers?
SELECT customer_phone, COUNT(*) AS duplicate_phone_count
FROM customers
GROUP BY customer_phone
HAVING COUNT(*) > 1;

-- Are there duplicate order idempotency keys?
SELECT idempotency_key, COUNT(*) AS duplicate_order_idemp_count
FROM orders
WHERE idempotency_key IS NOT NULL
GROUP BY idempotency_key
HAVING COUNT(*) > 1;

-- Are there duplicate payment idempotency keys?
SELECT idempotency_key, COUNT(*) AS duplicate_payment_idemp_count
FROM payments
WHERE idempotency_key IS NOT NULL
GROUP BY idempotency_key
HAVING COUNT(*) > 1;

SELECT '=== 4. INVENTORY EDGE CASE DISTRIBUTION ===' AS section;
SELECT 
    COUNT(*) FILTER (WHERE i.stock_quantity > i.reorder_level) AS in_stock_count,
    COUNT(*) FILTER (WHERE i.stock_quantity > 0 AND i.stock_quantity <= i.reorder_level) AS low_stock_count,
    COUNT(*) FILTER (WHERE i.stock_quantity = 0) AS out_of_stock_count,
    COUNT(*) FILTER (WHERE p.is_active = FALSE) AS inactive_product_count
FROM products p
LEFT JOIN inventory i ON p.id = i.product_id;

SELECT '=== 5. ORDER STATUS LIFECYCLE DISTRIBUTION ===' AS section;
SELECT 
    status,
    COUNT(*) AS order_count,
    SUM(total_amount_pkr) AS total_volume_pkr
FROM orders
GROUP BY status
ORDER BY order_count DESC;

SELECT '=== 6. PAYMENT SECURITY & PROVIDER AUDIT (ZERO SECRETS) ===' AS section;
SELECT 
    provider,
    payment_method,
    payment_status,
    COUNT(*) AS payment_count,
    SUM(amount_pkr) AS total_collected_pkr
FROM payments
GROUP BY provider, payment_method, payment_status
ORDER BY provider;

SELECT '=== 7. PRODUCT VARIANTS SAMPLE (SAFE VIEW) ===' AS section;
SELECT 
    p.sku AS parent_sku,
    v.variant_sku,
    v.variant_name,
    v.attributes,
    v.additional_price_pkr,
    v.is_active
FROM product_variants v
JOIN products p ON v.product_id = p.id
ORDER BY p.id, v.id;
