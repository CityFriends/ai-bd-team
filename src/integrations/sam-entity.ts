// SAM.gov Entity Search Integration
// Used by Rosa to verify partner registrations and certifications

import { getSupabase } from './supabase.js';

const SAM_API_BASE = 'https://api.sam.gov/entity-information/v3/entities';

export interface SAMEntityCertifications {
  is8a?: boolean;
  isWOSB?: boolean;
  isSDVOSB?: boolean;
  isHUBZone?: boolean;
  isEDWOSB?: boolean;
}

export interface SAMEntity {
  ueiSAM: string;
  legalBusinessName: string;
  dbaName?: string;
  cageCode?: string;
  physicalAddress: {
    city?: string;
    state?: string;
    stateOrProvinceCode?: string;
    country?: string;
  };
  businessTypes: string[];
  naicsCodes: string[];
  pscCodes?: string[];
  registrationStatus: string;
  registrationExpirationDate?: string;
  activationDate?: string;
  purposeOfRegistration?: string;
  // Certifications
  sbaBusinessTypes?: string[];
  isSmallBusiness?: boolean;
  certifications: SAMEntityCertifications;
  // POC
  governmentBusinessPOC?: {
    firstName: string;
    lastName: string;
    title?: string;
    email?: string;
    phone?: string;
  };
}

export interface SAMSearchResult {
  entities: SAMEntity[];
  totalRecords: number;
  query: string;
}

// Search for entities by name
export async function searchEntities(params: {
  legalBusinessName?: string;
  ueiSAM?: string;
  cageCode?: string;
}): Promise<SAMSearchResult> {
  const { legalBusinessName, ueiSAM, cageCode } = params;

  const apiKey = process.env.SAM_API_KEY;
  if (!apiKey) {
    console.warn('SAM_API_KEY not configured');
    return { entities: [], totalRecords: 0, query: legalBusinessName || ueiSAM || cageCode || '' };
  }

  // Build query
  const queryParts: string[] = [];
  if (legalBusinessName) queryParts.push(`legalBusinessName:${encodeURIComponent(legalBusinessName)}`);
  if (ueiSAM) queryParts.push(`ueiSAM:${ueiSAM}`);
  if (cageCode) queryParts.push(`cageCode:${cageCode}`);

  const query = queryParts.join('~');

  // Check cache
  const cacheKey = `sam-entity:${query}`;
  const cached = await getCachedResult(cacheKey);
  if (cached) {
    console.log('SAM Entity: Using cached result');
    return cached;
  }

  try {
    const url = new URL(SAM_API_BASE);
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('q', query);
    url.searchParams.set('registrationStatus', 'A'); // Active only
    url.searchParams.set('includeSections', 'entityRegistration,coreData,assertions,certifications,pointsOfContact');

    console.log(`SAM Entity: Searching for "${legalBusinessName || ueiSAM || cageCode}"`);

    const response = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('SAM Entity API error:', response.status, errorText);
      throw new Error(`SAM API error: ${response.status}`);
    }

    const data = await response.json() as any;
    const entities = parseEntities(data.entityData || []);

    const result: SAMSearchResult = {
      entities,
      totalRecords: data.totalRecords || entities.length,
      query: legalBusinessName || ueiSAM || cageCode || '',
    };

    // Cache result
    await cacheResult(cacheKey, result);

    return result;
  } catch (error) {
    console.error('SAM Entity search error:', error);
    return {
      entities: [],
      totalRecords: 0,
      query: legalBusinessName || ueiSAM || cageCode || '',
    };
  }
}

