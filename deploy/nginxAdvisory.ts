/**
 * nginx.org security advisories (CVE-2026-121810, -123007, -123633, -123634, -118899, -113425,
 * -125283, -120967, -123640):
 * not vulnerable in 1.30.7+ (stable) and 1.31.9+ (mainline). A version on neither line past those is
 * read as not fixed, so a base image move to another line has to update this first.
 */
export function nginxFixed(version: string): boolean {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (m === null) return false;
  const [major, minor, patch] = m.slice(1).map(Number);
  if (major !== 1) return false;
  if (minor === 30) return patch >= 7;
  if (minor === 31) return patch >= 9;
  return false;
}
