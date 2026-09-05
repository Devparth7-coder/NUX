import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { verifyPassword } from '@/lib/auth/password';
import { createSession } from '@/lib/auth/session';
import { rateLimit } from '@/lib/auth/rate-limit';
import { NexusError } from '@/lib/errors';
import { fail, handler, ok, validationError } from '@/lib/api/response';
import { clientIp } from '@/server/auth/guard';
import { audit } from '@/server/services/activity';

export const runtime = 'nodejs';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export const POST = handler(async (req: NextRequest) => {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return validationError(parsed.error);

  const ip = clientIp(req.headers) ?? 'unknown';
  const limit = rateLimit(`login:${ip}`, 12, 60_000);
  if (!limit.allowed) {
    return fail(new NexusError('RATE_LIMITED', 'Too many attempts. Try again shortly.'));
  }

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    await audit({ action: 'auth.login.failed', ip, metadata: { email: parsed.data.email } });
    return fail(new NexusError('UNAUTHORIZED', 'Invalid email or password'));
  }

  const { token } = await createSession(user.id, { userAgent: req.headers.get('user-agent'), ip });
  await audit({ userId: user.id, action: 'auth.login', ip });

  // The token is returned so clients in embedded contexts (where the browser may
  // drop the cookie) can authenticate API calls with `Authorization: Bearer`.
  return ok({ id: user.id, email: user.email, name: user.name, role: user.role, token });
});
