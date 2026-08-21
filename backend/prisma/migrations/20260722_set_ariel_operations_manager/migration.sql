UPDATE users
SET
  role = 'operations_manager',
  is_active = true,
  updated_at = NOW()
WHERE lower(email) = lower('arielmeidar23@gmail.com')
   OR (name ILIKE '%אריאל%' AND role IN ('admin', 'operations'));
