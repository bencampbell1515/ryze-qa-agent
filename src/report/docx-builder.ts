import {
  Document, Packer, Paragraph, ImageRun, HeadingLevel,
  Table, TableRow, TableCell, TextRun, AlignmentType,
  PageBreak, WidthType,
} from 'docx';
import { readFileSync, existsSync } from 'node:fs';
import type { BugRecord, Severity } from '../types.js';

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0, high: 1, medium: 2, low: 3,
};

function severityColor(s: Severity): string {
  const colors: Record<Severity, string> = {
    critical: 'FF0000', high: 'FF6600', medium: 'FFAA00', low: '888888',
  };
  return colors[s];
}

function bugSection(bug: BugRecord): Paragraph[] {
  const paragraphs: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [
        new TextRun({
          text: `[${bug.severity.toUpperCase()}] ${bug.title}`,
          color: severityColor(bug.severity),
          bold: true,
        }),
      ],
    }),
    new Paragraph(
      `Bug ID: ${bug.fingerprint.slice(0, 8)} · ${bug.bugClass} · ` +
      `Affects ${bug.urls.length} URL(s) · Viewports: ${bug.viewports.join(', ')}`,
    ),
    new Paragraph(bug.description),
  ];

  if (bug.elementShot && existsSync(bug.elementShot)) {
    paragraphs.push(
      new Paragraph({
        children: [
          new ImageRun({
            data: readFileSync(bug.elementShot),
            transformation: { width: 400, height: 250 },
            type: 'png',
          }),
        ],
      }),
    );
  }

  if (bug.annotatedPageShot && existsSync(bug.annotatedPageShot)) {
    paragraphs.push(
      new Paragraph({
        children: [
          new ImageRun({
            data: readFileSync(bug.annotatedPageShot),
            transformation: { width: 600, height: 400 },
            type: 'png',
          }),
        ],
      }),
    );
  }

  for (const url of bug.urls) {
    paragraphs.push(new Paragraph({ text: `• ${url}`, bullet: { level: 0 } }));
  }

  if (bug.helpUrl) {
    paragraphs.push(new Paragraph(`Fix guidance: ${bug.helpUrl}`));
  }

  paragraphs.push(new Paragraph({ children: [new PageBreak()] }));
  return paragraphs;
}

export async function buildDocx(
  bugs: BugRecord[],
  meta: { crawlDate: string; totalPages: number; sites: string[] },
): Promise<Buffer> {
  const sorted = [...bugs].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );

  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const b of bugs) counts[b.severity]++;

  const revenueBugs = sorted.filter((b) => b.ruleId.startsWith('revenue:'));

  const summaryTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: ['Severity', 'Count'].map(
          (t) => new TableCell({ children: [new Paragraph({ text: t, bold: true } as Parameters<typeof Paragraph>[0])] }),
        ),
      }),
      ...(['critical', 'high', 'medium', 'low'] as Severity[]).map(
        (s) => new TableRow({
          children: [s, String(counts[s])].map(
            (t) => new TableCell({ children: [new Paragraph(t)] }),
          ),
        }),
      ),
    ],
  });

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ heading: HeadingLevel.HEADING_1, text: 'Ryze QA Audit Report' }),
          new Paragraph(`Sites: ${meta.sites.join(', ')}`),
          new Paragraph(`Crawl date: ${meta.crawlDate}`),
          new Paragraph(`Total pages crawled: ${meta.totalPages}`),
          new Paragraph(`Total unique bugs: ${bugs.length}`),
          new Paragraph({ children: [new PageBreak()] }),

          new Paragraph({ heading: HeadingLevel.HEADING_1, text: 'Severity Summary' }),
          summaryTable,
          new Paragraph({ children: [new PageBreak()] }),

          ...(revenueBugs.length > 0
            ? [
                new Paragraph({ heading: HeadingLevel.HEADING_1, text: 'Revenue-Impact Bugs' }),
                ...revenueBugs.flatMap(bugSection),
              ]
            : []),

          new Paragraph({ heading: HeadingLevel.HEADING_1, text: 'All Bugs' }),
          ...sorted.flatMap(bugSection),

          new Paragraph({ heading: HeadingLevel.HEADING_1, text: 'Appendix — Raw Data' }),
          new Paragraph(JSON.stringify(bugs, null, 2)),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}
