import {
  Document, Packer, Paragraph, HeadingLevel,
  TextRun, AlignmentType, WidthType, ImageRun,
  Table, TableRow, TableCell, ShadingType, BorderStyle,
} from 'docx';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import type { BugRecord, Severity } from '../types.js';

const SCREENSHOTS_DIR = join(process.cwd(), 'output', 'screenshots');
// Max display width in pixels at 96 DPI within 6.5in page (minus 0.5in indent)
const SCREENSHOT_DISPLAY_WIDTH = 560;
const SCREENSHOT_MAX_HEIGHT = 380;

function urlToSlug(url: string): string {
  return url.replace(/https?:\/\/[^/]+/, '').replace(/\//g, '-').slice(0, 60) || 'root';
}

function findScreenshotPath(urls: string[]): string | null {
  for (const url of urls.slice(0, 3)) {
    for (const vp of ['desktop', 'tablet', 'mobile']) {
      const p = join(SCREENSHOTS_DIR, `${urlToSlug(url)}-${vp}.png`);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

async function loadScreenshot(path: string): Promise<{ data: Buffer; width: number; height: number } | null> {
  try {
    const resized = await sharp(path)
      .resize({ width: SCREENSHOT_DISPLAY_WIDTH, height: SCREENSHOT_MAX_HEIGHT, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
    const meta = await sharp(resized).metadata();
    return { data: resized, width: meta.width ?? SCREENSHOT_DISPLAY_WIDTH, height: meta.height ?? SCREENSHOT_MAX_HEIGHT };
  } catch {
    return null;
  }
}

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0, high: 1, medium: 2, low: 3,
};

const SEVERITY_COLOR: Record<Severity, string> = {
  critical: 'CC0000', high: 'E65C00', medium: 'CC8800', low: '666666',
};

// Page width minus margins in twips (8.5in - 2in margins = 6.5in * 1440)
const PAGE_WIDTH = 9360;

function rule(color = 'CCCCCC'): Paragraph {
  return new Paragraph({
    border: { bottom: { color, size: 6, space: 1, style: BorderStyle.SINGLE } },
    spacing: { after: 80 },
    children: [],
  });
}

function summaryTable(
  counts: Record<Severity, number>,
  totalPages: number,
  crawlDate: string,
  sites: string[],
): Table {
  const rows: [string, string][] = [
    ['Sites audited', sites.join(', ')],
    ['Crawl date', crawlDate],
    ['Pages crawled', String(totalPages)],
    ['Critical', String(counts.critical)],
    ['High', String(counts.high)],
    ['Medium', String(counts.medium)],
    ['Low', String(counts.low)],
  ];

  const labelW = 2000;
  const valueW = PAGE_WIDTH - labelW;

  return new Table({
    width: { size: PAGE_WIDTH, type: WidthType.DXA },
    columnWidths: [labelW, valueW],
    rows: rows.map(([label, value], i) =>
      new TableRow({
        children: [
          new TableCell({
            width: { size: labelW, type: WidthType.DXA },
            shading: { type: ShadingType.SOLID, color: 'F0F0F0', fill: 'F0F0F0' },
            children: [new Paragraph({
              children: [new TextRun({ text: label, bold: true, size: 20 })],
            })],
          }),
          new TableCell({
            width: { size: valueW, type: WidthType.DXA },
            children: [new Paragraph({
              children: [new TextRun({ text: value, size: 20 })],
            })],
          }),
        ],
      }),
    ),
  });
}

async function bugEntry(bug: BugRecord, index: number): Promise<Paragraph[]> {
  const sev = bug.severity.toUpperCase();
  const color = SEVERITY_COLOR[bug.severity];
  const urlCount = bug.urls.length;
  const displayUrls = bug.urls.slice(0, 5);

  const paras: Paragraph[] = [
    // Header line: number + severity + rule + page count
    new Paragraph({
      spacing: { before: 160, after: 40 },
      children: [
        new TextRun({ text: `${index}. `, bold: true, size: 20 }),
        new TextRun({ text: `[${sev}]`, bold: true, color, size: 20 }),
        new TextRun({ text: `  ${bug.ruleId}`, bold: true, size: 20 }),
        new TextRun({ text: `  —  ${urlCount} page${urlCount !== 1 ? 's' : ''} affected`, size: 20, color: '666666' }),
      ],
    }),
    // Description
    new Paragraph({
      spacing: { before: 0, after: 40 },
      indent: { left: 360 },
      children: [new TextRun({ text: bug.description.slice(0, 200), size: 18, italics: true })],
    }),
    // URLs
    ...displayUrls.map((url) =>
      new Paragraph({
        spacing: { before: 0, after: 20 },
        indent: { left: 360 },
        children: [new TextRun({ text: `• ${url}`, size: 18, color: '0070C0' })],
      }),
    ),
    ...(urlCount > 5
      ? [new Paragraph({
          indent: { left: 360 },
          spacing: { before: 0, after: 40 },
          children: [new TextRun({ text: `  …and ${urlCount - 5} more`, size: 18, color: '999999' })],
        })]
      : []),
  ];

  // Embed a representative page screenshot if one exists from the last audit run
  const screenshotPath = findScreenshotPath(bug.urls);
  if (screenshotPath) {
    const img = await loadScreenshot(screenshotPath);
    if (img) {
      paras.push(
        new Paragraph({
          spacing: { before: 40, after: 80 },
          indent: { left: 360 },
          children: [
            new ImageRun({
              type: 'png',
              data: img.data,
              transformation: { width: img.width, height: img.height },
            }),
          ],
        }),
      );
    }
  }

  return paras;
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

  const children: (Paragraph | Table)[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 200 },
      children: [new TextRun({ text: 'Ryze QA Audit Report', bold: true, size: 52, color: '1a3a6b' })],
    }),

    summaryTable(counts, meta.totalPages, meta.crawlDate, meta.sites),

    new Paragraph({ spacing: { before: 400 }, children: [] }),
  ];

  let globalIndex = 1;

  for (const sev of ['critical', 'high', 'medium', 'low'] as Severity[]) {
    const group = sorted.filter((b) => b.severity === sev);
    if (group.length === 0) continue;

    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 320, after: 120 },
        children: [
          new TextRun({
            text: `${sev.charAt(0).toUpperCase() + sev.slice(1)} (${group.length})`,
            bold: true,
            color: SEVERITY_COLOR[sev],
            size: 32,
          }),
        ],
      }),
      rule(SEVERITY_COLOR[sev]),
    );

    for (const bug of group) {
      children.push(...await bugEntry(bug, globalIndex++));
    }

    children.push(new Paragraph({ spacing: { before: 200 }, children: [] }));
  }

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 },
        },
      },
      children,
    }],
  });

  return Packer.toBuffer(doc);
}
