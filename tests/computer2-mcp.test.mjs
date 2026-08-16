import test from 'node:test';
import assert from 'node:assert/strict';

import { createComputer2Caller, parseComputer2Result } from '../src/lib/computer2-mcp.ts';

test('MCP text results retain the leading JSON payload when a governor handle follows it', () => {
  const value = parseComputer2Result({
    content: [{ type: 'text', text: '{\n  "id": "plan-123",\n  "message": "brace } inside string"\n}\n\n[More output stored. Use a handle.]' }],
  });
  assert.deepEqual(value, { id: 'plan-123', message: 'brace } inside string' });
});

test('plain text MCP results remain available as text', () => {
  assert.deepEqual(parseComputer2Result({ content: [{ type: 'text', text: 'ready' }] }), { text: 'ready' });
});

test('server-side Computer 2 calls reuse one authenticated MCP connection', async () => {
  let connections = 0;
  let closes = 0;
  const toolCalls = [];
  const client = {
    async connect() { connections += 1; },
    async callTool(request) { toolCalls.push(request); return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] }; },
    async close() { closes += 1; },
  };
  const caller = createComputer2Caller({
    url: 'http://127.0.0.1:3000/mcp',
    token: 'server-only-token',
    createClient: () => client,
    createTransport: () => ({ kind: 'test-transport' }),
  });

  await caller('job_status', { job_id: 'job-1' });
  await caller('job_status', { job_id: 'job-1' });

  assert.equal(connections, 1);
  assert.equal(closes, 0);
  assert.equal(toolCalls.length, 2);
});

test('stale Computer 2 calls have a bounded timeout so reconnect can proceed', async () => {
  let options;
  const client = {
    async connect() {},
    async callTool(_request, _schema, callOptions) {
      options = callOptions;
      return { content: [{ type: 'text', text: '{"ok":true}' }] };
    },
    async close() {},
  };
  const caller = createComputer2Caller({
    url: 'http://127.0.0.1:3000/mcp',
    token: 'server-only-token',
    createClient: () => client,
    createTransport: () => ({}),
  });
  await caller('job_status', { job_id: 'job-restarted' });
  assert.equal(options.timeout, 30_000);
});

test('expired MCP session reconnects and retries the same tool call once', async () => {
  let connections = 0;
  let closes = 0;
  const requests = [];
  const clients = [
    {
      async connect() { connections += 1; },
      async callTool(request) {
        requests.push(request);
        throw new Error('Streamable HTTP error: Bad Request: No valid session ID provided');
      },
      async close() { closes += 1; },
    },
    {
      async connect() { connections += 1; },
      async callTool(request) {
        requests.push(request);
        return { content: [{ type: 'text', text: '{"id":"plan-reconnected"}' }] };
      },
      async close() { closes += 1; },
    },
  ];
  const caller = createComputer2Caller({
    url: 'http://127.0.0.1:3000/mcp',
    token: 'server-only-token',
    createClient: () => clients.shift(),
    createTransport: () => ({}),
  });

  const result = await caller('plan_create', { goal: 'approved build' });
  assert.deepEqual(result, { id: 'plan-reconnected' });
  assert.equal(connections, 2);
  assert.equal(closes, 1);
  assert.deepEqual(requests, [
    { name: 'plan_create', arguments: { goal: 'approved build' } },
    { name: 'plan_create', arguments: { goal: 'approved build' } },
  ]);
});

test('ordinary Computer 2 tool errors are not retried', async () => {
  let connections = 0;
  let calls = 0;
  const caller = createComputer2Caller({
    url: 'http://127.0.0.1:3000/mcp',
    token: 'server-only-token',
    createClient: () => ({
      async connect() { connections += 1; },
      async callTool() { calls += 1; throw new Error('Tool rejected invalid build input'); },
      async close() {},
    }),
    createTransport: () => ({}),
  });

  await assert.rejects(() => caller('plan_create', { goal: '' }), /invalid build input/i);
  assert.equal(connections, 1);
  assert.equal(calls, 1);
});
