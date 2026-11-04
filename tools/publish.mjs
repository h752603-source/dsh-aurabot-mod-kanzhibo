#!/usr/bin/env node
// 发布到 GitHub —— 不需要装 git：直接用 GitHub 的 Git Data API 建仓库 + 一次提交把整个目录推上去。
//
// 用法：
//   node tools/publish.mjs --token=ghp_xxx                     # 仓库名默认 dsh-aurabot-mod-kanzhibo
//   node tools/publish.mjs --token=ghp_xxx --repo=my-repo --branch=main
//   GITHUB_TOKEN=ghp_xxx node tools/publish.mjs                # 也可以走环境变量
//   node tools/publish.mjs --dry-run                           # 没 token 也能看它打算干什么
//
// token 要什么权限：
//   classic：勾 repo（public 仓库其实 public_repo 就够）
//   fine-grained：Administration=Read and write（建仓库）、Contents=Read and write（推文件）
//
// 做的事：
//   1. 用 /user 确认你是谁（顺便把 index.json 里的 USER/REPO 换成真的）
//   2. 仓库不存在就建一个 public 的
//   3. 把所有文件打成一次 commit 推上去（blob → tree → commit → ref）
//   4. 打印仓库地址和该填给插件的 AURABOT_REGISTRY_URL

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const API = 'https://api.github.com'
const SKIP = new Set(['node_modules', '.git', 'modules-data', '.aurabot-cache'])

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)=(.*)$/.exec(a)
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true]
  }),
)
const token = String(args.token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '')
const repo = String(args.repo || 'dsh-aurabot-mod-kanzhibo')
const branch = String(args.branch || 'main')
const dryRun = Boolean(args['dry-run']) || !token
const isPrivate = String(args.private || 'false') === 'true'
const description = 'Aurabot（大肥鱼 QQ 插件）扩展模块：看直播 —— 独立浏览器 + CDP 挂抖音直播间、进房评论、续粉丝团灯牌'

function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    if (SKIP.has(name)) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push({ path: relative(ROOT, full).split(sep).join('/'), data: readFileSync(full) })
  }
  return out
}

async function api(method, path, body, { allow404 = false } = {}) {
  let lastError = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(API + path, {
        method,
        headers: {
          authorization: 'Bearer ' + token,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'user-agent': 'kanzhibo-publish',
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30_000),
      })
      const text = await res.text()
      // 404 = 没有这个东西；409 = 空仓库（Git Repository is empty），都当「没有」处理
      if (allow404 && (res.status === 404 || res.status === 409)) return null
      // 5xx 是 GitHub 自己打嗝，退避再试
      if (res.status >= 500) {
        lastError = new Error(`${method} ${path} → HTTP ${res.status}：${text.slice(0, 200)}`)
        if (attempt < 3) { await new Promise((r) => setTimeout(r, attempt * 2500)); continue }
        throw lastError
      }
      if (!res.ok) {
        let why = text
        try { why = JSON.parse(text).message || text } catch {}
        throw new Error(`${method} ${path} → HTTP ${res.status}：${why}`)
      }
      return text ? JSON.parse(text) : {}
    } catch (error) {
      lastError = error
      if (error instanceof TypeError || error?.name === 'TimeoutError') {
        if (attempt < 3) { await new Promise((r) => setTimeout(r, attempt * 2500)); continue }
      }
      if (attempt >= 3 || !/HTTP 5/.test(String(error.message))) throw error
    }
  }
  throw lastError || new Error('请求失败')
}

// ---------- 0. 没 token：只报计划 ----------
if (dryRun) {
  const files = walk(ROOT)
  console.log('（没给 token，只表演一遍，不会真的动 GitHub）\n')
  console.log('仓库：' + repo + '（' + (isPrivate ? 'private' : 'public') + '，分支 ' + branch + '）')
  console.log('文件：' + files.length + ' 个，共 ' + (files.reduce((n, f) => n + f.data.length, 0) / 1024).toFixed(1) + ' KB')
  for (const f of files) console.log('  ' + f.path.padEnd(34) + (f.data.length + ' B').padStart(9))
  console.log('\n真正发布：把 token 填进去再跑一次')
  console.log('  node tools/publish.mjs --token=ghp_xxx')
  console.log('token 位置：GitHub → Settings → Developer settings → Personal access tokens')
  process.exit(0)
}

