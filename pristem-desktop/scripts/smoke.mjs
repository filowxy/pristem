// Protocol smoke test against the running desktop service.
// Verifies that the kernel — not the UI — owns mode transitions and round events.
const base = process.env.PR_URL ? process.env.PR_URL.replace(/\/$/, '') : 'http://127.0.0.1:8787';
const events = [];
const ctl = new AbortController();

const stream = await fetch(`${base}/api/events`, { signal: ctl.signal });
const reader = stream.body.getReader();
const decoder = new TextDecoder();
let buf = '';
const pump = (async () => {
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = frame.split('\n').find((l) => l.startsWith('data: '));
      if (line) {
        try { events.push(JSON.parse(line.slice(6))); } catch { /* ignore */ }
      }
    }
  }
})();

const post = (path, body) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const types = () => events.filter((e) => e.channel === 'kernel').map((e) => e.payload.type);
const waitFor = async (pred, ms = 5000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (pred()) return true;
    await sleep(60);
  }
  return false;
};

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

await post('/api/request', { type: 'open_session', mode: 'coding' });
check('session_opened', await waitFor(() => types().includes('session_opened')));
const opened = events.find((e) => e.channel === 'kernel' && e.payload.type === 'session_opened');
const sid = opened?.payload.session;
check('session id assigned', Number.isInteger(sid), `sid=${sid}`);

await post('/api/request', { type: 'switch_mode', session: sid, mode: 'IDE' });
check('coding → IDE', await waitFor(() => events.some((e) => e.payload?.type === 'mode_changed' && e.payload.to === 'IDE')));

await post('/api/request', { type: 'switch_mode', session: sid, mode: 'helping' });
check('IDE → helping', await waitFor(() => events.some((e) => e.payload?.to === 'helping')));

// Kernel contract: entering deepsleep ALWAYS emits a human confirmation first,
// regardless of the source mode. The 6x6 transition table is checked on confirm.
await post('/api/request', { type: 'switch_mode', session: sid, mode: 'deepsleep' });
check('helping → deepsleep asks for confirmation', await waitFor(() => types().includes('buttons')));
const stale = events.find((e) => e.payload?.type === 'buttons')?.payload.buttons.find((b) => b.choice === 'deepsleep');
await post('/api/request', { type: 'confirm', session: sid, id: stale.id, choice: stale.choice });
check('helping → deepsleep rejected on confirm', await waitFor(() => events.some((e) => e.payload?.type === 'error' && /forbidden/.test(e.payload.message))));

await post('/api/request', { type: 'switch_mode', session: sid, mode: 'advisor' });
check('helping → advisor', await waitFor(() => events.some((e) => e.payload?.to === 'advisor')));

await post('/api/request', { type: 'annotate', session: sid, target: '0:12:some span', note: 'check this', classification: 'correction' });
check('annotation → digest_requested', await waitFor(() => types().includes('digest_requested')));

const buttonsBefore = events.filter((e) => e.payload?.type === 'buttons').length;
await post('/api/request', { type: 'switch_mode', session: sid, mode: 'deepsleep' });
check('advisor → deepsleep requires confirmation', await waitFor(() => events.filter((e) => e.payload?.type === 'buttons').length > buttonsBefore));
const buttons = events.filter((e) => e.payload?.type === 'buttons');
const btn = buttons[buttons.length - 1].payload.buttons.find((b) => b.choice === 'deepsleep');
await post('/api/request', { type: 'confirm', session: sid, id: btn.id, choice: btn.choice });
check('confirmed → deepsleep', await waitFor(() => events.some((e) => e.payload?.to === 'deepsleep')));

await post('/api/request', { type: 'list_reminders', session: sid });
check('wake briefing via reminder', await waitFor(() => types().includes('reminder')));

await post('/api/request', { type: 'switch_mode', session: sid, mode: 'goal' });
check('deepsleep → goal (wake commit point)', await waitFor(() => events.some((e) => e.payload?.to === 'goal')));

await post('/api/request', { type: 'submit_round', session: sid, text: 'make the presence dial honest' });
check('round streams speech/call/result/answer/finished', await waitFor(() => {
  const t = types();
  return ['speech', 'call', 'result', 'answer', 'finished'].every((k) => t.includes(k));
}, 12000), types().join(','));

const files = await (await post('/api/io', { op: 'fs.list' })).json();
check('service IO exposes workspace files', Array.isArray(files.files) && files.files.length > 0, `${files.files?.length} entries`);

console.log('\n--- kernel errors ---');
events.filter((e) => e.payload?.type === 'error').forEach((e) => console.log('  ' + e.payload.message));
console.log('--- transitions ---');
events.filter((e) => e.payload?.type === 'mode_changed').forEach((e) => console.log(`  ${e.payload.from} → ${e.payload.to}`));

// Release the worker slot — the kernel only has `worker_slots` (4) of them.
await post('/api/request', { type: 'close_session', session: sid });
check('session_closed (slot released)', await waitFor(() => types().includes('session_closed')));

ctl.abort();
await pump.catch(() => {});
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
