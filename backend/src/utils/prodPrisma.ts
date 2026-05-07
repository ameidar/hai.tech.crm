import { PrismaClient } from '@prisma/client';
import { prisma as devPrisma } from './prisma.js';

/**
 * Optional read-only Prisma client pointing to the production database via an
 * SSH tunnel (typically localhost:6543 → prod:5432). Used by financial
 * dashboards on the dev environment so the user sees real prod data.
 *
 * Falls back to the regular dev prisma when PROD_DATABASE_URL is not set —
 * which is the right behavior on prod itself, where this same code runs and
 * the local prisma already points to prod.
 *
 * NEVER write through this client. By convention, only call read methods
 * (findMany / findUnique / count / aggregate / groupBy).
 */
const globalForProd = globalThis as unknown as { prodPrisma: PrismaClient | undefined };

function buildProdClient(): PrismaClient {
  const url = process.env.PROD_DATABASE_URL;
  if (!url) return devPrisma;
  return new PrismaClient({
    datasources: { db: { url } },
    log: ['error'],
  });
}

export const prodPrisma: PrismaClient = globalForProd.prodPrisma ?? buildProdClient();

if (process.env.NODE_ENV !== 'production') {
  globalForProd.prodPrisma = prodPrisma;
}
