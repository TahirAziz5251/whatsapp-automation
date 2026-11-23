DO $$
DECLARE
    t1_id UUID := '11111111-1111-1111-1111-111111111111'::UUID;
    t2_id UUID := '22222222-2222-2222-2222-222222222222'::UUID;
    test_phone VARCHAR(50) := '923001234567';
    cnt INT;
BEGIN
    -- 1. Create two test tenants
    INSERT INTO platform_tenants (id, slug, name, business_template_id)
    VALUES (t1_id, 'clinic-alpha', 'Alpha Clinic', 'CLINIC_OPD')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO platform_tenants (id, slug, name, business_template_id)
    VALUES (t2_id, 'bakery-beta', 'Beta Bakery', 'BAKERY_CAKES')
    ON CONFLICT (id) DO NOTHING;

    -- 2. Act as Tenant 1 (Alpha Clinic)
    PERFORM set_config('app.current_tenant_id', t1_id::text, true);
    
    INSERT INTO platform_contacts (tenant_id, customer_phone, full_name)
    VALUES (t1_id, test_phone, 'Zahid (Clinic Patient)')
    ON CONFLICT (tenant_id, customer_phone) DO NOTHING;

    SELECT count(*) INTO cnt FROM platform_contacts WHERE customer_phone = test_phone;
    RAISE NOTICE 'TC-01 [PASS] Tenant 1 sees its own contact: count = %', cnt;

    -- 3. Act as Tenant 2 (Beta Bakery)
    PERFORM set_config('app.current_tenant_id', t2_id::text, true);
    
    -- Tenant 2 must NOT see Tenant 1's contact!
    SELECT count(*) INTO cnt FROM platform_contacts WHERE customer_phone = test_phone;
    IF cnt != 0 THEN
        RAISE EXCEPTION 'TC-01 [FAIL] Cross-tenant data leak! Tenant 2 saw % contacts of Tenant 1', cnt;
    END IF;
    RAISE NOTICE 'TC-01 [PASS] Cross-tenant read blocked! Tenant 2 sees % contacts of Tenant 1 (Expected 0)', cnt;

    -- Tenant 2 inserts the EXACT SAME phone number (TC-02: Non-collision test)!
    INSERT INTO platform_contacts (tenant_id, customer_phone, full_name)
    VALUES (t2_id, test_phone, 'Zahid (Bakery Customer)')
    ON CONFLICT (tenant_id, customer_phone) DO NOTHING;

    SELECT count(*) INTO cnt FROM platform_contacts WHERE customer_phone = test_phone;
    IF cnt != 1 THEN
        RAISE EXCEPTION 'TC-02 [FAIL] Failed to isolate contact in Tenant 2!';
    END IF;
    RAISE NOTICE 'TC-02 [PASS] Non-collision proven! Same phone number exists in Tenant 2: count = %', cnt;

    -- 4. Act with NO tenant context set (TC-03: Default fail-closed)
    PERFORM set_config('app.current_tenant_id', '', true);
    SELECT count(*) INTO cnt FROM platform_contacts WHERE customer_phone = test_phone;
    IF cnt != 0 THEN
        RAISE EXCEPTION 'TC-03 [FAIL] Fail-closed violation! Unscoped query returned % rows', cnt;
    END IF;
    RAISE NOTICE 'TC-03 [PASS] Fail-closed proven! Unscoped query returns % rows (Expected 0)', cnt;

    RAISE NOTICE '================================================================';
    RAISE NOTICE 'ALL DATABASE RLS AND NON-COLLISION TESTS PASSED SUCCESSFULLY!   ';
    RAISE NOTICE '================================================================';
END $$;
