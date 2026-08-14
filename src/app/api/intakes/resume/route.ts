import { getIntakeService } from '../../../../lib/intake/service.ts';

export async function POST() {
  try {
    return Response.json({ ok: true, ...await getIntakeService().resumeInterrupted() });
  } catch {
    return Response.json({ ok: false, degraded: true, errorClass: 'dependency-unavailable', message: 'Intake recovery will retry when Computer 2 is available.' });
  }
}
