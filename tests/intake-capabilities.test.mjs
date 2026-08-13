import assert from 'node:assert/strict';
import test from 'node:test';

import { recoverVisionCapability } from '../src/lib/intake/capabilities.ts';

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
