import { NextResponse, type NextRequest } from "next/server";

import { getPreviewData } from "@/lib/preview-data";

export async function GET(request: NextRequest) {
  try {
    const data = await getPreviewData(request.nextUrl.searchParams.has("refresh"));
    return NextResponse.json({ base: data.base, defaultSeed: data.defaultSeed, setupWarnings: data.setupWarnings, report: data.report });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
