import assert from 'node:assert/strict';
import test from 'node:test';

import { discoverDocumentCapabilities, recoverVisionCapability } from '../src/lib/intake/capabilities.ts';

function report(overrides = {}) {
  return {
    word: { available: true, detail: 'Word COM available' },
    pdfRenderer: { available: true, detail: 'pdftoppm available' },
    ollama: { installed: true, running: true, endpoint: 'http://127.0.0.1:11434' },
    vision: { available: false, installedCandidates: [], model: '', detail: 'No compatible model' },
    ...overrides,
  };
}

test('vision recovery diagnoses before provisioning and reuses an installed compatible model', async () => {
  const actions = [];
  let started = false;
  const recovered = await recoverVisionCapability({
    async discover() {
      actions.push('discover');
      return report({
        ollama: { installed: true, running: started, endpoint: 'http://127.0.0.1:11434' },
        vision: { available: false, installedCandidates: ['existing-vision'], model: '', detail: 'Service stopped' },
      });
    },
    async startService() { actions.push('start-service'); started = true; },
    async repairConfiguration() { actions.push('repair-configuration'); },
    async restartService() { actions.push('restart-service'); },
    async provisionVisionModel(model) { actions.push(`pull-${model}`); },
    async healthCheck() {
      actions.push('health-check');
      return report({
        vision: { available: true, installedCandidates: ['existing-vision'], model: 'existing-vision', detail: 'Ready' },
      });
    },
  });

  assert.deepEqual(actions, ['discover', 'start-service', 'health-check']);
  assert.equal(recovered.vision.model, 'existing-vision');
  assert.equal(actions.includes('pull-gemma3:4b'), false);
});

test('provisions gemma3:4b only after compatible discovery and service recovery are exhausted', async () => {
  const actions = [];
  let provisioned = false;
  const recovered = await recoverVisionCapability({
    async discover() {
      actions.push('discover');
      return report();
    },
    async startService() { actions.push('start-service'); },
    async repairConfiguration() { actions.push('repair-configuration'); },
    async restartService() { actions.push('restart-service'); },
    async provisionVisionModel(model) { actions.push(`pull-${model}`); provisioned = true; },
    async healthCheck() {
      actions.push('health-check');
      return provisioned
        ? report({ vision: { available: true, installedCandidates: ['gemma3:4b'], model: 'gemma3:4b', detail: 'Ready' } })
        : report();
    },
  });

  assert.deepEqual(actions.slice(-2), ['pull-gemma3:4b', 'health-check']);
  assert.equal(recovered.vision.available, true);
});

test('does not provision while the local Ollama service remains unavailable', async () => {
  const actions = [];
  const unavailable = report({ ollama: { installed: true, running: false, endpoint: 'http://127.0.0.1:11434' } });
  const recovered = await recoverVisionCapability({
    async discover() { actions.push('discover'); return unavailable; },
    async startService() { actions.push('start-service'); },
    async repairConfiguration() { actions.push('repair-configuration'); },
    async restartService() { actions.push('restart-service'); },
    async provisionVisionModel(model) { actions.push(`pull-${model}`); },
    async healthCheck() { actions.push('health-check'); return unavailable; },
  });
  assert.equal(recovered.vision.available, false);
  assert.equal(actions.some((action) => action.startsWith('pull-')), false);
  assert.deepEqual(actions, [
    'discover', 'start-service', 'health-check',
    'repair-configuration', 'restart-service', 'health-check',
  ]);
});

test('discovers an existing local PDF renderer even when it is absent from PATH', async () => {
  const rendererPath = 'C:\\local-tools\\poppler\\pdftoppm.exe';
  const capability = await discoverDocumentCapabilities({
    commandPath: async () => '',
    wordAvailable: async () => false,
    localModelNames: () => [],
    rendererCandidates: () => [rendererPath],
    fileExists: (path) => path === rendererPath,
    fetchImpl: async () => { throw new Error('offline'); },
  });

  assert.equal(capability.pdfRenderer.available, true);
  assert.equal(capability.pdfRenderer.path, rendererPath);
});

test('prefers a native PDF renderer executable over a command shim', async () => {
  const rendererPath = 'C:\\local-tools\\poppler\\pdftoppm.exe';
  const capability = await discoverDocumentCapabilities({
    commandPath: async (command) => command === 'pdftoppm' ? 'C:\\shim\\pdftoppm.cmd' : '',
    wordAvailable: async () => false,
    localModelNames: () => [],
    rendererCandidates: () => [rendererPath],
    fileExists: () => true,
    fetchImpl: async () => { throw new Error('offline'); },
  });

  assert.equal(capability.pdfRenderer.path, rendererPath);
});

test('selects a smaller installed completion model for brief synthesis', async () => {
  const capability = await discoverDocumentCapabilities({
    commandPath: async () => '',
    wordAvailable: async () => true,
    localModelNames: () => [],
    rendererCandidates: () => [],
    fileExists: () => false,
    async fetchImpl(url, init) {
      if (url.endsWith('/api/version')) return new Response(JSON.stringify({ version: '1.0.0' }));
      if (url.endsWith('/api/tags')) return new Response(JSON.stringify({ models: [
        { name: 'gemma3:4b', size: 3_300_000_000 },
        { name: 'qwen3:1.7b', size: 1_300_000_000 },
      ] }));
      const model = JSON.parse(init.body).model;
      return new Response(JSON.stringify({ capabilities: model.startsWith('gemma3') ? ['completion', 'vision'] : ['completion'] }));
    },
  });

  assert.equal(capability.vision.model, 'gemma3:4b');
  assert.equal(capability.synthesis.model, 'qwen3:1.7b');
});
