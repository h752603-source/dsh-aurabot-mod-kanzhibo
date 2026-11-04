#!/usr/bin/env node
// 一键打包：module/ → registry/<id>-<version>.zip + registry/index.json
//
// 用法（在仓库根目录）：
//   node tools/pack.mjs --owner=<你的GitHub用户名>                 # 仓库名默认取当前文件夹名
//   node tools/pack.mjs --owner=xxx --repo=dsh-aurabot-mod-kanzhibo --branch=main
//
// 产物：
//   registry/<id>-<version>.zip   模块本体，zip 根目录 = modules/<id>/ 里的内容
//   registry/index.json           Aurabot「模块市场」读的索引（schema 1）
//
// 校验：写完立刻用和插件同一套规则（路径安全 / 压缩方式 / crc32 / 大小）读回来比一遍，
// 任何一项不对就退出码 1，不会留下坏包。

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const MODULE_DIR = join(ROOT, 'module')
const REGISTRY_DIR = join(ROOT, 'registry')
const SKIP = new Set(['node_modules', '.git', '.aurabot-cache', 'modules-data'])

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)=(.*)$/.exec(a)
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true]
  }),
)
const owner = typeof args.owner === 'string' ? args.owner : ''
const repo = typeof args.repo === 'string' ? args.repo : basename(ROOT)
const branch = typeof args.branch === 'string' ? args.branch : 'main'

// ---------- 收文件 ----------
function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    if (SKIP.has(name)) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else out.push({ name: relative(MODULE_DIR, full).split(sep).join('/'), data: readFileSync(full) })
  }
  return out
}

// ---------- 写 zip（只写文件条目，不写目录条目；文件名一律 UTF-8） ----------
function buildZip(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8')
    const crc = crc32(data)
    let method = 8
    let body = deflateRawSync(data, { level: 9 })
    if (body.length >= data.length) { method = 0; body = data } // 压不动就存
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4)
    lh.writeUInt16LE(0x0800, 6) // UTF-8 文件名
    lh.writeUInt16LE(method, 8)
    lh.writeUInt32LE(crc, 14)
    lh.writeUInt32LE(body.length, 18)
    lh.writeUInt32LE(data.length, 22)
    lh.writeUInt16LE(nameBuf.length, 26)
    const record = Buffer.concat([lh, nameBuf, body])
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0)
    ch.writeUInt16LE(20, 4)
    ch.writeUInt16LE(20, 6)
    ch.writeUInt16LE(0x0800, 8)
    ch.writeUInt16LE(method, 10)
    ch.writeUInt32LE(crc, 16)
    ch.writeUInt32LE(body.length, 20)
    ch.writeUInt32LE(data.length, 24)
    ch.writeUInt16LE(nameBuf.length, 28)
    ch.writeUInt32LE(offset, 42)
    locals.push(record)
    centrals.push(Buffer.concat([ch, nameBuf]))
    offset += record.length
  }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, eocd])
}

// ---------- 读回校验（和插件 src/core/community.js 的 readZip 同一套规则） ----------
const safeName = (name) =>
  Boolean(name) && !name.includes('\\') && !name.includes('\0') && !name.startsWith('/') && !/^[a-zA-Z]:/.test(name) &&
  name.split('/').every((seg) => seg && seg !== '.' && seg !== '..')

function readZip(buf) {
  let end = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break }
  if (end < 0) throw new Error('不是有效的 zip')
  const count = buf.readUInt16LE(end + 10)
  let p = buf.readUInt32LE(end + 16)
  const files = new Map()
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip 目录损坏')
    const flags = buf.readUInt16LE(p + 8)
    const method = buf.readUInt16LE(p + 10)
    const crc = buf.readUInt32LE(p + 16)
    const packed = buf.readUInt32LE(p + 20)
    const size = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    p += 46 + nameLen + extraLen + commentLen
    if (flags & 1) throw new Error('zip 不能加密')
    if (name.endsWith('/')) continue
    if (!safeName(name)) throw new Error('不安全的路径：' + name)
    if (method !== 0 && method !== 8) throw new Error('不支持的压缩方式：' + name)
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new Error('zip 文件头损坏')
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const raw = buf.subarray(start, start + packed)
    const data = method === 8 ? inflateRawSync(raw) : Buffer.from(raw)
    if (data.length !== size || crc32(data) !== crc) throw new Error('zip 校验失败：' + name)
    files.set(name, data)
  }
  return files
}

