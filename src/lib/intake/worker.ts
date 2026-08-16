import type { BuildBriefContent, EvidenceRecord } from './types.ts';
import type { IntakeStore, StoredSourceManifestItem } from './store.ts';
import { createGeminiVisionClient, synthesizeBrief } from './vision.ts';
import { processDocument } from './documents.ts';
import { geminiConfigured } from '../ai/gemini.ts';

type PageEvidenceInput = Omit<EvidenceRecord, 'evidenceId' | 'createdAt'>;

type SourceProcessorContext = {
  completedPages: Set<number>;
  checkpointPage(page: number, evidence: PageEvidenceInput[]): Promise<void>;
};

type SourceResult = { totalPages: number; inspectedPages: number };

type WorkerDependencies = {
  store: IntakeStore;
  intakeId: string;
  processSource?: (source: StoredSourceManifestItem, context: SourceProcessorContext) => Promise<SourceResult>;
  synthesize?: (evidence: EvidenceRecord[]) => Promise<{
    brief: BuildBriefContent;
    contradictions: string[];
    uncertainties: string[];
    requiredInputs?: import('./types.ts').BuildInputRequirement[];
  }>;
};

function emit(store: IntakeStore, projectId: string, input: {
  category: string;
  stage: string;
  severity: 'info' | 'success' | 'warning' | 'error';
  humanMessage: string;
  technicalPayload?: unknown;
}) {
  return store.appendEvent(projectId, { ...input, source: 'intake-worker', target: 'computer-2' });
}

async function defaultSourceProcessor(source: StoredSourceManifestItem, context: SourceProcessorContext): Promise<SourceResult> {
  const visualSource = !['text/plain', 'text/markdown'].includes(source.mimeType);
  if (visualSource && !geminiConfigured()) {
    throw new Error('Gemini API document vision is not configured. Add GEMINI_API_KEY to the Builder environment.');
  }
  const result = await processDocument(source, {
    completedPages: context.completedPages,
    visionClient: visualSource ? createGeminiVisionClient() : undefined,
  });
  for (const page of [...new Set(result.evidence.map((item) => item.page).filter((page): page is number => typeof page === 'number'))]) {
    if (context.completedPages.has(page)) continue;
    await context.checkpointPage(page, result.evidence.filter((item) => item.page === page).map(({ evidenceId: _id, createdAt: _createdAt, ...item }) => item));
  }
  if (result.blockingIssues.length) throw new Error(result.blockingIssues.map((issue) => `Page ${issue.page}: ${issue.message}`).join('; '));
  return { totalPages: result.visualCoverage.totalPages, inspectedPages: result.visualCoverage.inspectedPages };
}

async function defaultSynthesize(evidence: EvidenceRecord[]) {
  if (!evidence.length) throw new Error('No understandable project evidence was produced.');
  if (!geminiConfigured()) {
    throw new Error('Gemini API document understanding is not configured. Add GEMINI_API_KEY to the Builder environment.');
  }
  return synthesizeBrief(evidence, createGeminiVisionClient());
}

