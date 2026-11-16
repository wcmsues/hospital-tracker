/**
 * 医院招聘监测
 * 数据源：上海卫生人才网（rczp.shwshr.cn）公开接口
 * 用法：node scripts/monitor.mjs
 * 环境变量（可选，用于推送）：
 *   SERVERCHAN_KEY   Server酱 SendKey，微信接收
 *   WECOM_WEBHOOK    企业微信群机器人 webhook
 */
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

const ROOT = path.resolve(import.meta.dirname, '..');
const STATE_FILE = path.join(ROOT, '.monitor-state.json');
const OUT_FILE = path.join(ROOT, 'notices.json');
const API = 'https://rczp.shwshr.cn/api/person/job/page';
const KEYWORDS = ['护理'];
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

const today = new Date().toISOString().slice(0, 10);

function normName(n) {
  return String(n || '').replace(/[（(][^）)]*[）)]/g, '').replace(/\s/g, '');
}

function loadHospitals() {
  const src = fs.readFileSync(path.join(ROOT, 'data.js'), 'utf8');
  const m = src.match(/window\.HOSPITALS\s*=\s*(\[[\s\S]*\]);/);
  if (!m) throw new Error('解析 data.js 失败');
  return JSON.parse(m[1]);
}

function httpGet(url, timeout = 45000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, timeout }, (res) => {
      if (res.statusCode >= 400) { reject(new Error('HTTP ' + res.statusCode)); return; }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function fetchJobs(keyword) {
  const all = [];
  for (let page = 1; page <= 4; page++) {
    const url = `${API}?pageNum=${page}&pageSize=100&jobName=${encodeURIComponent(keyword)}`;
    let res = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        res = await httpGet(url);
        break;
      } catch (e) {
        if (attempt === 4) throw e;
        console.log('重试', page, attempt + 1, e.message);
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
      }
    }
    const rows = (res && res.data && res.data.rows) || [];
    all.push(...rows);
    const total = (res && res.data && res.data.total) || 0;
    if (all.length >= total || rows.length < 100) break;
  }
  return all;
}

function isOpen(job) {
  if (job.jobStatus && job.jobStatus !== 'PASS') return false;
  if (job.jobEndDate && job.jobEndDate < today) return false;
  return true;
}

function main() {
  return (async () => {
    const hospitals = loadHospitals();
    const mine = hospitals.map((h) => ({ name: h.name, key: normName(h.name), id: h.id }));

    let jobs = [];
    for (const kw of KEYWORDS) jobs.push(...(await fetchJobs(kw)));

    // 去重
    const seen = new Set();
    jobs = jobs.filter((j) => (seen.has(j.id) ? false : (seen.add(j.id), true)));
    const open = jobs.filter(isOpen);

    // 同一医院同名同人数的岗位只保留一条（取截止最晚的）
    const byKey = new Map();
    for (const j of open) {
      const k = (j.unit && j.unit.unitName) + '|' + j.jobName + '|' + j.recruitmentNum;
      const prev = byKey.get(k);
      if (!prev || (j.jobEndDate || '') > (prev.jobEndDate || '')) byKey.set(k, j);
    }
    const dedup = Array.from(byKey.values());

    // 与清单匹配
    const matched = [];
    for (const j of dedup) {
      const un = normName(j.unit && j.unit.unitName);
      const hit = mine.find((m) => un.includes(m.key) || m.key.includes(un));
      if (!hit) continue;
      matched.push({ job: j, hosp: hit });
    }

    // 状态比对
    let state = { initialized: false, seen: {} };
    try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) {}
    if (!state.seen) state.seen = {};

    const items = matched.map(({ job, hosp }) => ({
      id: String(job.id),
      hospital: hosp.name,
      hospitalId: hosp.id,
      unit: job.unit.unitName,
      job: job.jobName,
      num: job.recruitmentNum || 0,
      edu: job.educationRequirementName || '',
      title: job.professorRequirementName || '',
      exp: job.workingLifeRequirementName || '',
      start: job.jobStartDate || '',
      end: job.jobEndDate || '',
      url: 'https://rczp.shwshr.cn/job',
      isNew: false,
      firstSeen: state.seen[job.id] || today
    }));

    const fresh = items.filter((it) => !state.seen[it.id]);
    // 首次运行只建基线，不标新、不推送
    const firstRun = !state.initialized;
    const notify = firstRun ? [] : fresh;
    items.forEach((it) => {
      it.isNew = !firstRun && fresh.some((f) => f.id === it.id);
    });

    items.sort((a, b) => (b.start || '').localeCompare(a.start || ''));

    const out = {
      updatedAt: new Date().toISOString(),
      source: '上海卫生人才网',
      today,
      openTotal: open.length,
      matchedCount: items.length,
      newCount: firstRun ? 0 : fresh.length,
      items
    };
    fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 1));

    // 更新状态：只保留当前仍在招的 id + 最近 60 天见过的
    const nextSeen = {};
    items.forEach((it) => { nextSeen[it.id] = state.seen[it.id] || today; });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ initialized: true, seen: nextSeen, updatedAt: new Date().toISOString() }, null, 1));

    console.log(`在招护理岗 ${open.length} 个，匹配清单 ${items.length} 家医院，新增 ${fresh.length} 个`);

    if (notify.length) return sendPush(notify);
    return null;
  })();
}

async function sendPush(items) {
  const lines = items.slice(0, 12).map((it) =>
    `· ${it.hospital}\n  ${it.job} ${it.num}人 ${it.edu}${it.end ? ' 截止' + it.end : ''}`
  );
  const text = `【医院招聘更新】新增 ${items.length} 个岗位\n\n${lines.join('\n')}\n\n详情：https://rczp.shwshr.cn/job`;

  const key = process.env.SERVERCHAN_KEY;
  if (key) {
    const url = `https://sctapi.ftqq.com/${key}.send`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ title: `医院招聘更新 ${items.length} 个岗位`, desp: text })
    }).catch((e) => console.error('Server酱推送失败', e.message));
  }

  const hook = process.env.WECOM_WEBHOOK;
  if (hook) {
    await fetch(hook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'text', text: { content: text } })
    }).catch((e) => console.error('企业微信推送失败', e.message));
  }

  if (!key && !hook) console.log('未配置推送渠道，仅更新 notices.json');
}

main().catch((e) => { console.error(e); process.exit(1); });
