#!/usr/bin/env node
/**
 * post-push-ci-check.mjs — PostToolUse Bash hook
 *
 * Fires after every Bash command. Detects:
 * 1. `git push` → Polls GitHub Actions for the triggered run, reports pass/fail
 *    with failure details so Claude can fix issues immediately.
 * 2. `wrangler pages deploy` → Verifies the deployment URL returns HTTP 200.
 *
 * Communicates via stderr (Claude reads hook stderr).
 * Always exits 0 — informational only, never blocks.
 */

import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";

const command = process.env.TOOL_INPUT_command || "";

// ── Quick exit for irrelevant commands ──────────────────────────────────────
const isGitPush = /\bgit\s+push\b/.test(command);
const isWranglerDeploy = /\bwrangler\s+pages\s+deploy\b/.test(command);

if (!isGitPush && !isWranglerDeploy) process.exit(0);

// ── Debounce: skip if a check started in the last 30s ───────────────────────
const DEBOUNCE_FILE = join(process.env.TEMP || "/tmp", ".claude-ci-check-ts");
try {
  if (existsSync(DEBOUNCE_FILE)) {
    const last = parseInt(readFileSync(DEBOUNCE_FILE, "utf8"), 10);
    if (Date.now() - last < 30000) {
      process.exit(0);
    }
  }
  writeFileSync(DEBOUNCE_FILE, String(Date.now()));
} catch {
  /* ignore */
}

// ── Main ────────────────────────────────────────────────────────────────────
try {
  if (isGitPush) await checkCI();
  if (isWranglerDeploy) await checkDeploy();
} catch (err) {
  console.error(`[ci-check] Unexpected error: ${err.message}`);
}

process.exit(0);

// ═══════════════════════════════════════════════════════════════════════════
// CI Check — after git push
// ═══════════════════════════════════════════════════════════════════════════

async function checkCI() {
  console.error("\n[ci-check] Push detected — monitoring GitHub Actions...");

  // Verify gh is available and authenticated
  try {
    execSync("gh auth status", {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    console.error("[ci-check] gh CLI not authenticated — skipping CI check.");
    return;
  }

  const pushTime = new Date();
  const INITIAL_WAIT = 8000; // Wait for run to be queued
  const POLL_INTERVAL = 10000; // 10s between polls
  const MAX_WAIT = 180000; // 3 minute total timeout
  const QUEUE_GRACE = 40000; // 40s grace for run to appear

  await sleep(INITIAL_WAIT);

  const startTime = Date.now();
  let trackedRunId = null;

  while (Date.now() - startTime < MAX_WAIT) {
    try {
      const result = execSync(
        "gh run list --limit 3 --json status,conclusion,name,databaseId,createdAt",
        { encoding: "utf8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"] },
      ).trim();

      const runs = JSON.parse(result);
      if (!runs.length) {
        console.error(
          "[ci-check] No CI runs found — repo may not have workflows.",
        );
        return;
      }

      // Find a run created after our push (with 5s tolerance for clock skew)
      const cutoff = new Date(pushTime.getTime() - 5000);
      const ourRun =
        runs.find((r) => new Date(r.createdAt) >= cutoff) || null;

      if (!ourRun) {
        const waited = Date.now() - startTime;
        if (waited > QUEUE_GRACE) {
          // No run appeared within grace period — push may have failed or no CI configured
          console.error(
            "[ci-check] No new CI run detected. Push may have failed or no workflow triggered.",
          );
          return;
        }
        // Keep waiting for run to appear
        await sleep(POLL_INTERVAL);
        continue;
      }

      trackedRunId = ourRun.databaseId;

      if (ourRun.status === "completed") {
        if (ourRun.conclusion === "success") {
          console.error(
            `[ci-check] ✓ ${ourRun.name} PASSED (run #${trackedRunId}).`,
          );
        } else {
          console.error(
            `\n[ci-check] ✗ ${ourRun.name} FAILED (run #${trackedRunId}).`,
          );
          fetchFailedLogs(trackedRunId);
          console.error(
            "[ci-check] ↑ Fix the issues above and push again.\n",
          );
        }
        return;
      }

      // Still running
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.error(
        `[ci-check] ${ourRun.name}: ${ourRun.status}... (${elapsed}s)`,
      );
    } catch (err) {
      console.error(`[ci-check] Poll error: ${err.message}`);
    }

    await sleep(POLL_INTERVAL);
  }

  // Timed out
  console.error(`[ci-check] ⚠ CI still running after ${MAX_WAIT / 1000}s.`);
  if (trackedRunId) {
    console.error(`[ci-check] Check manually: gh run view ${trackedRunId}`);
  }
}

function fetchFailedLogs(runId) {
  try {
    const logs = execSync(`gh run view ${runId} --log-failed`, {
      encoding: "utf8",
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    const lines = logs.split("\n");
    // Last 60 lines usually contain the actual error details
    const tail = lines.slice(-60).join("\n");
    console.error("\n--- CI Failure Log ---");
    console.error(tail);
    console.error("--- End CI Log ---\n");
  } catch (err) {
    console.error(
      `[ci-check] Could not fetch failure logs: ${err.message}`,
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Deploy Check — after wrangler pages deploy
// ═══════════════════════════════════════════════════════════════════════════

async function checkDeploy() {
  // Extract project name: --project-name=<name> or --project-name <name>
  const projectMatch = command.match(/--project-name[= ](\S+)/);
  const project = projectMatch ? projectMatch[1] : null;

  if (!project) {
    console.error(
      "[deploy-check] Could not determine project name from command — skipping.",
    );
    return;
  }

  const deployUrl = `https://${project}.pages.dev`;
  console.error(`\n[deploy-check] Verifying deployment at ${deployUrl}...`);

  // Wait for edge propagation
  await sleep(8000);

  const MAX_RETRIES = 3;
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const resp = await fetch(deployUrl, {
        method: "HEAD",
        signal: AbortSignal.timeout(10000),
        headers: { "User-Agent": "Claude-Deploy-Check/1.0" },
      });

      if (resp.ok) {
        console.error(
          `[deploy-check] ✓ Deployment healthy (HTTP ${resp.status}).`,
        );
        return;
      }

      console.error(
        `[deploy-check] Got HTTP ${resp.status} — retrying in 5s...`,
      );
    } catch (err) {
      console.error(
        `[deploy-check] Attempt ${i + 1}/${MAX_RETRIES} failed: ${err.message}`,
      );
    }

    if (i < MAX_RETRIES - 1) await sleep(5000);
  }

  console.error(
    `[deploy-check] ✗ Deployment verification failed after ${MAX_RETRIES} attempts.`,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
