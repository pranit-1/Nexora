require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cron = require("node-cron");

const { checkDeadlinesAndSendEmails } = require("./services/deadlineChecker");
const { verifyEmailConnection } = require("./services/emailService");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;
const CRON_SCHEDULE = process.env.DEADLINE_CHECK_CRON || "0 8 * * *"; // daily 08:00
const SCRAPE_CRON = process.env.SCRAPE_CRON || "0 9 * * *"; // daily 09:00 — local auto-scrape for Explore
const NEXT_API_URL = process.env.NEXT_API_URL || "http://localhost:3000";

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "origin-backend", time: new Date().toISOString() });
});

// Manual trigger — handy for testing without waiting for the cron.
app.post("/run-deadline-check", async (_req, res) => {
  try {
    const results = await checkDeadlinesAndSendEmails();
    res.json({ ok: true, results });
  } catch (err) {
    console.error("[server] Manual deadline check failed:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Local-only: trigger full scraping pipeline (hits Next.js /api/scrape -> saves to Firestore)
app.post("/run-scrape", async (_req, res) => {
  try {
    // Use global fetch (Node 18+)
    const r = await fetch(`${NEXT_API_URL}/api/scrape`, { method: "GET" });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    res.json({ ok: true, ...data });
  } catch (err) {
    console.error("[server] Manual scrape failed:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/run-scrape", async (_req, res) => {
  try {
    const r = await fetch(`${NEXT_API_URL}/api/scrape`, { method: "GET" });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    res.json({ ok: true, ...data });
  } catch (err) {
    console.error("[server] Manual scrape failed:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

async function start() {
  try {
    await verifyEmailConnection();
    console.log("[server] Gmail SMTP connection verified.");
  } catch (err) {
    console.warn("[server] Email connection not verified:", err.message);
    console.warn("[server] Check backend/.env — server will still start, but emails will fail until fixed.");
  }

  cron.schedule(CRON_SCHEDULE, () => {
    console.log(`[cron] Running scheduled deadline check (${new Date().toISOString()})`);
    checkDeadlinesAndSendEmails().catch((err) =>
      console.error("[cron] Deadline check failed:", err)
    );
  });
  console.log(`[server] Deadline check cron scheduled: "${CRON_SCHEDULE}"`);

  // Local daily auto-scrape — no Vercel needed. Hits Next.js API which runs all scrapers + saves to Firestore.
  cron.schedule(SCRAPE_CRON, async () => {
    console.log(`[cron] Running daily auto-scrape (${new Date().toISOString()}) -> ${NEXT_API_URL}/api/scrape`);
    try {
      const r = await fetch(`${NEXT_API_URL}/api/scrape`);
      const data = await r.json();
      console.log(`[cron] Scrape done:`, JSON.stringify(data.summary || data).slice(0, 800));
    } catch (err) {
      console.error("[cron] Auto-scrape failed:", err.message);
    }
  });
  console.log(`[server] Auto-scrape cron scheduled: "${SCRAPE_CRON}" -> ${NEXT_API_URL}/api/scrape`);

  app.listen(PORT, () => {
    console.log(`[server] Origin backend listening on http://localhost:${PORT}`);
  });
}

start();
