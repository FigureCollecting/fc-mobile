// ADDR-1: ONE public image address (fc-infra edge README "The public image address"): every
// derivative and mask is <MEDIA_PUBLIC_BASE_URL>/<64 lowercase hex>, the same in every phase.
import { describe, expect, it } from 'vitest';
import { DEFAULT_MEDIA_PUBLIC_BASE_URL, MEDIA_PUBLIC_BASE_URL, MEDIA_ORIGIN, isMediaUrl, resolveMediaBase } from '../address';

const HEX = 'ab'.repeat(32);

describe('the public image address', () => {
  it('is https://images.figurecollecting.com/d unless the build says otherwise', () => {
    expect(DEFAULT_MEDIA_PUBLIC_BASE_URL).toBe('https://images.figurecollecting.com/d');
    expect(MEDIA_PUBLIC_BASE_URL).toBe(DEFAULT_MEDIA_PUBLIC_BASE_URL);
    expect(MEDIA_ORIGIN).toBe('https://images.figurecollecting.com');
  });

  it('takes a build value, trimmed of white space and trailing slashes', () => {
    expect(resolveMediaBase(' http://localhost:8480/media/d// ')).toBe('http://localhost:8480/media/d');
    expect(resolveMediaBase('')).toBe(DEFAULT_MEDIA_PUBLIC_BASE_URL);
    expect(resolveMediaBase('   ')).toBe(DEFAULT_MEDIA_PUBLIC_BASE_URL);
    expect(resolveMediaBase(undefined)).toBe(DEFAULT_MEDIA_PUBLIC_BASE_URL);
  });

  it('names a derivative only as <base>/<64 lowercase hex>, exactly', () => {
    expect(isMediaUrl(`https://images.figurecollecting.com/d/${HEX}`)).toBe(true);
    expect(isMediaUrl(new URL(`https://images.figurecollecting.com/d/${HEX}`))).toBe(true);
    for (const url of [
      `https://images.figurecollecting.com/d/${HEX.toUpperCase()}`,
      `https://images.figurecollecting.com/d/${HEX.slice(1)}`,
      `https://images.figurecollecting.com/d/${HEX}0`,
      `https://images.figurecollecting.com/d/${HEX}/x`,
      `https://images.figurecollecting.com/d/${HEX}?raw=1`,
      `https://images.figurecollecting.com/d/${HEX}#x`,
      `https://images.figurecollecting.com/serve/1@2`,
      `https://images.figurecollecting.com/x/d/${HEX}`,
      `http://images.figurecollecting.com/d/${HEX}`,
      `https://images.figurecollecting.com.evil.example/d/${HEX}`,
      `https://figurecollecting.com/media/d/${HEX}`,
      `https://static.myfigurecollection.net/d/${HEX}`,
      'not a url',
      '',
    ]) {
      expect(isMediaUrl(url), url).toBe(false);
    }
  });

  it('checks against the base it is given', () => {
    expect(isMediaUrl(`http://localhost:8480/media/d/${HEX}`, 'http://localhost:8480/media/d')).toBe(true);
    expect(isMediaUrl(`https://images.figurecollecting.com/d/${HEX}`, 'http://localhost:8480/media/d')).toBe(false);
  });
});
