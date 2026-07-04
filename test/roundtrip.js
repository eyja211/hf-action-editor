/**
 * roundtrip.js — M1 验证：两版 Jenny 数据 load→serialize 逐字节一致
 * 运行：node test/roundtrip.js
 */
'use strict';
require('../js/jsonio.js');   // 设置 globalThis.HFJ
require('../js/model.js');    // 设置 globalThis.HFModel

const fs = require('fs');
const path = require('path');

const HFJ = globalThis.HFJ;
const { HFCharacter } = globalThis.HFModel;

const BASE = path.resolve(__dirname, '..', '..');
const DATASETS = [
    { tag: 'HFE',  dir: path.join(BASE, 'HFE角色SPT及贴图') },
    { tag: 'HFEX', dir: path.join(BASE, 'HFEX角色SPT及贴图') },
];

let failures = 0;

function check(cond, msg) {
    if (cond) { console.log('  ✓ ' + msg); }
    else { console.log('  ✗ ' + msg); failures++; }
}

for (const ds of DATASETS) {
    console.log(`\n===== ${ds.tag} (${ds.dir}) =====`);
    const sub = fs.readdirSync(ds.dir);
    const sptFolder = sub.find(d => /Spt$/i.test(d));
    const lmiFolder = sub.find(d => /Lmi$/i.test(d));
    if (!sptFolder || !lmiFolder) { console.log('  ✗ 找不到 Spt/Lmi 文件夹'); failures++; continue; }

    const sptText = fs.readFileSync(path.join(ds.dir, sptFolder, 'Spt.json'), 'utf8');
    const lmiJsons = new Map();
    let pngCount = 0;
    for (const f of fs.readdirSync(path.join(ds.dir, lmiFolder))) {
        if (/\.json$/i.test(f)) lmiJsons.set(f, fs.readFileSync(path.join(ds.dir, lmiFolder, f), 'utf8'));
        else if (/\.png$/i.test(f)) pngCount++;
    }

    const t0 = Date.now();
    const ch = new HFCharacter({ sptFolder, lmiFolder, sptText, lmiJsons, pngs: new Map() });
    const tParse = Date.now() - t0;

    // --- round-trip ---
    const t1 = Date.now();
    const report = ch.roundTripReport();
    const tSer = Date.now() - t1;
    const bad = report.filter(r => !r.ok);
    check(bad.length === 0, `round-trip 逐字节一致（${report.length} 个文件, 解析 ${tParse}ms, 序列化+比对 ${tSer}ms）`);
    for (const b of bad.slice(0, 5)) {
        console.log(`      ${b.name} @${b.firstDiff.pos}`);
        console.log(`      期望: ${JSON.stringify(b.firstDiff.expect)}`);
        console.log(`      实际: ${JSON.stringify(b.firstDiff.got)}`);
    }

    // --- 基本结构 ---
    check(ch.version === ds.tag, `版本识别 = ${ch.version}${ch.versionWarning ? '（警告: ' + ch.versionWarning + '）' : ''}`);
    check(ch.charId() === 'jenny', `角色 id = ${ch.charId()}`);
    check(ch.frameCount() > 0, `帧数 = ${ch.frameCount()}`);
    check(ch.actionCount() > 0, `动作数 = ${ch.actionCount()}`);
    check(ch.limbByName.size > 0, `Limb 注册 = ${ch.limbByName.size} 个`);
    check(ch.picByIndex.size > 0, `图池 = ${ch.picByIndex.size} 张（PNG 文件 ${pngCount} 个）`);

    // --- 动作帧区间抽查 ---
    const acts = ch.listActions();
    const stand = acts.find(a => a.name === 'STAND');
    if (stand) {
        const range = ch.actionFrameRange(stand.index);
        check(!!range && range.end >= range.start,
            `STAND 帧区间 = [${range && range.start}, ${range && range.end}]`);
    } else { check(false, '找到 STAND 动作'); }

    // --- resolvePic 抽查：STAND 首帧的 uz 每一项都能解析出贴图 ---
    if (stand) {
        const range = ch.actionFrameRange(stand.index);
        const frame = ch.getFrame(range.start);
        const uz = HFJ.get(frame, 'uz');
        let okCnt = 0, total = 0, noPng = 0;
        HFJ.arrEach(uz, (lz) => {
            if (!lz || lz.t !== 'o') return;
            total++;
            const slot = HFJ.getV(lz, 'i') | 0;
            const p = HFJ.getV(lz, 'p') | 0;
            const info = ch.resolvePic(slot, p);
            if (info) { okCnt++; if (!info.pngName) noPng++; }
        });
        check(okCnt === total, `STAND 首帧 uz 全部解析（${okCnt}/${total}，其中无位图 ${noPng} 项）`);
        if (noPng > 0) {
            HFJ.arrEach(uz, (lz) => {
                if (!lz || lz.t !== 'o') return;
                const slot = HFJ.getV(lz, 'i') | 0, p = HFJ.getV(lz, 'p') | 0;
                const info = ch.resolvePic(slot, p);
                if (info && !info.pngName) console.log(`      无位图: 槽位${slot} p=${p} → 图池#${info.picIndex} disabled=${info.disabled}`);
            });
        }
    }

    // --- HFW 数组操作自测（对克隆树操作，不污染原数据）---
    const framesClone = HFJ.clone(ch.framesArr());
    const n0 = HFJ.arrLen(framesClone);
    HFJ.arrSplice(framesClone, 1, 0, [HFJ.clone(HFJ.arrGet(framesClone, 0))]);
    check(HFJ.arrLen(framesClone) === n0 + 1, `arrSplice 插入后 len=${HFJ.arrLen(framesClone)}`);
    HFJ.arrSplice(framesClone, 1, 1, []);
    check(HFJ.arrLen(framesClone) === n0 && HFJ.stringify(framesClone) === HFJ.stringify(ch.framesArr()),
        'arrSplice 删除还原后与原数据一致');
}

console.log(failures === 0 ? '\n全部通过 ✓' : `\n${failures} 项失败 ✗`);
process.exit(failures === 0 ? 0 : 1);
