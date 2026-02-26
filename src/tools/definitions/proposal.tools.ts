/**
 * Proposal Tools
 *
 * Tools for proposal writing and content retrieval.
 * Used by Jodie (Writer) agent.
 */

import type { AgentTool } from '../types.js';
import { getSupabase } from '../../integrations/supabase.js';

/**
 * Search proposal snippets
 */
export const searchProposalSnippetsTool: AgentTool = {
  definition: {
    name: 'search_proposal_snippets',
    description:
      'Search for reusable proposal language snippets by type, case study, tags, or audience. Returns Shipley-aligned content with action + proof.',
    input_schema: {
      type: 'object' as const,
      properties: {
        snippet_type: {
          type: 'string',
          description:
            'Type of snippet: past_performance, capability, technical_approach, differentiator, management, staffing, transition',
          enum: [
            'past_performance',
            'capability',
            'technical_approach',
            'differentiator',
            'management',
            'staffing',
            'transition',
          ],
        },
        case_study_title: {
          type: 'string',
          description:
            'Title of the case study to get snippets for (e.g., "Resolving Veteran Debt in Minutes")',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags to filter by (e.g., ["VA", "accessibility", "trauma-informed"])',
        },
        audience: {
          type: 'string',
          description: 'Target audience: general, technical, or executive',
          enum: ['general', 'technical', 'executive'],
        },
        limit: {
          type: 'number',
          description: 'Maximum number of snippets to return (default 5)',
        },
      },
      required: [],
    },
  },
  allowedAgents: ['jodie'],
  sourceName: 'Proposal Snippets Database',
  execute: async (params) => {
    try {
      const supabase = getSupabase();

      let query = supabase.from('proposal_snippets').select(`
        id,
        title,
        snippet_type,
        content,
        word_count,
        tags,
        audience,
        case_studies (
          title,
          client,
          agency
        )
      `);

      // Apply filters
      if (params.snippet_type) {
        query = query.eq('snippet_type', params.snippet_type as string);
      }

      if (params.audience) {
        query = query.eq('audience', params.audience as string);
      }

      if (params.tags && Array.isArray(params.tags) && params.tags.length > 0) {
        // Filter by any matching tag
        query = query.overlaps('tags', params.tags as string[]);
      }

      const limit = (params.limit as number) || 5;
      query = query.limit(limit);

      const { data, error } = await query;

      if (error) {
        return {
          success: false,
          data: null,
          error: `Database error: ${error.message}`,
          sourceCitation: 'Proposal Snippets Database',
        };
      }

      // Filter by case study title if provided (post-query since it's a join)
      let results = data || [];
      if (params.case_study_title) {
        const searchTitle = (params.case_study_title as string).toLowerCase();
        results = results.filter((snippet: Record<string, unknown>) => {
          const caseStudy = snippet.case_studies as Record<string, unknown> | null;
          return caseStudy?.title?.toString().toLowerCase().includes(searchTitle);
        });
      }

      return {
        success: true,
        data: {
          snippets: results.map((s: Record<string, unknown>) => ({
            title: s.title,
            type: s.snippet_type,
            content: s.content,
            wordCount: s.word_count,
            tags: s.tags,
            audience: s.audience,
            caseStudy: s.case_studies,
          })),
          count: results.length,
        },
        sourceCitation: 'Proposal Snippets Database',
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'Snippet search failed',
        sourceCitation: 'Proposal Snippets Database',
      };
    }
  },
};

/**
 * Get case study details for proposals
 */
export const getCaseStudyDetailsTool: AgentTool = {
  definition: {
    name: 'get_case_study_details',
    description:
      'Get detailed case study information including challenge, approach, solution, outcomes, team composition, and duration. Use for past performance sections.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: {
          type: 'string',
          description: 'Title or partial title of the case study',
        },
        agency: {
          type: 'string',
          description: 'Agency name to filter by (e.g., "VA", "CMS", "Maryland")',
        },
        client: {
          type: 'string',
          description: 'Client name to filter by',
        },
      },
      required: [],
    },
  },
  allowedAgents: ['jodie'],
  sourceName: 'Case Studies Database',
  execute: async (params) => {
    try {
      const supabase = getSupabase();

      let query = supabase.from('case_studies').select('*');

      if (params.title) {
        query = query.ilike('title', `%${params.title}%`);
      }

      if (params.agency) {
        query = query.ilike('agency', `%${params.agency}%`);
      }

      if (params.client) {
        query = query.ilike('client', `%${params.client}%`);
      }

      const { data, error } = await query;

      if (error) {
        return {
          success: false,
          data: null,
          error: `Database error: ${error.message}`,
          sourceCitation: 'Case Studies Database',
        };
      }

      return {
        success: true,
        data: {
          caseStudies: data?.map((cs) => ({
            title: cs.title,
            client: cs.client,
            agency: cs.agency,
            challenge: cs.challenge,
            approach: cs.approach,
            solution: cs.solution,
            outcomes: cs.outcomes,
            methods: cs.methods_used,
            teamComposition: cs.team_composition,
            duration: cs.duration,
            sourceUrl: cs.source_url,
          })),
          count: data?.length || 0,
        },
        sourceCitation: 'Case Studies Database',
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'Case study lookup failed',
        sourceCitation: 'Case Studies Database',
      };
    }
  },
};

