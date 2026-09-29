/**
 * 构建脚本：esbuild 打包 TS → dist/，并拷贝 manifest / html / css /
 * _locales / icons（manifest 的 version 从 package.json 注入）。
 *
 * 用法：
 *   node scripts/build.mjs          # 一次性构建（生产包，不含 E2E 钩子）
 *   node scripts/build.mjs --watch  # 监听模式（不压缩，方便调试）
 *   node scripts/build.mjs --zip    # 构建后打出 img2prompt-vx.y.z.zip
 *   node scripts/build.mjs --e2e    # E2E 专用构建（含 __img2promptE2E 钩子，仅测试用）
 */
import { build, context } from 'esbuild';
import { execFile } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const srcDir = path.join(root, 'src');
const distDir = path.join(root, 'dist');
const args = new Set(process.argv.slice(2));
const isWatch = args.has('--watch');
const wantZip = args.has('--zip');
/**
 * E2E 专用构建：service worker 暴露 __img2promptE2E 测试钩子。
 * 生产构建（默认）不包含该钩子，上架包不受影响。
 */
const isE2E = args.has('--e2e');

const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

/** 打包入口：background 必须是 esm（MV3 service worker 支持 module），其余用 iife */
const entries = [
  { entry: 'src/background/service-worker.ts', out: 'background/service-worker.js', format: 'esm' },
  { entry: 'src/content/content-script.ts', out: 'content/content-script.js', format: 'iife' },
  { entry: 'src/popup/popup.ts', out: 'popup/popup.js', format: 'iife' },
  { entry: 'src/options/options.ts', out: 'options/options.js', format: 'iife' },
];

/** 拷贝静态资源；clean=true 时先清空 dist */
async function copyStatic(clean) {
  if (clean) {
    await rm(distDir, { recursive: true, force: true });
  }
  await mkdir(distDir, { recursive: true });

  // manifest：版本号从 package.json 注入，保持单一事实来源
  const manifest = JSON.parse(await readFile(path.join(srcDir, 'manifest.json'), 'utf8'));
  manifest.version = pkg.version;
  await writeFile(path.join(distDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  for (const dir of ['popup', 'options']) {
    await cp(path.join(srcDir, dir), path.join(distDir, dir), {
      recursive: true,
      filter: (src) => !src.endsWith('.ts'),
    });
  }
  await cp(path.join(srcDir, 'assets'), path.join(distDir, 'assets'), { recursive: true });
  await cp(path.join(root, '_locales'), path.join(distDir, '_locales'), { recursive: true });
}

function esbuildOptions(entry) {
  return {
    entryPoints: [path.join(root, entry.entry)],
    outfile: path.join(distDir, entry.out),
    bundle: true,
    minify: !isWatch,
    sourcemap: true,
    format: entry.format,
    target: 'chrome116',
    logLevel: 'warning',
    define: { __IMG2PROMPT_E2E__: String(isE2E) },
  };
}

/** 打 zip 包（用于 Release 附件与手动分发） */
async function makeZip() {
  const zipName = `img2prompt-v${pkg.version}.zip`;
  const zipPath = path.join(root, zipName);
  await rm(zipPath, { force: true });
  await promisify(execFile)('zip', ['-qr', zipPath, '.'], { cwd: distDir });
  console.log(`zip: ${zipName}`);
}

if (isWatch) {
  await copyStatic(true);
  const copyPlugin = {
    name: 'copy-static',
    setup(pluginBuild) {
      pluginBuild.onEnd(() => copyStatic(false));
    },
  };
  const contexts = await Promise.all(
    entries.map((entry) => context({ ...esbuildOptions(entry), plugins: [copyPlugin] }))
  );
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log('watching src/ → dist/ …');
} else {
  await copyStatic(true);
  for (const entry of entries) {
    await build(esbuildOptions(entry));
  }
  if (wantZip) {
    await makeZip();
  }
  console.log('build done → dist/');
}
