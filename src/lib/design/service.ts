import { execFile as execFileCallback } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';

import { callDesignDirector, designProviderStatus } from '../ai/design-provider.ts';
import { callDesignImage, designImageModel, designImageSize, type DesignGeneratedImage } from '../ai/design-image.ts';
import { extractFirstJsonObject, type AiMessage } from '../ai/openrouter.ts';
import type { IntakeStore } from '../intake/store.ts';
import type { BuildBrief } from '../intake/types.ts';
import type { DesignContract, DesignGenerationPacket, DesignMockup, DesignReferenceFile, DesignSession, DesignTemplateOptions, DesignVisualQa } from './types.ts';

const execFile = promisify(execFileCallback);

const designBodySchema = z.object({
  summary: z.string().min(1),
  principles: z.array(z.string()).default([]),
  designSystem: z.object({
    visualLanguage: z.string().min(1),
    typography: z.array(z.string()).default([]),
    colorAndMaterial: z.array(z.string()).default([]),
    spacingAndShape: z.array(z.string()).default([]),
    elevationAndDepth: z.array(z.string()).default([]),
    motion: z.array(z.string()).default([]),
    tokens: z.record(z.string(), z.string()).optional(),
  }),
  screens: z.array(z.object({
    name: z.string().min(1),
    purpose: z.string().min(1),
    layout: z.array(z.string()).default([]),
    components: z.array(z.string()).default([]),
    states: z.array(z.string()).default([]),
    mobile: z.array(z.string()).default([]),
    desktop: z.array(z.string()).default([]),
  })).default([]),
  interactions: z.array(z.string()).default([]),
  responsiveRules: z.array(z.string()).default([]),
  accessibility: z.array(z.string()).default([]),
  assets: z.array(z.string()).default([]),
  implementationRules: z.array(z.string()).default([]),
  visualAcceptance: z.array(z.string()).default([]),
  selectedElements: z.array(z.string()).optional(),
});

const visualQaSchema = z.object({
  score: z.number().min(0).max(100),
  summary: z.string().min(1),
  strengths: z.array(z.string()).default([]),
  mismatches: z.array(z.object({
    area: z.string().min(1),
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    expected: z.string().min(1),
    observed: z.string().min(1),
    repair: z.string().min(1),
  })).default([]),
});

type AiCaller = typeof callDesignDirector;
type ImageCaller = typeof callDesignImage;

function imageExtension(mimeType: string) {
  if (mimeType.includes('jpeg')) return 'jpg';
  if (mimeType.includes('webp')) return 'webp';
  return 'png';
}

function mockupAssetDirectory(workspace: string, intakeId: string) {
  return join(workspace, '.builder', 'design-mockups', intakeId);
}

function mockupPrompt(input: {
  brief: BuildBrief;
  designSpec: string;
  elements: string[];
  label: string;
  viewport: 'desktop' | 'mobile' | 'detail';
}) {
  const viewportInstruction = input.viewport === 'mobile'
    ? 'Render a polished mobile app screen at a phone-oriented composition. Show the actual application UI edge-to-edge, not a device mockup floating in a scene.'
    : input.viewport === 'detail'
      ? 'Render a second high-detail desktop application screen focusing on the most important secondary workflow while preserving the exact same design system.'
      : 'Render the primary desktop application screen as a production UI screenshot. Show the actual app edge-to-edge, not a laptop, monitor, desk, or marketing scene.';
  return [
    'You are the visual renderer for an application design system.',
    'Generate a realistic, implementation-ready UI mockup screenshot that a software builder can reproduce 1:1.',
    viewportInstruction,
    'Do not add device frames, hands, desks, decorative browser chrome, or presentation boards.',
    'Use legible interface text, consistent spacing, coherent components, real navigation hierarchy, and a complete screen rather than an abstract concept image.',
    `Screen target: ${input.label}.`,
    `Approved product outcome: ${input.brief.content.outcome}`,
    `Selected visual elements: ${input.elements.join(', ') || 'use the approved design specification'}`,
    `Approved design specification:\n${input.designSpec}`,
  ].join('\n\n');
}

function mockupDataUrl(workspace: string, intakeId: string, mockup: DesignMockup) {
  const path = join(mockupAssetDirectory(workspace, intakeId), mockup.fileName);
  const bytes = readFileSync(path);
  return `data:${mockup.mimeType};base64,${bytes.toString('base64')}`;
}


