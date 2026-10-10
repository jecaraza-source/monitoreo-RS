import { connection, type NextRequest } from "next/server";
import { demoFeed, demoRss } from "@/lib/demo/feeds";

/**
 * Fictitious RSS feeds (src/lib/demo/feeds.ts) to try ingestion end to end.
 * Public on purpose: the ingest cron fetches them like any outlet's feed.
 */
export async function GET(request: NextRequest, { params }: RouteContext<"/api/demo/rss/[feed]">) {
  await connection();
  const feed = demoFeed((await params).feed);
  if (!feed) return new Response("Feed no encontrado", { status: 404 });
  return new Response(demoRss(feed, request.nextUrl.origin, new Date()), {
    headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "no-store" },
  });
}
