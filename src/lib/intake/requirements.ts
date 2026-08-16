import { createHash } from 'node:crypto';
import { createReadStream, copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { getSecureVault, secretFingerprint, type SecureVault } from '../secure-vault.ts';
import type { IntakeStore } from './store.ts';
import type { BuildInputRequirement, BuildRequirementState, RequirementField, RequirementFulfillment } from './types.ts';

const PROVIDER_ENV: Record<string, string[]> = {
  'hugging-face': ['HF_TOKEN', 'HUGGINGFACE_HUB_TOKEN'],
  openrouter: ['OPENROUTER_API_KEY'],
  github: ['GH_TOKEN', 'GITHUB_TOKEN'],
  vercel: ['VERCEL_TOKEN'],
  supabase: ['SUPABASE_ACCESS_TOKEN'],
  firebase: ['FIREBASE_TOKEN', 'GOOGLE_APPLICATION_CREDENTIALS'],
  aws: ['AWS_ACCESS_KEY_ID'],
  modal: ['MODAL_TOKEN_ID'],
};

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'input';
}
function providerSlug(requirement: BuildInputRequirement) { return slug(requirement.provider || requirement.label); }
export function credentialVaultKey(requirement: BuildInputRequirement, field: RequirementField) {
  return field.envVar?.trim() ? `env:${field.envVar.trim().toLowerCase()}` : `provider:${providerSlug(requirement)}:${slug(field.id || field.label)}`;
}
export function runtimeEnvironmentName(requirement: BuildInputRequirement, field: RequirementField) {
  if (field.envVar?.trim()) return field.envVar.trim().toUpperCase();
  return `BUILDER_INPUT_${slug(`${requirement.id}-${field.id}`).replaceAll('-', '_').toUpperCase()}`;
}
function providerEnvNames(requirement: BuildInputRequirement, field: RequirementField) {
  const explicit = field.envVar?.trim() ? [field.envVar.trim()] : [];
  const known = PROVIDER_ENV[providerSlug(requirement)] || [];
  return [...new Set([...explicit, ...known])];
}
function localAccountAvailable(requirement: BuildInputRequirement) {
  if (providerSlug(requirement) !== 'hugging-face') return false;
  const home = process.env.USERPROFILE || process.env.HOME || '';
  if (!home) return false;
  return [join(home, '.cache', 'huggingface', 'token'), join(home, '.huggingface', 'token')].some((path) => existsSync(path));
}
function currentBriefRequirement(store: IntakeStore, intakeId: string, requirementId: string) {
  const requirement = store.currentBrief(intakeId)?.requiredInputs?.find((item) => item.id === requirementId);
  if (!requirement) throw new Error('This required input is no longer part of the current Build Brief');
  return requirement;
}
function fileFulfillmentValid(requirement: BuildInputRequirement, fulfillment: RequirementFulfillment | null) {
  if (!fulfillment || fulfillment.status !== 'provided') return false;
  const paths = fulfillment.storedPaths || [];
  if (paths.length < Math.max(1, requirement.minCount || 1)) return false;
  return paths.every((path) => existsSync(path) && statSync(path).isFile());
}
function credentialFieldSource(requirement: BuildInputRequirement, field: RequirementField, vault: SecureVault) {
  const key = credentialVaultKey(requirement, field);
  const metadata = vault.metadata(key);
  if (metadata) return { source: 'saved' as const, name: runtimeEnvironmentName(requirement, field), fingerprint: metadata.fingerprint };
  for (const name of providerEnvNames(requirement, field)) if (process.env[name]?.trim()) return { source: 'environment' as const, name, fingerprint: secretFingerprint(process.env[name]!) };
  if (localAccountAvailable(requirement)) return { source: 'local-account' as const, name: '', fingerprint: 'local-account' };
  return null;
}

