/**
 * Downloads the three real, public data sources this prototype is grounded in:
 *   1. IBM AMLworld HI-Small_Trans.csv (transactions + laundering ground truth)
 *   2. OFAC SDN + alternate-name + address lists (real sanctions data)
 *   3. FFIEC BSA/AML Manual Appendix F (real regulator-published red-flag guidance)
 *      -> scraped into src/policy/typologies.yaml
 *
 * Everything lands in data/raw/, which is gitignored. Run with `bun run data:fetch`.
 */
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import * as cheerio from "cheerio";
import AdmZip from "adm-zip";
import { DATA_RAW_DIR, POLICY_DIR } from "../src/config.ts";
import { writeTypologiesYaml, type TypologySection } from "../src/policy/typologiesSchema.ts";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const HI_SMALL_ZIP_URL =
  "https://huggingface.co/datasets/eexzzm/IBM-Transactions-for-Anti-Money-Laundering-HI-Small-Trans/resolve/main/HI-Small_Trans.csv.zip";

const OFAC_FILES = {
  "sdn.csv": "https://www.treasury.gov/ofac/downloads/sdn.csv",
  "add.csv": "https://www.treasury.gov/ofac/downloads/add.csv",
  "alt.csv": "https://www.treasury.gov/ofac/downloads/alt.csv",
} as const;

const FFIEC_APPENDIX_F_URL = "https://bsaaml.ffiec.gov/manual/Appendices/07";

async function downloadTo(url: string, destPath: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  await writeFile(destPath, buf);
  return buf.length;
}

async function fetchTransactions() {
  console.log("[transactions] downloading HI-Small_Trans.csv.zip from Hugging Face...");
  const zipPath = `${DATA_RAW_DIR}/HI-Small_Trans.csv.zip`;
  const size = await downloadTo(HI_SMALL_ZIP_URL, zipPath);
  console.log(`[transactions] downloaded ${(size / 1e6).toFixed(1)} MB, extracting...`);

  const zip = new AdmZip(zipPath);
  zip.extractAllTo(DATA_RAW_DIR, true);
  await rm(zipPath);

  const csvPath = `${DATA_RAW_DIR}/HI-Small_Trans.csv`;
  if (!existsSync(csvPath)) {
    throw new Error(`Expected ${csvPath} after extraction but it's missing`);
  }
  console.log(`[transactions] ready at ${csvPath}`);
}

async function fetchOfac() {
  const today = new Date().toISOString().slice(0, 10);
  for (const [filename, url] of Object.entries(OFAC_FILES)) {
    console.log(`[ofac] downloading ${filename}...`);
    const size = await downloadTo(url, `${DATA_RAW_DIR}/${filename}`);
    console.log(`[ofac] ${filename}: ${(size / 1024).toFixed(0)} KB`);
  }
  await writeFile(`${DATA_RAW_DIR}/ofac-list-version.txt`, today);
  console.log(`[ofac] stamped list version ${today}`);
}

/**
 * FFIEC's site fronts Cloudflare with TLS/HTTP-client fingerprinting (JA3/JA4), not
 * just a User-Agent check — verified manually: `curl -A "<browser UA>"` gets a clean
 * 200, but Bun's native `fetch` (a different TLS stack) still 403s with the identical
 * header set. Shelling out to curl, which is present on every platform this project
 * targets (Windows via Git Bash/WSL, macOS, Linux), is the pragmatic fix rather than
 * fighting fetch's TLS fingerprint. The page structure is:
 *   <h4> = top-level category (Money Laundering / Terrorist Financing)
 *   <h6> = named subsection (e.g. "Funds Transfers")
 *   <ul><li> = the individual red flags under that subsection
 * Each red flag becomes one clause, keyed "ffiec-appF:<slugified-h6>:<n>".
 */
async function curlGet(url: string, userAgent: string): Promise<string> {
  const proc = Bun.spawn(["curl", "-sL", "-A", userAgent, url], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`curl exited ${exitCode} for ${url}: ${stderr}`);
  }
  return stdout;
}

async function fetchTypologyCorpus() {
  console.log("[ffiec] fetching Appendix F...");
  const html = await curlGet(FFIEC_APPENDIX_F_URL, BROWSER_UA);
  if (html.length < 1000) {
    throw new Error(`FFIEC Appendix F response looked too short (${html.length} bytes) — likely blocked`);
  }
  await writeFile(`${DATA_RAW_DIR}/ffiec-appendix-f.html`, html);

  const $ = cheerio.load(html);
  const sections: TypologySection[] = [];

  let currentCategory = "";
  let currentSection = "";
  let currentSlug = "";
  let clauseIndex = 0;

  // Walk the content area's direct children in document order so h4/h6/ul nesting
  // is tracked correctly (cheerio's .each over a single selector loses that order).
  const contentRoot = $("h3:contains('APPENDIX F')").parent();
  const nodes = contentRoot.length > 0 ? contentRoot.children() : $("body").children();

  for (const el of nodes.toArray()) {
    const tag = el.tagName?.toLowerCase();
    const node = $(el);
    if (tag === "h4") {
      currentCategory = node.text().trim();
    } else if (tag === "h6") {
      currentSection = node.text().trim().replace(/\s+/g, " ");
      currentSlug = slugify(currentSection);
      clauseIndex = 0;
      sections.push({ category: currentCategory, section: currentSection, slug: currentSlug, clauses: [] });
    } else if (tag === "ul" && currentSlug) {
      const target = sections[sections.length - 1];
      if (!target) continue;
      for (const li of node.find("li").toArray()) {
        const text = $(li).text().replace(/\s+/g, " ").trim();
        if (!text) continue;
        clauseIndex += 1;
        target.clauses.push({
          id: `ffiec-appF:${currentSlug}:${clauseIndex}`,
          text,
        });
      }
    }
  }

  const totalClauses = sections.reduce((n, s) => n + s.clauses.length, 0);
  if (totalClauses < 50) {
    throw new Error(
      `Only parsed ${totalClauses} FFIEC red-flag clauses across ${sections.length} sections — ` +
        `page structure likely changed; inspect data/raw/ffiec-appendix-f.html before trusting this.`,
    );
  }
  console.log(`[ffiec] parsed ${totalClauses} clauses across ${sections.length} sections`);

  await mkdir(POLICY_DIR, { recursive: true });
  await writeTypologiesYaml(sections);
  console.log(`[ffiec] wrote ${POLICY_DIR}/typologies.yaml`);
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function main() {
  await mkdir(DATA_RAW_DIR, { recursive: true });

  await fetchTransactions();
  await fetchOfac();
  await fetchTypologyCorpus();

  console.log("\nAll three real data sources fetched. Note: the IBM dataset's companion");
  console.log("HI-Small_Patterns.txt (per-ring typology labels) is Kaggle-account-gated and");
  console.log("is NOT auto-fetched here — see DATA_LICENSES.md. Ground truth for this");
  console.log("prototype uses the `Is Laundering` column, which ships in HI-Small_Trans.csv");
  console.log("itself and needs no separate file.");
}

if (import.meta.main) {
  await main();
}
