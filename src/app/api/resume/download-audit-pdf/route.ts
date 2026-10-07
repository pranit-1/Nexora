import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/serverAuth';
import { auditResume, auditResumeBuffer, buildAuditReportPdfBuffer } from '@/lib/services/resumeAnalyzerService';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json().catch(() => null);
    const { audit, fileName = 'Resume' } = body || {};

    if (!audit) {
      return NextResponse.json({ error: 'Audit data is required to generate report PDF.' }, { status: 400 });
    }

    const buffer = await buildAuditReportPdfBuffer(audit, fileName);
    const safeName = (fileName || 'Resume_Audit').replace(/[^a-zA-Z0-9_-]/g, '_');
    const response = new NextResponse(buffer as any);
    response.headers.set('Content-Type', 'application/pdf');
    response.headers.set('Content-Disposition', `attachment; filename="${safeName}_ATS_Report.pdf"`);
    response.headers.set('Content-Length', buffer.length.toString());
    return response;
  } catch (err: any) {
    console.error('[ResumeAPI] Download audit PDF error:', err);
    return NextResponse.json({ error: err?.message || 'Failed to generate PDF' }, { status: 500 });
  }
}
