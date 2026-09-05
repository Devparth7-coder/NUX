import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { createSession } from '@/lib/auth/session';
import { rateLimit } from '@/lib/auth/rate-limit';
import { NexusError } from '@/lib/errors';
import { fail, handler, ok, validationError } from '@/lib/api/response';
import { clientIp } from '@/server/auth/guard';

export const runtime = 'nodejs';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2).max(80),
  workspaceName: z.string().min(2).max(80).optional(),
});

export const POST = handler(async (req: NextRequest) => {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);

  const ip = clientIp(req.headers) ?? 'unknown';
  if (!rateLimit(`register:${ip}`, 5, 60_000).allowed) {
    return fail(new NexusError('RATE_LIMITED', 'Too many registration attempts.'));
  }

  const email = parsed.data.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return fail(new NexusError('CONFLICT', 'An account with that email already exists'));

  const workspaceName = parsed.data.workspaceName ?? `${parsed.data.name}'s workspace`;
  const slug = workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) || 'workspace';

  const user = await prisma.user.create({
    data: {
      email,
      name: parsed.data.name,
      passwordHash: await hashPassword(parsed.data.password),
      role: 'OWNER',
      memberships: {
        create: {
          role: 'OWNER',
          workspace: {
            create: {
              name: workspaceName,
              slug: `${slug}-${Date.now().toString(36).slice(-4)}`,
            },
          },
        },
      },
    },
  });

  const { token } = await createSession(user.id, { userAgent: req.headers.get('user-agent'), ip });
  return ok({ id: user.id, email: user.email, name: user.name, token }, { status: 201 });
});
