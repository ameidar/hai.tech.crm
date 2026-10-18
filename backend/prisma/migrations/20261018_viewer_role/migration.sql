-- Read-only "viewer" role: sees everything an admin sees, cannot write.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'viewer';
