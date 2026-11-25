import { NextResponse } from "next/server"

/**
 * LEGACY — buyer retirement is no longer part of the product.
 *
 * Generation credits are internal cooperative records allocated to members
 * (POST /api/credits/allocate); they are not sold to external buyers or
 * retired for ESG claims. Historic rows in `retirements` remain readable via
 * GET /api/certificates/[id] (flagged `is_legacy`).
 */
export async function POST() {
  return NextResponse.json(
    {
      error:
        "Certificate retirement has been discontinued. Generation credits are allocated to " +
        "cooperative members via POST /api/credits/allocate.",
      replacement: "/api/credits/allocate",
    },
    { status: 410 }
  )
}
