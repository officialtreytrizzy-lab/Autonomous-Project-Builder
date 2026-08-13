import test from 'node:test';
import assert from 'node:assert/strict';

import { parseComputer2Result } from '../src/lib/computer2-mcp.ts';

test('MCP text results retain the leading JSON payload when a governor handle follows it', () => {
  const value = parseComputer2Result({
    content: [{ type: 'text', text: '{\n  "id": "plan-123",\n  "message": "brace } inside string"\n}\n\n[More output stored. Use a handle.]' }],
  });
  assert.deepEqual(value, { id: 'plan-123', message: 'brace } inside string' });
});

test('plain text MCP results remain available as text', () => {
  assert.deepEqual(parseComputer2Result({ content: [{ type: 'text', text: 'ready' }] }), { text: 'ready' });
});
