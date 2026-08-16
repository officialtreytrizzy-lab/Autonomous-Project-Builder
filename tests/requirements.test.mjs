import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { approveIntakeResponse } from '../src/app/api/intakes/[intakeId]/approve/route.ts';
import { computeApprovalHash } from '../src/lib/intake/contract.ts';
import {
  fulfillRequirementCredential,
  fulfillRequirementPaths,
  requirementContract,
  resolveRequirementStates,
  writeBuildRequirementBundle,
} from '../src/lib/intake/requirements.ts';
import { IntakeStore } from '../src/lib/intake/store.ts';
import { SecureVault } from '../src/lib/secure-vault.ts';

const content = {
  outcome: 'Build the requested product', users: [], flows: [], requirements: [], designDirection: [],
  dataAndIntegrations: [], exclusions: [], acceptanceTests: [], assumptions: [],
};

function fixture(prefix = 'builder-requirements-') {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const store = new IntakeStore(join(root, 'state.db'));
  const workspace = join(root, 'workspace');
  mkdirSync(workspace, { recursive: true });
  const project = store.createProject({ name: 'Requirements Test', objective: 'Exercise required build inputs', workspace });
  const intake = store.createIntake(project.id);
  return { root, store, workspace, project, intake, close() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}

function approveTestDesign(store, intakeId) {
  const intake = store.getIntake(intakeId);
  const model = 'test-design-model';
  store.ensureDesignSession(intakeId, model);
  store.appendDesignMessage(intakeId, { role: 'assistant', content: 'Approved test design.', model });
  return store.saveDesignContract({
    id: `design-${intakeId}`, intakeId, projectId: intake.projectId, version: store.nextDesignVersion(intakeId),
    status: 'approved', provider: 'openrouter', model, approvedAt: new Date().toISOString(), summary: 'Approved design.',
    principles: ['Clear hierarchy'], designSystem: { visualLanguage: 'Premium', typography: ['Sans'], colorAndMaterial: ['Glass'], spacingAndShape: ['Consistent'], elevationAndDepth: ['Subtle'], motion: ['Safe'] },
    screens: [], interactions: [], responsiveRules: [], accessibility: [], assets: [], implementationRules: [], visualAcceptance: [],
  });
}

test('RVC vocal-stem folder enforces the exact minimum before becoming build-ready', async (t) => {
  const f = fixture('builder-rvc-input-'); t.after(() => f.close());
  f.store.createBriefVersion(f.intake.id, content, { inspectedPages: 0, totalPages: 0, complete: true }, [{
    id: 'rvc-vocal-stems', label: 'Clean vocal stems', kind: 'folder', description: 'Training vocals for the RVC voice model.',
    reason: 'The requested RVC model cannot be trained without enough clean isolated vocals.', required: true, minCount: 10,
    acceptedExtensions: ['.wav', '.flac'],
  }]);
  const folder = join(f.root, 'vocal-stems'); mkdirSync(folder);
  for (let index = 1; index <= 9; index += 1) writeFileSync(join(folder, `stem-${index}.wav`), `audio-${index}`);
  await assert.rejects(() => fulfillRequirementPaths({ store: f.store, intakeId: f.intake.id, requirementId: 'rvc-vocal-stems', paths: [folder] }), /at least 10.*9 were found/i);
  assert.equal(resolveRequirementStates(f.store, f.intake.id)[0].satisfied, false);
  writeFileSync(join(folder, 'stem-10.wav'), 'audio-10');
  const ready = await fulfillRequirementPaths({ store: f.store, intakeId: f.intake.id, requirementId: 'rvc-vocal-stems', paths: [folder] });
  assert.equal(ready.satisfied, true);
  assert.equal(ready.fileCount, 10);
  const stored = f.store.getRequirementFulfillment(f.intake.id, 'rvc-vocal-stems');
  assert.equal(stored.fileHashes.length, 10);
  assert.equal(stored.storedPaths.length, 10);
  assert.equal(stored.storedPaths.every((path) => existsSync(path) && path.includes(join('.builder', 'user-inputs', 'rvc-vocal-stems'))), true);
});

test('Hugging Face access is encrypted at rest and automatically reusable by a future project', async (t) => {
  if (process.platform !== 'win32') return;
  const root = mkdtempSync(join(tmpdir(), 'builder-secure-vault-'));
  const previousUser = process.env.USERPROFILE;
  const previousHf = process.env.HF_TOKEN;
  const previousHub = process.env.HUGGINGFACE_HUB_TOKEN;
  process.env.USERPROFILE = root;
  delete process.env.HF_TOKEN;
  delete process.env.HUGGINGFACE_HUB_TOKEN;
  const vaultPath = join(root, 'secure-credentials.json');
  const vault = new SecureVault(vaultPath);
  const secret = `hf_test_${crypto.randomUUID().replaceAll('-', '')}`;
  const make = (name) => {
    const store = new IntakeStore(join(root, `${name}.db`));
    const workspace = join(root, `${name}-workspace`); mkdirSync(workspace);
    const project = store.createProject({ name, objective: 'Needs Hugging Face', workspace });
    const intake = store.createIntake(project.id);
    store.createBriefVersion(intake.id, content, { inspectedPages: 0, totalPages: 0, complete: true }, [{
      id: 'hugging-face-access', label: 'Hugging Face access', kind: 'credential', description: 'Access required models.',
      reason: 'The requested gated model must be downloaded from Hugging Face.', required: true, provider: 'hugging-face', reusable: true,
      fields: [{ id: 'token', label: 'Access token', type: 'secret', required: true, envVar: 'HF_TOKEN' }],
    }]);
    return { store, intake };
  };
  const first = make('first'); const second = make('second');
  t.after(() => {
    first.store.close(); second.store.close();
    if (previousUser === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = previousUser;
    if (previousHf === undefined) delete process.env.HF_TOKEN; else process.env.HF_TOKEN = previousHf;
    if (previousHub === undefined) delete process.env.HUGGINGFACE_HUB_TOKEN; else process.env.HUGGINGFACE_HUB_TOKEN = previousHub;
    rmSync(root, { recursive: true, force: true });
  });
  await fulfillRequirementCredential({ store: first.store, intakeId: first.intake.id, requirementId: 'hugging-face-access', fields: { token: secret }, vault });
  const vaultText = readFileSync(vaultPath, 'utf8');
  assert.equal(vaultText.includes(secret), false);
  assert.equal(await vault.get('env:hf_token'), secret);
  const futureState = resolveRequirementStates(second.store, second.intake.id, vault)[0];
  assert.equal(futureState.satisfied, true);
  assert.equal(futureState.source, 'saved');
  assert.match(futureState.summary, /encrypted access is ready/i);
});

test('approval blocks missing user-only inputs and succeeds after the required asset is supplied', async (t) => {
  const f = fixture('builder-approval-input-'); t.after(() => f.close());
  const brief = f.store.createBriefVersion(f.intake.id, content, { inspectedPages: 0, totalPages: 0, complete: true }, [{
    id: 'brand-image', label: 'Brand image', kind: 'files', description: 'Final production logo.', reason: 'The approved interface requires the real brand asset.', required: true, minCount: 1, acceptedExtensions: ['.png'],
  }]);
  f.store.updateIntake(f.intake.id, { status: 'awaiting-approval' });
  approveTestDesign(f.store, f.intake.id);
  const request = () => new Request('http://local/approve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ briefVersionId: brief.id, buildConfiguration: { deployment: 'local' } }) });
  const blocked = await approveIntakeResponse(request(), f.intake.id, f.store);
  assert.equal(blocked.status, 409);
  assert.match((await blocked.json()).error, /Brand image/);
  const logo = join(f.root, 'logo.png'); writeFileSync(logo, 'png-fixture');
  await fulfillRequirementPaths({ store: f.store, intakeId: f.intake.id, requirementId: 'brand-image', paths: [logo] });
  const approved = await approveIntakeResponse(request(), f.intake.id, f.store);
  assert.equal(approved.status, 200);
});

test('required input fingerprints are material to the immutable approval hash', async (t) => {
  const f = fixture('builder-input-hash-'); t.after(() => f.close());
  const brief = f.store.createBriefVersion(f.intake.id, content, { inspectedPages: 0, totalPages: 0, complete: true }, [{
    id: 'reference-image', label: 'Reference image', kind: 'files', description: 'Visual reference.', reason: 'Required visual identity.', required: true, acceptedExtensions: ['.png'],
  }]);
  const file = join(f.root, 'reference.png'); writeFileSync(file, 'version-one');
  await fulfillRequirementPaths({ store: f.store, intakeId: f.intake.id, requirementId: 'reference-image', paths: [file] });
  const configuration = { repository: '', backend: 'none', deployment: 'local', workflow: 'none', needsAuthenticatedBrowser: false, needsWindowsHost: true };
  const firstMaterial = requirementContract(f.store, f.intake.id);
  const first = computeApprovalHash({ brief, sources: [], decisions: [], requirements: firstMaterial, buildConfiguration: configuration });
  writeFileSync(file, 'version-two');
  await fulfillRequirementPaths({ store: f.store, intakeId: f.intake.id, requirementId: 'reference-image', paths: [file] });
  const secondMaterial = requirementContract(f.store, f.intake.id);
  const second = computeApprovalHash({ brief, sources: [], decisions: [], requirements: secondMaterial, buildConfiguration: configuration });
  assert.notEqual(first, second);
});

test('build requirement bundle contains no plaintext credential and provides an environment-only helper', async (t) => {
  if (process.platform !== 'win32') return;
  const f = fixture('builder-secret-bundle-'); t.after(() => f.close());
  const vault = new SecureVault(join(f.root, 'vault.json'));
  const secret = `private_${crypto.randomUUID().replaceAll('-', '')}`;
  const old = process.env.BUILDER_TEST_PRIVATE_TOKEN; delete process.env.BUILDER_TEST_PRIVATE_TOKEN;
  t.after(() => { if (old === undefined) delete process.env.BUILDER_TEST_PRIVATE_TOKEN; else process.env.BUILDER_TEST_PRIVATE_TOKEN = old; });
  f.store.createBriefVersion(f.intake.id, content, { inspectedPages: 0, totalPages: 0, complete: true }, [{
    id: 'private-service', label: 'Private service token', kind: 'credential', description: 'Required API access.', reason: 'Build uses a protected API.', required: true, provider: 'private-service', reusable: true,
    fields: [{ id: 'token', label: 'Token', type: 'secret', required: true, envVar: 'BUILDER_TEST_PRIVATE_TOKEN' }],
  }]);
  await fulfillRequirementCredential({ store: f.store, intakeId: f.intake.id, requirementId: 'private-service', fields: { token: secret }, vault });
  const states = resolveRequirementStates(f.store, f.intake.id, vault); assert.equal(states[0].satisfied, true);
  const material = requirementContract(f.store, f.intake.id, vault);
  assert.equal(JSON.stringify(material).includes(secret), false);
  const encrypted = vault.encryptedValue('env:builder_test_private_token');
  const bundle = { items: [{ id: 'private-service', label: 'Private service token', kind: 'credential', fields: [{ id: 'token', label: 'Token', runtimeEnv: 'BUILDER_TEST_PRIVATE_TOKEN', source: 'saved' }] }], encryptedSecrets: { BUILDER_TEST_PRIVATE_TOKEN: encrypted } };
  writeBuildRequirementBundle(f.workspace, bundle, 'a'.repeat(64));
  const manifest = readFileSync(join(f.workspace, '.builder', 'approved-requirements.json'), 'utf8');
  const runtime = readFileSync(join(f.workspace, '.builder', 'runtime-secrets.json'), 'utf8');
  const helper = readFileSync(join(f.workspace, '.builder', 'run-with-secrets.ps1'), 'utf8');
  assert.equal(manifest.includes(secret), false);
  assert.equal(runtime.includes(secret), false);
  assert.match(helper, /ProtectedData.*Unprotect/);
  assert.match(helper, /SetEnvironmentVariable/);
  assert.doesNotMatch(helper, /Write-Output.*secret|Write-Host.*secret/i);
});


test('Understand stage exposes build-input channels and blocks design while required items are missing', () => {
  const panel = readFileSync('src/components/builder/RequirementsPanel.tsx', 'utf8');
  const understand = readFileSync('src/components/builder/UnderstandMode.tsx', 'utf8');
  const approval = readFileSync('src/components/builder/ApprovalMode.tsx', 'utf8');
  assert.match(panel, /Build inputs & access/);
  assert.match(panel, /selectInputFolder/);
  assert.match(panel, /selectInputFiles/);
  assert.match(panel, /Save encrypted access/);
  assert.match(panel, /Saved for future Builder projects/);
  assert.match(understand, /missingRequiredInputs/);
  assert.match(understand, /Provide every required build input/);
  assert.match(approval, /missingRequiredInputs/);
});
