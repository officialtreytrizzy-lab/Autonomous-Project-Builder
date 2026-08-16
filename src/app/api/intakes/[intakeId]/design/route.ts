import { z } from 'zod';

import { DesignService } from '../../../../../lib/design/service';
import { getIntakeStore } from '../../../../../lib/intake/store';

const messageSchema = z.object({
  action: z.enum(['chat', 'packet', 'import']).default('chat'),
  message: z.string().trim().max(50000).default(''),
  elements: z.array(z.string()).default([]),
  referenceFiles: z.array(z.object({
    name: z.string(),
    size: z.number(),
    type: z.string(),
    dataUrl: z.string().optional(),
    extractedText: z.string().optional(),
  })).default([]),
  constructTemplate: z.boolean().default(false),
});

export async function GET(_request: Request, context: { params: Promise<{ intakeId: string }> }) {
  const { intakeId } = await context.params;
  const store = getIntakeStore();
  if (!store.getIntake(intakeId)) return Response.json({ error: 'Intake not found' }, { status: 404 });
  return Response.json(new DesignService(store).status(intakeId));
}

export async function POST(request: Request, context: { params: Promise<{ intakeId: string }> }) {
  const { intakeId } = await context.params;
  try {
    const input = messageSchema.parse(await request.json());
    const store = getIntakeStore();
    if (!store.getIntake(intakeId)) return Response.json({ error: 'Intake not found' }, { status: 404 });
    const design = new DesignService(store);
    if (input.action === 'packet') {
      return Response.json({ packet: design.packet(intakeId, input.elements, input.referenceFiles.map((file) => file.name)) });
    }
    if (input.action === 'import') {
      const result = await design.importDesign(intakeId, input.referenceFiles, input.elements);
      return Response.json(result);
    }
    const result = await design.chat(intakeId, input.message, {
      elements: input.elements,
      referenceFiles: input.referenceFiles,
      constructTemplate: input.constructTemplate,
    });
    return Response.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: 'Invalid design message', issues: error.issues }, { status: 400 });
    return Response.json({ error: error instanceof Error ? error.message : 'Unable to update visual design' }, { status: 400 });
  }
}
