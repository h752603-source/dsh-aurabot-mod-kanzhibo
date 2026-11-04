#!/usr/bin/env node
// 生成本地静态徽章（docs/badges/*.svg）—— 不依赖 shields.io，国内网络也能正常显示。
// 用法：node tools/badges.mjs   （改了 module.json 的版本号之后重跑一次）

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const OUT = join(ROOT, 'docs', 'badges')
mkdirSync(OUT, { recursive: true })

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
// 11px 字号下的宽度估算：全角（中文 / ≥ 之类）算两倍
const textWidth = (s) => [...String(s)].reduce((n, ch) => n + (/[\u2000-\u9fff\uff00-\uffef]/.test(ch) ? 11.4 : 6.3), 0)

function badge(label, value, color) {
  const lw = Math.round(textWidth(label) + 10)
  const vw = Math.round(textWidth(value) + 10)
  const w = lw + vw
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${esc(label)}: ${esc(value)}">
  <title>${esc(label)}: ${esc(value)}</title>
  <linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
  <clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${lw}" height="20" fill="#555"/>
    <rect x="${lw}" width="${vw}" height="20" fill="${color}"/>
    <rect width="${w}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">
    <text x="${lw / 2}" y="14">${esc(label)}</text>
    <text x="${lw + vw / 2}" y="14">${esc(value)}</text>
  </g>
</svg>
`
}

const manifest = JSON.parse(readFileSync(join(ROOT, 'module', 'module.json'), 'utf8'))
const list = [
  ['version', manifest.version, '#2B8EC4'],
  ['plugin api', 'v' + (manifest.api || 1), '#4B8BBE'],
  ['node', '>=22', '#339933'],
  ['platform', 'Windows | macOS', '#6b7280'],
  ['license', manifest.license || 'MIT', '#3da639'],
]
for (const [label, value, color] of list) {
  const file = join(OUT, label.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '') + '.svg')
  writeFileSync(file, badge(label, value, color))
  console.log('  ' + file.replace(ROOT, '.').padEnd(30) + label + ': ' + value)
}
