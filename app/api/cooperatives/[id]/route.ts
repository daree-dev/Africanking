import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';

type RouteContext = { params: { id: string } };

const COOPERATIVE_MANAGER_ROLES = ['ADMIN', 'COOPERATIVE_MANAGER'];

function isManager(role: string | undefined | null): boolean {
  return !!role && COOPERATIVE_MANAGER_ROLES.includes(role);
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cooperative = await prisma.cooperative.findUnique({
    where: { id: params.id },
    include: {
      members: { where: { deletedAt: null } },
      meters: { where: { deletedAt: null } },
    },
  });

  if (!cooperative) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json(cooperative);
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isManager(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const cooperative = await prisma.cooperative.findUnique({ where: { id: params.id } });
  if (!cooperative) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (typeof body.name === 'string') data.name = body.name;
  if (typeof body.region === 'string') data.region = body.region;

  // Lifecycle transitions. Deactivation/archival retain the record and its
  // history; only ADMIN may permanently delete, and only after archival.
  if (body.action === 'deactivate') {
    if (cooperative.deletedAt) {
      return NextResponse.json({ error: 'Cooperative is deleted' }, { status: 409 });
    }
    data.deactivatedAt = new Date();
  } else if (body.action === 'reactivate') {
    if (cooperative.deletedAt) {
      return NextResponse.json({ error: 'Cooperative is deleted' }, { status: 409 });
    }
    data.deactivatedAt = null;
  } else if (body.action === 'archive') {
    if (cooperative.deletedAt) {
      return NextResponse.json({ error: 'Cooperative is deleted' }, { status: 409 });
    }
    data.archivedAt = new Date();
  } else if (body.action === 'unarchive') {
    if (cooperative.deletedAt) {
      return NextResponse.json({ error: 'Cooperative is deleted' }, { status: 409 });
    }
    data.archivedAt = null;
  } else if (body.action === 'delete') {
    if (session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!cooperative.archivedAt) {
      return NextResponse.json(
        { error: 'Cooperative must be archived before permanent deletion' },
        { status: 409 },
      );
    }
    data.deletedAt = new Date();
  } else if (body.action === 'erase') {
    // Privacy-compliant erasure: redact PII on the cooperative and its members
    // while retaining aggregate audit evidence (readings, allocations, ids).
    if (session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!cooperative.deletedAt) {
      return NextResponse.json(
        { error: 'Cooperative must be deleted before erasure' },
        { status: 409 },
      );
    }

    const redactedName = `redacted-${cooperative.id}`;
    await prisma.$transaction([
      prisma.member.updateMany({
        where: { cooperativeId: cooperative.id },
        data: { name: 'Redacted', email: null, phone: null, erasedAt: new Date() },
      }),
      prisma.cooperative.update({
        where: { id: cooperative.id },
        data: { name: redactedName, region: null, contactEmail: null, erasedAt: new Date() },
      }),
    ]);

    const erased = await prisma.cooperative.findUnique({ where: { id: cooperative.id } });
    return NextResponse.json(erased);
  }

  const updated = await prisma.cooperative.update({
    where: { id: params.id },
    data,
  });

  return NextResponse.json(updated);
}
