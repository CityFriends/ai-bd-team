/**
 * Setup Notion Hub
 *
 * Creates the AI BD Team Hub structure in Notion with all databases.
 *
 * Usage:
 *   npm run notion:setup <parent-page-id>
 *
 * The parent-page-id is the Notion page where you want the hub created.
 * You can find it in the URL: notion.so/<page-id>
 */
import 'dotenv/config';
import { createNotionHub, NotionHubIds } from '../integrations/notion-hub.js';
import { getSupabase } from '../integrations/supabase.js';

async function saveHubIds(ids: NotionHubIds) {
  // Save to a config file and to Supabase for persistence
  const supabase = getSupabase();

  // Store in company_profile or a separate config table
  const { error } = await supabase
    .from('company_profile')
    .update({
      notion_hub_config: ids,
      updated_at: new Date().toISOString(),
    })
    .eq('id', (await supabase.from('company_profile').select('id').single()).data?.id);

  if (error) {
    console.warn('Could not save to Supabase, saving locally...');
  }

  // Also write to a local file for backup
  const fs = await import('fs');
  fs.writeFileSync(
    'notion-hub-ids.json',
    JSON.stringify(ids, null, 2)
  );
  console.log('\nSaved hub IDs to notion-hub-ids.json');
}

async function main() {
  const parentPageId = process.argv[2];

  if (!parentPageId) {
    console.log(`
Usage: npm run notion:setup <parent-page-id>

The parent-page-id is the Notion page where you want the hub created.
You can find it in the page URL: notion.so/<parent-page-id>

Example:
  npm run notion:setup abc123def456...

Note: Make sure your Notion integration has access to this page.
`);
    process.exit(1);
  }

  // Clean up the page ID (remove dashes if present)
  const cleanPageId = parentPageId.replace(/-/g, '');

  console.log('='.repeat(60));
  console.log('  Setting Up AI BD Team Notion Hub');
  console.log('='.repeat(60));
  console.log(`\nParent page ID: ${cleanPageId}`);

  try {
    const ids = await createNotionHub(cleanPageId);

    await saveHubIds(ids);

    console.log('\n' + '='.repeat(60));
    console.log('  Setup Complete!');
    console.log('='.repeat(60));

    console.log(`
Next Steps:
1. Open Notion and find the "AI BD Team Hub" page
2. Set up views in each database:
   - Opportunities: Create "Pipeline Board" (by Status), "Needs Decision" (filtered), "Calendar" (by Due Date)
   - Forecasts: Create "Coming Soon", "High Relevance", "By Agency" views
   - Activity Log: Create "Recent Activity", "By Agent" views
3. Run 'npm run notion:test' to verify everything works
4. The agents will now sync opportunities to Notion automatically
`);

  } catch (error) {
    console.error('\nError creating hub:', error);
    process.exit(1);
  }
}

main().catch(console.error);
