import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  TARGET_CATALOG,
  defaultTarget,
  isValidBuildTarget,
  requiredArtifactExtensionGroups,
  targetIsWebRuntime,
  targetLabel,
} from '../src/lib/target-platform.ts';

test('target catalog covers requested device-first build families', () => {
  const ids = TARGET_CATALOG.map((entry) => entry.id);
  assert.deepEqual(ids, ['apple', 'android', 'tv-streaming', 'windows', 'macos', 'web', 'cross-platform']);
  const tv = TARGET_CATALOG.find((entry) => entry.id === 'tv-streaming');
  assert.ok(tv?.devices.some((entry) => entry.id === 'fire-tv'));
  assert.ok(tv?.devices.some((entry) => entry.id === 'chromecast-receiver'));
  assert.ok(tv?.devices.some((entry) => entry.id === 'android-tv'));
});

test('target combinations distinguish runtime from final deliverable', () => {
  const fire = { family: 'tv-streaming', device: 'fire-tv', runtime: 'fire-os', deliverable: 'apk' };
  const windows = { family: 'windows', device: 'windows-desktop', runtime: 'windows', deliverable: 'exe' };
  const apple = { family: 'apple', device: 'iphone', runtime: 'ios', deliverable: 'ipa' };
  assert.equal(isValidBuildTarget(fire), true);
  assert.equal(isValidBuildTarget(windows), true);
  assert.equal(isValidBuildTarget(apple), true);
  assert.match(targetLabel(fire), /Fire TV \/ Firestick.*APK/);
  assert.deepEqual(requiredArtifactExtensionGroups(windows), [['.exe']]);
  assert.deepEqual(requiredArtifactExtensionGroups(apple), [['.ipa']]);
});

test('responsive web stays the backwards-compatible default while remaining explicit', () => {
  const target = defaultTarget();
  assert.equal(isValidBuildTarget(target), true);
  assert.equal(targetIsWebRuntime(target), true);
  assert.equal(target.deliverable, 'responsive-web');
});

test('app ships night v4 by default with light v3 toggle and target selector', () => {
  const layout = readFileSync(new URL('../src/app/layout.tsx', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../src/app/page.tsx', import.meta.url), 'utf8');
  const compose = readFileSync(new URL('../src/components/builder/ComposeMode.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8');
  assert.match(layout, /data-theme="night"/);
  assert.match(page, /theme-toggle/);
  assert.match(page, /'night' \| 'light'/);
  assert.match(compose, /Build for a device first/);
  assert.match(compose, /Platform.*Device.*OS \/ Runtime.*Deliverable/s);
  assert.match(css, /V3 \/ V4 FROSTED GLASS PRODUCT THEME/);
  assert.match(css, /html\[data-theme='light'\]/);
  assert.match(css, /html\[data-theme='night'\]/);
});