function decodeDataUrl(dataUrl: string) {
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(dataUrl);
  if (!match) throw new Error('Invalid imported design data');
  const mimeType = match[1] || 'application/octet-stream';
  const bytes = Buffer.from(match[3], match[2] ? 'base64' : 'utf8');
  return { mimeType, bytes };
}

function importMimeType(file: DesignReferenceFile) {
  const declared = file.type?.trim().toLowerCase();
  if (declared?.includes('/')) return declared;
  const extension = extname(file.name).toLowerCase() || (declared ? `.${declared}` : '');
  if (extension === '.pdf') return 'application/pdf';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.png') return 'image/png';
  return 'application/octet-stream';
}

function inferImportedViewport(name: string): DesignMockup['viewport'] {
  const lower = name.toLowerCase();
  if (/mobile|phone|iphone|android|portrait/.test(lower)) return 'mobile';
  if (/desktop|dashboard|laptop|wide|web/.test(lower)) return 'desktop';
  return 'detail';
}

function baseDesignPrompt(input: {
  provider: 'ChatGPT' | 'Gemini';
  brief: BuildBrief;
  elements: string[];
  referenceFiles: string[];
}) {
  const { provider, brief, elements, referenceFiles } = input;
  return [
    `Create the complete high-fidelity UI design template for this approved application using ${provider} image generation.`,
    'This is not a mood board and not a marketing scene. Produce implementation-ready, full-size application screens with the UI rendered edge-to-edge.',
    'Generate separate visual designs for every required primary screen and important state. Include desktop and mobile versions where the layout materially changes. Keep one coherent design system across every image.',
    'Do not add laptop/phone device frames, hands, desks, browser marketing chrome, or decorative presentation boards unless the product itself requires them.',
    'Treat all supplied brand assets and reference images as authoritative. Preserve logos, brand identity, required information architecture, and approved product scope.',
    '',
    'APPROVED PROJECT BRIEF',
    briefText(brief),
    '',
    `SELECTED VISUAL DIRECTION: ${elements.join(', ') || 'derive a premium coherent direction from the approved brief'}`,
    `REFERENCE FILES TO ATTACH WITH THIS PROMPT: ${referenceFiles.join(', ') || 'none'}`,
    '',
    'DESIGN REQUIREMENTS',
    '- Define and visibly apply typography hierarchy, font families/weights, color tokens, spacing rhythm, corner radii, borders, shadows, glass/material treatments, icon treatment, and focus/hover/selected states.',
    '- Show real navigation hierarchy, cards, buttons, forms, tables/lists, dialogs/drawers, empty/loading/error states, and the components required by the approved flows.',
    '- Desktop must be intentionally composed for a large application window, not stretched mobile UI.',
    '- Mobile must preserve feature hierarchy while reflowing navigation, grids, tables, controls, and dense information for touch.',
    '- Make interaction affordances obvious and keep contrast/accessibility production-ready.',
    '- Use realistic interface copy based only on the approved brief. Do not invent product features.',
    '- Keep repeated components visually identical across all screens so the set can become one design system.',
    '',
    'DELIVERABLE',
    'Return full-resolution design images for the required screens. If the complete product needs multiple screens, generate them as separate images rather than shrinking an entire application into one unreadable board. Include clear screen names so the files can be imported back into Autonomous Builder as one Design Package.',
  ].join('\n');
}

function designGenerationPacket(brief: BuildBrief, elements: string[] = [], referenceFiles: string[] = []): DesignGenerationPacket {
  const screenRequirements = brief.content.flows.length
    ? brief.content.flows.map((flow) => `Design the complete interface for: ${flow}`)
    : ['Design the primary end-to-end application experience from the approved brief.'];
  const componentRequirements = [
    ...brief.content.requirements.slice(0, 12),
    'Navigation and location/context switching where required',
    'Primary and secondary actions with complete states',
    'Forms, lists, tables, cards, dialogs/drawers, and status feedback required by the approved flows',
    'Loading, empty, success, warning, and error states',
  ];
  const brandDirection = brief.content.designDirection.length
    ? brief.content.designDirection
    : ['Use a premium, coherent visual system derived from the product audience and approved brief.'];
  return {
    version: 1,
    projectOutcome: brief.content.outcome,
    screenRequirements,
    componentRequirements,
    desktopRequirements: [
      'Compose for a full desktop application window with intentional information density and hierarchy.',
      'Specify grid/column behavior, persistent versus contextual navigation, panels, tables, and overlays.',
      'Keep important workflows visible without turning the screen into a presentation board.',
    ],
    mobileRequirements: [
      'Create mobile counterparts for screens whose layout or interaction changes on a phone.',
      'Reflow dense controls, tables, grids, navigation, dialogs, and multi-column content for touch.',
      'Preserve task priority and feature parity without merely scaling the desktop screen down.',
    ],
    brandDirection,
    uxRequirements: [
      ...brief.content.acceptanceTests.slice(0, 10),
      'Every screen must be concrete enough to implement and visually compare with screenshots.',
      'Use consistent repeated components and visible interactive states across the complete package.',
      'Do not add functionality outside the approved Build Brief.',
    ],
    referenceFiles,
    chatgptPrompt: baseDesignPrompt({ provider: 'ChatGPT', brief, elements, referenceFiles }),
    geminiPrompt: baseDesignPrompt({ provider: 'Gemini', brief, elements, referenceFiles }),
    importInstructions: [
      'Export or save each generated screen as PNG, JPG, or WEBP; a multi-page PDF is also supported.',
      'Use descriptive filenames such as 01-dashboard-desktop.png and 02-dashboard-mobile.png.',
      'Import all screens together so Autonomous Builder treats them as one authoritative Design Package.',
      'The Builder will vision-analyze every imported screen, create the Design Source of Truth, and use the approved visuals for screenshot QA during implementation.',
    ],
  };
}

