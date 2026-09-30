/**
 * Set-Aside Normalization Tests
 *
 * Covers SAM.gov code mapping, FFTC eligibility, and prompt formatting.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeSetAside,
  formatSetAsideForPrompt,
  determineFftcEligibility,
} from '../set-aside.js';

const FFTC_CERTS = [
  'SBA 8(a) Business Development',
  'SBA Women-Owned Small Business (WOSB)',
  'Service-Disabled Veteran-Owned Small Business (SDVOSB)',
];
const FFTC_SET_ASIDES = ['8(a)', 'WOSB', 'SDVOSB'];

describe('Set-Aside Normalization', () => {
  it('unrestricted — NONE code', () => {
    const result = normalizeSetAside('NONE', 'No Set aside used', FFTC_CERTS, FFTC_SET_ASIDES);
    expect(result.normalizedType).toBe('UNRESTRICTED');
    expect(result.fftcEligible).toBe(true);
    expect(result.rawCode).toBe('NONE');
  });

  it('unrestricted — null/missing', () => {
    const result = normalizeSetAside(null, null, FFTC_CERTS, FFTC_SET_ASIDES);
    expect(result.normalizedType).toBe('UNRESTRICTED');
    expect(result.fftcEligible).toBe(true);
  });

  it('SBA small business set-aside', () => {
    const result = normalizeSetAside(
      'SBA',
      'Small Business Set Aside - Total',
      FFTC_CERTS,
      FFTC_SET_ASIDES
    );
    expect(result.normalizedType).toBe('SBA_SMALL_BUSINESS');
    expect(result.fftcEligible).toBe(true);
    expect(result.rawLabel).toBe('Small Business Set Aside - Total');
  });

  it('8(a) program', () => {
    const result = normalizeSetAside('8A', '8(a) Set-Aside', FFTC_CERTS, FFTC_SET_ASIDES);
    expect(result.normalizedType).toBe('SBA_8A');
    expect(result.fftcEligible).toBe(true);
  });

  it('8(a) Native American variant', () => {
    const result = normalizeSetAside('8AN', '8(a) Native American', FFTC_CERTS, FFTC_SET_ASIDES);
    expect(result.normalizedType).toBe('SBA_8A');
    expect(result.fftcEligible).toBe(true);
  });

  it('SDVOSB', () => {
    const result = normalizeSetAside(
      'SDVOSB',
      'Service-Disabled Veteran-Owned',
      FFTC_CERTS,
      FFTC_SET_ASIDES
    );
    expect(result.normalizedType).toBe('SDVOSB');
    expect(result.fftcEligible).toBe(true);
  });

  it('WOSB', () => {
    const result = normalizeSetAside(
      'WOSB',
      'Women-Owned Small Business',
      FFTC_CERTS,
      FFTC_SET_ASIDES
    );
    expect(result.normalizedType).toBe('WOSB');
    expect(result.fftcEligible).toBe(true);
  });

  it('HUBZone — FFTC NOT eligible', () => {
    const result = normalizeSetAside('HZC', 'HUBZone', FFTC_CERTS, FFTC_SET_ASIDES);
    expect(result.normalizedType).toBe('HUBZONE');
    expect(result.fftcEligible).toBe(false);
  });

  it('unknown code', () => {
    const result = normalizeSetAside('XYZ123', 'Some Future Code', FFTC_CERTS, FFTC_SET_ASIDES);
    expect(result.normalizedType).toBe('UNKNOWN');
    expect(result.fftcEligible).toBe(false);
  });

  it('case insensitive code matching', () => {
    const result = normalizeSetAside('sba', 'Small Business', FFTC_CERTS, FFTC_SET_ASIDES);
    expect(result.normalizedType).toBe('SBA_SMALL_BUSINESS');
  });
});

describe('Prompt Formatting', () => {
  it('SBA eligible formats correctly', () => {
    const sa = normalizeSetAside(
      'SBA',
      'Small Business Set Aside - Total',
      FFTC_CERTS,
      FFTC_SET_ASIDES
    );
    const text = formatSetAsideForPrompt(sa);
    expect(text).toContain('Small Business');
    expect(text).toContain('FFTC ELIGIBLE');
    expect(text).not.toContain('NOT ELIGIBLE');
  });

  it('HUBZone ineligible formats correctly', () => {
    const sa = normalizeSetAside('HZC', 'HUBZone', FFTC_CERTS, FFTC_SET_ASIDES);
    const text = formatSetAsideForPrompt(sa);
    expect(text).toContain('FFTC NOT ELIGIBLE');
  });

  it('unrestricted formats correctly', () => {
    const sa = normalizeSetAside('NONE', null, FFTC_CERTS, FFTC_SET_ASIDES);
    const text = formatSetAsideForPrompt(sa);
    expect(text).toContain('Unrestricted');
    expect(text).toContain('FFTC ELIGIBLE');
  });
});

describe('Eligibility Without Certs', () => {
  it('company without 8(a) cert is ineligible for 8(a) set-aside', () => {
    const eligible = determineFftcEligibility('SBA_8A', [], []);
    expect(eligible).toBe(false);
  });

  it('company without SDVOSB cert is ineligible for SDVOSB set-aside', () => {
    const eligible = determineFftcEligibility('SDVOSB', [], []);
    expect(eligible).toBe(false);
  });

  it('any company eligible for unrestricted', () => {
    const eligible = determineFftcEligibility('UNRESTRICTED', [], []);
    expect(eligible).toBe(true);
  });

  it('any small business eligible for SBA set-aside', () => {
    const eligible = determineFftcEligibility('SBA_SMALL_BUSINESS', [], []);
    expect(eligible).toBe(true);
  });
});
