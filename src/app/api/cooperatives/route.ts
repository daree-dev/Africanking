import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const DEFAULT_TIMEZONE = "UTC";

function isValidIanaTimezone(timezone: unknown): timezone is string {
  if (typeof timezone !== "string" || timezone.trim() === "") {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export async function GET() {
  const cooperatives = await prisma.cooperative.findMany({
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(cooperatives);
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { name, timezone } = (body ?? {}) as {
    name?: unknown;
    timezone?: unknown;
  };

  if (typeof name !== "string" || name.trim() === "") {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const resolvedTimezone =
    timezone === undefined || timezone === null || timezone === ""
      ? DEFAULT_TIMEZONE
      : timezone;

  if (!isValidIanaTimezone(resolvedTimezone)) {
    return NextResponse.json(
      { error: "timezone must be a valid IANA timezone identifier" },
      { status: 400 },
    );
  }

  const cooperative = await prisma.cooperative.create({
    data: {
      name: name.trim(),
      timezone: resolvedTimezone,
    },
  });

  return NextResponse.json(cooperative, { status: 201 });
}