// Verify a specific company's SAM registration
export async function verifyRegistration(companyName: string): Promise<{
  isRegistered: boolean;
  isActive: boolean;
  entity: SAMEntity | null;
  certifications: string[];
  expirationWarning?: string;
  source: string;
}> {
  const result = await searchEntities({ legalBusinessName: companyName });

  if (result.entities.length === 0) {
    return {
      isRegistered: false,
      isActive: false,
      entity: null,
      certifications: [],
      source: 'SAM.gov (not found)',
    };
  }

  // Find best match (exact or closest)
  const entity = result.entities[0];
  const isActive = entity.registrationStatus === 'Active';

  // Build certifications list
  const certifications: string[] = [];
  if (entity.certifications.is8a) certifications.push('8(a)');
  if (entity.certifications.isWOSB) certifications.push('WOSB');
  if (entity.certifications.isEDWOSB) certifications.push('EDWOSB');
  if (entity.certifications.isSDVOSB) certifications.push('SDVOSB');
  if (entity.certifications.isHUBZone) certifications.push('HUBZone');
  if (entity.isSmallBusiness) certifications.push('Small Business');

  // Check expiration
  let expirationWarning: string | undefined;
  if (entity.registrationExpirationDate) {
    const expDate = new Date(entity.registrationExpirationDate);
    const daysUntilExpiration = Math.ceil((expDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (daysUntilExpiration <= 90) {
      expirationWarning = `Registration expires in ${daysUntilExpiration} days (${entity.registrationExpirationDate})`;
    }
  }

  return {
    isRegistered: true,
    isActive,
    entity,
    certifications,
    expirationWarning,
    source: 'SAM.gov',
  };
}

// Check if company has specific certification
export async function checkCertification(
  companyName: string,
  certification: '8a' | 'WOSB' | 'SDVOSB' | 'HUBZone' | 'EDWOSB'
): Promise<{
  hasCertification: boolean;
  entity: SAMEntity | null;
  source: string;
}> {
  const result = await verifyRegistration(companyName);

  if (!result.entity) {
    return {
      hasCertification: false,
      entity: null,
      source: 'SAM.gov (company not found)',
    };
  }

  const certMap: Record<string, keyof SAMEntityCertifications> = {
    '8a': 'is8a',
    'WOSB': 'isWOSB',
    'SDVOSB': 'isSDVOSB',
    'HUBZone': 'isHUBZone',
    'EDWOSB': 'isEDWOSB',
  };

  const certKey = certMap[certification];
  const hasCertification = certKey ? result.entity.certifications[certKey] === true : false;

  return {
    hasCertification,
    entity: result.entity,
    source: 'SAM.gov',
  };
}

// Search for potential partners by NAICS
export async function findPartnersByNAICS(params: {
  naicsCode: string;
  state?: string;
  certifications?: ('8a' | 'WOSB' | 'SDVOSB' | 'HUBZone')[];
  limit?: number;
}): Promise<{
  entities: SAMEntity[];
  source: string;
}> {
  const { naicsCode, state, certifications = [], limit = 10 } = params;

  const apiKey = process.env.SAM_API_KEY;
  if (!apiKey) {
    return { entities: [], source: 'SAM.gov (API key not configured)' };
  }

  try {
    const url = new URL(SAM_API_BASE);
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('naicsCode', naicsCode);
    url.searchParams.set('registrationStatus', 'A');
    url.searchParams.set('includeSections', 'entityRegistration,coreData,assertions,certifications');

    if (state) {
      url.searchParams.set('physicalAddressStateCode', state);
    }

    // Add certification filters
    for (const cert of certifications) {
      if (cert === '8a') url.searchParams.set('sbaBusinessTypeCode', 'A4');
      if (cert === 'WOSB') url.searchParams.set('sbaBusinessTypeCode', 'XX');
      if (cert === 'SDVOSB') url.searchParams.set('sbaBusinessTypeCode', 'A5');
      if (cert === 'HUBZone') url.searchParams.set('sbaBusinessTypeCode', 'A2');
    }

    const response = await fetch(url.toString(), {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`SAM API error: ${response.status}`);
    }

    const data = await response.json() as any;
    const entities = parseEntities(data.entityData || []).slice(0, limit);

    return {
      entities,
      source: `SAM.gov (NAICS ${naicsCode})`,
    };
  } catch (error) {
    console.error('SAM partner search error:', error);
    return { entities: [], source: 'SAM.gov (error)' };
  }
}

// Parse SAM API response into our entity format
function parseEntities(entityData: any[]): SAMEntity[] {
  return entityData.map((e: any) => {
    const core = e.coreData || {};
    const registration = e.entityRegistration || {};
    const assertions = e.assertions || {};
    const certifications = e.certifications || {};
    const pocs = e.pointsOfContact || {};

    return {
      ueiSAM: registration.ueiSAM || '',
      legalBusinessName: registration.legalBusinessName || core.legalBusinessName || 'Unknown',
      dbaName: registration.dbaName,
      cageCode: core.cageCode,
      physicalAddress: {
        city: core.physicalAddress?.city || '',
        state: core.physicalAddress?.stateOrProvinceCode || '',
        country: core.physicalAddress?.countryCode || 'USA',
      },
      businessTypes: registration.businessTypes || [],
      naicsCodes: (core.naicsList || []).map((n: any) => n.naicsCode),
      pscCodes: core.pscList?.map((p: any) => p.pscCode),
      registrationStatus: registration.registrationStatus || 'Unknown',
      registrationExpirationDate: registration.registrationExpirationDate,
      activationDate: registration.activationDate,
      sbaBusinessTypes: assertions.sbaBusinessTypes,
      isSmallBusiness: assertions.sizeMetrics?.averageAnnualRevenue?.averageAnnualRevenueAmount < 41500000,
      certifications: {
        is8a: certifications.has8aCertification || hasSBAType(assertions, 'A4'),
        isWOSB: certifications.hasWOSBCertification || hasSBAType(assertions, 'XX'),
        isSDVOSB: certifications.hasSDVOSBCertification || hasSBAType(assertions, 'A5'),
        isHUBZone: certifications.hasHUBZoneCertification || hasSBAType(assertions, 'A2'),
        isEDWOSB: certifications.hasEDWOSBCertification,
      },
      governmentBusinessPOC: pocs.governmentBusinessPOC ? {
        firstName: pocs.governmentBusinessPOC.firstName,
        lastName: pocs.governmentBusinessPOC.lastName,
        title: pocs.governmentBusinessPOC.title,
        email: pocs.governmentBusinessPOC.email,
        phone: pocs.governmentBusinessPOC.phone,
      } : undefined,
    };
  });
}

function hasSBAType(assertions: any, typeCode: string): boolean {
  return (assertions.sbaBusinessTypes || []).some((t: any) => t.sbaBusinessTypeCode === typeCode);
}

// Cache helpers
async function getCachedResult(cacheKey: string): Promise<any | null> {
  try {
    const supabase = getSupabase();

    const { data } = await supabase
      .from('research_cache')
      .select('data, created_at')
      .eq('cache_key', cacheKey)
      .single();

    if (data) {
      const cacheAge = Date.now() - new Date(data.created_at).getTime();
      // SAM data changes less frequently - cache for 7 days
      if (cacheAge < 7 * 24 * 60 * 60 * 1000) {
        return data.data;
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function cacheResult(cacheKey: string, result: any): Promise<void> {
  try {
    const supabase = getSupabase();

    await supabase
      .from('research_cache')
      .upsert({
        cache_key: cacheKey,
        source: 'sam-entity',
        data: result,
        created_at: new Date().toISOString(),
      }, { onConflict: 'cache_key' });
  } catch (error) {
    console.warn('Failed to cache SAM entity result:', error);
  }
}

// Search for entities with flexible filters (used by Rosa scanner)
export async function searchSAMEntities(params: {
  naicsCode?: string;
  businessType?: 'small' | 'large' | 'all';
  certifications?: ('8a' | 'WOSB' | 'SDVOSB' | 'HUBZone')[];
  state?: string;
  limit?: number;
}): Promise<{ entities: SAMEntity[]; totalRecords: number }> {
  const { naicsCode, businessType = 'all', certifications = [], state, limit = 20 } = params;

  const apiKey = process.env.SAM_API_KEY;
  if (!apiKey) {
    console.warn('SAM_API_KEY not configured');
    return { entities: [], totalRecords: 0 };
  }

  try {
    const url = new URL(SAM_API_BASE);
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('registrationStatus', 'A');
    url.searchParams.set('includeSections', 'entityRegistration,coreData,assertions,certifications');

    if (naicsCode) {
      url.searchParams.set('naicsCode', naicsCode);
    }

    if (state) {
      url.searchParams.set('physicalAddressStateCode', state);
    }

    // Business type filter
    if (businessType === 'small') {
      url.searchParams.set('organizationStructure', '2J'); // Small business
    }

    // Certification filters - use first one if multiple (SAM API limitation)
    if (certifications.length > 0) {
      const certCodes: Record<string, string> = {
        '8a': 'A4',
        'WOSB': 'XX',
        'SDVOSB': 'A5',
        'HUBZone': 'A2',
      };
      const firstCert = certifications[0];
      if (certCodes[firstCert]) {
        url.searchParams.set('sbaBusinessTypeCode', certCodes[firstCert]);
      }
    }

    console.log(`SAM Entity Search: NAICS=${naicsCode}, type=${businessType}, certs=${certifications.join(',')}`);

    const response = await fetch(url.toString(), {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      console.warn(`SAM Entity API error: ${response.status}`);
      return { entities: [], totalRecords: 0 };
    }

    const data = await response.json() as any;
    const entities = parseEntities(data.entityData || []).slice(0, limit);

    return {
      entities,
      totalRecords: data.totalRecords || entities.length,
    };
  } catch (error) {
    console.error('SAM Entity search error:', error);
    return { entities: [], totalRecords: 0 };
  }
}

// Format for agent response
export function formatSAMEntityForAgent(verification: {
  isRegistered: boolean;
  isActive: boolean;
  entity: SAMEntity | null;
  certifications: string[];
  expirationWarning?: string;
}): string {
  if (!verification.isRegistered || !verification.entity) {
    return "Could not find this company in SAM.gov - they may not be registered or the name might be different.";
  }

  const e = verification.entity;
  let response = `SAM.gov confirms ${e.legalBusinessName} is ${verification.isActive ? 'actively registered' : 'registered but status unclear'}`;

  if (e.cageCode) {
    response += ` (CAGE: ${e.cageCode})`;
  }

  if (verification.certifications.length > 0) {
    response += `. Certifications: ${verification.certifications.join(', ')}`;
  }

  if (verification.expirationWarning) {
    response += `. ⚠️ ${verification.expirationWarning}`;
  }

  return response;
}
