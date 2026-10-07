/**
 * Jodie PDF Renderer
 *
 * Generates real PDF files from structured proposal content.
 * Parallel rendering to DOCX — both consume the same structured input.
 * PDF is a review/final-output artifact, not the editable source.
 *
 * Uses PDFKit for direct PDF generation with controlled layout.
 */

import PDFDocument from 'pdfkit';
import * as crypto from 'crypto';
import type {
  StructuredProposalContent,
  ProposalTemplate,
  ProposalTableDef,
} from './docx-renderer.js';
import { DEFAULT_TEMPLATE } from './docx-renderer.js';

export interface PdfRenderResult {
  buffer: Buffer;
  contentHash: string;
  pageCount: number;
  sectionCount: number;
  wordCount: number;
  templateId: string;
  templateVersion: string;
  metadata: Record<string, string>;
}

/**
 * Render structured proposal content to PDF buffer.
 */
export async function renderPdf(
  content: StructuredProposalContent,
  template: ProposalTemplate = DEFAULT_TEMPLATE
): Promise<PdfRenderResult> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'LETTER',
        margins: {
          top: 72,    // 1 inch
          bottom: 72,
          left: 72,
          right: 72,
        },
        info: {
          Title: template.titlePage.proposalTitle,
          Author: template.titlePage.companyName,
          Subject: `Proposal ${content.proposalVersion}`,
          Creator: 'Jodie PDF Renderer v1',
        },
        bufferPages: true,
      });

      let finalPageCount = 0;
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const contentHash = crypto.createHash('sha256').update(buffer).digest('hex');

        resolve({
          buffer,
          contentHash,
          pageCount: finalPageCount,
          sectionCount: content.sections.length,
          wordCount: totalWords,
          templateId: template.templateId,
          templateVersion: template.templateVersion,
          metadata: {
            workspaceId: content.workspaceId,
            proposalVersion: content.proposalVersion,
            solicitationVersion: content.solicitationVersion || '',
            amendmentVersion: String(content.amendmentVersion || 0),
            generatedAt: new Date().toISOString(),
            renderer: 'jodie-pdf-renderer-v1',
          },
        });
      });
      doc.on('error', reject);

      let totalWords = 0;
      const bodyFont = 'Helvetica';
      const bodySize = 11;
      const headingSize = 14;
      const pageWidth = 612 - 144; // Letter minus margins

      // ============================================================
      // TITLE PAGE
      // ============================================================
      doc.moveDown(6);
      doc.fontSize(18).font('Helvetica-Bold')
        .text(template.titlePage.companyName, { align: 'center' });
      doc.moveDown(1);
      doc.fontSize(24).font('Helvetica-Bold')
        .text(template.titlePage.proposalTitle, { align: 'center' });
      doc.moveDown(0.5);

      if (template.titlePage.solicitationNumber) {
        doc.fontSize(12).font(bodyFont)
          .text(`Solicitation: ${template.titlePage.solicitationNumber}`, { align: 'center' });
      }
      if (template.titlePage.agencyName) {
        doc.fontSize(12).font(bodyFont)
          .text(`Submitted to: ${template.titlePage.agencyName}`, { align: 'center' });
      }

      doc.moveDown(1);
      doc.fontSize(11).font(bodyFont).fillColor('#666666')
        .text(`Version: ${content.proposalVersion}`, { align: 'center' });

      if (template.titlePage.submissionDate) {
        doc.text(template.titlePage.submissionDate, { align: 'center' });
      }

      doc.moveDown(6);
      doc.fontSize(9).font('Helvetica-Oblique').fillColor('#999999')
        .text(`PROPRIETARY — ${template.headerText}`, { align: 'center' });

      doc.fillColor('#000000');

      // ============================================================
      // CONTENT SECTIONS
      // ============================================================
      for (const section of content.sections) {
        doc.addPage();

        // Header on each page
        doc.save();
        doc.fontSize(8).font('Helvetica-Oblique').fillColor('#999999')
          .text(template.headerText, 72, 36, { align: 'center', width: pageWidth });
        doc.restore();
        doc.fillColor('#000000');
        doc.y = 72; // Reset to top margin

        // Section heading
        const hSize = section.headingLevel === 1 ? headingSize + 2 :
          section.headingLevel === 2 ? headingSize : headingSize - 2;

        doc.fontSize(hSize).font('Helvetica-Bold')
          .text(section.title);
        doc.moveDown(0.3);

        // Requirement refs
        if (section.requirementRefs && section.requirementRefs.length > 0) {
          doc.fontSize(9).font('Helvetica-Oblique').fillColor('#666666')
            .text(`[Requirements: ${section.requirementRefs.join(', ')}]`);
          doc.fillColor('#000000');
          doc.moveDown(0.3);
        }

        // Paragraphs
        for (const para of section.paragraphs) {
          totalWords += para.text.split(/\s+/).filter(Boolean).length;

          if (para.type === 'bullet') {
            doc.fontSize(bodySize).font(para.bold ? 'Helvetica-Bold' : bodyFont)
              .text(`  •  ${para.text}`, { indent: 20 });
          } else if (para.type === 'reference') {
            doc.fontSize(bodySize - 1).font('Helvetica-Oblique').fillColor('#444444')
              .text(para.text + (para.evidenceRef ? ` [${para.evidenceRef}]` : ''));
            doc.fillColor('#000000');
          } else {
            doc.fontSize(bodySize)
              .font(para.bold ? 'Helvetica-Bold' : para.italic ? 'Helvetica-Oblique' : bodyFont)
              .text(para.text, { lineGap: 3 });
          }
          doc.moveDown(0.3);
        }

        // Tables
        if (section.tables) {
          for (const tableDef of section.tables) {
            renderTable(doc, tableDef, bodyFont, bodySize - 1, pageWidth);
          }
        }
      }

      // Footer on each page (page numbers)
      const range = doc.bufferedPageRange();
      finalPageCount = range.count;
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        doc.fontSize(8).font('Helvetica').fillColor('#999999')
          .text(
            `${template.footerText}  |  Page ${i + 1}`,
            72,
            doc.page.height - 50,
            { align: 'center', width: pageWidth }
          );
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function renderTable(
  doc: InstanceType<typeof PDFDocument>,
  tableDef: ProposalTableDef,
  font: string,
  fontSize: number,
  pageWidth: number
): void {
  doc.moveDown(0.5);

  if (tableDef.caption) {
    doc.fontSize(fontSize).font('Helvetica-Bold').text(tableDef.caption);
    doc.moveDown(0.2);
  }

  const colCount = tableDef.headers.length;
  const colWidth = pageWidth / colCount;
  const startX = 72;
  let y = doc.y;
  const rowHeight = 20;

  // Header row
  doc.save();
  doc.rect(startX, y, pageWidth, rowHeight).fill('#1F4E79');
  for (let i = 0; i < colCount; i++) {
    doc.fontSize(fontSize).font('Helvetica-Bold').fillColor('#FFFFFF')
      .text(tableDef.headers[i], startX + i * colWidth + 4, y + 4, {
        width: colWidth - 8,
        height: rowHeight,
      });
  }
  doc.restore();
  doc.fillColor('#000000');
  y += rowHeight;

  // Data rows
  for (const row of tableDef.rows) {
    // Alternate row shading
    const rowIdx = tableDef.rows.indexOf(row);
    if (rowIdx % 2 === 0) {
      doc.save();
      doc.rect(startX, y, pageWidth, rowHeight).fill('#F2F2F2');
      doc.restore();
      doc.fillColor('#000000');
    }

    for (let i = 0; i < colCount && i < row.length; i++) {
      doc.fontSize(fontSize).font(font)
        .text(row[i], startX + i * colWidth + 4, y + 4, {
          width: colWidth - 8,
          height: rowHeight,
        });
    }
    y += rowHeight;
  }

  // Border
  doc.save();
  doc.rect(startX, doc.y - (tableDef.rows.length + 1) * rowHeight, pageWidth, (tableDef.rows.length + 1) * rowHeight)
    .stroke('#CCCCCC');
  doc.restore();

  doc.y = y + 10;
  doc.moveDown(0.5);
}
