import { generateReportHtml } from "./buildReport.ts";

const PORT = Number(process.env.REPORT_PORT ?? 8791);

Bun.serve({
  port: PORT,
  async fetch() {
    const html = await generateReportHtml();
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  },
});

console.log(`Report server listening on http://localhost:${PORT}`);
