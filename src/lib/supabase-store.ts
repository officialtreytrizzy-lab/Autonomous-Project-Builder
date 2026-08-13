import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { BuildAnalysis, BuildRequest } from './builder';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

export type PersistedBuild = {
  id: string;
  projectId?: string;
  name: string;
  objective: string;
  repository?: string;
  backend: string;
  deployment: string;
  workflow: string;
  planId?: string;
  jobId?: string;
  status: string;
  stage: string;
  readinessScore: number;
  ingredients: unknown[];
  steps: unknown[];
  logs: unknown[];
  result?: unknown;
  createdAt: string;
  updatedAt: string;
};

let supabaseInstance: SupabaseClient | null = null;

function getSupabase(): SupabaseClient | null {
  if (supabaseInstance) return supabaseInstance;
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    supabaseInstance = createClient(url, key, { auth: { persistSession: false } });
    return supabaseInstance;
  } catch {
    return null;
  }
}

// ---------- Filesystem-backed fallback (persists across restarts) ----------

const STORE_DIR = process.env.BUILDER_STORE_DIR || join(process.cwd(), '.builder-store');
const STORE_FILE = join(STORE_DIR, 'builds.json');

function ensureStoreDir() {
  if (!existsSync(/*turbopackIgnore: true*/ STORE_DIR)) {
    try { mkdirSync(STORE_DIR, { recursive: true }); } catch {}
  }
}

function readLocalStore(): Map<string, PersistedBuild> {
  ensureStoreDir();
  try {
    if (existsSync(/*turbopackIgnore: true*/ STORE_FILE)) {
      const data = JSON.parse(readFileSync(/*turbopackIgnore: true*/ STORE_FILE, 'utf-8')) as Record<string, PersistedBuild>;
      return new Map(Object.entries(data));
    }
  } catch {}
  return new Map();
}

function writeLocalStore(store: Map<string, PersistedBuild>) {
  ensureStoreDir();
  try {
    const obj: Record<string, PersistedBuild> = {};
    for (const [k, v] of store) obj[k] = v;
    writeFileSync(STORE_FILE, JSON.stringify(obj, null, 2), 'utf-8');
  } catch {}
}

// In-memory cache hydrated from filesystem on first access
let localStoreCache: Map<string, PersistedBuild> | null = null;

function getLocalStore(): Map<string, PersistedBuild> {
  if (!localStoreCache) localStoreCache = readLocalStore();
  return localStoreCache;
}

/**
 * Save or update a build record in Supabase (or filesystem-backed fallback storage)
 */
export async function persistBuild(build: {
  id: string;
  request: BuildRequest;
  analysis: BuildAnalysis;
  planId?: string;
  jobId?: string;
  status: string;
  logs?: unknown[];
  result?: unknown;
}): Promise<{ ok: boolean; source: 'supabase' | 'local'; id: string }> {
  const now = new Date().toISOString();
  const record: PersistedBuild = {
    id: build.id,
    name: build.request.name || 'Untitled Build',
    objective: build.request.objective || '',
    repository: build.request.repository || '',
    backend: build.request.backend || 'none',
    deployment: build.request.deployment || 'local',
    workflow: build.request.workflow || 'none',
    planId: build.planId,
    jobId: build.jobId,
    status: build.status,
    stage: build.analysis.stage,
    readinessScore: Math.round(
      ((build.analysis.greenCount + build.analysis.yellowCount * 0.5) /
        Math.max(1, build.analysis.ingredients.length)) *
        100,
    ),
    ingredients: build.analysis.ingredients,
    steps: build.analysis.steps,
    logs: build.logs || [],
    result: build.result,
    createdAt: now,
    updatedAt: now,
  };

  const supabase = getSupabase();
  if (supabase) {
    try {
      const { error } = await supabase.from('builds').upsert(record);
      if (!error) return { ok: true, source: 'supabase', id: build.id };
    } catch {
      // Graceful fallback to local store on network/table error
    }
  }

  const store = getLocalStore();
  // Preserve createdAt from existing record if updating
  const existing = store.get(build.id);
  if (existing) record.createdAt = existing.createdAt;
  store.set(build.id, record);
  writeLocalStore(store);
  return { ok: true, source: 'local', id: build.id };
}

/**
 * Retrieve a build record by ID
 */
export async function getPersistedBuild(id: string): Promise<PersistedBuild | null> {
  const supabase = getSupabase();
  if (supabase) {
    try {
      const { data, error } = await supabase.from('builds').select('*').eq('id', id).single();
      if (!error && data) return data as PersistedBuild;
    } catch {}
  }
  return getLocalStore().get(id) || null;
}

/**
 * List recent build records
 */
export async function listPersistedBuilds(limit = 10): Promise<PersistedBuild[]> {
  const supabase = getSupabase();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('builds')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (!error && data) return data as PersistedBuild[];
    } catch {}
  }
  return Array.from(getLocalStore().values())
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}
