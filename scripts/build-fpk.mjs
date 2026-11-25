import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'dist/fnos');
const pack = join(out, 'package');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

// 飞牛使用同源 HTTP / WebSocket，避免把其他平台的远程地址写入安装包。
execFileSync('npm', ['run', 'build'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, VITE_SERVER_URL: '', VITE_PUBLIC_URL: '', VITE_REMOTE_URL: '' },
});
rmSync(pack, { recursive: true, force: true });
cpSync(join(root, 'packaging/fnos'), pack, { recursive: true });
copyFileSync(join(root, 'apps/server/dist/main.js'), join(pack, 'app/server.mjs'));
cpSync(join(root, 'apps/web/dist'), join(pack, 'app/web'), { recursive: true });
copyFileSync(join(root, 'LICENSE'), join(pack, 'LICENSE'));
const images = join(pack, 'app/ui/images');
mkdirSync(images, { recursive: true });
copyFileSync(join(pack, 'ICON.PNG'), join(images, 'icon_64.png'));
copyFileSync(join(pack, 'ICON_256.PNG'), join(images, 'icon_256.png'));
const manifest = join(pack, 'manifest');
writeFileSync(
  manifest,
  readFileSync(manifest, 'utf8').replace(/^version=.*$/m, `version=${version}`),
);
for (const name of readdirSync(join(pack, 'cmd'))) chmodSync(join(pack, 'cmd', name), 0o755);

execFileSync(process.execPath, ['--test', 'scripts/test-fpk.mjs'], { cwd: root, stdio: 'inherit' });
const rawArtifact = join(out, 'deskpark.fpk');
rmSync(rawArtifact, { force: true });
execFileSync(process.env.FNPACK || 'fnpack', ['build', '--nosign', '--directory', pack], {
  cwd: out,
  stdio: 'inherit',
});
if (!existsSync(rawArtifact)) throw new Error('fnpack 未生成 FPK，请检查上方的打包错误。');
const filename = `deskpark-${version}.fpk`;
const artifact = join(out, filename);
renameSync(rawArtifact, artifact);
const checksum = createHash('sha256').update(readFileSync(artifact)).digest('hex');
writeFileSync(`${artifact}.sha256`, `${checksum}  ${filename}\n`);
console.log(`FPK: ${artifact}`);
