export const dynamic = 'force-dynamic';

/** Liveness probe for uptime monitoring. Exposes no configuration details. */
export function GET() {
  return Response.json(
    { data: { status: 'ok', time: new Date().toISOString() }, error: null },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
