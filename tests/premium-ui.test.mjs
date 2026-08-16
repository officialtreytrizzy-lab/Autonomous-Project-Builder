import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync('src/app/page.tsx', 'utf8');
const css = readFileSync('src/app/globals.css', 'utf8');
const layout = readFileSync('src/app/layout.tsx', 'utf8');

test('premium shell exposes the five explicit product modes', () => {
  for (const mode of ['Compose', 'Understand', 'Design', 'Approve & Build', 'Build']) assert.match(page, new RegExp(mode));
  assert.match(page, /Opening your Builder/);
});

test('first launch gives a friendly choice between a new app and an existing app', () => {
  const welcome = readFileSync('src/components/builder/FirstRunWelcome.tsx', 'utf8');
  const compose = readFileSync('src/components/builder/ComposeMode.tsx', 'utf8');
  assert.match(page, /autonomous-builder-welcome-seen/);
  assert.match(welcome, /Build a new app/);
  assert.match(welcome, /Improve an existing app/);
  assert.match(welcome, /How it works/);
  assert.match(compose, /New app/);
  assert.match(compose, /Existing app/);
  assert.match(compose, /Review what Builder understood/);
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


test('Design keeps the telemetry drawer compact while detailed HUD expansion is reserved for Understand and Build', () => {
  const hud = readFileSync('src/components/builder/LiveProgressHud.tsx', 'utf8');
  assert.match(hud, /telemetryDrawerAvailable = mode === 'Understand' \|\| mode === 'Build'/);
  assert.match(hud, /\{drawerOpen && \(/);
  assert.match(hud, /\{telemetryDrawerAvailable && \(/);
});

test('system health stays compact when healthy and project state is separate from execution', () => {
  const health = readFileSync('src/components/builder/SystemHealth.tsx', 'utf8');
  const rail = readFileSync('src/components/builder/ProjectRail.tsx', 'utf8');
  assert.match(health, /Everything ready/);
  assert.match(health, /aria-expanded/);
  assert.match(page, /project status/i);
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




test('design studio is a required visual checkpoint before new approvals', () => {
  const design = readFileSync('src/components/builder/DesignMode.tsx', 'utf8');
  const approveRoute = readFileSync('src/app/api/intakes/[intakeId]/approve/route.ts', 'utf8');
  const execution = readFileSync('src/lib/build-execution.ts', 'utf8');
  assert.match(design, /Gemini 3\.7 \+ Cloudflare Visual Design/);
  assert.match(design, /Rendered Mockups/);
  assert.match(design, /flux-2-klein-4b/);
  assert.match(design, /approved-design\.json/);
  assert.match(approveRoute, /Approve the visual design before authorizing the build/);
  assert.match(execution, /immutable visual contract/);
  assert.match(execution, /approved-design-renders/);
});



test('implementation plan import is separate from supporting references and makes typed fields optional', () => {
  const compose = readFileSync('src/components/builder/ComposeMode.tsx', 'utf8');
  assert.match(compose, /Import an implementation plan/);
  assert.match(compose, /Authoritative build source/);
  assert.match(compose, /\.pdf,\.doc,\.docx/);
  assert.match(compose, /Optional with plan/);
  assert.match(compose, /Supporting screenshots & reference files/);
  assert.match(compose, /implementation-plan/);
});
