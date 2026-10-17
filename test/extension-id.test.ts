import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * 扩展身份守护：
 * - manifest 必须带固定 "key"：扩展 ID 由它派生、与加载路径无关，
 *   这样手动拖新版本到浏览器加载时 ID 不变，chrome.storage 里的
 *   配置（服务商/Key/模板/历史）会被自动继承。改 key = 全员配置清零，禁止。
 * - package.json 与 manifest 的版本号必须一致（发版纪律）。
 */

interface ManifestShape {
  key?: string;
  version?: string;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as T;
}

/** 按 Chrome 规则从 manifest key 派生扩展 ID（公钥 DER 的 SHA-256 前 16 字节映射到 a-p） */
function deriveExtensionId(keyBase64: string): string {
  const der = Buffer.from(keyBase64, 'base64');
  const digest = createHash('sha256').update(der).digest();
  let id = '';
  for (const byte of digest.subarray(0, 16)) {
    id += String.fromCharCode(97 + (byte >> 4));
    id += String.fromCharCode(97 + (byte & 0xf));
  }
  return id;
}

describe('扩展身份', () => {
  const manifest = readJson<ManifestShape>('../src/manifest.json');
  const pkg = readJson<{ version: string }>('../package.json');

  it('manifest 带固定 key 且派生 ID 为约定值', () => {
    expect(manifest.key).toBeTruthy();
    expect(deriveExtensionId(manifest.key!)).toBe('flcopnobpiiphipikpnnfohlomknphmc');
  });

  it('package.json 与 manifest 版本号一致', () => {
    expect(manifest.version).toBe(pkg.version);
  });
});
