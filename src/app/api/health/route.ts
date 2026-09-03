import { prisma } from "@/lib/db";
import { buildHealthReport } from "@/lib/health";

export async function GET() {
  const report = await buildHealthReport(() => prisma.$queryRaw`SELECT 1`);

  return Response.json(report, {
    status: report.status === "ok" ? 200 : 503,
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
