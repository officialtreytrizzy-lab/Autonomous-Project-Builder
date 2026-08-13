import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { analyzeBuild } from '@/lib/builder';
import { validateIngredients } from '@/lib/validator';

const schema = z.object({
  name: z.string().trim().max(120).optional(),
  objective: z.string().trim().max(4000).optional(),
  repository: z.string().trim().max(300).optional(),
  backend: z.enum(['supabase', 'appwrite', 'firebase', 'none']).default('none'),
  deployment: z.enum(['local', 'vercel', 'none']).default('local'),
  workflow: z.enum(['windmill', 'none']).default('none'),
  needsAuthenticatedBrowser: z.boolean().default(false),
  needsWindowsHost: z.boolean().default(false),
});

export async function POST(request: NextRequest) {
  try {
    const body = schema.parse(await request.json());
    const staticAnalysis = analyzeBuild(body);

    try {
      const validatedIngredients = await validateIngredients(body);
      if (validatedIngredients.length > 0) {
        staticAnalysis.ingredients = validatedIngredients;
        staticAnalysis.greenCount = validatedIngredients.filter((i) => i.level === 'green').length;
        staticAnalysis.yellowCount = validatedIngredients.filter((i) => i.level === 'yellow').length;
        staticAnalysis.redCount = validatedIngredients.filter((i) => i.level === 'red').length;
        staticAnalysis.blockingCount = validatedIngredients.filter((i) => i.level === 'red' && i.blocking).length;
        staticAnalysis.canContinue = staticAnalysis.blockingCount === 0;
        staticAnalysis.stage = staticAnalysis.canContinue ? 'ready' : 'blocked';
      }
    } catch {
      // Fallback to static analysis seamlessly
    }

    return NextResponse.json(staticAnalysis);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid build request', issues: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: 'Unable to analyze build request' }, { status: 500 });
  }
}
