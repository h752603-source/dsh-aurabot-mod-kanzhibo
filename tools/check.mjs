#!/usr/bin/env node
// CI / 本地用：检查提交进去的东西自不自洽。
//   1. registry/index.json 里每个模块的 sha256 / bytes 和 zip 对不对得上
//   2. 模块 zip 里的 module.json 的 id / version 和索引对不对得上
//   3. module/module.json 的版本和 module/index.mjs 里的 version 对不对得上
//   4. 模块能跑离线自检（verify/verify.mjs）
// 任何一项不对退出码 1。

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const problems = []
const ok = (msg) => console.log('  OK   ' + msg)
const bad = (msg) => { problems.push(msg); console.log('  FAIL ' + msg) }

const indexPath = join(ROOT, 'registry', 'index.json')
const manifestPath = join(ROOT, 'module', 'module.json')
if (!existsSync(indexPath)) { console.log('没有 registry/index.json，先跑 node tools/pack.mjs'); process.exit(1) }
if (!existsSync(manifestPath)) { console.log('没有 module/module.json'); process.exit(1) }

const index = JSON.parse(readFileSync(indexPath, 'utf8'))
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const entrySrc = readFileSync(join(ROOT, 'module', 'index.mjs'), 'utf8')

console.log('索引：schema ' + index.schema + '，assetsBase ' + index.assetsBase)
if (index.schema === 1) ok('索引 schema = 1')
else bad('索引 schema 不是 1')
if (/^https:\/\//.test(String(index.assetsBase))) ok('assetsBase 是 https')
else bad('assetsBase 不是 https：' + index.assetsBase)
if (String(index.assetsBase).includes('USER/REPO')) bad('assetsBase 还是占位符 USER/REPO，发布前跑 tools/pack.mjs --owner=<你的用户名>')

for (const e of index.modules || []) {
  const zip = join(ROOT, 'registry', e.path || '')
  if (!existsSync(zip)) { bad(e.id + '：找不到 ' + (e.path || '（path 为空）')); continue }
  const buf = readFileSync(zip)
  const sha = createHash('sha256').update(buf).digest('hex')
  sha === e.sha256 ? ok(e.id + '：zip sha256 对得上') : bad(e.id + '：sha256 不一致（' + sha.slice(0, 12) + ' vs ' + String(e.sha256).slice(0, 12) + '），重跑 pack.mjs')
  buf.length === e.bytes ? ok(e.id + '：zip 大小对得上') : bad(e.id + '：bytes 不一致')
  const m = JSON.parse(readFileSync(manifestPath, 'utf8'))
  m.id === e.id ? ok(e.id + '：module.json 的 id 对得上') : bad(e.id + '：module.json 的 id 是 ' + m.id)
  m.version === e.version ? ok(e.id + '：版本对得上（' + e.version + '）') : bad(e.id + '：module.json 是 ' + m.version + '，索引里是 ' + e.version)
}

const v = (/version:\s*'([^']+)'/.exec(entrySrc) || [])[1]
v === manifest.version ? ok('index.mjs 的 version 和 module.json 一致（' + v + '）') : bad('index.mjs 是 ' + v + '，module.json 是 ' + manifest.version)
const idInCode = (/id:\s*'([^']+)'/.exec(entrySrc) || [])[1]
idInCode === manifest.id ? ok('index.mjs 的 id 和 module.json 一致（' + idInCode + '）') : bad('index.mjs 的 id 是 ' + idInCode)

console.log('\n跑模块离线自检…')
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'module', 'verify', 'verify.mjs')], { cwd: ROOT, encoding: 'utf8' })
  const last = out.trim().split('\n').pop()
  if (/0 失败/.test(last)) ok('verify: ' + last)
  else bad('verify: ' + last)
} catch (error) {
  bad('verify 挂了：' + String(error.message || error).split('\n')[0])
}

console.log(problems.length ? '\n有 ' + problems.length + ' 项不对' : '\n全部通过')
process.exit(problems.length ? 1 : 0)
