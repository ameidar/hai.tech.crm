-- AlterEnum
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'contacted';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'converted';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'closed';
