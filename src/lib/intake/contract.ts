import { createHash } from 'node:crypto';
import type { ApprovalHashInput } from './types';

function sortRecursively(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortRecursively);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortRecursively(entry)]),
  );
}

function stableJson(value: unknown) {
  return JSON.stringify(sortRecursively(value));
}

function materialContract(input: ApprovalHashInput) {
  const legacyContract = {
    brief: {
      version: input.brief.version,
      content: input.brief.content,
      visualCoverage: input.brief.visualCoverage,
    },
    sources: input.sources
      .map(({ sourceId, revision, contentHash, mimeType, role }) => ({ sourceId, revision, contentHash, mimeType, role: role || 'reference' }))
      .sort((left, right) => left.sourceId.localeCompare(right.sourceId)),
    decisions: input.decisions
      .map(({ decisionId, resolution, required }) => ({ decisionId, resolution, required }))
      .sort((left, right) => left.decisionId.localeCompare(right.decisionId)),
    ...(input.requirements?.length ? { requirements: input.requirements } : {}),
    buildConfiguration: input.buildConfiguration,
  };
  if (input.design === undefined) return legacyContract;
  return {
    ...legacyContract,
    design: input.design ? {
      version: input.design.version,
      summary: input.design.summary,
      principles: input.design.principles,
      designSystem: input.design.designSystem,
      screens: input.design.screens,
      interactions: input.design.interactions,
      responsiveRules: input.design.responsiveRules,
      accessibility: input.design.accessibility,
      assets: input.design.assets,
      implementationRules: input.design.implementationRules,
      visualAcceptance: input.design.visualAcceptance,
    } : null,
  };
}

export function computeApprovalHash(input: ApprovalHashInput) {
  return createHash('sha256').update(stableJson(materialContract(input))).digest('hex');
}

export function isMaterialContractChange(before: ApprovalHashInput, after: ApprovalHashInput) {
  return computeApprovalHash(before) !== computeApprovalHash(after);
}
