import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { analyzeBuild } from '@/lib/builder';

const schema = z.object({
  name: z.string().trim().max(120).optional(),
  objective: z.string().trim().max(4000).optional(),
  repository: z.string().trim().max(300).optional(),
  backend: z.enum(['supabase', 'appwrite', 'firebase', 'none']).default('none'),
  deployment: z.enum(['vercel', 'none']).default('none'),
  workflow: z.enum(['windmill', 'none']).default('none'),
  needsAuthenticatedBrowser: z.boolean().default(false),
  needsWindowsHost: z.boolean().default(false),
});

export async function POST(request: NextRequest) {
  try {
    const body = schema.parse(await request.json());
    return NextResponse.json(analyzeBuild(body));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid build request', issues: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: 'Unable to analyze build request' }, { status: 500 });
  }
}
