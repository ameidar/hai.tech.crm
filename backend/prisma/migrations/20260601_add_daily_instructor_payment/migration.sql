ALTER TABLE "cycles"
  ADD COLUMN "instructor_payment_mode" TEXT NOT NULL DEFAULT 'hourly',
  ADD COLUMN "instructor_daily_rate" DECIMAL(10, 2);

