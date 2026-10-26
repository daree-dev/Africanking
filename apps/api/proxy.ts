import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export function proxy(req: NextRequest) {
  const response = NextResponse.next()

  if (req.nextUrl.pathname.startsWith("/api")) {
    response.headers.set("X-Request-Id", crypto.randomUUID())
  }

  return response
}

export const config = {
  matcher: "/api/:path*",
}