export const BUILD_TARGET_FAMILIES = ['apple', 'android', 'tv-streaming', 'windows', 'macos', 'web', 'cross-platform'] as const;
export type BuildTargetFamily = (typeof BUILD_TARGET_FAMILIES)[number];

export const BUILD_DEVICE_FAMILIES = [
  'iphone', 'ipad', 'apple-tv', 'mac-desktop',
  'android-phone-tablet', 'android-tv', 'fire-tv', 'chromecast-receiver',
  'windows-desktop', 'mobile-web', 'desktop-web', 'responsive-web',
  'cross-platform-mobile', 'cross-platform-desktop', 'hybrid-web',
] as const;
export type BuildDeviceFamily = (typeof BUILD_DEVICE_FAMILIES)[number];

export const BUILD_RUNTIMES = [
  'ios', 'ipados', 'tvos', 'macos', 'android', 'android-tv', 'fire-os',
  'cast-web-receiver', 'windows', 'browser', 'hybrid-native', 'cross-desktop',
] as const;
export type BuildRuntime = (typeof BUILD_RUNTIMES)[number];

export const BUILD_DELIVERABLES = [
  'ipa', 'apk', 'aab', 'exe', 'msix', 'dmg', 'pkg',
  'mobile-web', 'desktop-web', 'responsive-web', 'pwa', 'cast-receiver',
  'ipa-apk', 'exe-dmg', 'hybrid-web',
] as const;
export type BuildDeliverable = (typeof BUILD_DELIVERABLES)[number];

export type BuildTargetSelection = {
  family: BuildTargetFamily;
  device: BuildDeviceFamily;
  runtime: BuildRuntime;
  deliverable: BuildDeliverable;
};

type Option = { id: string; label: string; detail: string };
type DeviceOption = Option & { runtimes: Array<{ id: BuildRuntime; label: string; detail: string; deliverables: BuildDeliverable[] }> };

type FamilyOption = Option & { id: BuildTargetFamily; devices: DeviceOption[] };

export const TARGET_CATALOG: FamilyOption[] = [
  {
    id: 'apple', label: 'Apple', detail: 'iPhone, iPad, Apple TV, or Mac',
    devices: [
      { id: 'iphone', label: 'iPhone', detail: 'Native iPhone application', runtimes: [{ id: 'ios', label: 'iOS', detail: 'Apple mobile runtime', deliverables: ['ipa'] }] },
      { id: 'ipad', label: 'iPad', detail: 'Native iPad application', runtimes: [{ id: 'ipados', label: 'iPadOS', detail: 'Apple tablet runtime', deliverables: ['ipa'] }] },
      { id: 'apple-tv', label: 'Apple TV', detail: '10-foot television experience', runtimes: [{ id: 'tvos', label: 'tvOS', detail: 'Apple TV runtime', deliverables: ['ipa'] }] },
      { id: 'mac-desktop', label: 'Mac', detail: 'Native macOS desktop application', runtimes: [{ id: 'macos', label: 'macOS', detail: 'Apple desktop runtime', deliverables: ['dmg', 'pkg'] }] },
    ],
  },
  {
    id: 'android', label: 'Android', detail: 'Phones, tablets, Android TV, or Google TV',
    devices: [
      { id: 'android-phone-tablet', label: 'Phone / Tablet', detail: 'Android mobile application', runtimes: [{ id: 'android', label: 'Android', detail: 'Android mobile runtime', deliverables: ['apk', 'aab'] }] },
      { id: 'android-tv', label: 'Android TV / Google TV', detail: 'Remote-first 10-foot Android experience', runtimes: [{ id: 'android-tv', label: 'Android TV', detail: 'Android television runtime', deliverables: ['apk', 'aab'] }] },
    ],
  },
  {
    id: 'tv-streaming', label: 'TV & Streaming', detail: 'Fire TV, Chromecast, Android TV, or Apple TV',
    devices: [
      { id: 'fire-tv', label: 'Fire TV / Firestick', detail: 'Amazon Fire TV application', runtimes: [{ id: 'fire-os', label: 'Fire OS', detail: 'Amazon television runtime', deliverables: ['apk'] }] },
      { id: 'chromecast-receiver', label: 'Chromecast Receiver', detail: 'Cast-enabled receiver experience', runtimes: [{ id: 'cast-web-receiver', label: 'Cast Web Receiver', detail: 'Receiver web runtime for casting', deliverables: ['cast-receiver'] }] },
      { id: 'android-tv', label: 'Android TV / Google TV', detail: 'Android television application', runtimes: [{ id: 'android-tv', label: 'Android TV', detail: 'Android television runtime', deliverables: ['apk', 'aab'] }] },
      { id: 'apple-tv', label: 'Apple TV', detail: 'Apple television application', runtimes: [{ id: 'tvos', label: 'tvOS', detail: 'Apple TV runtime', deliverables: ['ipa'] }] },
    ],
  },
  {
    id: 'windows', label: 'Windows', detail: 'Installable Windows desktop application',
    devices: [{ id: 'windows-desktop', label: 'Windows Desktop', detail: 'Mouse, keyboard, and desktop-window experience', runtimes: [{ id: 'windows', label: 'Windows', detail: 'Windows desktop runtime', deliverables: ['exe', 'msix'] }] }],
  },
  {
    id: 'macos', label: 'macOS', detail: 'Installable Mac desktop application',
    devices: [{ id: 'mac-desktop', label: 'Mac Desktop', detail: 'Native or packaged macOS desktop experience', runtimes: [{ id: 'macos', label: 'macOS', detail: 'Apple desktop runtime', deliverables: ['dmg', 'pkg'] }] }],
  },
  {
    id: 'web', label: 'Web', detail: 'Mobile, desktop, responsive, or installable PWA',
    devices: [
      { id: 'mobile-web', label: 'Mobile Web', detail: 'Touch-first browser experience', runtimes: [{ id: 'browser', label: 'Browser / PWA', detail: 'Modern mobile browser runtime', deliverables: ['mobile-web', 'pwa'] }] },
      { id: 'desktop-web', label: 'Desktop Web', detail: 'Large-screen browser experience', runtimes: [{ id: 'browser', label: 'Browser / PWA', detail: 'Modern desktop browser runtime', deliverables: ['desktop-web', 'pwa'] }] },
      { id: 'responsive-web', label: 'Responsive Web', detail: 'One web app across mobile and desktop', runtimes: [{ id: 'browser', label: 'Browser / PWA', detail: 'Responsive browser runtime', deliverables: ['responsive-web', 'pwa'] }] },
    ],
  },
  {
    id: 'cross-platform', label: 'Cross-platform', detail: 'One project targeting multiple device families',
    devices: [
      { id: 'cross-platform-mobile', label: 'iOS + Android', detail: 'Shared mobile codebase with native packages', runtimes: [{ id: 'hybrid-native', label: 'Hybrid Native', detail: 'Shared app shell targeting iOS and Android', deliverables: ['ipa-apk'] }] },
      { id: 'cross-platform-desktop', label: 'Windows + macOS', detail: 'Shared desktop codebase with platform installers', runtimes: [{ id: 'cross-desktop', label: 'Cross-platform Desktop', detail: 'Shared desktop runtime', deliverables: ['exe-dmg'] }] },
      { id: 'hybrid-web', label: 'Hybrid Web App', detail: 'Installable web core that adapts across devices', runtimes: [{ id: 'browser', label: 'Browser / PWA', detail: 'Web runtime with installable app behavior', deliverables: ['hybrid-web', 'pwa'] }] },
    ],
  },
];

