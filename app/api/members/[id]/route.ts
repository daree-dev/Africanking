import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';

type RouteContext = { params: { id: string } };

const MEMBER_MANAGER_ROLES = ['ADMIN', 'COOPERATIVE_MANAGER'];

function isMemberManager(role: string | undefined | null): boolean {
  return !!role && MEMBER_MANAGER_ROLES.includes(role);
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const member = await prisma.member.findUnique({
    where: { id: params.id },
    include: { cooperative: true },
  });

  if (!member) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 });
  }

  return NextResponse.json({ member });
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isMemberManager(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const member = await prisma.member.findUnique({
    where: { id: params.id },
    include: { cooperative: true },
  });

  if (!member) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { action, name, email, phone } = body as {
    action?: string;
    name?: string;
    email?: string;
    phone?: string;
  };

  // Lifecycle transitions: deactivate, reactivate, archive, erase.
  if (action) {
    if (member.cooperative?.archivedAt || member.cooperative?.deletedAt) {
      return NextResponse.json(
        { error: 'Cooperative is inactive; member lifecycle changes are blocked' },
        { status: 409 }
      );
    }

    switch (action) {
      case 'deactivate': {
        if (member.deactivatedAt) {
          return NextResponse.json({ error: 'Member already deactivated' }, { status: 409 });
        }
        const updated = await prisma.member.update({
          where: { id: member.id },
          data: { deactivatedAt: new Date() },
        });
        return NextResponse.json({ member: updated });
      }
      case 'reactivate': {
        if (member.deletedAt) {
          return NextResponse.json(
            { error: 'Erased members cannot be reactivated' },
            { status: 409 }
          );
        }
        const updated = await prisma.member.update({
          where: { id: member.id },
          data: { deactivatedAt: null, archivedAt: null },
        });
        return NextResponse.json({ member: updated });
      }
      case 'archive': {
        if (member.archivedAt) {
          return NextResponse.json({ error: 'Member already archived' }, { status: 409 });
        }
        const updated = await prisma.member.update({
          where: { id: member.id },
          data: { archivedAt: new Date() },
        });
        return NextResponse.json({ member: updated });
      }
      case 'erase': {
        // Privacy-compliant erasure: redact PII but retain the row so that
        // historical allocations and audit evidence remain intact.
        if (member.deletedAt) {
          return NextResponse.json({ error: 'Member already erased' }, { status: 409 });
        }
        const updated = await prisma.member.update({
          where: { id: member.id },
          data: {
            name: 'Erased member',
            email: null,
            phone: null,
            deactivatedAt: member.deactivatedAt ?? new Date(),
            deletedAt: new Date(),
          },
        });
        return NextResponse.json({ member: updated });
      }
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  }

  // Block profile edits on inactive members.
  if (member.deactivatedAt || member.archivedAt || member.deletedAt) {
    return NextResponse.json(
      { error: 'Member is inactive; edits are blocked' },
      { status: 409 }
    );
  }

  const updated = await prisma.member.update({
    where: { id: member.id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(email !== undefined ? { email } : {}),
      ...(phone !== undefined ? { phone } : {}),
    },
  });

  return NextResponse.json({ member: updated });
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Permanent deletion is restricted to admins and only allowed for members
  // that have already been deactivated, so audit history is never silently lost.
  if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const member = await prisma.member.findUnique({ where: { id: params.id } });
  if (!member) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 });
  }

  if (!member.deactivatedAt && !member.archivedAt) {
    return NextResponse.json(
      { error: 'Deactivate or archive the member before permanent deletion' },
      { status: 409 }
    );
  }

  await prisma.member.delete({ where: { id: member.id } });
  return NextResponse.json({ success: true });
}
