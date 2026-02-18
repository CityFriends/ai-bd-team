// Parse FAR DITA files and load into Supabase
import 'dotenv/config';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { getSupabase } from '../integrations/supabase.js';

export interface FARSection {
  section_number: string; // e.g., "15.304"
  title: string; // e.g., "Evaluation factors and significant subfactors"
  part: number; // e.g., 15
  subpart?: string; // e.g., "15.3"
  full_text: string; // The complete text content
  summary?: string; // A shorter summary for quick reference
}

// Parse DITA XML to extract text content
function stripXmlTags(xml: string): string {
  return (
    xml
      // Remove XML declaration and DOCTYPE
      .replace(/<\?xml[^>]*\?>/g, '')
      .replace(/<!DOCTYPE[^>]*>/g, '')
      // Remove all XML tags but keep content
      .replace(/<[^>]+>/g, ' ')
      // Decode HTML entities
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#xA0;/g, ' ')
      // Clean up whitespace
      .replace(/\s+/g, ' ')
      .trim()
  );
}

// Extract section number from DITA content
function extractSectionNumber(content: string, filename: string): string {
  // Try to get from autonumber prop
  const autoMatch = content.match(/<ph[^>]*props="autonumber"[^>]*>([^<]+)<\/ph>/);
  if (autoMatch) {
    return autoMatch[1].trim();
  }

  // Fall back to filename
  return filename.replace('.dita', '');
}

// Extract title from DITA content
function extractTitle(content: string): string {
  const titleMatch = content.match(/<title[^>]*>([^]*?)<\/title>/);
  if (titleMatch) {
    // Remove the section number from title
    const title = stripXmlTags(titleMatch[1]);
    // Remove leading section number if present
    return title.replace(/^\d+\.\d+(-\d+)?(\([a-z]\))?\s*/, '').trim();
  }
  return '';
}

// Parse a single DITA file
function parseDitaFile(content: string, filename: string): FARSection | null {
  const sectionNumber = extractSectionNumber(content, filename);
  const title = extractTitle(content);
  const fullText = stripXmlTags(content);

  if (!sectionNumber || !fullText) {
    return null;
  }

  // Extract part number
  const partMatch = sectionNumber.match(/^(\d+)\./);
  const part = partMatch ? parseInt(partMatch[1], 10) : 0;

  // Extract subpart (e.g., "15.3" from "15.304")
  const subpartMatch = sectionNumber.match(/^(\d+\.\d)/);
  const subpart = subpartMatch ? subpartMatch[1] : undefined;

  // Create a summary (first ~300 chars of meaningful content)
  const summary = fullText.slice(0, 300).replace(/\s+\S*$/, '') + '...';

  return {
    section_number: sectionNumber,
    title,
    part,
    subpart,
    full_text: fullText,
    summary,
  };
}

// Load all FAR sections from DITA files
export async function parseFARFiles(ditaDir: string): Promise<FARSection[]> {
  const files = await readdir(ditaDir);
  const ditaFiles = files.filter((f) => f.endsWith('.dita'));

  console.log(`Found ${ditaFiles.length} DITA files to parse`);

  const sectionsMap = new Map<string, FARSection>();
  let processed = 0;

  for (const file of ditaFiles) {
    const content = await readFile(join(ditaDir, file), 'utf-8');
    const section = parseDitaFile(content, file);

    if (section) {
      // Dedupe by section_number - keep the one with more content
      const existing = sectionsMap.get(section.section_number);
      if (!existing || section.full_text.length > existing.full_text.length) {
        sectionsMap.set(section.section_number, section);
      }
    }

    processed++;
    if (processed % 500 === 0) {
      console.log(`Parsed ${processed}/${ditaFiles.length} files...`);
    }
  }

  const sections = Array.from(sectionsMap.values());
  console.log(`Successfully parsed ${sections.length} unique FAR sections`);
  return sections;
}

// Upload sections to Supabase
export async function uploadToSupabase(sections: FARSection[]): Promise<void> {
  const supabase = getSupabase();

  console.log(`Uploading ${sections.length} sections to Supabase...`);

  // Upload in batches of 50 (smaller to avoid duplicate issues)
  const batchSize = 50;
  let uploaded = 0;
  let skipped = 0;

  for (let i = 0; i < sections.length; i += batchSize) {
    const batch = sections.slice(i, i + batchSize);

    const { error } = await supabase
      .from('far_sections')
      .upsert(batch, { onConflict: 'section_number', ignoreDuplicates: true });

    if (error) {
      // If batch fails, try one by one
      console.log(`Batch ${Math.floor(i / batchSize) + 1} had issues, uploading individually...`);
      for (const section of batch) {
        const { error: singleError } = await supabase
          .from('far_sections')
          .upsert(section, { onConflict: 'section_number', ignoreDuplicates: true });

        if (singleError) {
          skipped++;
        } else {
          uploaded++;
        }
      }
    } else {
      uploaded += batch.length;
      console.log(
        `Uploaded batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(sections.length / batchSize)}`
      );
    }
  }

  console.log(`Upload complete! ${uploaded} uploaded, ${skipped} skipped.`);
}

// Main function
async function main() {
  const ditaDir = process.argv[2] || 'data/far/dita';

  console.log('=== FAR Parser ===');
  console.log(`Reading from: ${ditaDir}`);

  const sections = await parseFARFiles(ditaDir);

  if (sections.length === 0) {
    console.log('No sections parsed, exiting');
    return;
  }

  // Show some sample sections
  console.log('\nSample sections:');
  for (const section of sections.slice(0, 3)) {
    console.log(`\n  ${section.section_number}: ${section.title}`);
    console.log(`  Part: ${section.part}, Subpart: ${section.subpart || 'N/A'}`);
    console.log(`  Summary: ${(section.summary || '').slice(0, 100)}...`);
  }

  // Upload to Supabase
  console.log('\nUploading to Supabase...');
  await uploadToSupabase(sections);

  console.log('\nDone!');
}

// Run if called directly (not imported)
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch(console.error);
}
