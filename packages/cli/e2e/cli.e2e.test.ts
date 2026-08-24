import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The phase prompt's own spec: every e2e test drives the real built CLI as a
// subprocess via `node <dist/index.js>` (never `shell: true` — matches the
// repo's forbidden-pattern CI check). The test:e2e script builds first, so
// dist/ is guaranteed to exist when these run; if it does not, the spawn
// error below surfaces a clear, actionable message rather than a bare ENOENT.
const CLI_PATH = fileURLToPath(new URL('../dist/index.js', import.meta.url));

const SKILL_NAME = 'safe-skill';
const SKILL_VERSION = '0.1.0';

interface CliResult {
  /** Process exit code, or null when the child was killed/never exited. */
  status: number | null;
  stdout: string;
  stderr: string;
}

interface RunOptions {
  cwd: string;
  registry: string;
  /**
   * Piped-stdin answers, one per prompt, written only once that prompt's
   * marker text has appeared in the child's output. Keeps stdin open until
   * the child exits: closing the pipe early would force-close any prompt
   * whose readline has not started yet (observed empirically — a
   * pre-buffered pipe with EOF only answers the first of several prompts).
   */
  answers?: string[];
}

// Prompt markers, aligned index-wise with the answers array. The order is
// the order adopt's prompts appear (adopt.ts): author name, author email,
// license (skipped — the fixture frontmatter declares license: MIT), confirm.
const PROMPT_MARKERS = ['Author name:', 'Author email', 'Register this skill?'];

function runCli(args: string[], opts: RunOptions): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd: opts.cwd,
      env: { ...process.env, GOODBOY_REGISTRY: opts.registry },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let answerIndex = 0;
    const answers = opts.answers ?? [];

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(
        new Error(
          `CLI command timed out after 30s: goodboy ${args.join(' ')} ` +
            `(stdout so far: ${JSON.stringify(stdout.slice(-500))})`,
        ),
      );
    }, 30_000);

    const driveAnswers = (): void => {
      if (answerIndex >= answers.length) return;
      const output = stdout + stderr;
      while (answerIndex < answers.length && output.includes(PROMPT_MARKERS[answerIndex])) {
        child.stdin.write(answers[answerIndex] + '\n');
        answerIndex += 1;
      }
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      driveAnswers();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      driveAnswers();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(
        new Error(
          `Failed to spawn ${CLI_PATH}: ${err.message}. ` +
            `The CLI must be built first — run 'npm run build -w packages/cli'.`,
        ),
      );
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({ status: code, stdout, stderr });
    });
  });
}

function writeManifest(dir: string): void {
  // Mirrors the shape of src/__fixtures__/valid-no-permissions.json: no
  // `permissions`, so requestConsent() returns true without prompting and
  // install never blocks on stdin. keywords/category are included to keep
  // add's validation output warning-free.
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify(
      {
        name: SKILL_NAME,
        version: SKILL_VERSION,
        description: 'A skill with no elevated access claimed',
        author: { name: 'Test Author' },
        license: 'MIT',
        schema_version: '2.0.0',
        status: 'experimental',
        keywords: ['test'],
        category: 'other',
      },
      null,
      2,
    ) + '\n',
  );
}

function writeSkillMd(dir: string, license?: string): void {
  // Frontmatter name/description mirror the manifest exactly (keeps
  // validateSkillDirectory warning-free); license is only present for the
  // adopt flow, where it is what skips adopt's own License prompt.
  const licenseLine = license ? `license: ${license}\n` : '';
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${SKILL_NAME}\ndescription: A skill with no elevated access claimed\n${licenseLine}---\n` +
      `# ${SKILL_NAME}\n\n` +
      'This is the body of the skill: enough prose to clear the 50-character\n' +
      'body warning threshold while still being a plain, honest fixture.\n',
  );
}

// Registers the skill in the temp registry and installs it into
// <projectDir>/.claude/skills/ — the shared setup of flows 1–3.
async function addAndInstall(opts: { cwd: string; registry: string }): Promise<void> {
  const sourceDir = join(opts.cwd, SKILL_NAME);
  const added = await runCli(['add', sourceDir], opts);
  expect(added.status).toBe(0);
  expect(added.stdout + added.stderr).toContain('added to registry');

  const installed = await runCli(['install', SKILL_NAME], opts);
  expect(installed.status).toBe(0);
  expect(existsSync(join(opts.cwd, '.claude', 'skills', SKILL_NAME))).toBe(true);
}

