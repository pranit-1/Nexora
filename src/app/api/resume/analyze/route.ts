import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/serverAuth';
import { auditResume, auditResumeBuffer, AuditResult } from '@/lib/services/resumeAnalyzerService';
import { extractText } from '@/lib/services/documentReaderService';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  try {
    const formData = await request.formData().catch(() => null);
    const body = !formData ? await request.json().catch(() => null) : null;

    const targetJobDescription = formData?.get('targetJobDescription')?.toString() || body?.targetJobDescription || '';

    // File upload case
    if (formData && formData.has('file')) {
      const file = formData.get('file');
      if (!(file instanceof File)) {
        return NextResponse.json({ error: 'Invalid file upload' }, { status: 400 });
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      const result = await auditResumeBuffer(buffer, file.name, targetJobDescription);
      return NextResponse.json({
        success: true,
        audit: result.analysis,
        fileName: result.fileName,
        charCount: result.charCount,
        pageCount: result.pageCount,
      });
    }

    // Raw text case
    if (body?.resumeText) {
      const audit = await auditResume({
        resumeText: body.resumeText,
        targetJobDescription,
      });
      return NextResponse.json({ success: true, audit, fileName: body.fileName || 'Pasted Resume Text' });
    }

    // Try to get from stored base resume text if provided
    if (body?.baseResumeText) {
      const audit = await auditResume({
        resumeText: body.baseResumeText,
        targetJobDescription,
      });
      return NextResponse.json({ success: true, audit, fileName: body.fileName || 'Base Resume' });
    }

    return NextResponse.json({ error: 'Please upload a PDF/DOCX resume or provide resume text to analyze.' }, { status: 400 });
  } catch (err: any) {
    console.error('[ResumeAPI] Analyze error:', err);
    return NextResponse.json({ error: err?.message || 'Failed to analyze resume' }, { status: 500 });
  }
}
