-- v1.63.0: cycle expenses can be created through the v1 API with an API key.
-- A key is a machine identity, not a user, so created_by is NULL for those rows
-- (the audit_logs row carries api_key_id + "api-key:<name>"). Same approach as
-- instructor_fixed_additions.created_by (v1.61.0/v1.62.0). Existing rows are untouched.
ALTER TABLE "cycle_expenses" ALTER COLUMN "created_by" DROP NOT NULL;
