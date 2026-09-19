import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DefaultResourceLoader,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = await mkdtemp(join(tmpdir(), "pi-install-test-"));
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, "Run this check with npm run test:install");

function npm(args, cwd) {
  const result = spawnSync(
    process.execPath,
    [npmCli, ...args, ...process.argv.slice(2), "--no-audit", "--no-fund"],
    {
      cwd,
      encoding: "utf8",
      timeout: 180_000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

async function loadPackage(packagePath, label) {
  const cwd = join(temporary, `${label}-project`);
  const agentDir = join(temporary, `${label}-agent`);
  await mkdir(cwd);
  await mkdir(agentDir);
  const settingsManager = SettingsManager.inMemory(
    { packages: [packagePath] },
    { projectTrusted: false },
  );
  const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager });
  await loader.reload();
  const loaded = loader.getExtensions();
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, manifest.pi.extensions.length);
  const packageSkills = loader.getSkills().skills.filter((skill) => {
    const path = relative(packagePath, skill.filePath);
    return !path.startsWith("..") && !isAbsolute(path);
  });
  assert.deepEqual(packageSkills.map((skill) => skill.name).sort(), [
    "background-terminals",
    "subagents",
  ]);
  assert.ok(
    loader
      .getThemes()
      .themes.some((theme) => theme.name === "github-dark-default"),
  );
  console.log(
    `${label}: loaded ${loaded.extensions.length} extensions, 2 skills, and the theme`,
  );
}

try {
  const [packed] = JSON.parse(
    npm(["pack", "--json", "--pack-destination", temporary], root),
  );
  assert.ok(
    packed.files.some(
      (file) => file.path === "extensions/workflows/sandbox-child.cjs",
    ),
  );
  assert.ok(
    !packed.files.some((file) =>
      /\.(test|spec)\.ts$|config\.private|^\.env/.test(file.path),
    ),
  );

  // Recreate a checkout without node_modules so undeclared dependencies cannot leak in.
  const checkout = join(temporary, "checkout");
  for (const { path } of packed.files) {
    const target = join(checkout, path);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(root, path), target);
  }
  await copyFile(
    join(root, "package-lock.json"),
    join(checkout, "package-lock.json"),
  );
  npm(["ci", "--omit=dev"], checkout);
  await loadPackage(checkout, "clean production checkout");

  // Pi runs npm install for Git packages, including on repeat installation.
  const lockBefore = await readFile(
    join(checkout, "package-lock.json"),
    "utf8",
  );
  npm(["install", "--omit=dev"], checkout);
  assert.equal(
    await readFile(join(checkout, "package-lock.json"), "utf8"),
    lockBefore,
  );
  console.log("repeat production install: lockfile unchanged");

  const consumer = join(temporary, "consumer");
  await mkdir(consumer);
  await writeFile(
    join(consumer, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      dependencies: {
        ...Object.fromEntries(
          Object.keys(manifest.peerDependencies).map((name) => [
            name,
            manifest.devDependencies[name],
          ]),
        ),
        [manifest.name]: `file:${resolve(temporary, packed.filename)}`,
      },
    }),
  );
  npm(["install", "--omit=dev"], consumer);
  await loadPackage(
    join(consumer, "node_modules", manifest.name),
    "packed plugin",
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
