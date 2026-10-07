/**
 * Jodie DOCX Renderer
 *
 * Generates real DOCX files from structured proposal content.
 * The renderer consumes structured data, NOT arbitrary model prose.
 * It is NOT an AI component.
 *
 * Supports: title page, section headings, body paragraphs,
 * bullet lists, tables, page breaks, headers/footers,
 * page numbers, proposal metadata, controlled styles,
 * requirement/reference markers.
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Header,
  Footer,
  PageNumber,
  Table,
  TableRow,
  TableCell,
  WidthType,
  PageBreak,
  AlignmentType,
  ShadingType,
} from 'docx';
import * as crypto from 'crypto';

// ============================================================
// TEMPLATE MODEL
// ============================================================

export interface ProposalTemplate {
  templateId: string;
  templateVersion: string;
  name: string;
  styles: TemplateStyles;
  titlePage: TitlePageConfig;
  headerText: string;
  footerText: string;
  maxPages?: number;
  marginTop?: number;
  marginBottom?: number;
  marginLeft?: number;
  marginRight?: number;
  minFontSize?: number;
}

export interface TemplateStyles {
  headingFont: string;
  bodyFont: string;
  bodyFontSize: number;
  headingFontSize: number;
  lineSpacing: number;
}

export interface TitlePageConfig {
  companyName: string;
  proposalTitle: string;
  solicitationNumber?: string;
  agencyName?: string;
  submissionDate?: string;
  version?: string;
}

// ============================================================
// STRUCTURED PROPOSAL INPUT
// ============================================================

export interface StructuredProposalContent {
  workspaceId: string;
  proposalVersion: string;
  solicitationVersion?: string;
  amendmentVersion?: number;
  sections: ProposalSectionContent[];
  metadata: Record<string, string>;
}

export interface ProposalSectionContent {
  sectionKey: string;
  title: string;
  headingLevel: 1 | 2 | 3;
  paragraphs: ProposalParagraph[];
  tables?: ProposalTableDef[];
  requirementRefs?: string[];
  pageBreakBefore?: boolean;
}

export interface ProposalParagraph {
  text: string;
  type: 'body' | 'bullet' | 'numbered' | 'reference' | 'note';
  bold?: boolean;
  italic?: boolean;
  evidenceRef?: string;
}

export interface ProposalTableDef {
  caption?: string;
  headers: string[];
  rows: string[][];
}

// ============================================================
// RENDER RESULT
// ============================================================

export interface RenderResult {
  buffer: Buffer;
  contentHash: string;
  sectionCount: number;
  wordCount: number;
  templateId: string;
  templateVersion: string;
  metadata: Record<string, string>;
}

// ============================================================
// DEFAULT TEMPLATE
// ============================================================

export const DEFAULT_TEMPLATE: ProposalTemplate = {
  templateId: 'fftc-standard-v1',
  templateVersion: '1.0.0',
  name: 'FFTC Standard Proposal',
  styles: {
    headingFont: 'Calibri',
    bodyFont: 'Calibri',
    bodyFontSize: 22, // half-points (11pt)
    headingFontSize: 28, // 14pt
    lineSpacing: 276, // 1.15 line spacing (in 240ths)
  },
  titlePage: {
    companyName: 'Friends From The City, LLC',
    proposalTitle: 'Technical and Management Proposal',
  },
  headerText: 'FRIENDS FROM THE CITY, LLC — PROPRIETARY',
  footerText: 'Use or disclosure of data is subject to the restriction on the title page',
  marginTop: 1440, // 1 inch in twips
  marginBottom: 1440,
  marginLeft: 1440,
  marginRight: 1440,
  minFontSize: 20, // 10pt minimum
};

// ============================================================
// DOCX RENDERER
// ============================================================

/**
 * Render structured proposal content to DOCX buffer.
 * Consumes structured data only — not arbitrary prose.
 */
