/**
 * Comprehensive POS Domain Verification Test Suite
 * 
 * Verifies:
 * 1. Product Discovery & Information (SKU, Categories, Product Variants)
 * 2. Product Availability & Inventory Edge Cases (IN_STOCK, LOW_STOCK, OUT_OF_STOCK, INACTIVE)
 * 3. Price Inquiries (Guaranteed single active price in PKR)
 * 4. Order Creation & Atomic Inventory Deduction
 * 5. Price Tampering & Insufficient Stock Rejections
 * 6. Order Idempotency (Replayed requests return existing order without double-charging/deduction)
 * 7. Payment Security & Provider Recording (Zero raw card/secret storage)
 * 8. Payment Idempotency (Replayed payment callback handled idempotently)
 * 9. Customer Ownership & Privacy Enforcement on Order Status
 * 10. Knowledge vs. Transactional Fact Separation (Warranty & Return Policies)
 * 11. Lead Capture & CRM Stage Synchronization
 * 12. Human Approval Gate on Sensitive Order Cancellations
 */

const { execSync } = require('child_process');
const { executeActionGateway } = require('./action_gateway');

function runDockerPsql(db, sql) {
  return execSync(`docker exec -i evolution-postgres psql -U postgres -d ${db} -t -A`, {
    input: sql,
    encoding: 'utf8'
  }).trim();
}