function synthesizeManualObjective(objective: string) {
  const normalized = objective.trim();
  const outcome = normalized.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || 'Build the requested product.';
  return {
    brief: {
      outcome,
      users: ['Users and audiences explicitly defined in the authoritative manual objective.'],
      flows: ['Implement every explicit user flow, routing rule, and conversion path in the authoritative manual objective.'],
      requirements: [normalized],
      designDirection: ['Follow every explicit visual, responsive, accessibility, and brand direction in the authoritative manual objective.'],
      dataAndIntegrations: ['Follow every explicit data, configuration, SEO, external service, and integration rule in the authoritative manual objective.'],
      exclusions: ['Respect every explicit exclusion, anti-requirement, and do-not-invent rule in the authoritative manual objective.'],
      acceptanceTests: ['Pass every explicit required test, production rule, and acceptance condition in the authoritative manual objective.'],
      assumptions: ['The user-provided manual objective is authoritative and must not be silently weakened or overridden.'],
    },
    contradictions: [],
    uncertainties: [],
    requiredInputs: [],
  };
}
export async function runIntakeWorker(deps: WorkerDependencies) {
  const intake = deps.store.getIntake(deps.intakeId);
  if (!intake) throw new Error(`Unknown intake: ${deps.intakeId}`);
  const project = deps.store.getProject(intake.projectId);
  if (!project) throw new Error(`Unknown project: ${intake.projectId}`);
  const existingBrief = deps.store.currentBrief(intake.id);
  const currentSources = deps.store.currentSources(intake.id).filter((item) => item.availability === 'available');
  const existingBriefIsComplete = existingBrief?.visualCoverage.complete && currentSources.every((source) => (
    source.processingStatus === 'complete' && Number(source.pageCount || 0) === Number(source.inspectedPageCount || 0)
  ));
  if (existingBrief && existingBriefIsComplete) {
    const hasUnresolvedDecisions = deps.store.decisionsForBrief(existingBrief.id).some((decision) => decision.required && !decision.resolution.trim());
    deps.store.updateIntake(intake.id, { status: hasUnresolvedDecisions ? 'awaiting-resolution' : 'awaiting-approval' });
    deps.store.updateProject(project.id, { state: 'awaiting-approval' });
    return existingBrief;
  }
  deps.store.updateIntake(intake.id, { status: 'extracting' });
  deps.store.updateProject(project.id, { state: 'understanding' });
  emit(deps.store, project.id, { category: 'intake', stage: 'understanding', severity: 'info', humanMessage: 'Understanding project evidence.' });

  try {
    let totalPages = 0;
    let inspectedPages = 0;
    for (const source of currentSources) {
      const completedPages = new Set(
        deps.store.evidenceForBriefSource(intake.id, source.sourceId)
          .filter((item) => item.revisionId === source.revisionId && item.kind === 'page-overview')
          .map((item) => item.page)
          .filter((page): page is number => typeof page === 'number'),
      );
      deps.store.updateIntake(intake.id, { status: 'inspecting' });
      deps.store.updateSourceRevision(source.revisionId, { processingStatus: 'processing' });
      const result = await (deps.processSource || defaultSourceProcessor)(source, {
        completedPages,
        async checkpointPage(page, pageEvidence) {
          for (const evidence of pageEvidence) deps.store.recordEvidence(evidence);
          emit(deps.store, project.id, {
            category: 'checkpoint', stage: 'visual-inspection', severity: 'success',
            humanMessage: `Inspected ${source.originalFilename}, page ${page}.`,
            technicalPayload: { sourceId: source.sourceId, revisionId: source.revisionId, page },
          });
        },
      });
      totalPages += result.totalPages;
      inspectedPages += result.inspectedPages;
      deps.store.updateSourceRevision(source.revisionId, {
        processingStatus: result.totalPages === result.inspectedPages ? 'complete' : 'blocked',
        pageCount: result.totalPages,
        inspectedPageCount: result.inspectedPages,
      });
    }

    deps.store.updateIntake(intake.id, { status: 'synthesizing' });
    let allEvidence = deps.store.evidenceForIntake(intake.id);
    if (!allEvidence.length && currentSources.length === 0 && project.inputMode === 'manual' && project.objective.trim()) {
      deps.store.recordEvidence({
        intakeId: intake.id,
        sourceId: 'manual-project-objective',
        revisionId: `manual-project-objective:${project.id}`,
        kind: 'user-text',
        content: project.objective.trim(),
        relationships: ['source-role:manual-objective', 'authoritative:user-supplied'],
        confidence: 1,
        processingMethod: 'manual-project-objective',
      });
      allEvidence = deps.store.evidenceForIntake(intake.id);
    }
    const implementationPlanSourceIds = new Set(currentSources.filter((source) => source.role === 'implementation-plan').map((source) => source.sourceId));
    const synthesisEvidence = allEvidence.map((item) => implementationPlanSourceIds.has(item.sourceId)
      ? { ...item, relationships: ['source-role:implementation-plan', ...item.relationships.filter((relationship) => relationship !== 'source-role:implementation-plan')] }
      : item);
    const synthesis = deps.synthesize
      ? await deps.synthesize(synthesisEvidence)
      : currentSources.length === 0 && project.inputMode === 'manual' && project.objective.trim()
        ? synthesizeManualObjective(project.objective)
        : await defaultSynthesize(synthesisEvidence);
    const brief = deps.store.createBriefVersion(intake.id, synthesis.brief, {
      totalPages,
      inspectedPages,
      complete: totalPages === inspectedPages,
    }, synthesis.requiredInputs || []);
    for (const contradiction of synthesis.contradictions) deps.store.addDecision(brief.id, { question: contradiction, required: true });
    for (const uncertainty of synthesis.uncertainties) deps.store.addDecision(brief.id, { question: uncertainty, required: true });
    const hasDecisions = synthesis.contradictions.length + synthesis.uncertainties.length > 0;
    deps.store.updateIntake(intake.id, { status: hasDecisions ? 'awaiting-resolution' : 'awaiting-approval' });
    deps.store.updateProject(project.id, { state: 'awaiting-approval' });
    emit(deps.store, project.id, {
      category: 'brief', stage: 'understanding', severity: hasDecisions ? 'warning' : 'success',
      humanMessage: hasDecisions ? 'Build Brief is ready with decisions to resolve.' : brief.requiredInputs.length ? 'Build Brief is ready with required user inputs to provide.' : 'Source-grounded Build Brief is ready for approval.',
      technicalPayload: { briefId: brief.id, version: brief.version, contradictions: synthesis.contradictions.length, uncertainties: synthesis.uncertainties.length, requiredInputs: brief.requiredInputs.length },
    });
    return brief;
  } catch (error) {
    deps.store.updateIntake(intake.id, { status: 'blocked' });
    emit(deps.store, project.id, {
      category: 'recovery', stage: 'understanding', severity: 'error',
      humanMessage: 'Document understanding was interrupted and can resume from its last checkpoint.',
      technicalPayload: { message: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }
}
