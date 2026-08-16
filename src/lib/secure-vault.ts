import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type SecretMetadata = {
  key: string;
  label: string;
  provider: string;
  fingerprint: string;
  updatedAt: string;
};

type VaultEntry = SecretMetadata & { encrypted: string };
type VaultFile = { version: 1; secrets: Record<string, VaultEntry> };
type SecretProtector = { protect(value: string): Promise<string>; unprotect(value: string): Promise<string> };

function emptyVault(): VaultFile { return { version: 1, secrets: {} }; }

export function secretFingerprint(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export function defaultSecretVaultPath() {
  return process.env.BUILDER_SECRET_VAULT?.trim() || join(process.cwd(), '.builder', 'secure-credentials.json');
}

function dpapi(action: 'protect' | 'unprotect', value: string) {
  if (process.platform !== 'win32') throw new Error('Secure credential storage currently requires the Windows desktop Builder.');
  const protect = action === 'protect';
  const script = [
    "Add-Type -AssemblyName System.Security",
    "$inputText=[Console]::In.ReadToEnd()",
    protect
      ? "$bytes=[Text.Encoding]::UTF8.GetBytes($inputText);$protected=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($protected))"
      : "$protected=[Convert]::FromBase64String($inputText);$bytes=[Security.Cryptography.ProtectedData]::Unprotect($protected,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes))",
  ].join(';');
  return new Promise<string>((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(`Windows credential encryption failed${stderr.trim() ? `: ${stderr.trim()}` : ''}`)));
    child.stdin.end(value, 'utf8');
  });
}

const defaultProtector: SecretProtector = {
  protect: (value) => dpapi('protect', value),
  unprotect: (value) => dpapi('unprotect', value),
};

function normalizeKey(value: string) {
  const key = value.trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!key) throw new Error('Credential key is required');
  return key.slice(0, 180);
}

export class SecureVault {
  readonly path: string;
  private readonly protector: SecretProtector;

  constructor(path = defaultSecretVaultPath(), protector: SecretProtector = defaultProtector) {
    this.path = path;
    this.protector = protector;
  }

  private read(): VaultFile {
    if (!existsSync(this.path)) return emptyVault();
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as VaultFile;
      if (parsed.version !== 1 || !parsed.secrets || typeof parsed.secrets !== 'object') throw new Error('invalid vault format');
      return parsed;
    } catch {
      throw new Error('Secure credential vault is unreadable. Builder will not overwrite it.');
    }
  }

  private write(vault: VaultFile) {
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(vault, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    renameSync(temporary, this.path);
  }

  has(key: string) {
    return Boolean(this.read().secrets[normalizeKey(key)]);
  }

  metadata(key: string): SecretMetadata | null {
    const entry = this.read().secrets[normalizeKey(key)];
    if (!entry) return null;
    const { encrypted: _encrypted, ...metadata } = entry;
    return metadata;
  }

  listMetadata() {
    return Object.values(this.read().secrets).map(({ encrypted: _encrypted, ...metadata }) => metadata);
  }

  encryptedValue(key: string) {
    return this.read().secrets[normalizeKey(key)]?.encrypted || '';
  }

  async protectValue(value: string) {
    return this.protector.protect(value);
  }

  async set(input: { key: string; label: string; provider?: string; value: string }) {
    if (!input.value) throw new Error('Credential value is required');
    const key = normalizeKey(input.key);
    const vault = this.read();
    const encrypted = await this.protector.protect(input.value);
    const entry: VaultEntry = {
      key,
      label: input.label.trim().slice(0, 120) || key,
      provider: input.provider?.trim().slice(0, 120) || '',
      fingerprint: secretFingerprint(input.value),
      updatedAt: new Date().toISOString(),
      encrypted,
    };
    vault.secrets[key] = entry;
    this.write(vault);
    return this.metadata(key)!;
  }

  async get(key: string) {
    const encrypted = this.encryptedValue(key);
    return encrypted ? this.protector.unprotect(encrypted) : '';
  }

  delete(key: string) {
    const normalized = normalizeKey(key);
    const vault = this.read();
    if (!vault.secrets[normalized]) return false;
    delete vault.secrets[normalized];
    this.write(vault);
    return true;
  }
}

const globalVault = globalThis as typeof globalThis & { __autonomousBuilderSecureVault?: SecureVault };
export function getSecureVault() {
  if (!globalVault.__autonomousBuilderSecureVault) globalVault.__autonomousBuilderSecureVault = new SecureVault();
  return globalVault.__autonomousBuilderSecureVault;
}