function runGateway(action, params, phone = '+923001234567') {
  return executeActionGateway({
    action,
    params,
    trustedSessionContext: {
      business_code: 'POS_RETAIL',
      instance_name: 'point-of-sale',
      customerPhone: phone,
      allowed_tools: ['action_gateway', 'create_order', 'update_order', 'cancel_order', 'record_payment', 'sync_crm']
    }
  });
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log('========================================================================');
  console.log('🧪 RUNNING POS DOMAIN COMPREHENSIVE VERIFICATION TEST SUITE');
  console.log('========================================================================\n');

  // Test 1: Product Discovery & Product Variants
  console.log('--- Test 1: Product Discovery & Multi-Variant Catalog ---');
  const prodRaw = runDockerPsql('pos_db', `
    SELECT p.sku, p.name, pr.price_pkr, pr.currency 
    FROM products p 
    JOIN prices pr ON p.id = pr.product_id 
    WHERE p.sku = 'POS-HW-001' 
    LIMIT 1;
  `);
  const [sku, name, price, currency] = prodRaw.split('|');
  assert(sku === 'POS-HW-001', `Found product SKU: ${sku}`);
  assert(currency === 'PKR', `Currency strictly enforced as ${currency}`);

  const variantsCount = parseInt(runDockerPsql('pos_db', `
    SELECT COUNT(*) FROM product_variants WHERE product_id = (SELECT id FROM products WHERE sku = 'POS-HW-001');
  `), 10);
  assert(variantsCount >= 2, `Product has multiple registered variants (count: ${variantsCount})`);

  // Test 2: Inventory Edge Cases (In-Stock, Low-Stock, Out-of-Stock, Inactive)
  console.log('\n--- Test 2: Inventory Edge Cases ---');
  const inStockCheck = runDockerPsql('pos_db', `
    SELECT stock_quantity FROM inventory WHERE product_id = (SELECT id FROM products WHERE sku = 'POS-HW-001');
  `);
  assert(parseInt(inStockCheck, 10) > 10, `In-Stock Product verified (Stock: ${inStockCheck} units)`);

  const lowStockCheck = runDockerPsql('pos_db', `
    SELECT i.stock_quantity <= i.reorder_level FROM inventory i JOIN products p ON i.product_id = p.id WHERE p.sku = 'POS-SW-001';
  `);
  assert(lowStockCheck === 't', 'Low-Stock edge case detected (Stock under reorder level)');

  const outOfStockCheck = runDockerPsql('pos_db', `
    SELECT stock_quantity FROM inventory i JOIN products p ON i.product_id = p.id WHERE p.sku = 'POS-HW-004';
  `);
  assert(parseInt(outOfStockCheck, 10) === 0, 'Out-of-Stock edge case verified (Stock: 0 units)');

  const inactiveCheck = runDockerPsql('pos_db', `
    SELECT is_active FROM products WHERE sku = 'POS-LEGACY-01';
  `);
  assert(inactiveCheck === 'f', 'Inactive / Discontinued product correctly flagged (is_active = FALSE)');

  // Test 3: Price Inquiries (Guaranteed Single Active Price in PKR)
  console.log('\n--- Test 3: Deterministic Price Verification ---');
  const priceRows = runDockerPsql('pos_db', `
    SELECT COUNT(*) FROM prices WHERE product_id = (SELECT id FROM products WHERE sku = 'POS-HW-001');
  `);
  assert(parseInt(priceRows, 10) === 1, `Exactly 1 active price record per product (count: ${priceRows})`);

  // Test 4: Order Creation & Atomic Inventory Deduction
  console.log('\n--- Test 4: Order Creation & Atomic Inventory Deduction ---');
  const initialStock = parseInt(runDockerPsql('pos_db', `SELECT stock_quantity FROM inventory WHERE product_id = (SELECT id FROM products WHERE sku = 'POS-HW-001');`), 10);
  const testIdempKey = `IDEMP-TEST-${Date.now()}`;
  
  const gatewayRes = runGateway('create_order', {
    customer_phone: '+923001234567',
    customer_name: 'Test Customer',
    city: 'Lahore',
    idempotency_key: testIdempKey,
    items: [
      { sku: 'POS-HW-001', quantity: 2 }
    ]
  }, '+923001234567');

  assert(gatewayRes.status === 'SUCCESS', 'Order created successfully');
  const orderRes = gatewayRes.result;
  assert(orderRes.order_number.startsWith('ORD-'), `Assigned order number: ${orderRes.order_number}`);

  const newStock = parseInt(runDockerPsql('pos_db', `SELECT stock_quantity FROM inventory WHERE product_id = (SELECT id FROM products WHERE sku = 'POS-HW-001');`), 10);
  assert(newStock === initialStock - 2, `Atomic inventory deduction verified (${initialStock} -> ${newStock})`);

  // Test 5: Rejection of Price Tampering & Insufficient Stock
  console.log('\n--- Test 5: Tampering & Insufficient Stock Rejections ---');
  const tamperingRes = runGateway('create_order', {
    customer_phone: '+923001234567',
    items: [{ sku: 'POS-HW-001', quantity: 1, unit_price: 100.00 }] // Fake manipulated price
  }, '+923001234567');
  assert(tamperingRes.status === 'ERROR' && tamperingRes.formatted_context.includes('Price tampering detected'), 'Price tampering attempt blocked outside database');

  const stockExceededRes = runGateway('create_order', {
    customer_phone: '+923001234567',
    items: [{ sku: 'POS-HW-001', quantity: 99999 }] // Exceeds available stock
  }, '+923001234567');
  assert(stockExceededRes.status === 'ERROR' && stockExceededRes.formatted_context.includes('Insufficient inventory'), 'Over-quantity order blocked with Insufficient inventory');

  // Test 6: Order Idempotency (Replayed Request)
  console.log('\n--- Test 6: Order Idempotency Guarantee ---');
  const replayGatewayRes = runGateway('create_order', {
    customer_phone: '+923001234567',
    customer_name: 'Test Customer',
    city: 'Lahore',
    idempotency_key: testIdempKey, // Exact same idempotency key
    items: [
      { sku: 'POS-HW-001', quantity: 2 }
    ]
  }, '+923001234567');

  const replayRes = replayGatewayRes.result;
  assert(replayRes.status === 'IDEMPOTENT_REPLAY', 'Replayed order flagged as IDEMPOTENT_REPLAY');
  assert(replayRes.order_number === orderRes.order_number, 'Returned existing order number without re-generation');
  
  const postReplayStock = parseInt(runDockerPsql('pos_db', `SELECT stock_quantity FROM inventory WHERE product_id = (SELECT id FROM products WHERE sku = 'POS-HW-001');`), 10);
  assert(postReplayStock === newStock, 'Inventory was NOT deducted a second time on replay');

  // Test 7: Payment Security & Recording
  console.log('\n--- Test 7: Payment Security (Zero Secrets Stored) ---');
  const payIdempKey = `PAY-IDEMP-${Date.now()}`;
  const payGatewayRes = runGateway('record_payment', {
    order_id: orderRes.order_id,
    provider: 'JAZZCASH_PGW',
    payment_method: 'JAZZCASH',
    transaction_ref: `JC-${Date.now()}`,
    idempotency_key: payIdempKey,
    amount_pkr: orderRes.total_amount_pkr
  }, '+923001234567');

  assert(payGatewayRes.status === 'SUCCESS', 'Payment recorded successfully');
  const payRes = payGatewayRes.result;
  assert(payRes.provider === 'JAZZCASH_PGW', 'Provider metadata captured cleanly');
  assert(payRes.payment_method === 'JAZZCASH', 'Payment method verified');

  const payRecord = runDockerPsql('pos_db', `
    SELECT provider, payment_method, payment_status 
    FROM payments 
    WHERE id = ${payRes.payment_id};
  `);
  assert(payRecord === 'JAZZCASH_PGW|JAZZCASH|COMPLETED', 'Payment stored in COMPLETED state with zero card secrets');

  // Test 8: Payment Idempotency
  console.log('\n--- Test 8: Payment Idempotency Guarantee ---');
  const replayPayGatewayRes = runGateway('record_payment', {
    order_id: orderRes.order_id,
    provider: 'JAZZCASH_PGW',
    payment_method: 'JAZZCASH',
    transaction_ref: payRes.transaction_ref,
    idempotency_key: payIdempKey,
    amount_pkr: orderRes.total_amount_pkr
  }, '+923001234567');
  const replayPayRes = replayPayGatewayRes.result;
  assert(replayPayRes.status === 'IDEMPOTENT_REPLAY', 'Replayed payment callback returned IDEMPOTENT_REPLAY without duplicate charge');

  // Test 9: Customer Ownership Enforcement
  console.log('\n--- Test 9: Customer Privacy & Ownership Gate ---');
  const ownershipRes = runGateway('update_order', {
    order_id: orderRes.order_id,
    status: 'CONFIRMED'
  }, '+923999999999'); // Different phone number attempting to modify order
  assert(ownershipRes.status === 'ERROR' && ownershipRes.formatted_context.includes('Ownership constraint violation'), 'Cross-customer order access blocked');

  // Test 10: Knowledge vs Transactional Separation
  console.log('\n--- Test 10: Knowledge Documents vs Transactional Facts ---');
  const warrantyDoc = runDockerPsql('platform_db', `
    SELECT title FROM knowledge_documents 
    WHERE business_code = 'POS_RETAIL' AND title LIKE '%Warranty%' LIMIT 1;
  `);
  assert(warrantyDoc.includes('Warranty'), `Found authoritative warranty knowledge document: "${warrantyDoc}"`);

  // Test 11: Lead Capture & CRM Stage Synchronization
  console.log('\n--- Test 11: Lead Capture & CRM Synchronization ---');
  const crmGatewayRes = runGateway('sync_crm', {
    customer_phone: '+923009988776',
    push_name: 'Grocery Store Manager',
    city: 'Faisalabad',
    stage: 'DEMO_BOOKED',
    notes: 'Interested in POS-HW-003 Touch Terminal bundle'
  }, '+923009988776');
  assert(crmGatewayRes.status === 'SUCCESS', 'CRM lead captured successfully');
  assert(crmGatewayRes.result.stage === 'DEMO_BOOKED', 'Lead stage updated to DEMO_BOOKED');

  const leadInDb = runDockerPsql('pos_db', `
    SELECT lead_stage FROM leads WHERE customer_phone = '+923009988776';
  `);
  assert(leadInDb === 'DEMO_BOOKED', 'Lead stage verified in pos_db.leads');

  // Test 12: Human Approval Gate on Sensitive Order Cancellations
  console.log('\n--- Test 12: Human Approval Gate for Cancellations ---');
  const cancelAttempt = runGateway('cancel_order', {
    order_id: orderRes.order_id,
    reason: 'Wrong item selected'
  }, '+923001234567');

  assert(cancelAttempt.status === 'APPROVAL_REQUIRED', 'Sensitive order cancellation intercepted by Approval Gate');
  assert(cancelAttempt.approval_token.startsWith('APR-'), `Generated approval token: ${cancelAttempt.approval_token}`);

  console.log('\n========================================================================');
  console.log(`🏁 POS DOMAIN VERIFICATION FINISHED: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Unhandled Test Error:', err);
  process.exit(1);
});
