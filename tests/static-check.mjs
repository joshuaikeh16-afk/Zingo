import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';
const check = (path) => {
  const ts = path.endsWith('.ts');
  const result = spawnSync(process.execPath, ts ? ['--check', '--input-type=module'] : ['--check', path], { encoding: 'utf8', env: process.env,
    ...(ts ? { input: stripTypeScriptTypes(readFileSync(path, 'utf8'), { mode: 'strip' }) } : {}) });
  assert.equal(result.status, 0, result.stderr);
};
const root = resolve(import.meta.dirname, '..');
const html = readFileSync(`${root}/app.html`, 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, 'Duplicate DOM IDs');
for (const page of readdirSync(root).filter(file => file.endsWith('.html'))) {
  const source = readFileSync(`${root}/${page}`, 'utf8');
  const pageIds = [...source.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(pageIds).size, pageIds.length, `${page}: duplicate DOM IDs`);
  for (const match of source.matchAll(/(?:src|href)="(\/[^"#]+)"/g)) assert(existsSync(root + match[1].split('?')[0]), `${page}: missing asset ${match[1]}`);
}
assert(!/compose-modal|data-action="compose"|gemini|video-post/i.test(html), 'Removed flows remain in app HTML');
const files = readdirSync(`${root}/js`).filter((file) => file.endsWith('.js'));
for (const file of files) {
  const path = `${root}/js/${file}`, source = readFileSync(path, 'utf8');
  for (const match of source.matchAll(/from ['"](\.[^'"]+)['"]/g)) {
    const imported = resolve(dirname(path), match[1]);
    assert(existsSync(imported), `${file}: missing import ${match[1]}`);
  }
  check(path);
}
const scan = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? scan(`${dir}/${entry.name}`) : entry.name.endsWith('.ts') ? [`${dir}/${entry.name}`] : []);
for (const file of scan(`${root}/supabase/functions`)) {
  check(file);
}
console.log('Static checks passed: DOM IDs, assets, local imports, JS and Edge Function syntax.');