export const DELIVERABLE_LABELS: Record<BuildDeliverable, string> = {
  ipa: 'IPA', apk: 'APK', aab: 'Android App Bundle (AAB)', exe: 'EXE', msix: 'MSIX', dmg: 'DMG', pkg: 'PKG',
  'mobile-web': 'Mobile Web', 'desktop-web': 'Desktop Web', 'responsive-web': 'Responsive Web', pwa: 'Progressive Web App (PWA)',
  'cast-receiver': 'Chromecast Web Receiver', 'ipa-apk': 'IPA + APK', 'exe-dmg': 'EXE + DMG', 'hybrid-web': 'Hybrid Web App',
};

export function familyOption(id?: string) { return TARGET_CATALOG.find((entry) => entry.id === id); }
export function deviceOption(family?: string, device?: string) { return familyOption(family)?.devices.find((entry) => entry.id === device); }
export function runtimeOption(family?: string, device?: string, runtime?: string) { return deviceOption(family, device)?.runtimes.find((entry) => entry.id === runtime); }

export function defaultTarget(): BuildTargetSelection {
  return { family: 'web', device: 'responsive-web', runtime: 'browser', deliverable: 'responsive-web' };
}

export function isValidBuildTarget(value: unknown): value is BuildTargetSelection {
  if (!value || typeof value !== 'object') return false;
  const target = value as Partial<BuildTargetSelection>;
  const runtime = runtimeOption(target.family, target.device, target.runtime);
  return Boolean(runtime && runtime.deliverables.includes(target.deliverable as BuildDeliverable));
}

export function targetLabel(target?: BuildTargetSelection | null) {
  if (!target || !isValidBuildTarget(target)) return 'Responsive Web';
  const family = familyOption(target.family)!;
  const device = deviceOption(target.family, target.device)!;
  const runtime = runtimeOption(target.family, target.device, target.runtime)!;
  return `${family.label} · ${device.label} · ${runtime.label} · ${DELIVERABLE_LABELS[target.deliverable]}`;
}

export function targetNeedsAppleBuildHost(target?: BuildTargetSelection | null) {
  return Boolean(target && ['ipa', 'dmg', 'pkg', 'ipa-apk', 'exe-dmg'].includes(target.deliverable) && ['ios', 'ipados', 'tvos', 'macos', 'hybrid-native', 'cross-desktop'].includes(target.runtime));
}

export function targetNeedsAndroidToolchain(target?: BuildTargetSelection | null) {
  return Boolean(target && ['apk', 'aab', 'ipa-apk'].includes(target.deliverable));
}

export function targetIsWebRuntime(target?: BuildTargetSelection | null) {
  return !target || ['mobile-web', 'desktop-web', 'responsive-web', 'pwa', 'hybrid-web', 'cast-receiver'].includes(target.deliverable);
}


export function requiredArtifactExtensionGroups(target?: BuildTargetSelection | null): string[][] {
  if (!target || targetIsWebRuntime(target)) return [];
  const groups: Partial<Record<BuildDeliverable, string[][]>> = {
    ipa: [['.ipa']], apk: [['.apk']], aab: [['.aab']], exe: [['.exe']], msix: [['.msix', '.msixbundle']], dmg: [['.dmg']], pkg: [['.pkg']],
    'ipa-apk': [['.ipa'], ['.apk', '.aab']], 'exe-dmg': [['.exe', '.msix'], ['.dmg', '.pkg']],
  };
  return groups[target.deliverable] || [];
}
