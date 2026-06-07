-- Add city of residence to instructors (used by accounting to compute travel pay)
ALTER TABLE "instructors" ADD COLUMN "city" TEXT;