export function resolveRequirementStates(store: IntakeStore, intakeId: string, vault = getSecureVault()): BuildRequirementState[] {
  const brief = store.currentBrief(intakeId);
  if (!brief) return [];
  return (brief.requiredInputs || []).map((requirement) => {
    const fulfillment = store.getRequirementFulfillment(intakeId, requirement.id);
    if (requirement.kind === 'credential') {
      const requiredFields = (requirement.fields || []).filter((field) => field.required !== false);
      const availability = requiredFields.map((field) => credentialFieldSource(requirement, field, vault));
      const satisfied = requiredFields.length > 0 && availability.every(Boolean);
      const sources = availability.filter(Boolean).map((entry) => entry!.source);
      const source = satisfied ? (sources.includes('saved') ? 'saved' : sources.includes('environment') ? 'environment' : 'local-account') : 'missing';
      return { requirement, satisfied, source, summary: satisfied ? (source === 'saved' ? 'Saved encrypted access is ready.' : source === 'environment' ? 'Existing embedded access is ready.' : 'Existing local account access is available.') : 'Access information is still required.', updatedAt: fulfillment?.updatedAt };
    }
    if (requirement.kind === 'folder' || requirement.kind === 'files') {
      const satisfied = fileFulfillmentValid(requirement, fulfillment);
      return { requirement, satisfied, source: satisfied ? 'project' : 'missing', summary: satisfied ? fulfillment?.summary || `${fulfillment?.fileCount || 0} file(s) provided.` : `Provide at least ${Math.max(1, requirement.minCount || 1)} matching file(s).`, fileCount: satisfied ? fulfillment?.fileCount : 0, updatedAt: fulfillment?.updatedAt };
    }
    const satisfied = fulfillment?.status === 'provided';
    return { requirement, satisfied, source: satisfied ? 'project' : 'missing', summary: satisfied ? fulfillment?.summary || 'Provided.' : 'Still required.', updatedAt: fulfillment?.updatedAt };
  });
}

export function requirementContract(store: IntakeStore, intakeId: string, vault = getSecureVault()) {
  const states = resolveRequirementStates(store, intakeId, vault);
  return states.map((state) => {
    const requirement = state.requirement;
    const fulfillment = store.getRequirementFulfillment(intakeId, requirement.id);
    const credentials = requirement.kind === 'credential' ? Object.fromEntries((requirement.fields || []).map((field) => {
      const source = credentialFieldSource(requirement, field, vault);
      return [field.id, source ? { source: source.source, fingerprint: source.fingerprint, runtimeEnv: runtimeEnvironmentName(requirement, field) } : { source: 'missing', fingerprint: '', runtimeEnv: runtimeEnvironmentName(requirement, field) }];
    })) : undefined;
    return {
      id: requirement.id,
      kind: requirement.kind,
      required: requirement.required,
      satisfied: state.satisfied,
      fileHashes: fulfillment?.fileHashes || [],
      valueHash: fulfillment?.values?.value ? secretFingerprint(fulfillment.values.value) : '',
      credentials,
    };
  });
}

