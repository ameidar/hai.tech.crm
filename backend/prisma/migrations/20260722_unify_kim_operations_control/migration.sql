DO $$
DECLARE
  target_user_id TEXT;
  old_sales_user_id TEXT;
BEGIN
  SELECT id INTO target_user_id
  FROM users
  WHERE lower(email) = lower('navekim@gmail.com')
  LIMIT 1;

  SELECT id INTO old_sales_user_id
  FROM users
  WHERE lower(email) = lower('kim@hai.tech')
  LIMIT 1;

  IF target_user_id IS NULL THEN
    RAISE NOTICE 'Kim operations_control migration skipped: target user navekim@gmail.com was not found';
    RETURN;
  END IF;

  UPDATE users
  SET
    name = 'קים נוה',
    phone = COALESCE(NULLIF(phone, ''), '0543354550'),
    role = 'operations_control',
    is_active = true,
    updated_at = NOW()
  WHERE id = target_user_id;

  UPDATE instructors
  SET
    user_id = target_user_id,
    email = 'navekim@gmail.com',
    updated_at = NOW()
  WHERE phone = '0543354550'
     OR lower(email) = lower('navekim@gmail.com')
     OR user_id = target_user_id;

  IF old_sales_user_id IS NOT NULL AND old_sales_user_id <> target_user_id THEN
    UPDATE lead_appointments
    SET assigned_to_id = target_user_id
    WHERE assigned_to_id = old_sales_user_id;

    UPDATE tasks
    SET assignee_id = target_user_id
    WHERE assignee_id = old_sales_user_id;

    UPDATE users
    SET
      is_active = false,
      name = 'קים (אוחד ל-navekim@gmail.com)',
      updated_at = NOW()
    WHERE id = old_sales_user_id;
  END IF;
END $$;
