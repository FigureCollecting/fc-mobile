import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// LGMOB: diagnostic ids reach users only with the /privacy page (P1). The flag (VITE_DIAG_IDS, src/config/features.ts)
// is off unless set to "true", and nothing that builds the app sets it: no env file the image build reads, not the Dockerfile
// (whose build loads .env.production), not a workflow. The web image job passes VITE_BUILD_ID alone as a build arg
// (deploy/workflowTokenGuard.ts). A run that wants ids on sets VITE_DIAG_IDS=true in its own environment.
const ROOT = path.resolve(__dirname, '../..');
const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');
const FLAG = /VITE_DIAG_IDS/;

describe('VITE_DIAG_IDS: set by nothing that builds the app', () => {
  it('no env file the image build reads sets it, .env.production included (the .local ones are dockerignored)', () => {
    const envFiles = readdirSync(ROOT).filter((f) => /^\.env(\.|$)/.test(f) && !f.endsWith('.local'));
    expect(envFiles).toEqual(expect.arrayContaining(['.env.production', '.env.test', '.env.development', '.env.stack']));
    for (const f of envFiles) expect(read(f), f).not.toMatch(/^\s*(export\s+)?VITE_DIAG_IDS\s*=/m);
  });

  it('the Dockerfile neither takes nor sets it', () => {
    expect(read('Dockerfile')).not.toMatch(FLAG);
  });

  it('no workflow passes it', () => {
    const dir = path.join(ROOT, '.github/workflows');
    const workflows = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
    expect(workflows).toContain('web-image.yml');
    for (const f of workflows) expect(readFileSync(path.join(dir, f), 'utf8'), f).not.toMatch(FLAG);
  });
});
