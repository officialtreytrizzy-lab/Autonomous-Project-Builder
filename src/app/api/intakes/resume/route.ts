import { getIntakeService } from '../../../../lib/intake/service.ts';

export async function POST() {
  try {
    return Response.json(await getIntakeService().resumeInterrupted());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to resume intake jobs' }, { status: 502 });
  }
}