export async function renderDocx(
  content: StructuredProposalContent,
  template: ProposalTemplate = DEFAULT_TEMPLATE
): Promise<RenderResult> {
  const children: (Paragraph | Table)[] = [];
  let totalWordCount = 0;

  // Title page
  children.push(...buildTitlePage(template, content));
  children.push(new Paragraph({ children: [new PageBreak()] }));

  // Sections
  for (const section of content.sections) {
    if (section.pageBreakBefore) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }

    // Section heading
    const headingLevel = section.headingLevel === 1 ? HeadingLevel.HEADING_1 :
      section.headingLevel === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;

    children.push(new Paragraph({
      heading: headingLevel,
      children: [new TextRun({
        text: section.title,
        font: template.styles.headingFont,
        size: template.styles.headingFontSize,
        bold: true,
      })],
    }));

    // Requirement reference markers
    if (section.requirementRefs && section.requirementRefs.length > 0) {
      children.push(new Paragraph({
        children: [new TextRun({
          text: `[Requirements: ${section.requirementRefs.join(', ')}]`,
          font: template.styles.bodyFont,
          size: template.styles.bodyFontSize - 4,
          italics: true,
          color: '666666',
        })],
      }));
    }

    // Paragraphs
    for (const para of section.paragraphs) {
      totalWordCount += para.text.split(/\s+/).filter(Boolean).length;

      if (para.type === 'bullet') {
        children.push(new Paragraph({
          bullet: { level: 0 },
          children: [new TextRun({
            text: para.text,
            font: template.styles.bodyFont,
            size: template.styles.bodyFontSize,
            bold: para.bold,
            italics: para.italic,
          })],
        }));
      } else if (para.type === 'reference') {
        children.push(new Paragraph({
          children: [
            new TextRun({
              text: para.text,
              font: template.styles.bodyFont,
              size: template.styles.bodyFontSize - 2,
              italics: true,
              color: '444444',
            }),
            ...(para.evidenceRef ? [new TextRun({
              text: ` [${para.evidenceRef}]`,
              font: template.styles.bodyFont,
              size: template.styles.bodyFontSize - 4,
              color: '888888',
            })] : []),
          ],
        }));
      } else {
        children.push(new Paragraph({
          spacing: { line: template.styles.lineSpacing },
          children: [new TextRun({
            text: para.text,
            font: template.styles.bodyFont,
            size: template.styles.bodyFontSize,
            bold: para.bold,
            italics: para.italic,
          })],
        }));
      }
    }

    // Tables
    if (section.tables) {
      for (const tableDef of section.tables) {
        children.push(buildTable(tableDef, template));
      }
    }
  }

  // Build document
  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: {
            top: template.marginTop || 1440,
            bottom: template.marginBottom || 1440,
            left: template.marginLeft || 1440,
            right: template.marginRight || 1440,
          },
          pageNumbers: { start: 1 },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({
              text: template.headerText,
              font: template.styles.bodyFont,
              size: 16, // 8pt
              italics: true,
              color: '999999',
            })],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: template.footerText + '  |  Page ',
                font: template.styles.bodyFont,
                size: 16,
                color: '999999',
              }),
              new TextRun({
                children: [PageNumber.CURRENT],
                font: template.styles.bodyFont,
                size: 16,
                color: '999999',
              }),
            ],
          })],
        }),
      },
      children,
    }],
  });

  const buffer = Buffer.from(await Packer.toBuffer(doc));
  const contentHash = crypto.createHash('sha256').update(buffer).digest('hex');

  return {
    buffer,
    contentHash,
    sectionCount: content.sections.length,
    wordCount: totalWordCount,
    templateId: template.templateId,
    templateVersion: template.templateVersion,
    metadata: {
      workspaceId: content.workspaceId,
      proposalVersion: content.proposalVersion,
      solicitationVersion: content.solicitationVersion || '',
      amendmentVersion: String(content.amendmentVersion || 0),
      generatedAt: new Date().toISOString(),
      renderer: 'jodie-docx-renderer-v1',
    },
  };
}

// ============================================================
// HELPERS
// ============================================================

function buildTitlePage(template: ProposalTemplate, content: StructuredProposalContent): Paragraph[] {
  const tp = template.titlePage;
  return [
    // Spacer
    new Paragraph({ spacing: { before: 4000 }, children: [] }),
    // Company name
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({
        text: tp.companyName,
        font: template.styles.headingFont,
        size: 36, // 18pt
        bold: true,
      })],
    }),
    new Paragraph({ spacing: { before: 600 }, children: [] }),
    // Proposal title
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({
        text: tp.proposalTitle,
        font: template.styles.headingFont,
        size: 48, // 24pt
        bold: true,
      })],
    }),
    new Paragraph({ spacing: { before: 400 }, children: [] }),
    // Solicitation
    ...(tp.solicitationNumber ? [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({
        text: `Solicitation: ${tp.solicitationNumber}`,
        font: template.styles.bodyFont,
        size: 24,
      })],
    })] : []),
    // Agency
    ...(tp.agencyName ? [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({
        text: `Submitted to: ${tp.agencyName}`,
        font: template.styles.bodyFont,
        size: 24,
      })],
    })] : []),
    // Version
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 600 },
      children: [new TextRun({
        text: `Version: ${content.proposalVersion}`,
        font: template.styles.bodyFont,
        size: 22,
        color: '666666',
      })],
    }),
    // Date
    ...(tp.submissionDate ? [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({
        text: tp.submissionDate,
        font: template.styles.bodyFont,
        size: 22,
      })],
    })] : []),
    // Proprietary notice
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 2000 },
      children: [new TextRun({
        text: 'PROPRIETARY — ' + template.headerText,
        font: template.styles.bodyFont,
        size: 18,
        italics: true,
        color: '999999',
      })],
    }),
  ];
}

function buildTable(tableDef: ProposalTableDef, template: ProposalTemplate): Table {
  const headerRow = new TableRow({
    tableHeader: true,
    children: tableDef.headers.map(h => new TableCell({
      shading: { type: ShadingType.SOLID, color: '1F4E79' },
      children: [new Paragraph({
        children: [new TextRun({
          text: h,
          font: template.styles.bodyFont,
          size: template.styles.bodyFontSize - 2,
          bold: true,
          color: 'FFFFFF',
        })],
      })],
    })),
  });

  const dataRows = tableDef.rows.map(row =>
    new TableRow({
      children: row.map(cell => new TableCell({
        children: [new Paragraph({
          children: [new TextRun({
            text: cell,
            font: template.styles.bodyFont,
            size: template.styles.bodyFontSize - 2,
          })],
        })],
      })),
    })
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...dataRows],
  });
}