function importedDesignAnalysisPrompt(brief: BuildBrief, mockups: DesignMockup[], elements: string[]) {
  return [
    'The attached screens are an AUTHORITATIVE imported Design Package. Analyze them; do not redesign or replace them.',
    'Convert what is visually present into a precise Design Source of Truth that a coding agent can reproduce and a vision QA agent can verify.',
    'Inspect every supplied screen and cross-screen relationship. Explicitly capture: page/screen structure; navigation; component hierarchy; typography and inferred font characteristics; exact/estimated colors; spacing rhythm; grids; alignment; corner radii; borders; shadows; glass/material effects; cards; buttons; tables/lists/forms; icons; image placement/cropping; responsive desktop/mobile relationships; interactive states; animations/transitions that are strongly implied; and accessibility/contrast requirements.',
    'Call out uncertainty instead of inventing unseen details. Preserve the approved product scope and use the Build Brief to resolve behavior that a still image cannot show.',
    `Imported package: ${mockups.map((mockup) => `${mockup.label}${mockup.sourcePage ? ` page ${mockup.sourcePage}` : ''}`).join('; ')}`,
    `Selected visual elements: ${elements.join(', ') || 'none explicitly selected'}`,
    '',
    'APPROVED BUILD BRIEF',
    briefText(brief),
    '',
    'Return a comprehensive visual specification in clear structured prose. This analysis will be converted into the immutable approved design contract after user approval.',
  ].join('\n');
}


function briefText(brief: BuildBrief) {
  return [
    `Outcome: ${brief.content.outcome}`,
    `Users: ${brief.content.users.join('; ') || 'not specified'}`,
    `Flows: ${brief.content.flows.join('; ') || 'not specified'}`,
    `Requirements: ${brief.content.requirements.join('; ') || 'not specified'}`,
    `Existing design direction: ${brief.content.designDirection.join('; ') || 'not specified'}`,
    `Data/integrations: ${brief.content.dataAndIntegrations.join('; ') || 'not specified'}`,
    `Exclusions: ${brief.content.exclusions.join('; ') || 'none'}`,
    `Acceptance tests: ${brief.content.acceptanceTests.join('; ') || 'not specified'}`,
  ].join('\n');
}

function systemPrompt(brief: BuildBrief) {
  return `You are the visual design director inside Autonomous Project Builder. Use the connected design-reasoning model to collaborate with the user on a concrete, premium, implementable application design before any coding begins.

Your job is design only. Do not expand product scope, invent backend requirements, or start implementation. Preserve the approved Build Brief. Translate it into a precise visual system, page/screen composition, responsive behavior, interaction behavior, states, typography, materials, spacing, and motion. When the user selects design building blocks (such as Liquid Glass, Night Theme, Neon Lights, Architectural Grids) or attaches custom design references (.pdf, .fig, PowerPoint .pptx, HTML mockups), synthesize them into a cohesive, production-ready design template specification. Proactively propose clear visual choices, exact color values, and concrete component blueprints.

The final approved design will become an immutable contract for the build worker (.builder/approved-design.json), so avoid vague phrases like "modern" unless you define the exact CSS properties, tokens, and layouts.

APPROVED BUILD BRIEF
${briefText(brief)}`;
}

