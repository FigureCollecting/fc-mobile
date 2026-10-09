import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { TOKEN_STEPS, checkWorkflow, stepId, type Rule } from '../workflowTokenGuard';

// NODE_AUTH_TOKEN reads @figurecollecting packages. It may only sit in the env of an
// allow-listed install or image-build step: never workflow- or job-wide, never in with:,
// never as a value in run: text, never exported through $GITHUB_ENV.

const ROOT = path.resolve(__dirname, '../..');
const WORKFLOWS = path.join(ROOT, '.github/workflows');
const FIXTURES = path.join(__dirname, 'fixtures/workflows');

const load = (dir: string, file: string): unknown => parse(readFileSync(path.join(dir, file), 'utf8'));

function fixture(file: string, allowed = fixtureAllowList(file)): Rule[] {
  return checkWorkflow(file, load(FIXTURES, file), allowed).map((v) => v.rule).sort();
}

function fixtureAllowList(file: string): Set<string> {
  return new Set(['Install dependencies', 'Build image', 'Build and push'].map((step) => stepId(file, 'build', step)));
}

describe('workflow token guard on fixtures', () => {
  it('passes the allowed shapes: install and image-build step env, secret-envs by name, trivy by SHA', () => {
    expect(fixture('clean.yml')).toEqual([]);
  });

  it('fails on a workflow-level token', () => {
    expect(fixture('workflow-level-token.yml')).toEqual(['workflow-env']);
  });

  it('fails on a job-level token', () => {
    expect(fixture('job-level-token.yml')).toEqual(['job-env']);
  });

  it('fails on the token in with:', () => {
    expect(fixture('token-in-with.yml')).toEqual(['with']);
  });

  it('fails on a GITHUB_ENV export of the token', () => {
    expect(fixture('github-env-export.yml')).toEqual(['github-env']);
  });

  it('fails on the token on a non-install step', () => {
    const violations = checkWorkflow('non-install-step.yml', load(FIXTURES, 'non-install-step.yml'), fixtureAllowList('non-install-step.yml'));
    expect(violations).toEqual([{ file: 'non-install-step.yml', where: 'build > Run unit tests > env', rule: 'non-install-step' }]);
  });

  it('fails on the token value in run: text, even on an allowed step', () => {
    expect(fixture('token-in-run.yml')).toEqual(['run-value']);
  });

  it('fails on the token anywhere else (a container env, an if:, the run name)', () => {
    expect(fixture('token-elsewhere.yml')).toEqual(['elsewhere', 'elsewhere', 'elsewhere']);
  });

  it('fails on an npm ci that runs install scripts while the token is in the step env', () => {
    expect(fixture('npm-ci-scripts.yml')).toEqual(['npm-ci-scripts']);
  });

  it('fails on aquasecurity/trivy-action referenced by tag or short SHA instead of a full SHA', () => {
    expect(fixture('trivy-tag.yml')).toEqual(['trivy-unpinned', 'trivy-unpinned']);
  });

  it('flags every token-bearing step, and a by-name with:, once the steps are not allow-listed', () => {
    expect(fixture('clean.yml', new Set())).toEqual(['non-install-step', 'non-install-step', 'non-install-step', 'non-install-step', 'with']);
  });

  it('labels an unnamed step by its index', () => {
    const wf = { jobs: { build: { steps: [{ run: 'npm test', env: { NODE_AUTH_TOKEN: 'x' } }] } } };
    expect(checkWorkflow('x.yml', wf, new Set())).toEqual([{ file: 'x.yml', where: 'build > #0 > env', rule: 'non-install-step' }]);
  });

  it('tolerates documents without jobs or steps', () => {
    expect(checkWorkflow('x.yml', null, new Set())).toEqual([]);
    expect(checkWorkflow('x.yml', { jobs: { call: { uses: './other.yml' } } }, new Set())).toEqual([]);
  });
});

describe('workflow token guard on .github/workflows', () => {
  const files = readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f)).sort();

  it('finds the workflows', () => {
    expect(files).toEqual(['build.yml', 'codeql.yml', 'security-scan.yml', 'stack.yml', 'web-image.yml']);
  });

  it.each(files)('%s keeps NODE_AUTH_TOKEN to allow-listed install steps', (file) => {
    expect(checkWorkflow(file, load(WORKFLOWS, file), TOKEN_STEPS)).toEqual([]);
  });

  it('has no stale allow-list entries', () => {
    const present = new Set<string>();
    for (const file of files) {
      const jobs = (load(WORKFLOWS, file) as { jobs: Record<string, { steps?: { name?: string }[] }> }).jobs;
      for (const [job, def] of Object.entries(jobs)) {
        for (const step of def.steps ?? []) present.add(stepId(file, job, String(step.name)));
      }
    }
    expect([...TOKEN_STEPS].filter((id) => !present.has(id))).toEqual([]);
    expect(TOKEN_STEPS.size).toBeGreaterThan(0);
  });
});
