// Real desktop window check: launches the windowed app, attaches to the actual
// WebView2 over CDP, and clicks the same controls a user clicks. The native
// folder dialog is detected (and cancelled) through Win32, so this suite proves
// the picker exists instead of hard-coding a headless branch.
//
// Usage: node pristem-desktop/.visual-check/_desktop-selfcheck.cjs
const { chromium } = require('playwright-core');
const { spawn, execFileSync } = require('child_process');

const APP = 'd:/projects/pristem/pristem-desktop/shell/target/debug/pristem-desktop.exe';
const PORT = Number(process.env.PR_DESKTOP_PORT || 8950);
const DEBUG = Number(process.env.PR_DESKTOP_DEBUG || 9333);
const URL = `http://127.0.0.1:${PORT}/`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ps(script) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return execFileSync('powershell', ['-NoProfile', '-EncodedCommand', encoded], { encoding: 'utf8' }).trim();
}

// Enumerate visible #32770 dialogs whose caption matches `title`.
function listDialogs(title) {
  const script = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class W3 {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
}
'@
$rows = New-Object System.Collections.ArrayList
$cb = {
  param($h, $l)
  if ([W3]::IsWindowVisible($h)) {
    $c = New-Object System.Text.StringBuilder 256
    [void][W3]::GetClassName($h, $c, 256)
    if ($c.ToString() -eq '#32770') {
      $t = New-Object System.Text.StringBuilder 512
      [void][W3]::GetWindowText($h, $t, 512)
      if ($t.ToString() -like '*${title}*') { [void]$rows.Add("$([int64]$h)|$($t.ToString())") }
    }
  }
  return $true
}
[void][W3]::EnumWindows($cb, [IntPtr]::Zero)
$rows | ForEach-Object { $_ }
`;
  const out = ps(script);
  return out.split(/\r?\n/).filter(Boolean).map((line) => {
    const [h, t] = line.split('|');
    return { h: Number(h), t };
  });
}

function closeDialog(handle) {
  const script = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class W4 {
  [DllImport("user32.dll")] public static extern IntPtr PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
}
'@
[void][W4]::PostMessage([IntPtr]${handle}, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
'closed'
`;
  ps(script);
}

(async () => {
  const child = spawn(APP, ['--port', String(PORT)], {
    detached: false,
    stdio: 'ignore',
    env: { ...process.env, PR_DEBUG_PORT: String(DEBUG) },
  });
  let browser;
  try {
    // Wait for the WebView2 debugging endpoint.
    let version = null;
    for (let i = 0; i < 60 && !version; i += 1) {
      await sleep(500);
      try { version = await (await fetch(`http://127.0.0.1:${DEBUG}/json/version`)).json(); } catch { /* not up yet */ }
    }
    check('desktop: the real WebView2 exposes its page', !!version, version ? version['Browser'] : 'no CDP endpoint');

    browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG}`);
    const context = browser.contexts()[0];
    let page = null;
    for (let i = 0; i < 30 && !page; i += 1) {
      page = context.pages().find((p) => p.url().startsWith(URL.replace(/\/$/, ''))) || context.pages()[0];
      if (!page) await sleep(300);
    }
    if (!page) throw new Error('no page in the desktop webview');
    await page.waitForSelector('.titlebar', { timeout: 20000 });
    await page.waitForSelector('.filetree', { timeout: 20000 });
    // First launch shows the two-step guide; dismiss it like a user would.
    const skipGuide = page.getByText('稍后设置', { exact: true });
    if (await skipGuide.count()) {
      await skipGuide.first().click();
      await page.waitForTimeout(500);
    }
    check('desktop: the window renders the real UI',
      (await page.locator('.titlebar').count()) === 1 && (await page.locator('.statusbar').count()) === 1);

    // The click that was swallowed by the window drag before: it must open the panel.
    if ((await page.locator('.session-panel').count()) === 0) {
      await page.locator('.session-switcher-btn').click();
      await page.waitForTimeout(400);
    }
    check('desktop: a click opens the session panel',
      (await page.locator('.session-panel').count()) === 1);

    // The real Win32 picker: click the tree button, find the dialog, cancel it.
    const rootBefore = (await page.locator('.tree-root').innerText()).trim();
    await page.locator('.filetree .pane-head .icon-btn[aria-label="打开文件夹"]').click();
    let dialogs = [];
    for (let i = 0; i < 20 && dialogs.length === 0; i += 1) {
      await sleep(400);
      dialogs = listDialogs('打开文件夹');
    }
    check('desktop: "open folder" shows the native folder dialog', dialogs.length > 0,
      `dialogs=${JSON.stringify(dialogs)}`);
    for (const d of dialogs) closeDialog(d.h);
    await sleep(800);
    check('desktop: cancelling the dialog keeps the workspace',
      (await page.locator('.tree-root').innerText()).trim() === rootBefore,
      `${rootBefore} -> ${(await page.locator('.tree-root').innerText()).trim()}`);
  } finally {
    try { await browser?.close(); } catch { /* ignore */ }
    try { child.kill(); } catch { /* ignore */ }
    // The WebView2 host is a child of the shell; kill the tree by pid.
    try {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch { /* already gone */ }
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} desktop checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
