// The shipped CSP has no 'unsafe-inline'. These patterns each create an inline
// style or script at runtime, which the browser blocks and reports.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '..');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' || e.name === 'test' ? [] : sources(full);
    return /\.(ts|tsx)$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name) ? [full] : [];
  });
}

function offenders(pattern: RegExp): string[] {
  return sources(SRC).flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, i) => (!/^\s*(\/\/|\/?\*)/.test(line) && pattern.test(line) ? [`${path.relative(SRC, file)}:${i + 1}`] : [])),
  );
}

describe('source is compatible with a CSP without unsafe-inline', () => {
  it('renders component CSS through <Style>, never a <style> element', () => {
    expect(offenders(/<style[\s>]/)).toEqual([]);
  });

  it("never uses framer-motion's popLayout, which injects a <style> element", () => {
    expect(offenders(/mode=["']popLayout["']/)).toEqual([]);
  });

  it('never writes a style attribute through markup or setAttribute', () => {
    expect(offenders(/style=\\?["']|setAttribute\(\s*["']style["']/)).toEqual([]);
  });

  it('never evaluates strings as code', () => {
    expect(offenders(/\beval\(|new Function\(|set(Timeout|Interval)\(\s*["'`]/)).toEqual([]);
  });
});
