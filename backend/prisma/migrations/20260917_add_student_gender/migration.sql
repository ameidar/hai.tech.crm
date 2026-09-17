-- Add a structured gender field for students, used for reporting and placement decisions.
CREATE TYPE "StudentGender" AS ENUM ('unknown', 'female', 'male', 'other');

ALTER TABLE "students"
ADD COLUMN "gender" "StudentGender" NOT NULL DEFAULT 'unknown';