function hashFile(path: string) {
  return new Promise<string>((resolveHash, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', () => resolveHash(hash.digest('hex')));
  });
}
function collectFolderFiles(root: string, limit = 5000) {
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (files.length >= limit) throw new Error(`Selected folder contains more than ${limit} files. Choose a more specific input folder.`);
      if (['.git', '.builder', 'node_modules'].includes(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  visit(root);
  return files;
}
function normalizeExtensions(requirement: BuildInputRequirement) {
  return new Set((requirement.acceptedExtensions || []).map((value) => value.trim().toLowerCase()).filter(Boolean).map((value) => value.startsWith('.') ? value : `.${value}`));
}
function safeRelative(root: string, file: string) {
  const rel = relative(root, file);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return basename(file);
  return rel;
}

export async function fulfillRequirementPaths(input: { store: IntakeStore; intakeId: string; requirementId: string; paths: string[] }) {
  const requirement = currentBriefRequirement(input.store, input.intakeId, input.requirementId);
  if (!['folder', 'files'].includes(requirement.kind)) throw new Error('This required input does not accept files or folders');
  const project = input.store.getProject(input.store.getIntake(input.intakeId)?.projectId || '');
  if (!project) throw new Error('Project not found');
  const selected = input.paths.map((path) => resolve(path)).filter(Boolean);
  if (!selected.length || selected.some((path) => !existsSync(path))) throw new Error('Selected input path is unavailable');
  let files: Array<{ source: string; relative: string }> = [];
  if (requirement.kind === 'folder') {
    if (selected.length !== 1 || !statSync(selected[0]).isDirectory()) throw new Error('Select one folder for this required input');
    const root = selected[0];
    files = collectFolderFiles(root).map((source) => ({ source, relative: safeRelative(root, source) }));
  } else {
    for (const source of selected) {
      if (statSync(source).isDirectory()) files.push(...collectFolderFiles(source).map((file) => ({ source: file, relative: join(basename(source), safeRelative(source, file)) })));
      else if (statSync(source).isFile()) files.push({ source, relative: basename(source) });
    }
  }
  const extensions = normalizeExtensions(requirement);
  if (extensions.size) files = files.filter(({ source }) => extensions.has(extname(source).toLowerCase()));
  const minimum = Math.max(1, requirement.minCount || 1);
  if (files.length < minimum) throw new Error(`This build needs at least ${minimum} matching file(s); ${files.length} were found.`);
  const destination = join(project.workspace, '.builder', 'user-inputs', requirement.id.replace(/[^a-zA-Z0-9._-]+/g, '-'));
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  const storedPaths: string[] = [];
  const fileHashes: string[] = [];
  for (const file of files) {
    const target = resolve(destination, file.relative);
    if (!target.toLowerCase().startsWith(`${resolve(destination).toLowerCase()}${sep}`) && target.toLowerCase() !== resolve(destination).toLowerCase()) throw new Error('Input file path escaped the private project input directory');
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(file.source, target);
    storedPaths.push(target);
    fileHashes.push(await hashFile(target));
  }
  const fulfillment: RequirementFulfillment = {
    intakeId: input.intakeId,
    requirementId: requirement.id,
    status: 'provided',
    summary: requirement.kind === 'folder' ? `${files.length} file(s) copied from ${basename(selected[0])}.` : `${files.length} file(s) provided.`,
    fileCount: files.length,
    displayName: requirement.kind === 'folder' ? basename(selected[0]) : `${files.length} selected file(s)`,
    storedPaths,
    fileHashes,
    updatedAt: new Date().toISOString(),
  };
  input.store.saveRequirementFulfillment(fulfillment);
  return resolveRequirementStates(input.store, input.intakeId).find((state) => state.requirement.id === requirement.id)!;
}

export async function fulfillRequirementCredential(input: { store: IntakeStore; intakeId: string; requirementId: string; fields: Record<string, string>; vault?: SecureVault }) {
  const requirement = currentBriefRequirement(input.store, input.intakeId, input.requirementId);
  if (requirement.kind !== 'credential') throw new Error('This required input is not a credential');
  const vault = input.vault || getSecureVault();
  for (const field of requirement.fields || []) {
    const value = input.fields[field.id];
    if (typeof value === 'string' && value.length > 0) await vault.set({ key: credentialVaultKey(requirement, field), label: `${requirement.label}  -  ${field.label}`, provider: requirement.provider || '', value });
  }
  const state = resolveRequirementStates(input.store, input.intakeId, vault).find((item) => item.requirement.id === requirement.id)!;
  if (!state.satisfied) throw new Error('All required access fields must be provided or already available');
  input.store.saveRequirementFulfillment({ intakeId: input.intakeId, requirementId: requirement.id, status: 'provided', summary: 'Reusable encrypted access saved for this and future projects.', credentialKeys: Object.fromEntries((requirement.fields || []).map((field) => [field.id, credentialVaultKey(requirement, field)])), updatedAt: new Date().toISOString() });
  return resolveRequirementStates(input.store, input.intakeId, vault).find((item) => item.requirement.id === requirement.id)!;
}

export function fulfillRequirementValue(input: { store: IntakeStore; intakeId: string; requirementId: string; value: string }) {
  const requirement = currentBriefRequirement(input.store, input.intakeId, input.requirementId);
  if (!['text', 'url'].includes(requirement.kind)) throw new Error('This required input does not accept a text value');
  const value = input.value.trim();
  if (!value) throw new Error('A value is required');
  if (requirement.kind === 'url') { try { new URL(value); } catch { throw new Error('Enter a valid URL'); } }
  input.store.saveRequirementFulfillment({ intakeId: input.intakeId, requirementId: requirement.id, status: 'provided', summary: requirement.kind === 'url' ? 'URL provided.' : 'Required information provided.', values: { value }, updatedAt: new Date().toISOString() });
  return resolveRequirementStates(input.store, input.intakeId).find((item) => item.requirement.id === requirement.id)!;
}

export function confirmRequirement(input: { store: IntakeStore; intakeId: string; requirementId: string; note?: string }) {
  const requirement = currentBriefRequirement(input.store, input.intakeId, input.requirementId);
  if (!['manual', 'device'].includes(requirement.kind)) throw new Error('This required input cannot be manually confirmed');
  input.store.saveRequirementFulfillment({ intakeId: input.intakeId, requirementId: requirement.id, status: 'provided', summary: input.note?.trim() || 'Confirmed by the user.', values: input.note?.trim() ? { value: input.note.trim() } : undefined, updatedAt: new Date().toISOString() });
  return resolveRequirementStates(input.store, input.intakeId).find((item) => item.requirement.id === requirement.id)!;
}

export async function buildRequirementRuntimeBundle(store: IntakeStore, intakeId: string, vault = getSecureVault()) {
  const states = resolveRequirementStates(store, intakeId, vault);
  const missing = states.filter((state) => state.requirement.required && !state.satisfied);
  if (missing.length) throw new Error(`Required user input is still missing: ${missing.map((item) => item.requirement.label).join(', ')}`);
  const encryptedSecrets: Record<string, string> = {};
  const items = [];
  for (const state of states) {
    const requirement = state.requirement;
    const fulfillment = store.getRequirementFulfillment(intakeId, requirement.id);
    if (requirement.kind === 'credential') {
      const fields = [];
      for (const field of requirement.fields || []) {
        const runtimeEnv = runtimeEnvironmentName(requirement, field);
        const source = credentialFieldSource(requirement, field, vault);
        if (source?.source === 'environment') encryptedSecrets[runtimeEnv] = await vault.protectValue(process.env[source.name]!);
        else if (source?.source === 'saved') encryptedSecrets[runtimeEnv] = vault.encryptedValue(credentialVaultKey(requirement, field));
        fields.push({ id: field.id, label: field.label, runtimeEnv, source: source?.source || 'missing' });
      }
      items.push({ id: requirement.id, label: requirement.label, kind: requirement.kind, description: requirement.description, reason: requirement.reason, provider: requirement.provider || '', fields });
    } else if (requirement.kind === 'folder' || requirement.kind === 'files') {
      items.push({ id: requirement.id, label: requirement.label, kind: requirement.kind, description: requirement.description, reason: requirement.reason, files: fulfillment?.storedPaths || [], fileCount: fulfillment?.fileCount || 0 });
    } else {
      items.push({ id: requirement.id, label: requirement.label, kind: requirement.kind, description: requirement.description, reason: requirement.reason, value: fulfillment?.values?.value || fulfillment?.summary || '' });
    }
  }
  return { items, encryptedSecrets };
}

export function writeBuildRequirementBundle(workspace: string, bundle: Awaited<ReturnType<typeof buildRequirementRuntimeBundle>>, approvalHash: string) {
  const control = join(workspace, '.builder');
  mkdirSync(control, { recursive: true });
  writeFileSync(join(control, 'approved-requirements.json'), JSON.stringify({ approvalHash, requirements: bundle.items }, null, 2), { encoding: 'utf8', mode: 0o600 });
  writeFileSync(join(control, 'runtime-secrets.json'), JSON.stringify({ version: 1, secrets: bundle.encryptedSecrets }, null, 2), { encoding: 'utf8', mode: 0o600 });
  const helper = `param([Parameter(Mandatory=$true)][string]$Command)\n$ErrorActionPreference='Stop'\nAdd-Type -AssemblyName System.Security\n$bundlePath=Join-Path $PSScriptRoot 'runtime-secrets.json'\nif(Test-Path -LiteralPath $bundlePath){\n  $bundle=Get-Content -Raw -LiteralPath $bundlePath | ConvertFrom-Json\n  if($bundle.secrets){ foreach($entry in $bundle.secrets.PSObject.Properties){\n    $protected=[Convert]::FromBase64String([string]$entry.Value)\n    $clear=[Security.Cryptography.ProtectedData]::Unprotect($protected,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)\n    [Environment]::SetEnvironmentVariable($entry.Name,[Text.Encoding]::UTF8.GetString($clear),'Process')\n  }}\n}\n& powershell.exe -NoProfile -NonInteractive -Command $Command\nexit $LASTEXITCODE\n`;
  writeFileSync(join(control, 'run-with-secrets.ps1'), helper, { encoding: 'utf8', mode: 0o600 });
}
