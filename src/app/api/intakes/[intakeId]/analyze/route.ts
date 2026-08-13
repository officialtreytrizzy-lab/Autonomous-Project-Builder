import { getIntakeService, type IntakeService } from '../../../../../lib/intake/service.ts';

export async function analyzeIntakeResponse(intakeId: string, service: IntakeService) {
  try {
    const intake = await service.analyze(intakeId);
    return Response.json({ intake, plan_id: intake.planId, job_id: intake.jobId }, { status: 202 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to analyze intake' }, { status: 502 });
  }
}

export async function POST(_request: Request, context: { params: Promise<{ intakeId: string }> }) {
  const { intakeId } = await context.params;
  return analyzeIntakeResponse(intakeId, getIntakeService());
}
