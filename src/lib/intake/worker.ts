import type { BuildBriefContent, EvidenceRecord } from './types.ts';
import type { IntakeStore, StoredSourceManifestItem } from './store.ts';
import { createOllamaVisionClient } from './vision.ts';
import { processDocument } from './documents.ts';
import { recoverVisionCapability } from './capabilities.ts';

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
  const capability = await recoverVisionCapability();
  if (!capability.vision.available && !['text/plain', 'text/markdown'].includes(source.mimeType)) {
    throw new Error(`Local visual inspection is unavailable: ${capability.vision.detail}`);
  }
  const result = await processDocument(source, {
    completedPages: context.completedPages,
    visionClient: capability.vision.available
      ? createOllamaVisionClient({ endpoint: capability.ollama.endpoint, model: capability.vision.model })
      : undefined,
  });
  for (const page of [...new Set(result.evidence.map((item) => item.page).filter((page): page is number => typeof page === 'number'))]) {
    if (context.completedPages.has(page)) continue;
    await context.checkpointPage(page, result.evidence.filter((item) => item.page === page).map(({ evidenceId: _id, createdAt: _createdAt, ...item }) => item));
  }
  if (result.blockingIssues.length) throw new Error(result.blockingIssues.map((issue) => `Page ${issue.page}: ${issue.message}`).join('; '));
  return { totalPages: result.visualCoverage.totalPages, inspectedPages: result.visualCoverage.inspectedPages };
}

function fallbackBrief(evidence: EvidenceRecord[]) {
  const text = evidence.map((item) => item.content).filter(Boolean).join('\n');
  return {
    brief: {
      outcome: text.slice(0, 1200) || 'Build the requested private local application.',
      users: [], flows: [], requirements: [], designDirection: [], dataAndIntegrations: [], exclusions: [], acceptanceTests: [], assumptions: [],
    },
    contradictions: [],
    uncertainties: text ? [] : ['No understandable project evidence was produced.'],
  };
}

export async function runIntakeWorker(deps: WorkerDependencies) {
  const intake = deps.store.getIntake(deps.intakeId);
  if (!intake) throw new Error(`Unknown intake: ${deps.intakeId}`);
  const project = deps.store.getProject(intake.projectId);
  if (!project) throw new Error(`Unknown project: ${intake.projectId}`);
  deps.store.updateIntake(intake.id, { status: 'extracting' });
  deps.store.updateProject(project.id, { state: 'understanding' });
  emit(deps.store, project.id, { category: 'intake', stage: 'understanding', severity: 'info', humanMessage: 'Understanding project evidence.' });

  try {
    let totalPages = 0;
    let inspectedPages = 0;
    for (const source of deps.store.currentSources(intake.id).filter((item) => item.availability === 'available')) {
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
    const allEvidence = deps.store.evidenceForIntake(intake.id);
    const synthesis = deps.synthesize ? await deps.synthesize(allEvidence) : fallbackBrief(allEvidence);
    const brief = deps.store.createBriefVersion(intake.id, synthesis.brief, {
      totalPages,
      inspectedPages,
      complete: totalPages === inspectedPages,
    });
    for (const contradiction of synthesis.contradictions) deps.store.addDecision(brief.id, { question: contradiction, required: true });
    for (const uncertainty of synthesis.uncertainties) deps.store.addDecision(brief.id, { question: uncertainty, required: true });
    const hasDecisions = synthesis.contradictions.length + synthesis.uncertainties.length > 0;
    deps.store.updateIntake(intake.id, { status: hasDecisions ? 'awaiting-resolution' : 'awaiting-approval' });
    deps.store.updateProject(project.id, { state: 'awaiting-approval' });
    emit(deps.store, project.id, {
      category: 'brief', stage: 'understanding', severity: hasDecisions ? 'warning' : 'success',
      humanMessage: hasDecisions ? 'Build Brief is ready with decisions to resolve.' : 'Source-grounded Build Brief is ready for approval.',
      technicalPayload: { briefId: brief.id, version: brief.version, contradictions: synthesis.contradictions.length, uncertainties: synthesis.uncertainties.length },
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
