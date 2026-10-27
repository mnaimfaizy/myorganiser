/**
 * One-shot script to generate apps/web/public/images/og-image.png
 * Usage: node tools/scripts/generate-og-image.ts
 */
import { unlinkSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const outPath = resolve(repoRoot, 'apps/web/public/images/og-image.png');

const html = /* html */ `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;800&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px; overflow: hidden;
    background: #0F172A;
    font-family: 'Plus Jakarta Sans', 'Segoe UI', system-ui, sans-serif;
    display: flex; align-items: center; justify-content: center;
  }
  .card {
    width: 1200px; height: 630px;
    background: linear-gradient(135deg, #0F172A 0%, #1e1b4b 50%, #134e4a 100%);
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 96px;
    position: relative;
    overflow: hidden;
  }
  /* decorative blobs */
  .card::before {
    content: '';
    position: absolute;
    top: -120px; right: -120px;
    width: 480px; height: 480px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(124,58,237,0.22) 0%, transparent 70%);
  }
  .card::after {
    content: '';
    position: absolute;
    bottom: -100px; left: 200px;
    width: 360px; height: 360px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(15,118,110,0.20) 0%, transparent 70%);
  }
  .left {
    display: flex; flex-direction: column; gap: 24px;
    z-index: 1;
  }
  .logo-row {
    display: flex; align-items: center; gap: 20px;
  }
  .wordmark {
    font-size: 56px; font-weight: 800; color: #fff; letter-spacing: -1px; line-height: 1;
  }
  .wordmark span { font-weight: 600; color: rgba(255,255,255,0.75); }
  .tagline {
    font-size: 28px; font-weight: 400; color: rgba(255,255,255,0.65);
    max-width: 560px; line-height: 1.4;
  }
  .pill-row {
    display: flex; gap: 12px; flex-wrap: wrap;
  }
  .pill {
    padding: 6px 16px; border-radius: 999px;
    font-size: 15px; font-weight: 600; letter-spacing: 0.3px;
  }
  .pill-purple { background: rgba(124,58,237,0.25); color: #c4b5fd; border: 1px solid rgba(124,58,237,0.4); }
  .pill-teal   { background: rgba(15,118,110,0.25);  color: #5eead4; border: 1px solid rgba(15,118,110,0.4); }
  .pill-cyan   { background: rgba(6,182,212,0.20);   color: #67e8f9; border: 1px solid rgba(6,182,212,0.35); }
  .right {
    z-index: 1; flex-shrink: 0;
  }
  /* Big shield */
  .shield-wrap { opacity: 0.92; }
</style>
</head>
<body>
<div class="card">
  <div class="left">
    <div class="logo-row">
      <!-- Shield SVG inline -->
      <div class="shield-wrap">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none" width="80" height="80">
          <defs>
            <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#7C3AED"/>
              <stop offset="100%" stop-color="#0F766E"/>
            </linearGradient>
            <radialGradient id="g2" cx="35%" cy="25%" r="55%">
              <stop offset="0%" stop-color="#ffffff" stop-opacity="0.22"/>
              <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
            </radialGradient>
          </defs>
          <path d="M4 3 L28 3 L28 19 Q28 30 16 31 Q4 30 4 19 Z" fill="url(#g1)"/>
          <path d="M4 3 L28 3 L28 19 Q28 30 16 31 Q4 30 4 19 Z" fill="url(#g2)"/>
          <path d="M8 17 L13.5 22.5 L24 11" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        </svg>
      </div>
      <div class="wordmark"><span>My</span>Organiser</div>
    </div>
    <div class="tagline">Organize your life. Secure your data.<br/>Protected by client-side end-to-end encryption.</div>
    <div class="pill-row">
      <div class="pill pill-purple">Encrypted Vault</div>
      <div class="pill pill-teal">Task Management</div>
      <div class="pill pill-cyan">Privacy First</div>
    </div>
  </div>
  <div class="right">
    <!-- Large decorative shield -->
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none" width="260" height="260" style="opacity:0.18">
      <defs>
        <linearGradient id="g3" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#a78bfa"/>
          <stop offset="100%" stop-color="#2dd4bf"/>
        </linearGradient>
      </defs>
      <path d="M4 3 L28 3 L28 19 Q28 30 16 31 Q4 30 4 19 Z" fill="url(#g3)"/>
      <path d="M8 17 L13.5 22.5 L24 11" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    </svg>
  </div>
</div>
</body>
</html>`;

const tmpHtml = resolve(repoRoot, 'tools/scripts/_og-tmp.html');
writeFileSync(tmpHtml, html, 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setViewportSize({ width: 1200, height: 630 });
await page.goto(`file:///${tmpHtml.replace(/\\/g, '/')}`);
// Wait for fonts
await page.waitForTimeout(1200);
await page.screenshot({ path: outPath, type: 'png' });
await browser.close();

unlinkSync(tmpHtml);
console.log(`✓ OG image written to ${outPath}`);
