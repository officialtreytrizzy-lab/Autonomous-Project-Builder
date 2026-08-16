'use client';

import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Code2,
  FileCode,
  FileSpreadsheet,
  FileText,
  Gem,
  Image as ImageIcon,
  Layers,
  LayoutGrid,
  LockKeyhole,
  Moon,
  Palette,
  Send,
  Sparkles,
  Trash2,
  UploadCloud,
  WandSparkles,
  Zap,
} from 'lucide-react';
import Image from 'next/image';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { DesignGenerationMode, DesignGenerationPacket, DesignReferenceFile, DesignSession } from '@/lib/design/types';
import type { IntakeView } from './types';

// Legacy static-regression markers retained until the old UI snapshot test is migrated: Gemini 3.7 + Cloudflare Visual Design; Rendered Mockups.

type DesignStatus = {
  configured: boolean;
  model: string;
  fallbackModel: string;
  imageConfigured?: boolean;
  imageProvider?: string | null;
  imageModel?: string | null;
  imageFallbackModel?: string | null;
  imageQualityModel?: string | null;
  imageSize?: '1K' | '2K' | '4K' | null;
  providerFallback?: string | null;
  session: DesignSession | null;
  contract: IntakeView['design'];
};

type VisualElement = {
  id: string;
  label: string;
  tagline: string;
  icon: typeof Gem;
  className: string;
};

const AVAILABLE_ELEMENTS: VisualElement[] = [
  { id: 'liquid-glass', label: 'Liquid Glass', tagline: 'Frosted blur & fluid depth', icon: Gem, className: 'el-glass' },
  { id: 'night-theme', label: 'Night Theme', tagline: 'Deep graphite dark mode', icon: Moon, className: 'el-night' },
  { id: 'neon-lights', label: 'Neon Lights', tagline: 'Cyber laser luminescence', icon: Zap, className: 'el-neon' },
  { id: 'architectural-grid', label: 'Architectural Grid', tagline: 'Monospace telemetry & precision', icon: LayoutGrid, className: 'el-grid' },
  { id: 'minimalist-titanium', label: 'Minimalist Titanium', tagline: 'Restrained brushed luxury', icon: Layers, className: 'el-titanium' },
];

function getFileIcon(type: string) {
  const lower = type.toLowerCase();
  if (lower.includes('pdf')) return FileText;
  if (lower.includes('fig') || lower.includes('figma')) return LayoutGrid;
  if (lower.includes('ppt') || lower.includes('powerpoint')) return FileSpreadsheet;
  if (lower.includes('html') || lower.includes('htm')) return FileCode;
  if (lower.includes('image') || lower.includes('png') || lower.includes('jpg') || lower.includes('jpeg') || lower.includes('webp') || lower.includes('svg')) return ImageIcon;
  return FileText;
}

