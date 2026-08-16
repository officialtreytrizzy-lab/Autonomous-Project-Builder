import { z } from 'zod';

import { DesignService } from '../../../../../../lib/design/service';
import { getIntakeStore } from '../../../../../../lib/intake/store';

const approveSchema = z.object({
  selectedElements: z.array(z.string()).default([]),
}).optional();

export async function POST(request: Request, context: { params: Promise<{ intakeId: string }> }) {
  const { intakeId } = await context.params;
  try {
    const store = getIntakeStore();
    if (!store.getIntake(intakeId)) return Response.json({ error: 'Intake not found' }, { status: 404 });
    let selectedElements: string[] = [];
    try {
      const body = await request.json();
      const parsed = approveSchema.parse(body);
      selectedElements = parsed?.selectedElements || [];
    } catch {
      // Body is optional
    }
    const contract = await new DesignService(store).approve(intakeId, selectedElements);
    return Response.json({ contract });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to approve visual design' }, { status: 400 });
  }
}
