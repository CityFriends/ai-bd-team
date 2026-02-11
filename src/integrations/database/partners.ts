import { getSupabase } from './client.js';

// ============================================
// RELATIONSHIP MEMORY (Rosa)
// ============================================

export interface PartnerCompany {
  id?: string;
  company_name: string;
  duns_number?: string;
  cage_code?: string;
  // Certifications
  certifications: string[]; // '8a', 'WOSB', 'SDVOSB', 'HUBZone', 'SB'
  naics_codes?: string[];
  // Capabilities
  capabilities: string[];
  past_performance_agencies?: string[]; // Agencies they've worked with
  // Relationship status
  relationship_status: 'prospect' | 'contacted' | 'active_partner' | 'past_partner' | 'do_not_use';
  relationship_notes?: string;
  // Metadata
  last_teamed_date?: string;
  teaming_history_count?: number;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  // Source
  added_by?: string;
  created_at?: string;
  updated_at?: string;
}

export interface TeamingInteraction {
  id?: string;
  partner_id?: string;
  partner_name: string;
  opportunity_id?: string;
  opportunity_title?: string;
  // Interaction details
  interaction_type:
    | 'teaming_discussion'
    | 'proposal_submitted'
    | 'won_together'
    | 'lost_together'
    | 'declined'
    | 'general';
  outcome?: 'positive' | 'negative' | 'neutral' | 'pending';
  notes?: string;
  // Metadata
  interaction_date: string;
  logged_by?: string;
  created_at?: string;
}

// Save or update a partner company
export async function savePartnerCompany(
  partner: Omit<PartnerCompany, 'id' | 'created_at'>
): Promise<PartnerCompany | null> {
  try {
    const { data, error } = await getSupabase()
      .from('partner_companies')
      .upsert(
        {
          ...partner,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'company_name' }
      )
      .select()
      .single();

    if (error) {
      console.error('Failed to save partner:', error);
      return null;
    }
    return data;
  } catch (err) {
    console.error('Partner save error:', err);
    return null;
  }
}

// Get partner by name
export async function getPartnerByName(companyName: string): Promise<PartnerCompany | null> {
  try {
    const { data, error } = await getSupabase()
      .from('partner_companies')
      .select()
      .ilike('company_name', `%${companyName}%`)
      .limit(1)
      .single();

    if (error) return null;
    return data;
  } catch {
    return null;
  }
}

// Search partners by certification
export async function searchPartnersByCertification(
  certification: string
): Promise<PartnerCompany[]> {
  try {
    const { data, error } = await getSupabase()
      .from('partner_companies')
      .select()
      .contains('certifications', [certification])
      .neq('relationship_status', 'do_not_use')
      .order('teaming_history_count', { ascending: false, nullsFirst: false });

    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

// Search partners by capability
export async function searchPartnersByCapability(capability: string): Promise<PartnerCompany[]> {
  try {
    const { data, error } = await getSupabase()
      .from('partner_companies')
      .select()
      .or(`capabilities.cs.{${capability}},capabilities.cs.{${capability.toLowerCase()}}`)
      .neq('relationship_status', 'do_not_use')
      .order('teaming_history_count', { ascending: false, nullsFirst: false });

    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

// Search partners by agency experience
export async function searchPartnersByAgency(agencyCode: string): Promise<PartnerCompany[]> {
  try {
    const { data, error } = await getSupabase()
      .from('partner_companies')
      .select()
      .contains('past_performance_agencies', [agencyCode])
      .neq('relationship_status', 'do_not_use')
      .order('teaming_history_count', { ascending: false, nullsFirst: false });

    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

// Get all active partners
export async function getActivePartners(): Promise<PartnerCompany[]> {
  try {
    const { data, error } = await getSupabase()
      .from('partner_companies')
      .select()
      .in('relationship_status', ['active_partner', 'past_partner', 'contacted'])
      .order('last_teamed_date', { ascending: false, nullsFirst: false });

    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

// Log a teaming interaction
export async function logTeamingInteraction(
  interaction: Omit<TeamingInteraction, 'id' | 'created_at'>
): Promise<TeamingInteraction | null> {
  try {
    const { data, error } = await getSupabase()
      .from('teaming_interactions')
      .insert({
        ...interaction,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error('Failed to log teaming interaction:', error);
      return null;
    }

    // Update partner's teaming history count
    if (interaction.partner_id) {
      await getSupabase()
        .from('partner_companies')
        .update({
          teaming_history_count: getSupabase().rpc('increment_field', {
            field_name: 'teaming_history_count',
            row_id: interaction.partner_id,
          }),
          last_teamed_date: interaction.interaction_date,
        })
        .eq('id', interaction.partner_id);
    }

    return data;
  } catch (err) {
    console.error('Teaming interaction error:', err);
    return null;
  }
}

// Get teaming history for a partner
export async function getTeamingHistory(
  partnerName: string,
  limit: number = 10
): Promise<TeamingInteraction[]> {
  try {
    const { data, error } = await getSupabase()
      .from('teaming_interactions')
      .select()
      .ilike('partner_name', `%${partnerName}%`)
      .order('interaction_date', { ascending: false })
      .limit(limit);

    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

// Get partners we've worked with on similar opportunities
export async function getPartnersForOpportunity(params: {
  agencyCode?: string;
  certificationNeeded?: string;
  capabilitiesNeeded?: string[];
}): Promise<PartnerCompany[]> {
  try {
    let query = getSupabase()
      .from('partner_companies')
      .select()
      .neq('relationship_status', 'do_not_use');

    // Filter by agency experience if provided
    if (params.agencyCode) {
      query = query.contains('past_performance_agencies', [params.agencyCode]);
    }

    // Filter by certification if needed
    if (params.certificationNeeded) {
      query = query.contains('certifications', [params.certificationNeeded]);
    }

    const { data, error } = await query
      .order('teaming_history_count', { ascending: false, nullsFirst: false })
      .limit(10);

    if (error) return [];

    // If capabilities needed, filter further
    let results = data || [];
    if (params.capabilitiesNeeded && params.capabilitiesNeeded.length > 0) {
      results = results.filter((p) =>
        params.capabilitiesNeeded!.some((cap) =>
          p.capabilities?.some((c: string) => c.toLowerCase().includes(cap.toLowerCase()))
        )
      );
    }

    return results;
  } catch {
    return [];
  }
}

// Format partner data for Rosa's context
export function formatPartnerForContext(partner: PartnerCompany): string {
  const lines: string[] = [
    `*${partner.company_name}*`,
    `Status: ${partner.relationship_status.replace('_', ' ')}`,
  ];

  if (partner.certifications?.length > 0) {
    lines.push(`Certs: ${partner.certifications.join(', ')}`);
  }
  if (partner.capabilities?.length > 0) {
    lines.push(`Capabilities: ${partner.capabilities.slice(0, 5).join(', ')}`);
  }
  if (partner.past_performance_agencies && partner.past_performance_agencies.length > 0) {
    lines.push(`Agency experience: ${partner.past_performance_agencies.join(', ')}`);
  }
  if (partner.teaming_history_count && partner.teaming_history_count > 0) {
    lines.push(
      `Teamed ${partner.teaming_history_count} times${partner.last_teamed_date ? `, last: ${partner.last_teamed_date.split('T')[0]}` : ''}`
    );
  }
  if (partner.relationship_notes) {
    lines.push(`Notes: ${partner.relationship_notes}`);
  }
  if (partner.contact_name) {
    lines.push(
      `Contact: ${partner.contact_name}${partner.contact_email ? ` (${partner.contact_email})` : ''}`
    );
  }

  return lines.join('\n');
}