// ---------- 1. 我是谁 ----------
const me = await api('GET', '/user')
const owner = String(args.owner || me.login)
if (args.owner && args.owner !== me.login) {
  throw new Error(`你给的 --owner=${args.owner} 和这个 token 的账号 ${me.login} 对不上`)
}
console.log('账号：' + me.login)

// ---------- 2. 用真账号重打包一次，把 index.json 里的 USER/REPO 换掉 ----------
console.log('重打包（assetsBase 指向 ' + owner + '/' + repo + '）…')
execFileSync(process.execPath, [join(ROOT, 'tools', 'pack.mjs'), '--owner=' + owner, '--repo=' + repo, '--branch=' + branch], { cwd: ROOT, stdio: 'inherit' })

// ---------- 3. 仓库在不在 ----------
const full = `/repos/${owner}/${repo}`
let repoInfo = await api('GET', full, null, { allow404: true })
if (!repoInfo) {
  console.log('仓库不存在，建一个：' + owner + '/' + repo)
  repoInfo = await api('POST', '/user/repos', {
    name: repo,
    description,
    homepage: `https://github.com/${owner}/${repo}`,
    private: isPrivate,
    has_issues: true,
    has_wiki: false,
    auto_init: false,
  })
} else {
  console.log('仓库已存在：' + repoInfo.html_url + '（默认分支 ' + repoInfo.default_branch + '）')
}

// ---------- 4. 一次提交 ----------
const files = walk(ROOT)
let parent = await api('GET', `/repos/${owner}/${repo}/git/ref/heads/${branch}`, null, { allow404: true })
if (!parent) {
  // 完全不空的仓库才允许直接建 blob；空仓库得先用 Contents API 落下第一个提交
  console.log('空仓库：先落一个初始提交（GitHub 不允许在空仓库上直接建 blob）')
  await api('PUT', `/repos/${owner}/${repo}/contents/README.md`, {
    message: 'chore: bootstrap',
    content: Buffer.from('# kanzhibo\n\n初始化提交，紧接着会被正式内容覆盖。\n').toString('base64'),
    branch,
  })
  parent = await api('GET', `/repos/${owner}/${repo}/git/ref/heads/${branch}`, null, { allow404: true })
  if (!parent) throw new Error('初始提交没成功，再跑一次')
}
const parents = [parent.object.sha]

const tree = []
for (const f of files) {
  const blob = await api('POST', `/repos/${owner}/${repo}/git/blobs`, {
    content: f.data.toString('base64'),
    encoding: 'base64',
  })
  tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha })
  process.stdout.write('\r上传 ' + tree.length + '/' + files.length + '  ' + f.path.padEnd(40))
}
process.stdout.write('\n')

const newTree = await api('POST', `/repos/${owner}/${repo}/git/trees`, { tree })
const manifest = JSON.parse(readFileSync(join(ROOT, 'module', 'module.json'), 'utf8'))
const commit = await api('POST', `/repos/${owner}/${repo}/git/commits`, {
  message: `kanzhibo ${manifest.version}：${manifest.description}`,
  tree: newTree.sha,
  parents,
})
if (parent) {
  await api('PATCH', `/repos/${owner}/${repo}/git/refs/heads/${branch}`, { sha: commit.sha, force: true })
} else {
  await api('POST', `/repos/${owner}/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: commit.sha })
}

const index = JSON.parse(readFileSync(join(ROOT, 'registry', 'index.json'), 'utf8'))
const entry = index.modules[0]
const sha = createHash('sha256').update(readFileSync(join(ROOT, 'registry', entry.path))).digest('hex')

console.log('\n发布完成')
console.log('  仓库：https://github.com/' + owner + '/' + repo)
console.log('  提交：' + commit.sha.slice(0, 7) + '（' + files.length + ' 个文件）')
console.log('  安装包：' + index.assetsBase + entry.path + '（sha256 ' + sha.slice(0, 12) + '…）')
console.log('\n别人怎么装：')
console.log('  ① 手动：把 module/ 里的文件拷到 ~/.dsh/plugins-data/aurabot/modules/kanzhibo/')
console.log('  ② 模块市场：把环境变量设成下面这个，重启插件后刷新市场')
console.log('     AURABOT_REGISTRY_URL=' + index.assetsBase + 'index.json')
if (!parent) {
  console.log('\n新仓库第一次提交，raw 地址可能有 1~2 分钟缓存，稍等再装。')
}