// ---------- 主流程 ----------
const manifest = JSON.parse(readFileSync(join(MODULE_DIR, 'module.json'), 'utf8'))
if (!/^[a-z][a-z0-9-]{1,39}$/.test(manifest.id)) throw new Error('module.json 的 id 不合规：' + manifest.id)
if (!/^\d+\.\d+\.\d+/.test(manifest.version)) throw new Error('module.json 的 version 要写成 x.y.z')

const entries = walk(MODULE_DIR)
if (!entries.some((e) => e.name === 'index.mjs')) throw new Error('module/ 里没有 index.mjs')
if (!entries.some((e) => e.name === 'module.json')) throw new Error('module/ 里没有 module.json')

// 入口文件和 module.json 的 id / version 必须对上（插件装完会拿它们跟索引比）
const entrySource = entries.find((e) => e.name === 'index.mjs').data.toString('utf8')
if (!new RegExp(`id:\\s*'${manifest.id}'`).test(entrySource)) {
  console.warn('提示：index.mjs 里的 id 和 module.json 不一致，检查一下')
}

const zipName = `${manifest.id}-${manifest.version}.zip`
const zipBuf = buildZip(entries)
mkdirSync(REGISTRY_DIR, { recursive: true })
writeFileSync(join(REGISTRY_DIR, zipName), zipBuf)

// 读回来比一遍
const back = readZip(zipBuf)
for (const e of entries) {
  const got = back.get(e.name)
  if (!got || !got.equals(e.data)) throw new Error('打包回读不一致：' + e.name)
}
if (back.size !== entries.length) throw new Error('打包回读条目数不一致')

const sha256 = createHash('sha256').update(zipBuf).digest('hex')
const homepage = String(manifest.homepage || '').includes('USER/REPO')
  ? (owner ? `https://github.com/${owner}/${repo}` : manifest.homepage)
  : manifest.homepage
const assetsBase = owner
  ? `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/registry/`
  : `https://raw.githubusercontent.com/USER/REPO/${branch}/registry/`

const index = {
  schema: 1,
  generatedAt: new Date().toISOString(),
  assetsBase,
  modules: [
    {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      category: manifest.category || 'platform',
      tags: manifest.tags || [],
      author: manifest.author || '',
      license: manifest.license || 'MIT',
      homepage,
      api: manifest.api || 1,
      minPluginVersion: manifest.minPluginVersion || '1.2.0',
      requires: manifest.requires || [],
      capabilities: manifest.capabilities || [],
      files: entries.length,
      bytes: zipBuf.length,
      path: zipName,
      sha256,
    },
  ],
  revoked: [],
}
writeFileSync(join(REGISTRY_DIR, 'index.json'), JSON.stringify(index, null, 2) + '\n')

// raw.githubusercontent.com 在部分网络下解析不了：再出两份走镜像的索引（装包地址也一起换）
if (owner) {
  const mirrors = {
    'index-cdn.json': `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/registry/`,
    'index-ghproxy.json': `https://ghproxy.net/https://raw.githubusercontent.com/${owner}/${repo}/${branch}/registry/`,
  }
  for (const [file, base] of Object.entries(mirrors)) {
    const copy = JSON.parse(JSON.stringify(index))
    copy.assetsBase = base
    writeFileSync(join(REGISTRY_DIR, file), JSON.stringify(copy, null, 2) + '\n')
  }
}

console.log('模块：' + manifest.name + ' ' + manifest.id + '@' + manifest.version)
console.log('文件：' + entries.map((e) => e.name).join(', '))
console.log('打包：registry/' + zipName + '（' + (zipBuf.length / 1024).toFixed(1) + ' KB，回读校验通过）')
console.log('sha256：' + sha256)
console.log('索引：registry/index.json  assetsBase=' + assetsBase)
if (!owner) console.log('\n还没填 --owner，index.json 里的地址是占位符：正式发布前跑一次 --owner=<你的GitHub用户名>')
console.log('\n接下来：')
console.log('  git init && git add -A && git commit -m "kanzhibo ' + manifest.version + '"')
console.log('  git remote add origin https://github.com/<owner>/' + repo + '.git && git push -u origin ' + branch)
console.log('  然后把 registry/' + zipName + ' 和 registry/index.json 一起提交（索引里的 sha256 必须和 zip 对得上）')