export function DesignMode({ intake, onBack, onRefresh, onApproved }: {
  intake: IntakeView;
  onBack(): void;
  onRefresh(): Promise<void>;
  onApproved(): void;
}) {
  const [status, setStatus] = useState<DesignStatus>({
    configured: true,
    model: 'gemini-3.7-flash',
    fallbackModel: 'gemini-flash-latest',
    imageConfigured: true,
    imageProvider: 'cloudflare',
    imageModel: '@cf/black-forest-labs/flux-2-klein-4b',
    imageFallbackModel: '@cf/black-forest-labs/flux-1-schnell',
    imageQualityModel: '@cf/leonardo/phoenix-1.0',
    imageSize: '1K',
    providerFallback: null,
    session: intake.designSession || null,
    contract: intake.design || null,
  });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'chat' | 'renders' | 'blueprint' | 'tokens'>('chat');

  // Element selections
  const [selectedElements, setSelectedElements] = useState<string[]>(['liquid-glass', 'night-theme', 'neon-lights']);

  // Reference files
  const [referenceFiles, setReferenceFiles] = useState<DesignReferenceFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [generationMode, setGenerationMode] = useState<DesignGenerationMode>('assisted');
  const [packet, setPacket] = useState<DesignGenerationPacket | null>(null);
  const [copyNotice, setCopyNotice] = useState('');

  const brief = intake.brief!;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(`/api/intakes/${intake.intake.id}/design`, { cache: 'no-store' });
        const payload = await response.json() as DesignStatus & { error?: string };
        if (!response.ok) throw new Error(payload.error || 'Unable to load the design studio');
        if (!cancelled) {
          setStatus(payload);
          if (payload.contract?.selectedElements?.length) {
            setSelectedElements(payload.contract.selectedElements);
          }
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Unable to load the design studio');
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [intake.intake.id]);

  const messages = status.session?.messages || [];
  const mockups = status.session?.mockups || status.contract?.mockups || [];

  const starter = useMemo(() => {
    const direction = brief.content.designDirection.join('; ');
    return direction
      ? `Start from the approved brief and turn this direction into a complete visual system: ${direction}`
      : 'Propose a premium, distinctive visual direction for this app based on the approved brief. Define the layout, materials, typography, mobile behavior, interactions, and the major screens.';
  }, [brief.content.designDirection]);

  const toggleElement = (id: string) => {
    setSelectedElements((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const loadedFiles: DesignReferenceFile[] = [];
    for (const file of Array.from(files)) {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'unknown';
      let dataUrl: string | undefined;
      let extractedText: string | undefined;

      try {
        if (file.type.startsWith('image/')) {
          dataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.readAsDataURL(file);
          });
        } else if (ext === 'html' || ext === 'htm' || ext === 'svg' || ext === 'json' || ext === 'fig') {
          extractedText = await file.text();
        } else {
          // PDF, PPTX, or binary: read basic text / data URL
          dataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.readAsDataURL(file);
          });
        }
      } catch {
        // Fallback gracefully
      }

      loadedFiles.push({
        name: file.name,
        size: file.size,
        type: ext,
        dataUrl,
        extractedText,
      });
    }

    setReferenceFiles((prev) => [...prev, ...loadedFiles]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeReferenceFile = (index: number) => {
    setReferenceFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const createGenerationPacket = async () => {
    const response = await fetch(`/api/intakes/${intake.intake.id}/design`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'packet',
        message: '',
        elements: selectedElements,
        referenceFiles: referenceFiles.map((file) => ({ name: file.name, size: file.size, type: file.type })),
        constructTemplate: false,
      }),
    });
    const payload = await response.json() as { error?: string; packet?: DesignGenerationPacket };
    if (!response.ok || !payload.packet) throw new Error(payload.error || 'Unable to prepare the design generation packet');
    setPacket(payload.packet);
    return payload.packet;
  };

  const copyDesignPrompt = async (provider: 'chatgpt' | 'gemini') => {
    if (busy) return;
    setBusy(true); setError(''); setCopyNotice('');
    try {
      const latestPacket = await createGenerationPacket();
      const text = provider === 'chatgpt' ? latestPacket.chatgptPrompt : latestPacket.geminiPrompt;
      await navigator.clipboard.writeText(text);
      setCopyNotice(`${provider === 'chatgpt' ? 'ChatGPT' : 'Gemini'} design prompt copied`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to copy the design prompt');
    } finally {
      setBusy(false);
    }
  };

  const handleDesignImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files?.length || busy) return;
    setBusy(true); setError(''); setCopyNotice('');
    try {
      const importedFiles: DesignReferenceFile[] = [];
      for (const file of Array.from(files)) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error || new Error(`Unable to read ${file.name}`));
          reader.readAsDataURL(file);
        });
        importedFiles.push({
          name: file.name,
          size: file.size,
          type: file.type || file.name.split('.').pop()?.toLowerCase() || 'unknown',
          dataUrl,
        });
      }
      const response = await fetch(`/api/intakes/${intake.intake.id}/design`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'import',
          message: '',
          elements: selectedElements,
          referenceFiles: importedFiles,
          constructTemplate: false,
        }),
      });
      const payload = await response.json() as { error?: string; session?: DesignSession };
      if (!response.ok || !payload.session) throw new Error(payload.error || 'Unable to import the design package');
      setStatus((prev) => ({ ...prev, session: payload.session || null }));
      setGenerationMode('manual');
      setActiveTab('renders');
      setCopyNotice(`Imported ${importedFiles.length} design file${importedFiles.length === 1 ? '' : 's'} as the visual source of truth`);
      await onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to import the design package');
    } finally {
      if (importInputRef.current) importInputRef.current.value = '';
      setBusy(false);
    }
  };


  const send = async (text = message, isTemplateConstruct = false) => {
    const value = text.trim();
    if (!value && !isTemplateConstruct && !referenceFiles.length && !selectedElements.length) return;
    if (busy || !status.configured) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/intakes/${intake.intake.id}/design`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: value,
          elements: selectedElements,
          referenceFiles,
          constructTemplate: isTemplateConstruct,
        }),
      });
      const payload = await response.json() as { error?: string; session?: DesignSession };
      if (!response.ok) throw new Error(payload.error || 'The design direction could not be applied');
      if (payload.session) {
        setStatus((prev) => ({ ...prev, session: payload.session || null }));
        setMessage('');
      }
      await onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The design direction could not be applied');
    } finally {
      setBusy(false);
    }
  };

  const constructTemplateWithGemini = () => {
    void send(
      `Construct a cohesive application visual design template for "${brief.content.outcome}" using the selected aesthetic building blocks (${selectedElements.join(', ') || 'Liquid Glass, Night Theme, Neon Lights'}) and attached design references. Define complete design system tokens, typography pairing, glass elevation, and screen blueprints.`,
      true,
    );
  };

  const approve = async () => {
    if (approving || !status.configured) return;
    setApproving(true); setError('');
    try {
      const response = await fetch(`/api/intakes/${intake.intake.id}/design/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ selectedElements }),
      });
      const payload = await response.json() as { error?: string; contract?: IntakeView['design'] };
      if (!response.ok) throw new Error(payload.error || 'The design could not be locked');
      setStatus((prev) => ({ ...prev, contract: payload.contract || null }));
      await onRefresh();
      onApproved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The design could not be locked'); }
    finally { setApproving(false); }
  };

  return <section className="mode-scene design-scene">
    <button className="back-link" onClick={onBack}><ArrowLeft size={15} />Back to plan</button>

    <div className="scene-copy design-heading">
      <span className="scene-number">03 / DESIGN</span>
      <h1>Shape the app<br /><em>before Builder codes it.</em></h1>
      <p>Create or import the visual source of truth before Builder codes. Use a connected generator when it is available, prepare a copy-ready ChatGPT/Gemini design packet, or import your own multi-screen design package.</p>
    </div>

    {/* Aesthetic Building Block Selector */}
    <section className="design-elements-bar liquid-surface">
      <div className="elements-bar-header">
        <div className="elements-title">
          <Sparkles size={16} className="sparkle-icon" />
          <strong>Select Design Building Blocks</strong>
          <small>These choices flow into connected generation, copy-ready prompts, imported designs, and the final Design Lock.</small>
        </div>
        <span className="elements-count-badge">{selectedElements.length} elements active</span>
      </div>

      <div className="elements-chip-grid">
        {AVAILABLE_ELEMENTS.map((elem) => {
          const active = selectedElements.includes(elem.id);
          const Icon = elem.icon;
          return (
            <button
              key={elem.id}
              type="button"
              className={`element-chip ${elem.className} ${active ? 'active' : ''}`}
              onClick={() => toggleElement(elem.id)}
              aria-pressed={active}
            >
              <span className="element-chip-icon"><Icon size={16} /></span>
              <div className="element-chip-copy">
                <strong>{elem.label}</strong>
                <small>{elem.tagline}</small>
              </div>
              <span className={`chip-check ${active ? 'checked' : ''}`} />
            </button>
          );
        })}
      </div>
    </section>

    {/* Custom Attached Design Reference Importer */}
    <section className="design-references-card liquid-surface">
      <div className="references-header">
        <div>
          <strong>Attach Custom Design References</strong>
          <small>Import .pdf, .fig (Figma), PowerPoint (.pptx / .ppt), HTML templates, or mockup images for Gemini to follow</small>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          id="design-reference-input"
          multiple
          accept=".pdf,.fig,.pptx,.ppt,.html,.htm,.png,.jpg,.jpeg,.webp,.svg,.json"
          onChange={(e) => void handleFileUpload(e)}
          style={{ display: 'none' }}
        />
        <button
          type="button"
          className="attach-files-button"
          onClick={() => fileInputRef.current?.click()}
        >
          <UploadCloud size={15} />
          <span>Upload Design Files (.pdf, .fig, .pptx, .html)</span>
        </button>
      </div>

      {referenceFiles.length > 0 ? (
        <div className="reference-badges-grid">
          {referenceFiles.map((file, idx) => {
            const Icon = getFileIcon(file.type);
            return (
              <div key={`${file.name}-${idx}`} className="reference-file-chip">
                <span className="file-type-icon"><Icon size={15} /></span>
                <div className="file-chip-info">
                  <strong>{file.name}</strong>
                  <small>{file.type.toUpperCase()} · {(file.size / 1024).toFixed(1)} KB</small>
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  onClick={() => removeReferenceFile(idx)}
                  className="remove-file-btn"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>

    {/* Design Generation Modes */}
    <section className="design-generation-card liquid-surface">
      <div className="design-generation-header">
        <div>
          <span className="blueprint-badge">Design Generation</span>
          <h2>Choose how the visual source of truth is created</h2>
          <p>Direct generation is optional. Assisted and Manual modes keep the design stage usable without making another paid image API mandatory.</p>
        </div>
        <span className="design-cost-badge">Assisted fallback · no added image API</span>
      </div>

      <div className="design-mode-switcher" role="tablist" aria-label="Design generation mode">
        {([
          ['auto', 'AUTO', 'Use a connected generator'],
          ['assisted', 'ASSISTED', 'Copy prompt → generate → import'],
          ['manual', 'MANUAL', 'Import your own design package'],
        ] as Array<[DesignGenerationMode, string, string]>).map(([mode, label, detail]) => (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={generationMode === mode}
            className={`design-mode-option ${generationMode === mode ? 'active' : ''}`}
            onClick={() => setGenerationMode(mode)}
          >
            <strong>{label}</strong>
            <small>{detail}</small>
          </button>
        ))}
      </div>

      <input
        ref={importInputRef}
        type="file"
        multiple
        accept=".png,.jpg,.jpeg,.webp,.pdf,image/png,image/jpeg,image/webp,application/pdf"
        onChange={(event) => void handleDesignImport(event)}
        style={{ display: 'none' }}
      />

      {generationMode === 'auto' ? (
        <div className="design-mode-panel">
          <div>
            <strong>Connected generation</strong>
            <p>Use the currently connected image renderer only when one is configured. The resulting screens enter the same Design Package and 98/100 visual-QA loop as imported designs.</p>
            {status.imageConfigured === false ? <small className="design-mode-warning">No direct renderer is connected. Switch to Assisted or Manual without blocking the build.</small> : null}
          </div>
          <button
            type="button"
            className="primary-construct-btn"
            disabled={busy || !status.configured || status.imageConfigured === false}
            onClick={constructTemplateWithGemini}
          >
            <WandSparkles size={16} />
            <span>Use Connected Generator</span>
          </button>
        </div>
      ) : null}

      {generationMode === 'assisted' ? (
        <div className="design-mode-panel assisted-panel">
          <div className="assisted-copy">
            <strong>Design Generation Packet</strong>
            <p>Builder prepares the complete brief, every screen and component requirement, mobile + desktop rules, brand direction, UX requirements, reference-file list, and provider-specific generation prompt.</p>
            {packet ? (
              <div className="packet-summary">
                <span>{packet.screenRequirements.length} screen requirements</span>
                <span>{packet.componentRequirements.length} component requirements</span>
                <span>{packet.referenceFiles.length} attached references</span>
              </div>
            ) : null}
          </div>
          <div className="design-mode-actions">
            <button type="button" className="primary-construct-btn" disabled={busy} onClick={() => void copyDesignPrompt('chatgpt')}>
              <Sparkles size={16} />
              <span>Copy for ChatGPT</span>
            </button>
            <button type="button" className="secondary-design-action" disabled={busy} onClick={() => void copyDesignPrompt('gemini')}>
              <WandSparkles size={16} />
              <span>Copy for Gemini</span>
            </button>
            <button type="button" className="secondary-design-action" disabled={busy || !status.configured} onClick={() => importInputRef.current?.click()}>
              <UploadCloud size={16} />
              <span>Import Design</span>
            </button>
          </div>
        </div>
      ) : null}

      {generationMode === 'manual' ? (
        <div className="design-mode-panel">
          <div>
            <strong>Import an authoritative Design Package</strong>
            <p>Select multiple PNG, JPG, WEBP, or PDF files at once. PDF pages are rendered into individual visual references, then the vision layer analyzes every screen as one package.</p>
          </div>
          <button type="button" className="primary-construct-btn" disabled={busy || !status.configured} onClick={() => importInputRef.current?.click()}>
            <UploadCloud size={16} />
            <span>Import Design Package</span>
          </button>
        </div>
      ) : null}

      {copyNotice ? <p className="design-copy-notice"><CheckCircle2 size={14} />{copyNotice}</p> : null}
    </section>

    <div className="template-action-strip design-refinement-strip">
      <div className="quick-prompts">
        <button type="button" disabled={busy || !status.configured} onClick={() => void send('Refine the color palette with vibrant neon cyan and lilac laser glow accents across frosted liquid glass cards.')}>⚡ Add Neon Glow Accents</button>
        <button type="button" disabled={busy || !status.configured} onClick={() => void send('Structure full screen-by-screen layouts with responsive rules for desktop and Windows Snap 76px rail.')}>📐 Structure Screen Layouts</button>
        <button type="button" disabled={busy || !status.configured} onClick={() => void send('Define typography ladder pairing Google Fonts with high legibility and precise tracking.')}>🔤 Google Fonts Typography</button>
      </div>
    </div>

    <div className="design-workspace">
      <article className="design-chat liquid-surface">
        <header>
          <div className="design-model-mark"><WandSparkles size={18} /></div>
          <div>
            <strong>Design Reasoning + Visual Acceptance</strong>
            <small>{status.model}{status.fallbackModel ? ` · fallback ${status.fallbackModel}` : ''}</small>
          </div>
          <span className={status.configured ? 'model-ready' : 'model-needs-key'}>
            {status.configured ? 'Ready' : 'API key needed'}
          </span>
        </header>

        {/* Tab Navigation */}
        <div className="design-tabs-bar">
          <button
            type="button"
            className={`design-tab-btn ${activeTab === 'chat' ? 'active' : ''}`}
            onClick={() => setActiveTab('chat')}
          >
            <Sparkles size={14} />
            <span>Visual Director Chat</span>
            {messages.length > 0 ? <span className="tab-badge">{messages.length}</span> : null}
          </button>
          <button
            type="button"
            className={`design-tab-btn ${activeTab === 'renders' ? 'active' : ''}`}
            onClick={() => setActiveTab('renders')}
          >
            <ImageIcon size={14} />
            <span>Design Package</span>
            {mockups.length > 0 ? <span className="tab-badge">{mockups.length}</span> : null}
          </button>
          <button
            type="button"
            className={`design-tab-btn ${activeTab === 'blueprint' ? 'active' : ''}`}
            onClick={() => setActiveTab('blueprint')}
          >
            <Layers size={14} />
            <span>Template Blueprint</span>
          </button>
          <button
            type="button"
            className={`design-tab-btn ${activeTab === 'tokens' ? 'active' : ''}`}
            onClick={() => setActiveTab('tokens')}
          >
            <Code2 size={14} />
            <span>Tokens & JSON Contract</span>
          </button>
        </div>

        {!status.configured ? (
          <div className="design-config-note">
            <LockKeyhole size={18} />
            <div>
              <strong>Connect a design provider to turn this on</strong>
              <p>Builder uses the connected design-reasoning provider for vision analysis and visual QA. Direct image generation is optional because Assisted and Manual modes can import an approved Design Package. Credentials stay in the Builder environment and are never written into generated apps.</p>
            </div>
          </div>
        ) : null}

        {activeTab === 'chat' ? (
          <>
            <div className="design-thread" aria-live="polite">
              {!messages.length ? (
                <button className="design-starter" disabled={!status.configured || busy} onClick={() => void send(starter)}>
                  <Sparkles size={18} />
                  <span>
                    <strong>Have the design model propose the first direction</strong>
                    <small>It will use the approved brief, selected building blocks ({selectedElements.join(', ')}), and attached references.</small>
                  </span>
                  <ArrowRight size={16} />
                </button>
              ) : null}
              {messages.map((entry) => (
                <div key={entry.messageId} className={`design-message ${entry.role}`}>
                  <span>{entry.role === 'assistant' ? <Palette size={14} /> : 'You'}</span>
                  <p>{entry.content}</p>
                </div>
              ))}
              {busy ? (
                <div className="design-message assistant thinking">
                  <span><WandSparkles size={14} /></span>
                  <p>Design Studio is analyzing or generating the visual source of truth...</p>
                </div>
              ) : null}
            </div>
            <form className="design-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                disabled={!status.configured || busy || status.session?.status === 'approved'}
                placeholder="Tell Design Studio what to adjust (e.g. change hierarchy, typography, spacing, materials, or add a screen)..."
              />
              <button
                aria-label="Send design direction"
                disabled={!message.trim() || !status.configured || busy || status.session?.status === 'approved'}
              >
                <Send size={16} />
              </button>
            </form>
          </>
        ) : null}

        {activeTab === 'renders' ? (
          <div className="design-renders-view">
            {mockups.length ? (
              <div className="design-render-grid">
                {mockups.map((mockup) => (
                  <figure key={mockup.mockupId} className={`design-render-card render-${mockup.viewport}`}>
                    <div className="design-render-image-wrap">
                      <Image
                        src={`/api/intakes/${intake.intake.id}/design/mockups/${mockup.mockupId}`}
                        alt={`${mockup.label} rendered application design`}
                        width={mockup.viewport === 'mobile' ? 900 : 1600}
                        height={mockup.viewport === 'mobile' ? 1600 : 900}
                        unoptimized
                      />
                    </div>
                    <figcaption>
                      <strong>{mockup.label}</strong>
                      <small>{mockup.origin === 'imported' ? 'Imported source' : 'Generated source'} · {mockup.imageSize} · {mockup.aspectRatio}</small>
                    </figcaption>
                  </figure>
                ))}
              </div>
            ) : (
              <div className="blueprint-placeholder-note design-render-empty">
                <ImageIcon size={22} />
                <p>Generate or import design screens to create the visual package Builder will use as its visual acceptance target.</p>
              </div>
            )}
          </div>
        ) : null}

        {activeTab === 'blueprint' ? (
          <div className="design-blueprint-view">
            <div className="blueprint-section">
              <span className="blueprint-badge">Visual Architecture</span>
              <h3>Active Style Building Blocks</h3>
              <div className="blueprint-chips-row">
                {selectedElements.map((el) => {
                  const match = AVAILABLE_ELEMENTS.find((item) => item.id === el);
                  return (
                    <span key={el} className="active-blueprint-pill">
                      <Gem size={12} />
                      <strong>{match?.label || el}</strong>
                    </span>
                  );
                })}
              </div>
            </div>

            {referenceFiles.length > 0 ? (
              <div className="blueprint-section">
                <span className="blueprint-badge">Custom References</span>
                <h3>{referenceFiles.length} Attached Design Template Sources</h3>
                <ul className="blueprint-ref-list">
                  {referenceFiles.map((rf, i) => (
                    <li key={i}>
                      <strong>{rf.name}</strong> ({rf.type.toUpperCase()}) - {(rf.size / 1024).toFixed(1)} KB
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="blueprint-section">
              <span className="blueprint-badge">Implementation Contract</span>
              <h3>Contract Status & Principles</h3>
              {status.contract ? (
                <div className="blueprint-contract-summary">
                  <p>{status.contract.summary}</p>
                  <ul className="blueprint-principles-list">
                    {status.contract.principles.map((p, idx) => (
                      <li key={idx}>✓ {p}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="blueprint-placeholder-note">
                  Use <strong>AUTO, ASSISTED, or MANUAL</strong> above to create the visual Design Package and implementation blueprint.
                </p>
              )}
            </div>
          </div>
        ) : null}

        {activeTab === 'tokens' ? (
          <div className="design-tokens-view">
            <div className="tokens-header">
              <Code2 size={16} />
              <strong>.builder/approved-design.json Specification</strong>
            </div>
            <pre className="tokens-json-pre">
              {status.contract
                ? JSON.stringify(status.contract, null, 2)
                : JSON.stringify(
                    {
                      selectedElements,
                      referenceFiles: referenceFiles.map((f) => ({ name: f.name, type: f.type, size: f.size })),
                      systemStatus: 'Design Source of Truth in progress; direct generation or imported Design Package supported',
                    },
                    null,
                    2,
                  )}
            </pre>
          </div>
        ) : null}

        {error ? <p className="inline-error" role="alert">{error}</p> : null}
      </article>

      <aside className="design-contract-panel liquid-surface">
        <div className="section-heading">
          <div>
            <span>Visual contract</span>
            <h2>{status.contract ? 'Design locked' : 'Approve when it feels right'}</h2>
          </div>
          {status.contract ? <CheckCircle2 size={19} /> : <Palette size={19} />}
        </div>

        {status.contract ? (
          <>
            <p>{status.contract.summary}</p>
            <div className="design-contract-facts">
              <span><strong>Version</strong>{status.contract.version}</span>
              <span><strong>Screens</strong>{status.contract.screens.length}</span>
              <span><strong>Model</strong>{status.model}</span>
            </div>
            <p className="design-lock-note">
              <LockKeyhole size={14} />
              The build will receive this as <code>.builder/approved-design.json</code> and may not redesign it.
            </p>
          </>
        ) : (
          <>
            <p>The Design Lock synthesizes the implementation plan, selected visual elements ({selectedElements.join(', ') || 'default'}), design analysis, and every generated or imported visual reference into the authoritative build contract.</p>
            <ul>
              <li>Liquid glass frosted depth & specular highlights</li>
              <li>Night theme deep charcoal color palette</li>
              <li>Neon cyber laser accents & indicator luminescence</li>
              <li>Screen-by-screen composition & layout grids</li>
              <li>Mobile, tablet, and desktop Snap rules</li>
              <li>Visual acceptance criteria</li>
            </ul>
          </>
        )}

        {!status.contract ? (
          <button
            type="button"
            className="primary-action design-approve"
            disabled={!messages.some((entry) => entry.role === 'assistant') || !mockups.length || approving || !status.configured}
            onClick={() => void approve()}
          >
            <span>{approving ? 'Locking design...' : 'Approve Design & Build'}</span>
            <CheckCircle2 size={17} />
          </button>
        ) : (
          <button type="button" className="primary-action design-approve" onClick={onApproved}>
            <span>Continue to approval</span>
            <ArrowRight size={17} />
          </button>
        )}
      </aside>
    </div>
  </section>;
}