function contractPrompt(selectedElements: string[] = []) {
  return `Convert the entire approved design conversation and selected aesthetic building blocks (${selectedElements.join(', ') || 'default'}) into one complete implementation contract. Return JSON only, with no markdown and no text before or after it. Use exactly this shape:
{
  "summary": "...",
  "principles": ["..."],
  "designSystem": {
    "visualLanguage": "...",
    "typography": ["..."],
    "colorAndMaterial": ["..."],
    "spacingAndShape": ["..."],
    "elevationAndDepth": ["..."],
    "motion": ["..."],
    "tokens": {
      "--bg-primary": "#0c0d12",
      "--surface-glass": "rgba(255, 255, 255, 0.04)",
      "--neon-accent": "#00f0ff",
      "--neon-glow": "rgba(0, 240, 255, 0.35)",
      "--font-display": "Inter, sans-serif"
    }
  },
  "screens": [{
    "name": "...",
    "purpose": "...",
    "layout": ["..."],
    "components": ["..."],
    "states": ["..."],
    "mobile": ["..."],
    "desktop": ["..."]
  }],
  "interactions": ["..."],
  "responsiveRules": ["..."],
  "accessibility": ["..."],
  "assets": ["..."],
  "implementationRules": ["..."],
  "visualAcceptance": ["..."],
  "selectedElements": ${JSON.stringify(selectedElements)}
}
Make every instruction concrete enough to implement and visually verify. Preserve every explicit choice the user approved.`;
}

function formatTemplatePrompt(options: DesignTemplateOptions, brief: BuildBrief) {
  const elements = options.elements || [];
  const parts: string[] = [
    `Construct a complete, production-grade application visual design template for: "${brief.content.outcome}".`,
  ];

  if (elements.length > 0) {
    parts.push(`User-Selected Aesthetic & Architectural Elements:`);
    if (elements.includes('liquid-glass')) {
      parts.push(`- LIQUID GLASS: Multi-layered frosted glass surfaces, backdrop-filter blur(24px), subtle specular highlight borders (rgba(255,255,255,0.12)), translucent cards, and smooth depth elevation.`);
    }
    if (elements.includes('night-theme')) {
      parts.push(`- NIGHT THEME: Deep space / slate graphite dark mode (#090a0f, #12131a), high-contrast legible typography (#f5f7fb), and restrained ambient luminescence.`);
    }
    if (elements.includes('neon-lights')) {
      parts.push(`- NEON LIGHTS: Vibrant cyber laser accents, glowing status pills, luminous indicators (Cyan #00f0ff, Lilac #b692fe, Emerald #00ff9d, Amber #ffbe53), and subtle particle glow borders.`);
    }
    if (elements.includes('architectural-grid')) {
      parts.push(`- ARCHITECTURAL GRID: Monospace precision data metrics, modular column grids, crisp 1px hairpins, and telemetry HUD components.`);
    }
    if (elements.includes('minimalist-titanium')) {
      parts.push(`- MINIMALIST TITANIUM: High-end brushed metal surfaces, disciplined whitespace, editorial typography, and quiet luxury materials.`);
    }
  }

  if (options.referenceFiles && options.referenceFiles.length > 0) {
    parts.push(`Attached Custom Design Reference Files (${options.referenceFiles.length}):`);
    for (const file of options.referenceFiles) {
      parts.push(`- Reference: ${file.name} (${file.type.toUpperCase()}, ${(file.size / 1024).toFixed(1)} KB)`);
      if (file.extractedText) {
        parts.push(`  Extracted Content / Mockup Rules:\n  """\n  ${file.extractedText.slice(0, 4000)}\n  """`);
      }
    }
  }

  if (options.prompt?.trim()) {
    parts.push(`User Custom Direction: ${options.prompt.trim()}`);
  }

  parts.push(`Please define the full Design System (visual language, Google fonts typography, color palette tokens, glass elevation, and micro-interactions), and specify each primary screen layout, components, responsive snap rules, and interactive states.`);
  return parts.join('\n\n');
}

export class DesignService {
  private store: IntakeStore;
  private callAi: AiCaller;
  private callImage: ImageCaller;

  constructor(store: IntakeStore, callAi: AiCaller = callDesignDirector, callImage: ImageCaller = callDesignImage) {
    this.store = store;
    this.callAi = callAi;
    this.callImage = callImage;
  }

  status(intakeId: string) {
    return {
      ...designProviderStatus(),
      session: this.store.currentDesignSession(intakeId),
      contract: this.store.currentDesignContract(intakeId),
    };
  }

