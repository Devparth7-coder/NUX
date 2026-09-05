import { PrismaClient } from '@prisma/client';
import { log } from './logger';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const client = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
  client.$connect().catch((e) => log.error('prisma connect failed', { error: String(e) }));
  return client;
}

/** Single shared PrismaClient (prevents connection exhaustion in dev HMR). */
export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