/**
 * Get company capabilities and differentiators
 */
export const getCompanyCapabilitiesTool: AgentTool = {
  definition: {
    name: 'get_company_capabilities',
    description:
      'Get company profile including capabilities, differentiators, certifications, and strategic context. Use for capability statements and technical approach sections.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  allowedAgents: ['jodie'],
  sourceName: 'Company Profile Database',
  execute: async () => {
    try {
      const supabase = getSupabase();

      const { data, error } = await supabase.from('company_profile').select('*').limit(1).single();

      if (error) {
        return {
          success: false,
          data: null,
          error: `Database error: ${error.message}`,
          sourceCitation: 'Company Profile Database',
        };
      }

      return {
        success: true,
        data: {
          companyName: data.company_name,
          tagline: data.tagline,
          elevatorPitch: data.elevator_pitch,
          capabilities: data.capabilities,
          differentiators: data.differentiators,
          certifications: data.certifications,
          setAsides: data.set_asides,
          naicsCodes: data.naics_codes,
          contractVehicles: data.contract_vehicles,
          agencyExperience: data.agency_experience,
          teamSize: data.team_size,
          strategicGoals: data.strategic_goals,
          capabilityGaps: data.capability_gaps,
          growthAreas: data.growth_areas,
        },
        sourceCitation: 'Company Profile Database',
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'Company profile lookup failed',
        sourceCitation: 'Company Profile Database',
      };
    }
  },
};

/**
 * Get key personnel for staffing sections
 */
export const getKeyPersonnelTool: AgentTool = {
  definition: {
    name: 'get_key_personnel',
    description:
      'Get key personnel information including roles and specialties. Use for staffing and management approach sections.',
    input_schema: {
      type: 'object' as const,
      properties: {
        role: {
          type: 'string',
          description: 'Filter by role (e.g., "UX Researcher", "Product Designer")',
        },
        specialty: {
          type: 'string',
          description: 'Filter by specialty (e.g., "Accessibility", "Service Design")',
        },
        available_only: {
          type: 'boolean',
          description: 'Only return available personnel (default true)',
        },
      },
      required: [],
    },
  },
  allowedAgents: ['jodie'],
  sourceName: 'Key Personnel Database',
  execute: async (params) => {
    try {
      const supabase = getSupabase();

      let query = supabase.from('key_personnel').select('*');

      if (params.available_only !== false) {
        query = query.eq('available', true);
      }

      if (params.role) {
        query = query.ilike('role', `%${params.role}%`);
      }

      const { data, error } = await query;

      if (error) {
        return {
          success: false,
          data: null,
          error: `Database error: ${error.message}`,
          sourceCitation: 'Key Personnel Database',
        };
      }

      // Filter by specialty if provided
      let results = data || [];
      if (params.specialty) {
        const searchSpecialty = (params.specialty as string).toLowerCase();
        results = results.filter((person) =>
          person.specialties?.some((s: string) => s.toLowerCase().includes(searchSpecialty))
        );
      }

      return {
        success: true,
        data: {
          personnel: results.map((p) => ({
            name: p.name,
            role: p.role,
            specialties: p.specialties,
            available: p.available,
          })),
          count: results.length,
        },
        sourceCitation: 'Key Personnel Database',
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'Personnel lookup failed',
        sourceCitation: 'Key Personnel Database',
      };
    }
  },
};

/**
 * All proposal tools
 */
export const proposalTools: AgentTool[] = [
  searchProposalSnippetsTool,
  getCaseStudyDetailsTool,
  getCompanyCapabilitiesTool,
  getKeyPersonnelTool,
];