  packet(intakeId: string, elements: string[] = [], referenceFiles: string[] = []) {
    const { brief } = this.readyBrief(intakeId);
    return designGenerationPacket(brief, elements, referenceFiles);
  }


  private readyBrief(intakeId: string) {
    const intake = this.store.getIntake(intakeId);
    if (!intake) throw new Error(`Unknown intake: ${intakeId}`);
    const brief = this.store.currentBrief(intakeId);
    if (!brief) throw new Error('Build Brief must be ready before visual design starts');
    const unresolved = this.store.decisionsForBrief(brief.id).filter((decision) => decision.required && !decision.resolution.trim());
    if (unresolved.length) throw new Error('Resolve required Build Brief decisions before visual design starts');
    return { intake, brief };
  }

  private messages(brief: BuildBrief, session: DesignSession): AiMessage[] {
    return [
      { role: 'system', content: systemPrompt(brief) },
      ...session.messages.map((message) => ({ role: message.role, content: message.content }) as AiMessage),
    ];
  }

  private async persistImportedDesignMockups(intakeId: string, files: DesignReferenceFile[]) {
    const { intake } = this.readyBrief(intakeId);
    const project = this.store.getProject(intake.projectId);
    if (!project) throw new Error(`Unknown project: ${intake.projectId}`);
    const directory = mockupAssetDirectory(project.workspace, intakeId);
    mkdirSync(directory, { recursive: true });
    const mockups: DesignMockup[] = [];

    for (const file of files) {
      if (!file.dataUrl) continue;
      const decoded = decodeDataUrl(file.dataUrl);
      const declaredMime = importMimeType(file);
      const mimeType = decoded.mimeType === 'application/octet-stream' ? declaredMime : decoded.mimeType;
      const sourceLabel = file.name.replace(/\.[^.]+$/, '') || file.name;

      if (mimeType === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        const importId = randomUUID();
        const sourceFileName = `import-${importId}-source.pdf`;
        const sourcePath = join(directory, sourceFileName);
        writeFileSync(sourcePath, decoded.bytes, { mode: 0o600 });
        const pagePrefixName = `import-${importId}-page`;
        const pagePrefix = join(directory, pagePrefixName);
        const renderer = process.env.PDF_RENDERER_PATH?.trim() || 'pdftoppm';
        try {
          await execFile(renderer, ['-png', '-r', '150', sourcePath, pagePrefix], {
            windowsHide: true,
            timeout: 180_000,
            maxBuffer: 1024 * 1024,
          });
        } catch (error) {
          throw new Error(`Could not render imported PDF ${file.name}. ${error instanceof Error ? error.message : String(error)}`);
        }
        const pageFiles = readdirSync(directory)
          .filter((name) => name.startsWith(`${pagePrefixName}-`) && name.toLowerCase().endsWith('.png'))
          .sort((a, b) => {
            const aPage = Number(a.match(/-(\d+)\.png$/i)?.[1] || 0);
            const bPage = Number(b.match(/-(\d+)\.png$/i)?.[1] || 0);
            return aPage - bPage;
          });
        pageFiles.forEach((pageFile, index) => {
          mockups.push({
            mockupId: `mockup-${randomUUID()}`,
            label: `${sourceLabel} — page ${index + 1}`,
            viewport: inferImportedViewport(file.name),
            aspectRatio: 'source',
            imageSize: '2K',
            mimeType: 'image/png',
            fileName: pageFile,
            model: 'imported-design',
            createdAt: new Date().toISOString(),
            origin: 'imported',
            sourceName: file.name,
            sourcePage: index + 1,
          });
        });
        continue;
      }

      if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) {
        continue;
      }
      const extension = imageExtension(mimeType);
      const mockupId = `mockup-${randomUUID()}`;
      const fileName = `${mockupId}-imported.${extension}`;
      writeFileSync(join(directory, fileName), decoded.bytes, { mode: 0o600 });
      const viewport = inferImportedViewport(file.name);
      mockups.push({
        mockupId,
        label: sourceLabel,
        viewport,
        aspectRatio: viewport === 'mobile' ? '9:16' : viewport === 'desktop' ? '16:9' : 'source',
        imageSize: '2K',
        mimeType,
        fileName,
        model: 'imported-design',
        createdAt: new Date().toISOString(),
        origin: 'imported',
        sourceName: file.name,
      });
    }