// Real temp filesystem, real built binary, real subprocess — no mocks. Each
// test gets its own project dir, its own registry dir, and its own source
// dir; the registry dir is created before the first spawn because
// getRegistryPath() falls back to the real ~/.goodboy/registry when the
// GOODBOY_REGISTRY path does not exist — a test that forgot that would
// silently write to the developer's actual registry.
describe('goodboy real-binary end-to-end', () => {
  // Existence gate with a clear, actionable message. Without it, a missing
  // binary would fail cryptically: spawning `node <missing-path>` succeeds
  // (node itself exists), then node exits 1 with an ENOENT stack trace —
  // exactly the failure this repo's guard-observed-failing rule exists to
  // catch. The test:e2e script builds first, so this only fires when someone
  // runs the e2e config directly without a build.
  beforeAll(() => {
    if (!existsSync(CLI_PATH)) {
      throw new Error(
        `Built CLI not found at ${CLI_PATH} — run 'npm run build -w packages/cli' first ` +
          `(npm run test:e2e does this automatically).`,
      );
    }
  });

  let projectDir: string;
  let registryDir: string;
  let sourceDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'goodboy-e2e-project-'));
    registryDir = mkdtempSync(join(tmpdir(), 'goodboy-e2e-registry-'));
    sourceDir = join(projectDir, SKILL_NAME);
    mkdirSync(sourceDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(registryDir, { recursive: true, force: true });
  });

  it('flow 1: add → install → verify, clean, exit 0', async () => {
    writeManifest(sourceDir);
    writeSkillMd(sourceDir);

    await addAndInstall({ cwd: projectDir, registry: registryDir });

    const verify = await runCli(['verify'], { cwd: projectDir, registry: registryDir });
    expect(verify.status).toBe(0);
    expect(verify.stdout).toContain('verified');
    expect(verify.stdout).toContain(SKILL_NAME);
  });

  it('flow 2: tamper the installed file → verify exits 1 with mismatch', async () => {
    writeManifest(sourceDir);
    writeSkillMd(sourceDir);
    await addAndInstall({ cwd: projectDir, registry: registryDir });

    const installedSkillMd = join(projectDir, '.claude', 'skills', SKILL_NAME, 'SKILL.md');
    writeFileSync(installedSkillMd, readFileSync(installedSkillMd, 'utf8') + '\n# Tampered\n');

    const verify = await runCli(['verify'], { cwd: projectDir, registry: registryDir });
    expect(verify.status).toBe(1);
    expect(verify.stdout + verify.stderr).toContain('mismatch');
  });

  it('flow 3: install → list → uninstall, project scope', async () => {
    writeManifest(sourceDir);
    writeSkillMd(sourceDir);
    await addAndInstall({ cwd: projectDir, registry: registryDir });

    const listed = await runCli(['list'], { cwd: projectDir, registry: registryDir });
    expect(listed.status).toBe(0);
    expect(listed.stdout).toContain(SKILL_NAME);

    const uninstalled = await runCli(['uninstall', SKILL_NAME], {
      cwd: projectDir,
      registry: registryDir,
    });
    expect(uninstalled.status).toBe(0);
    expect(existsSync(join(projectDir, '.claude', 'skills', SKILL_NAME))).toBe(false);

    const listedAgain = await runCli(['list'], { cwd: projectDir, registry: registryDir });
    expect(listedAgain.status).toBe(0);
    expect(listedAgain.stdout).not.toContain(SKILL_NAME);
  });

  it('flow 4: adopt end-to-end, driven via piped stdin through its real prompts', async () => {
    // Source has SKILL.md only — no manifest.json (adopt would refuse it).
    // license: MIT in the frontmatter skips adopt's License prompt, leaving
    // exactly three answers: author name, author email, final confirm.
    writeSkillMd(sourceDir, 'MIT');

    const adopted = await runCli(['adopt', sourceDir], {
      cwd: projectDir,
      registry: registryDir,
      answers: ['Test Author', 'author@example.com', 'y'],
    });

    expect(adopted.status).toBe(0);
    expect(adopted.stdout + adopted.stderr).toContain('Adopted skill');

    const entryPath = join(registryDir, SKILL_NAME, 'registry-entry.json');
    expect(existsSync(entryPath)).toBe(true);
    const entry = JSON.parse(readFileSync(entryPath, 'utf8')) as {
      name: string;
      latest: string;
    };
    expect(entry.name).toBe(SKILL_NAME);
    expect(entry.latest).toBe(SKILL_VERSION);

    const versionDir = join(registryDir, SKILL_NAME, 'versions', SKILL_VERSION);
    expect(existsSync(join(versionDir, 'manifest.json'))).toBe(true);
    expect(existsSync(join(versionDir, 'SKILL.md'))).toBe(true);

    // The source directory must be untouched — no manifest.json synthesized
    // into it (mirrors the C6 §1 source-unmodified check).
    expect(existsSync(join(sourceDir, 'manifest.json'))).toBe(false);
  });
});
