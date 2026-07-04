/**
 * matrix.js — M2 矩阵回归验证：
 * 对全部帧 × 全部部位条目执行 分解→重建，比对重建矩阵与原始矩阵。
 * 通过 = 骨骼连接表、关节数据、裁剪空间换算、分解/重构数学全部正确。
 * 运行：node test/matrix.js
 */
'use strict';
require('../js/jsonio.js');
require('../js/model.js');
require('../js/as3math.js');
require('../js/skeleton.js');
require('../js/pose.js');

const fs = require('fs');
const path = require('path');

const HFJ = globalThis.HFJ;
const { HFCharacter } = globalThis.HFModel;
const { FramePose, readMatrix } = globalThis.HFPose;

const BASE = path.resolve(__dirname, '..', '..');
const DATASETS = [
    { tag: 'HFE',  dir: path.join(BASE, 'HFE角色SPT及贴图') },
    { tag: 'HFEX', dir: path.join(BASE, 'HFEX角色SPT及贴图') },
];
const TOL = 1e-6;

let failures = 0;

for (const ds of DATASETS) {
    console.log(`\n===== ${ds.tag} =====`);
    const sub = fs.readdirSync(ds.dir);
    const sptFolder = sub.find(d => /Spt$/i.test(d));
    const lmiFolder = sub.find(d => /Lmi$/i.test(d));
    const sptText = fs.readFileSync(path.join(ds.dir, sptFolder, 'Spt.json'), 'utf8');
    const lmiJsons = new Map();
    for (const f of fs.readdirSync(path.join(ds.dir, lmiFolder))) {
        if (/\.json$/i.test(f)) lmiJsons.set(f, fs.readFileSync(path.join(ds.dir, lmiFolder, f), 'utf8'));
    }
    const ch = new HFCharacter({ sptFolder, lmiFolder, sptText, lmiJsons, pngs: new Map() });

    let totalFrames = 0, framesWithEntries = 0, totalEntries = 0;
    let noPicEntries = 0, noParentEntries = 0;
    let maxDiff = 0, maxDiffAt = '';
    const bad = [];

    const t0 = Date.now();
    for (let fi = 0; fi < ch.frameCount(); fi++) {
        const fNode = ch.getFrame(fi);
        if (!fNode) continue;
        totalFrames++;

        // 原始逻辑矩阵基准（独立解一份，避免与被测对象共享状态）
        const ref = new FramePose(ch, fi);
        const refM = new Map(); // slot → mLogical 克隆
        for (const e of ref.entries) {
            refM.set(e.list + ':' + e.slot, e.mLogical.clone());
        }
        if (ref.entries.length > 0) framesWithEntries++;

        // 被测：分解 → 全量重建
        const fp = new FramePose(ch, fi);
        fp.rebuildChain(null);

        for (const e of fp.entries) {
            totalEntries++;
            if (!e.pic) { noPicEntries++; continue; }
            if (!e.parentKnown) noParentEntries++;
            const orig = refM.get(e.list + ':' + e.slot);
            const m = e.mLogical;
            const diffs = [
                Math.abs(m.a - orig.a), Math.abs(m.b - orig.b),
                Math.abs(m.c - orig.c), Math.abs(m.d - orig.d),
                Math.abs(m.tx - orig.tx), Math.abs(m.ty - orig.ty)
            ];
            const dmax = Math.max(...diffs);
            if (dmax > maxDiff) { maxDiff = dmax; maxDiffAt = `帧${fi} 槽${e.slot}`; }
            if (dmax > TOL) {
                bad.push({ fi, slot: e.slot, dmax, orig, m });
            }
        }
    }
    const ms = Date.now() - t0;

    console.log(`  帧数: ${totalFrames}（有部位条目: ${framesWithEntries}），条目总数: ${totalEntries}`);
    console.log(`  无贴图解析条目: ${noPicEntries}，父不可用条目: ${noParentEntries}`);
    console.log(`  最大矩阵偏差: ${maxDiff.toExponential(3)} @ ${maxDiffAt}（容差 ${TOL}），耗时 ${ms}ms`);
    if (bad.length === 0) {
        console.log(`  ✓ 全部条目 分解→重建 与原矩阵一致`);
    } else {
        failures++;
        console.log(`  ✗ ${bad.length} 个条目超差，前 10 个：`);
        for (const b of bad.slice(0, 10)) {
            console.log(`    帧${b.fi} 槽${b.slot} 偏差=${b.dmax.toExponential(3)}`);
            console.log(`      原: a=${b.orig.a} b=${b.orig.b} tx=${b.orig.tx} ty=${b.orig.ty}`);
            console.log(`      建: a=${b.m.a} b=${b.m.b} tx=${b.m.tx} ty=${b.m.ty}`);
        }
    }

    // footY 抽查：对若干帧比较 computeFootY 与存档 footY
    let footChecked = 0, footMatch = 0;
    const footSamples = [];
    for (let fi = 0; fi < ch.frameCount() && footChecked < 200; fi++) {
        const fNode = ch.getFrame(fi);
        if (!fNode) continue;
        const fp = new FramePose(ch, fi);
        if (fp.entries.length === 0) continue;
        const calc = fp.computeFootY();
        const stored = HFJ.getV(fNode, 'footY');
        footChecked++;
        if (Math.abs(calc - stored) <= 1) footMatch++;
        else if (footSamples.length < 5) footSamples.push({ fi, calc, stored });
    }
    console.log(`  footY 抽查: ${footMatch}/${footChecked} 与存档一致（±1）`);
    for (const s of footSamples) {
        console.log(`    帧${s.fi}: 计算=${s.calc} 存档=${s.stored}`);
    }
}

console.log(failures === 0 ? '\n矩阵回归全部通过 ✓' : `\n${failures} 个数据集存在超差 ✗`);
process.exit(failures === 0 ? 0 : 1);