    if (!mockups.length) {
      throw new Error('Import at least one PNG, JPG, WEBP, or PDF design screen');
    }
    return { project, mockups };
  }

  async importDesign(intakeId: string, files: DesignReferenceFile[], selectedElements: string[] = []) {
    const { intake, brief } = this.readyBrief(intakeId);
    const status = designProviderStatus();
    const model = status.model;
    const { project, mockups } = await this.persistImportedDesignMockups(intakeId, files);
    const userMessage = `Imported ${mockups.length} authoritative design screen${mockups.length === 1 ? '' : 's'} as one Design Package. Analyze every screen and convert it into the Design Source of Truth without redesigning it.`;
    let session = this.store.appendDesignMessage(intakeId, { role: 'user', content: userMessage, model });
    session = this.store.setDesignMockups(intakeId, mockups, model);

    const content: AiMessage['content'] = [
      { type: 'text', text: importedDesignAnalysisPrompt(brief, mockups, selectedElements) },
      ...mockups.flatMap((mockup) => [
        { type: 'text' as const, text: `AUTHORITATIVE IMPORTED DESIGN: ${mockup.label}` },
        { type: 'image_url' as const, image_url: { url: mockupDataUrl(project.workspace, intakeId, mockup) } },
      ]),
    ];
    const reply = await this.callAi({
      messages: [{ role: 'system', content: systemPrompt(brief) }, { role: 'user', content }],
      model,
      maxTokens: 5000,
      temperature: 0.15,
    });
    session = this.store.appendDesignMessage(intakeId, { role: 'assistant', content: reply, model });
    session = this.store.setDesignMockups(intakeId, mockups, model);
    this.store.appendEvent(intake.projectId, {
      category: 'design-imported',
      stage: 'design',
      severity: 'success',
      source: 'design-studio',
      target: 'user',
      humanMessage: `Imported and vision-analyzed ${mockups.length} design screen${mockups.length === 1 ? '' : 's'} as the Design Source of Truth.`,
      technicalPayload: {
        model,
        sourceFiles: files.map((file) => file.name),
        mockupCount: mockups.length,
        origin: 'imported',
      },
    });
    return { session, reply, mockups };
  }


  private async renderTemplateMockups(input: {
    intakeId: string;
    designSpec: string;
    elements: string[];
    referenceFiles: DesignReferenceFile[];
  }) {
    const { intake, brief } = this.readyBrief(input.intakeId);
    const project = this.store.getProject(intake.projectId);
    if (!project) throw new Error(`Unknown project: ${intake.projectId}`);

    const directory = mockupAssetDirectory(project.workspace, input.intakeId);
    mkdirSync(directory, { recursive: true });
    const imageModel = designImageModel();
    const imageSize = designImageSize();
    const referenceDataUrls = input.referenceFiles
      .map((file) => file.dataUrl)
      .filter((value): value is string => Boolean(value && value.startsWith('data:')))
      .slice(0, 8);
    const primaryFlow = brief.content.flows[0] || 'Primary application experience';
    const secondaryFlow = brief.content.flows[1] || brief.content.flows[0] || 'Primary secondary workflow';
    const targets: Array<{ label: string; viewport: 'desktop' | 'mobile' | 'detail'; aspectRatio: string }> = [
      { label: `Primary desktop - ${primaryFlow}`, viewport: 'desktop', aspectRatio: '16:9' },
      { label: `Secondary desktop - ${secondaryFlow}`, viewport: 'detail', aspectRatio: '16:9' },
      { label: `Mobile - ${primaryFlow}`, viewport: 'mobile', aspectRatio: '9:16' },
    ];

    const renders = await Promise.all(targets.map(async (target) => {
      const generated: DesignGeneratedImage = await this.callImage({
        model: imageModel,
        prompt: mockupPrompt({
          brief,
          designSpec: input.designSpec,
          elements: input.elements,
          label: target.label,
          viewport: target.viewport,
        }),
        aspectRatio: target.aspectRatio,
        imageSize,
        referenceDataUrls,
      });
      const mockupId = `mockup-${randomUUID()}`;
      const extension = imageExtension(generated.mimeType);
      const fileName = `${mockupId}-${target.viewport}.${extension}`;
      writeFileSync(join(directory, fileName), Buffer.from(generated.data, 'base64'), { mode: 0o600 });
      const mockup: DesignMockup = {
        mockupId,
        label: target.label,
        viewport: target.viewport,
        aspectRatio: target.aspectRatio,
        imageSize,
        mimeType: generated.mimeType,
        fileName,
        model: generated.model,
        createdAt: new Date().toISOString(),
        origin: 'generated',
      };
      return mockup;
    }));

    return this.store.setDesignMockups(input.intakeId, renders, imageModel);
  }
  async chat(intakeId: string, content: string, options?: DesignTemplateOptions) {
    const text = content.trim();
    if (!text && !options?.constructTemplate && !options?.referenceFiles?.length && !options?.elements?.length) {
      throw new Error('Design message cannot be empty');
    }
    const { intake, brief } = this.readyBrief(intakeId);
    const status = designProviderStatus();
    const model = status.model;

    const messageText = options?.constructTemplate || options?.elements?.length || options?.referenceFiles?.length
      ? formatTemplatePrompt({ ...options, prompt: text }, brief)
      : text;

    let session = this.store.appendDesignMessage(intakeId, { role: 'user', content: messageText, model });

    const aiMessages = this.messages(brief, session);

    // If reference files contain image data URLs, attach multimodal image parts to the last message
    const imageFiles = (options?.referenceFiles || []).filter((f) => f.dataUrl && f.dataUrl.startsWith('data:image/'));
    if (imageFiles.length > 0) {
      const lastMsg = aiMessages[aiMessages.length - 1];
      if (lastMsg && typeof lastMsg.content === 'string') {
        const textContent = lastMsg.content;
        lastMsg.content = [
          { type: 'text', text: textContent },
          ...imageFiles.map((file) => ({
            type: 'image_url' as const,
            image_url: { url: file.dataUrl! },
          })),
        ];
      }
    }

    const reply = await this.callAi({
      messages: aiMessages,
      model,
      maxTokens: 4096,
      temperature: 0.45,
    });

    session = this.store.appendDesignMessage(intakeId, { role: 'assistant', content: reply, model });
    if (options?.constructTemplate) {
      session = await this.renderTemplateMockups({
        intakeId,
        designSpec: reply,
        elements: options.elements || [],
        referenceFiles: options.referenceFiles || [],
      });
    }
    this.store.appendEvent(intake.projectId, {
      category: 'design',
      stage: 'design',
      severity: 'info',
      source: 'design-studio',
      target: 'user',
      humanMessage: options?.constructTemplate
        ? 'The connected design tools created and analyzed the visual app template.'
        : 'The design reasoning layer updated the visual design direction.',
      technicalPayload: {
        model,
        imageModel: options?.constructTemplate ? designImageModel() : undefined,
        mockupCount: session.mockups?.length || 0,
        messageCount: session.messages.length,
        elements: options?.elements,
      },
    });
    return { session, reply, mockups: session.mockups || [] };
  }

  async approve(intakeId: string, selectedElements: string[] = []) {
    const { intake, brief } = this.readyBrief(intakeId);
    const session = this.store.currentDesignSession(intakeId);
    if (!session || !session.messages.some((message) => message.role === 'assistant')) {
      throw new Error('Collaborate on the visual design before approving it');
    }
    if (!session.mockups?.length) {
      throw new Error('Generate or import at least one visual design screen before approving the design');
    }
    const status = designProviderStatus();
    const model = status.model;
    const provider = model.toLowerCase().includes('gemini') ? 'gemini' : 'openrouter';
    const project = this.store.getProject(intake.projectId);
    if (!project) throw new Error(`Unknown project: ${intake.projectId}`);
    const contractContent: AiMessage['content'] = [
      { type: 'text', text: `${contractPrompt(selectedElements)}\n\nThe approved visual references below are authoritative. Derive the contract from both the design conversation and the actual images; do not replace or reinterpret their visible design.` },
      ...session.mockups.flatMap((mockup) => [
        { type: 'text' as const, text: `APPROVED DESIGN SOURCE: ${mockup.label}` },
        { type: 'image_url' as const, image_url: { url: mockupDataUrl(project.workspace, intakeId, mockup) } },
      ]),
    ];
    const text = await this.callAi({
      messages: [...this.messages(brief, session), { role: 'user', content: contractContent }],
      model,
      maxTokens: 5000,
      temperature: 0.15,
    });
    const body = designBodySchema.parse(extractFirstJsonObject(text));
    const approvedAt = new Date().toISOString();
    const contract: DesignContract = {
      id: `design-${randomUUID()}`,
      intakeId,
      projectId: intake.projectId,
      version: this.store.nextDesignVersion(intakeId),
      status: 'approved',
      provider,
      model,
      approvedAt,
      selectedElements: selectedElements.length ? selectedElements : body.selectedElements,
      mockups: session.mockups,
      ...body,
    };
    this.store.saveDesignContract(contract);
    this.store.rememberSemanticSegment(intake.projectId, {
      kind: 'design',
      title: `Approved visual design v${contract.version}`,
      content: `${contract.summary}\nPrinciples: ${contract.principles.join('; ')}\nImplementation rules: ${contract.implementationRules.join('; ')}`,
      tags: ['design', 'approved', 'visual-contract', ...contract.principles.slice(0, 6)],
      sourceRef: contract.id,
      confidence: 1,
    });
    this.store.appendEvent(intake.projectId, {
      category: 'design-approved',
      stage: 'design',
      severity: 'success',
      source: 'design-studio',
      target: 'user',
      humanMessage: 'Locked the approved visual design contract.',
      technicalPayload: { designId: contract.id, version: contract.version, model },
    });
    return contract;
  }

  async reviewImplementation(intakeId: string, screenshots: Array<{ label: string; dataUrl: string }>, threshold = Number(process.env.BUILDER_DESIGN_QA_THRESHOLD || 98)) {
    const { intake } = this.readyBrief(intakeId);
    const contract = this.store.currentDesignContract(intakeId);
    if (!contract) throw new Error('An approved visual design is required before implementation QA');
    if (!screenshots.length) throw new Error('At least one implementation screenshot is required for visual QA');
    const status = designProviderStatus();
    const model = status.model;
    const project = this.store.getProject(intake.projectId);
    if (!project) throw new Error(`Unknown project: ${intake.projectId}`);
    const prompt = `You are the connected vision reviewer performing strict 1:1 visual QA against an immutable approved application design contract. Compare only what is visually observable in the supplied implementation screenshots to the contract. Do not reward functionality that is not visible. Penalize layout, hierarchy, typography, spacing, materials, component styling, responsive behavior, and visual-state mismatches. A score of 98 or above means the implementation is effectively faithful enough to ship. Return JSON only with this exact shape: {"score":0,"summary":"...","strengths":["..."],"mismatches":[{"area":"...","severity":"low|medium|high|critical","expected":"...","observed":"...","repair":"..."}]}.\n\nAPPROVED DESIGN CONTRACT\n${JSON.stringify(contract)}`;
    const approvedMockupParts: AiMessage['content'] = (contract.mockups || []).flatMap((mockup) => [
      { type: 'text' as const, text: `APPROVED REFERENCE MOCKUP: ${mockup.label}` },
      { type: 'image_url' as const, image_url: { url: mockupDataUrl(project.workspace, intakeId, mockup) } },
    ]);
    const content: AiMessage['content'] = [
      { type: 'text', text: `${prompt}\n\nThe approved reference mockups below are the authoritative pixel-level visual target. The contract text resolves behavior and responsive details that are not visible in still images.` },
      ...approvedMockupParts,
      ...screenshots.flatMap((shot) => [
        { type: 'text' as const, text: `FINISHED IMPLEMENTATION SCREENSHOT: ${shot.label}` },
        { type: 'image_url' as const, image_url: { url: shot.dataUrl } },
      ]),
    ];
    const raw = await this.callAi({ messages: [{ role: 'user', content }], model, maxTokens: 3400, temperature: 0.1 });
    const parsed = visualQaSchema.parse(extractFirstJsonObject(raw));
    const qa: DesignVisualQa = {
      id: `design-qa-${randomUUID()}`,
      intakeId,
      projectId: intake.projectId,
      designId: contract.id,
      model,
      score: parsed.score,
      threshold,
      passed: parsed.score >= threshold && !parsed.mismatches.some((item) => item.severity === 'critical'),
      summary: parsed.summary,
      strengths: parsed.strengths,
      mismatches: parsed.mismatches,
      screenshots: screenshots.map((shot) => shot.label),
      createdAt: new Date().toISOString(),
    };
    this.store.rememberSemanticSegment(intake.projectId, {
      kind: 'verification',
      title: `Visual QA ${qa.score}/100`,
      content: `${qa.summary}\nMismatches: ${qa.mismatches.map((item) => `${item.area}: ${item.repair}`).join('; ') || 'none'}`,
      tags: ['visual-qa', qa.passed ? 'passed' : 'repair-required', `score-${Math.round(qa.score)}`],
      sourceRef: qa.id,
      confidence: 1,
    });
    this.store.appendEvent(intake.projectId, {
      category: qa.passed ? 'design-qa-passed' : 'design-qa-repair',
      stage: 'verification',
      severity: qa.passed ? 'success' : 'warning',
      source: 'design-studio',
      target: 'computer-2',
      humanMessage: qa.passed ? `Visual design match passed at ${qa.score}/100.` : `Visual design match is ${qa.score}/100 and needs repair.`,
      technicalPayload: qa,
    });
    return qa;
  }
}
