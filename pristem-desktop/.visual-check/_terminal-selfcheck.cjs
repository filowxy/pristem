// Terminal self-check against a fresh headless service on 8787: independent
// cwd per instance, Ctrl+C stops a foreground loop, kill tears the session
// down. Drives /api/io + the SSE stream directly (no browser).
const BASE = process.env.PR_URL ? process.env.PR_URL.replace(/\/$/, '') : 'http://127.0.0.1:8787';
const io = (body) => fetch(`${BASE}/api/io`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

(async () => {
  const res = await fetch(`${BASE}/api/events`);
  const reader = res.body.getReader();
  let buf = '';
  const pump = (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += Buffer.from(value).toString('utf8');
    }
  })().catch(() => {});

  const rowsFor = (instance) => {
    const out = [];
    for (const frame of buf.split('\n')) {
      if (!frame.startsWith('data: ')) continue;
      let ev;
      try { ev = JSON.parse(frame.slice(6)); } catch { continue; }
      const p = ev.payload ?? ev;
      if (p.type === 'term.output' && p.instance === instance) out.push(p.data ?? '');
    }
    return out.join('');
  };

  const open0 = await io({ op: 'term.open', instance: 0, cols: 80, rows: 24, shell: 'cmd' });
  const open1 = await io({ op: 'term.open', instance: 1, cols: 80, rows: 24, shell: 'cmd' });
  check('term: two instances open with a real shell name',
    open0.ok === true && open1.ok === true && !!open0.shell && !!open1.shell,
    `${open0.shell} / ${open1.shell}`);
  await sleep(500);

  await io({ op: 'term.write', instance: 0, data: 'cd /d C:\\Windows\r' });
  await io({ op: 'term.write', instance: 1, data: 'cd /d D:\\\r' });
  await sleep(400);
  await io({ op: 'term.write', instance: 0, data: 'echo INST0_OK\r' });
  await io({ op: 'term.write', instance: 1, data: 'echo INST1_OK\r' });
  await sleep(900);
  const out0 = rowsFor(0);
  const out1 = rowsFor(1);
  check('term: instance 0 ran its command in its own cwd',
    out0.includes('INST0_OK') && /C:\\Windows>/i.test(out0), out0.slice(-120).replace(/\r?\n/g, '|'));
  check('term: instance 1 kept an independent cwd',
    out1.includes('INST1_OK') && /D:\\>/i.test(out1) && !/C:\\Windows>/i.test(out1),
    out1.slice(-120).replace(/\r?\n/g, '|'));

  // Clipboard round-trip through the shell (restores the user's clipboard).
  const prevClip = await io({ op: 'clipboard.read' });
  const clipWrite = await io({ op: 'clipboard.write', text: 'PRISM_CLIP_42' });
  const clipRead = await io({ op: 'clipboard.read' });
  check('clipboard: shell write/read round-trip',
    clipWrite.ok === true && clipRead.text === 'PRISM_CLIP_42',
    `write=${clipWrite.ok} text=${JSON.stringify(clipRead.text)}`);
  if (prevClip.ok) await io({ op: 'clipboard.write', text: prevClip.text ?? '' });

  // Ctrl+C: a foreground loop must stop and the shell must keep its cwd.
  await io({ op: 'term.write', instance: 0, data: 'ping -t 127.0.0.1\r' });
  await sleep(1500);
  await io({ op: 'term.interrupt', instance: 0 });
  await sleep(700);
  await io({ op: 'term.write', instance: 0, data: 'echo AFTER_INT\r' });
  await sleep(1400);
  const after = rowsFor(0);
  check('term: Ctrl+C stops the foreground loop and the shell survives',
    after.includes('AFTER_INT') && /C:\\Windows>/i.test(after), after.slice(-160).replace(/\r?\n/g, '|'));

  await io({ op: 'term.kill', instance: 0 });
  const writeAfterKill = await io({ op: 'term.write', instance: 0, data: 'x' });
  check('term: kill tears the session down', writeAfterKill.ok === false);
  await io({ op: 'term.kill', instance: 1 });

  reader.cancel().catch(() => {});
  await pump;

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} terminal checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
