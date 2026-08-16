import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { secureWindowOptions } from '../desktop/runtime.mjs';

test('premium desktop shell keeps the native Windows frame and Snap Layout dimensions', () => {
  const options = secureWindowOptions();
  assert.equal(options.width, 1440);
  assert.equal(options.height, 900);
  assert.equal(options.minWidth, 760);
  assert.equal(options.minHeight, 640);
  assert.equal(options.frame, undefined);
  assert.equal(options.titleBarStyle, undefined);
  assert.equal(options.webPreferences.contextIsolation, true);
});

test('premium V5 uses product typography, restrained graphite surfaces, and a calm shell', () => {
  const css = readFileSync('src/app/globals.css', 'utf8');
  const page = readFileSync('src/app/page.tsx', 'utf8');
  const rail = readFileSync('src/components/builder/ProjectRail.tsx', 'utf8');
  assert.match(css, /PREMIUM V5 PRODUCT SYSTEM/);
  assert.match(css, /--win-nav-width:244px/);
  assert.match(css, /--win-command-height:58px/);
  assert.match(css, /--theme-bg:#0b0b0e/);
  assert.match(css, /--win-font:var\(--font-body\)/);
  assert.match(css, /\.ambient\{display:none!important\}/);
  assert.match(css, /\.desktop-footer\{display:none!important\}/);
  assert.match(page, /desktop-page-context/);
  for (const icon of ['FilePenLine', 'SearchCheck', 'Palette', 'BadgeCheck', 'Hammer']) assert.match(rail, new RegExp(icon));
});

test('narrow Windows Snap layout remains a persistent 76px icon rail', () => {
  const css = readFileSync('src/app/globals.css', 'utf8');
  assert.match(css, /@media\(max-width:980px\)\{:root\{--win-nav-width:76px\}/);
  assert.match(css, /\.mode-copy,\.mode-trailing\{display:none!important\}/);
  assert.match(css, /\.mode-link\{width:48px!important;min-height:46px!important\}/);
});

test('Compose is a premium workstation instead of a giant marketing hero', () => {
  const css = readFileSync('src/app/globals.css', 'utf8');
  assert.match(css, /Premium workstation refinement/);
  assert.match(css, /\.compose-scene\{display:block!important\}/);
  assert.match(css, /\.compose-surface\{max-width:1080px!important/);
  assert.match(css, /\.target-family-grid\{grid-template-columns:repeat\(7,minmax\(0,1fr\)\)!important\}/);
  assert.match(css, /\.target-choice small\{display:none!important\}/);
  assert.match(css, /\.field-label input\{min-height:44px!important/);
  assert.match(css, /@keyframes premium-scene-in/);
});

test('startup guard keeps unsolicited close requests from killing the desktop bootstrap', () => {
  const main = readFileSync('desktop/main.mjs', 'utf8');
  const startup = readFileSync('desktop/startup.html', 'utf8');
  assert.match(main, /Menu\.setApplicationMenu\(null\)/);
  assert.match(main, /startup-close-blocked/);
  assert.match(main, /if \(!shuttingDown && !windowCanClose\)/);
  assert.match(main, /windowCanClose = true/);
  assert.match(main, /desktop-host\.log/);
  assert.match(startup, /Preparing your workspace/);
  assert.match(startup, /#0b0b0e/);
  assert.match(startup, /#aa92ff/);
  assert.doesNotMatch(startup, /Getting your Builder ready/);
});
