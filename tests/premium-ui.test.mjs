import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync('src/app/page.tsx', 'utf8');
const css = readFileSync('src/app/globals.css', 'utf8');
const layout = readFileSync('src/app/layout.tsx', 'utf8');

test('premium shell exposes the four explicit product modes', () => {
  for (const mode of ['Compose', 'Understand', 'Approve & Build', 'Build']) assert.match(page, new RegExp(mode));
  assert.match(page, /Recovering persisted state/);
});

test('visual system includes restrained glass, bundled type, and reduced motion', () => {
  assert.match(css, /--deep-space:\s*#07111f/i);
  assert.match(css, /backdrop-filter:\s*blur/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.doesNotMatch(css, /transition:\s*all/);
  assert.match(layout, /@fontsource-variable\/sora/);
  assert.match(layout, /@fontsource-variable\/manrope/);
  assert.match(layout, /@fontsource\/ibm-plex-mono/);
});

test('system health stays compact when healthy and project state is separate from execution', () => {
  const health = readFileSync('src/components/builder/SystemHealth.tsx', 'utf8');
  const rail = readFileSync('src/components/builder/ProjectRail.tsx', 'utf8');
  assert.match(health, /Everything ready/);
  assert.match(health, /aria-expanded/);
  assert.match(rail, /project state/i);
  assert.match(page, /LivingBuildSpine/);
});

test('compose accepts every approved private local source type and supports drop intake', () => {
  const compose = readFileSync('src/components/builder/ComposeMode.tsx', 'utf8');
  assert.match(compose, /\.pdf,\.doc,\.docx,\.txt,\.md,\.png,\.jpg,\.jpeg,\.webp/);
  assert.match(compose, /drop/i);
  assert.match(compose, /XMLHttpRequest/);
});

test('approval is disabled for unresolved conflicts or incomplete visual coverage', () => {
  const approval = readFileSync('src/components/builder/ApprovalMode.tsx', 'utf8');
  assert.match(approval, /unresolvedDecisions\.length\s*>\s*0/);
  assert.match(approval, /!brief\.visualCoverage\.complete/);
  assert.match(approval, /Approve & Build/);
});

test('living spine renders repair, blocked, recovered, and complete only from persisted events', () => {
  const spine = readFileSync('src/components/builder/LivingBuildSpine.tsx', 'utf8');
  for (const state of ['repair', 'blocked', 'recovered', 'complete']) assert.match(spine, new RegExp(`spine-${state}`));
  assert.doesNotMatch(spine, /Math\.random|fakeProgress|estimatedPercent/);
  assert.match(spine, /stages complete/);
});

test('restart mode waits for state reconciliation before rendering the real spine', () => {
  const buildMode = readFileSync('src/components/builder/BuildMode.tsx', 'utf8');
  assert.match(buildMode, /Recovering persisted state/);
  assert.match(buildMode, /if \(!reconciled\)/);
  assert.match(buildMode, /useProjectEvents/);
});

test('persisted UI renders before recovery calls finish and intake polling cannot overlap', () => {
  const intakeRoute = readFileSync('src/app/api/intakes/[intakeId]/route.ts', 'utf8');
  assert.match(page, /void Promise\.allSettled/);
  assert.match(page, /setTimeout\(poll/);
  assert.doesNotMatch(page, /setInterval\([^)]*refreshIntake/s);
  assert.match(page, /selectProject\(project, restoredBuilds, false\)/);
  assert.match(intakeRoute, /searchParams\.get\('reconcile'\) !== '0'/);
  assert.match(page, /refreshSequenceRef/);
  assert.match(page, /sequence !== refreshSequenceRef\.current/);
});
