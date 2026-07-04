/**
 * test/browser/e2e.js — 浏览器端到端实测（M3–M7）
 * 用 puppeteer-core 驱动系统 Edge（无头），本地 HTTP 伺服工具与角色数据。
 * 运行：node test/browser/e2e.js [m3|m4|m5|m6|m7|all]（默认 all）
 * 产出截图：test/browser/shots/
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const puppeteer = require('puppeteer-core');
const { start } = require('./server');

const BASE = path.resolve(__dirname, '..', '..', '..');   // D:\desktop\贴图编辑
const TOOL = 'HF动作编辑器';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SHOTS = path.join(__dirname, 'shots');
const DL_DIR = path.join(__dirname, 'downloads');

const results = [];
let curSection = '';
function section(name) { curSection = name; console.log('\n===== ' + name + ' ====='); }
function check(ok, msg, detail) {
    results.push({ section: curSection, ok: !!ok, msg });
    console.log('  ' + (ok ? '✓' : '✗') + ' ' + msg + (ok || detail === undefined ? '' : '　⇒ ' + detail));
}

/** 枚举数据集文件，构造页面可 fetch 的 URL 清单 */
function datasetSpec(dirName, port) {
    const dir = path.join(BASE, dirName);
    const sub = fs.readdirSync(dir);
    const sptFolder = sub.find(d => /Spt$/i.test(d));
    const lmiFolder = sub.find(d => /Lmi$/i.test(d));
    const enc = s => s.split('/').map(encodeURIComponent).join('/');
    const root = `http://127.0.0.1:${port}/${enc(dirName)}`;
    const lmiJsonUrls = [], pngUrls = [];
    for (const f of fs.readdirSync(path.join(dir, lmiFolder))) {
        const u = `${root}/${enc(lmiFolder)}/${enc(f)}`;
        if (/\.json$/i.test(f)) lmiJsonUrls.push([f, u]);
        else if (/\.png$/i.test(f)) pngUrls.push([f, u]);
    }
    return {
        sptFolder, lmiFolder,
        sptUrl: `${root}/${enc(sptFolder)}/Spt.json`,
        lmiJsonUrls, pngUrls,
        localSptPath: path.join(dir, sptFolder, 'Spt.json'),
        localLmiDir: path.join(dir, lmiFolder)
    };
}

async function loadCharacter(page, spec) {
    return await page.evaluate(async (s) => {
        const sptText = await (await fetch(s.sptUrl)).text();
        const lmiJsons = new Map();
        for (const [name, url] of s.lmiJsonUrls) lmiJsons.set(name, await (await fetch(url)).text());
        const pngs = new Map();
        for (const [name, url] of s.pngUrls) pngs.set(name, await (await fetch(url)).blob());
        const extraLmi = [];
        for (const ex of (s.extraLmi || [])) {
            const jsons = new Map(), epngs = new Map();
            for (const [name, url] of ex.lmiJsonUrls) jsons.set(name, await (await fetch(url)).text());
            for (const [name, url] of ex.pngUrls) epngs.set(name, await (await fetch(url)).blob());
            extraLmi.push({ folder: ex.lmiFolder, jsons, pngs: epngs });
        }
        App.loadCharacterFiles({
            sptFolder: s.sptFolder, lmiFolder: s.lmiFolder,
            sptText, lmiJsons, pngs, extraLmi, handles: null
        });
        await App.images.preloadAll();
        App.requestDraw();
        await new Promise(r => setTimeout(r, 350));   // 等 roundTripReport 体检 + 首帧绘制
        return {
            version: App.char.version,
            frames: App.char.frameCount(),
            actions: App.char.listActions().length,
            actionIndex: App.actionIndex,
            actionName: (App.char.listActions().find(a => a.index === App.actionIndex) || {}).name,
            frameIndex: App.frameIndex,
            lmiSets: App.char.lmiSets.length,
            limbNames: App.char.limbByName.size
        };
    }, spec);
}

/** 画布非背景像素计数（背景 #20242b） */
async function stagePixels(page) {
    return await page.evaluate(() => {
        const cv = document.getElementById('stage');
        const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) {
            if (Math.abs(d[i] - 0x20) > 12 || Math.abs(d[i + 1] - 0x24) > 12 || Math.abs(d[i + 2] - 0x2b) > 12) n++;
        }
        return { nonBg: n, w: cv.width, h: cv.height };
    });
}

async function shot(page, name) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, name) });
}

/** 重建 viewport 的视图矩阵（fitView 公式；测试期间不滚轮缩放） */
const VIEW_JS = `(function(){
    const cv = document.getElementById('stage');
    const s = Math.min(cv.width / 500, cv.height / 450);
    return { a: s, b: 0, c: 0, d: s, tx: cv.width / 2 - 500 * s, ty: cv.height * 0.72 - 400 * s };
})()`;

/** 找一个可编辑（非从属、有姿势）槽位在画布上的可点击坐标 */
async function findDraggablePoint(page, preferSlots) {
    return await page.evaluate((prefer, viewJs) => {
        const vm = eval(viewJs);
        const fp = App.pose();
        if (!fp) return null;
        const cands = prefer.concat(fp.entries.map(e => e.slot));
        const cvRect = document.getElementById('stage').getBoundingClientRect();
        for (const slot of cands) {
            const e = fp.getEntry(slot);
            if (!e || !e.pose || !e.joints || e.joints.length < 1 || HFSkel.SLAVE_OF[slot]) continue;
            // 沿关节连线/贴图中心采样若干点，找 hitTest 恰好命中该槽位的像素
            const pts = [];
            if (e.joints.length >= 2) {
                for (let t = 0.25; t <= 0.75; t += 0.125) {
                    pts.push({
                        x: e.joints[0].x + (e.joints[1].x - e.joints[0].x) * t,
                        y: e.joints[0].y + (e.joints[1].y - e.joints[0].y) * t
                    });
                }
            }
            const img = App.images.get(e.pic && e.pic.pngName);
            if (img) {
                const c = e.mLogical.transformPoint(img.width / 2, img.height / 2);
                pts.push({ x: c.x, y: c.y });
            }
            for (const sp of pts) {
                const px = vm.a * sp.x + vm.tx, py = vm.d * sp.y + vm.ty;
                const hit = HFRender.hitTest(fp, App.images, vm, px, py);
                if (hit === slot) {
                    return {
                        slot,
                        cx: cvRect.left + px, cy: cvRect.top + py,
                        anchorCx: cvRect.left + (vm.a * e.pose._anchorX + vm.tx),
                        anchorCy: cvRect.top + (vm.d * e.pose._anchorY + vm.ty)
                    };
                }
            }
        }
        return null;
    }, preferSlots, VIEW_JS);
}

/** 当前帧节点序列化文本（用于前后一致性比对） */
async function frameText(page, fi) {
    return await page.evaluate(i => HFJ.stringify(App.char.getFrame(i)), fi);
}

async function main() {
    const what = (process.argv[2] || 'all').toLowerCase();
    const { server, port } = await start(BASE);
    fs.rmSync(DL_DIR, { recursive: true, force: true });
    fs.mkdirSync(DL_DIR, { recursive: true });

    const browser = await puppeteer.launch({
        executablePath: EDGE,
        headless: true,
        args: ['--window-size=1680,1050', '--disable-gpu']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1680, height: 1000 });

    const pageErrors = [], dialogs = [];
    page.on('pageerror', e => { pageErrors.push(String(e)); console.log('  [pageerror]', e); });
    page.on('dialog', async d => { dialogs.push(d.type() + ': ' + d.message()); await d.dismiss(); });
    page.on('console', m => { if (m.type() === 'error') console.log('  [console.error]', m.text()); });

    await page.goto(`http://127.0.0.1:${port}/${encodeURIComponent(TOOL)}/index.html`, { waitUntil: 'load' });

    const hfe = datasetSpec('HFE角色SPT及贴图', port);

    // ---------------- M3 加载 + 渲染 + 播放 ----------------
    section('M3 加载 / STAND 渲染 / 播放');
    const info = await loadCharacter(page, hfe);
    check(info.version === 'HFE', `版本识别 = ${info.version}`);
    check(info.frames === 522, `帧数 = ${info.frames}`);
    check(info.actions === 116, `动作数 = ${info.actions}`);
    check(info.actionName === 'STAND', `默认动作 = ${info.actionName}`);
    check(info.frameIndex === 1, `默认帧 = ${info.frameIndex}（STAND 起始）`);
    check(dialogs.length === 0, '加载无警告弹窗', dialogs.join(' | '));

    const badge = await page.$eval('#version-badge', el => el.textContent);
    check(/HFE/.test(badge), `顶栏版本徽章 = "${badge}"`);
    const nActs = await page.$eval('#action-list', el => el.children.length);
    check(nActs === 116, `动作列表条目 = ${nActs}`);
    const hasStand = await page.$eval('#action-list', el => /STAND/.test(el.textContent));
    check(hasStand, '动作列表含 STAND');
    const nThumbs = await page.$eval('#frame-strip', el => el.children.length);
    check(nThumbs >= 6, `时间轴帧条目 = ${nThumbs}（STAND 6 帧）`);

    await new Promise(r => setTimeout(r, 400));
    const px = await stagePixels(page);
    check(px.nonBg > 3000, `STAND 帧画布非背景像素 = ${px.nonBg}（画布 ${px.w}×${px.h}）`);
    await shot(page, 'm3-stand.png');

    // 时间轴播放
    await page.click('#btn-play');
    const seen = new Set();
    for (let i = 0; i < 16; i++) {
        await new Promise(r => setTimeout(r, 110));
        seen.add(await page.evaluate(() => App.frameIndex));
    }
    await page.click('#btn-play');
    const inRange = [...seen].every(f => f >= 1 && f <= 6);
    check(seen.size >= 3, `播放推进：观测到 ${seen.size} 个不同帧 [${[...seen].sort((a, b) => a - b)}]`);
    check(inRange, '播放帧全部在 STAND 区间 [1,6]');
    const playing = await page.evaluate(() => App.playing);
    check(playing === false, '再点播放键可停止');

    // 洋葱皮
    await page.click('#toggle-onion');
    await new Promise(r => setTimeout(r, 250));
    const pxOnion = await stagePixels(page);
    check(pxOnion.nonBg > px.nonBg, `洋葱皮开启后像素增多（${px.nonBg} → ${pxOnion.nonBg}）`);
    await shot(page, 'm3-onion.png');
    await page.click('#toggle-onion');

    // 切帧快捷键
    await page.evaluate(() => App.selectFrame(1));
    await page.keyboard.press('ArrowRight');
    const fi2 = await page.evaluate(() => App.frameIndex);
    check(fi2 === 2, `→ 键切到帧 ${fi2}`);
    await page.keyboard.press('ArrowLeft');

    // ref 复用帧（refIndex>0 且自身无 uz）：显示源帧画面 + 只读保护
    const refInfo = await page.evaluate(() => {
        App.selectFrame(114);           // LIE_TURN 首帧，refIndex=85
        const fp = App.pose();
        return { refSource: fp.refSource, entries: fp.entries.length };
    });
    await new Promise(r => setTimeout(r, 250));
    check(refInfo.refSource === 85, `帧114 复用源 = 帧${refInfo.refSource}`);
    check(refInfo.entries > 0, `复用帧解析条目 = ${refInfo.entries}`);
    const pxRef = await stagePixels(page);
    check(pxRef.nonBg > 3000, `复用帧渲染像素 = ${pxRef.nonBg}`);
    await shot(page, 'm3-refframe.png');
    // 只读：拖拽不产生修改
    const refGuard = await page.evaluate(() => {
        const before = HFJ.stringify(App.char.getFrame(114));
        const undoDepth = App.undo.canUndo();
        App.poseEditOnce('测试', fp => { const e = fp.entries[0]; if (e && e.pose) e.pose.rotation += 30; });
        return {
            unchanged: HFJ.stringify(App.char.getFrame(114)) === before,
            noNewUndo: App.undo.canUndo() === undoDepth
        };
    });
    check(refGuard.unchanged && refGuard.noNewUndo, '复用帧编辑保护生效（数据未变、无撤销记录）');
    await page.evaluate(() => {
        const stand = App.char.listActions().find(a => a.name === 'STAND');
        if (stand) App.selectAction(stand.index);
    });

    if (what !== 'all' && what !== 'm3' && pageErrors.length) { /* 继续 */ }

    // ---------------- M4 选中 / FK 编辑 / 撤销 / 帧结构 ----------------
    section('M4 选中部位 / 旋转移动缩放 FK / 撤销');
    const fi = await page.evaluate(() => App.frameIndex);
    const baseText = await frameText(page, fi);

    // 点击选中
    const pt = await findDraggablePoint(page, [5, 10, 6, 11]);
    check(!!pt, `找到可编辑部位命中点（槽 ${pt && pt.slot}）`);
    if (!pt) throw new Error('无法找到可点击部位');
    await page.mouse.click(pt.cx, pt.cy);
    const sel = await page.evaluate(() => App.selection);
    check(sel === pt.slot, `点击选中槽位 = ${sel}`);

    // 旋转（默认工具）：绕挂接点拖 ~40°
    const before = await page.evaluate(slot => {
        const fp = App.pose(); const e = fp.getEntry(slot);
        const kids = (fp.children[slot] || []).map(c => c.child).filter(c => fp.getEntry(c));
        const kid = kids[0];
        const ke = kid !== undefined ? fp.getEntry(kid) : null;
        return {
            rotation: e.pose.rotation, kid,
            kidTx: ke ? ke.mLogical.tx : null, kidTy: ke ? ke.mLogical.ty : null
        };
    }, pt.slot);
    // 围绕锚点从当前角度旋转 40°
    const r0 = Math.atan2(pt.cy - pt.anchorCy, pt.cx - pt.anchorCx);
    const rad = Math.hypot(pt.cx - pt.anchorCx, pt.cy - pt.anchorCy);
    const r1 = r0 + 40 * Math.PI / 180;
    await page.mouse.move(pt.cx, pt.cy);
    await page.mouse.down();
    for (let t = 0.2; t <= 1.001; t += 0.2) {
        const a = r0 + (r1 - r0) * t;
        await page.mouse.move(pt.anchorCx + Math.cos(a) * rad, pt.anchorCy + Math.sin(a) * rad);
        await new Promise(r => setTimeout(r, 25));
    }
    await page.mouse.up();
    await new Promise(r => setTimeout(r, 150));
    const afterRot = await page.evaluate((slot, kid) => {
        const fp = App.pose(); const e = fp.getEntry(slot);
        const ke = kid !== undefined && kid !== null ? fp.getEntry(kid) : null;
        return {
            rotation: e.pose.rotation,
            kidTx: ke ? ke.mLogical.tx : null, kidTy: ke ? ke.mLogical.ty : null,
            canUndo: App.undo.canUndo(),
            dirty: App.char.spt.dirty
        };
    }, pt.slot, before.kid);
    const dRot = afterRot.rotation - before.rotation;
    check(Math.abs(dRot - 40) < 12, `拖拽旋转生效：Δ旋转 = ${dRot.toFixed(1)}°（目标 40°）`);
    const kidMoved = before.kid !== undefined && before.kid !== null &&
        (Math.abs(afterRot.kidTx - before.kidTx) > 0.5 || Math.abs(afterRot.kidTy - before.kidTy) > 0.5);
    check(kidMoved, `FK 联动：子槽 ${before.kid} 矩阵随动（Δtx=${(afterRot.kidTx - before.kidTx).toFixed(2)}）`);
    check(afterRot.canUndo, '生成撤销命令');
    check(afterRot.dirty, 'Spt 标记为脏');
    await shot(page, 'm4-rotated.png');

    // Ctrl+Z 撤销
    await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
    await new Promise(r => setTimeout(r, 120));
    const undoneText = await frameText(page, fi);
    check(undoneText === baseText, 'Ctrl+Z 撤销后帧数据与编辑前逐字符一致');

    // 移动工具
    await page.click('#tool-move');
    const ptM = await findDraggablePoint(page, [pt.slot]);
    if (ptM) {
        const dpBefore = await page.evaluate(slot => {
            const e = App.pose().getEntry(slot); return { x: e.pose.dpx, y: e.pose.dpy };
        }, ptM.slot);
        await page.mouse.move(ptM.cx, ptM.cy);
        await page.mouse.down();
        await page.mouse.move(ptM.cx + 24, ptM.cy - 18, { steps: 6 });
        await page.mouse.up();
        await new Promise(r => setTimeout(r, 120));
        const dpAfter = await page.evaluate(slot => {
            const e = App.pose().getEntry(slot); return { x: e.pose.dpx, y: e.pose.dpy };
        }, ptM.slot);
        const moved = Math.abs(dpAfter.x - dpBefore.x) > 3 && Math.abs(dpAfter.y - dpBefore.y) > 3;
        check(moved, `移动工具生效：dp (${dpBefore.x.toFixed(1)},${dpBefore.y.toFixed(1)}) → (${dpAfter.x.toFixed(1)},${dpAfter.y.toFixed(1)})`);
        await page.evaluate(() => App.undo.undo());
    } else {
        check(false, '移动测试：找不到命中点');
    }

    // 缩放工具
    await page.click('#tool-scale');
    const ptS = await findDraggablePoint(page, [pt.slot]);
    if (ptS) {
        const scBefore = await page.evaluate(slot => {
            const e = App.pose().getEntry(slot); return e.pose.xScale;
        }, ptS.slot);
        const vx = ptS.cx - ptS.anchorCx, vy = ptS.cy - ptS.anchorCy;
        await page.mouse.move(ptS.cx, ptS.cy);
        await page.mouse.down();
        await page.mouse.move(ptS.anchorCx + vx * 1.5, ptS.anchorCy + vy * 1.5, { steps: 6 });
        await page.mouse.up();
        await new Promise(r => setTimeout(r, 120));
        const scAfter = await page.evaluate(slot => {
            const e = App.pose().getEntry(slot); return e.pose.xScale;
        }, ptS.slot);
        check(Math.abs(scAfter / scBefore - 1.5) < 0.25, `缩放工具生效：xScale ${scBefore.toFixed(3)} → ${scAfter.toFixed(3)}（目标 ×1.5）`);
        await page.evaluate(() => App.undo.undo());
    } else {
        check(false, '缩放测试：找不到命中点');
    }
    await page.click('#tool-rotate');

    // 撤销后帧数据完全还原
    const cleanText = await frameText(page, fi);
    check(cleanText === baseText, '全部撤销后帧数据与初始一致');
    const sptClean = await page.evaluate(() => App.char.spt.serialize() === App.char.spt.origText);
    check(sptClean, '全部撤销后 Spt 序列化与原文逐字节一致');

    // 帧复制 / 删除
    const fc0 = await page.evaluate(() => App.char.frameCount());
    await page.click('#btn-frame-copy');
    await new Promise(r => setTimeout(r, 250));
    const afterCopy = await page.evaluate(() => ({ n: App.char.frameCount(), fi: App.frameIndex }));
    check(afterCopy.n === fc0 + 1, `复制帧：帧数 ${fc0} → ${afterCopy.n}`);
    check(afterCopy.fi === fi + 1, `复制后选中新帧 ${afterCopy.fi}`);
    await page.click('#btn-frame-del');
    await new Promise(r => setTimeout(r, 250));
    const afterDel = await page.evaluate(() => ({
        n: App.char.frameCount(),
        clean: App.char.spt.serialize() === App.char.spt.origText
    }));
    check(afterDel.n === fc0, `删除帧：帧数还原为 ${afterDel.n}`);
    check(afterDel.clean, '复制+删除后 Spt 与原文逐字节一致');
    check(dialogs.length === 0, 'M4 过程无意外弹窗', dialogs.join(' | '));

    // ---------------- M4b FK 开关 / footY 保持 / 添加移除部位 ----------------
    section('M4b FK 开关 / footY 保持 / 添加移除部位');
    await page.evaluate(() => App.selectFrame(1));
    const base4b = await frameText(page, 1);
    const footY0 = await page.evaluate(() => HFJ.getV(App.char.getFrame(1), 'footY'));

    // FK 关：旋转上臂，子部位（前臂）矩阵不动
    await page.click('#toggle-fk');
    const ptF = await findDraggablePoint(page, [5, 10]);
    if (ptF) {
        await page.mouse.click(ptF.cx, ptF.cy);
        const kidBefore = await page.evaluate(slot => {
            const fp = App.pose();
            const kid = (fp.children[slot] || []).map(c => c.child).find(c => fp.getEntry(c));
            const ke = fp.getEntry(kid);
            return { kid, tx: ke.mLogical.tx, ty: ke.mLogical.ty, rot: fp.getEntry(slot).pose.rotation };
        }, ptF.slot);
        const a0 = Math.atan2(ptF.cy - ptF.anchorCy, ptF.cx - ptF.anchorCx);
        const rr = Math.hypot(ptF.cx - ptF.anchorCx, ptF.cy - ptF.anchorCy);
        await page.mouse.move(ptF.cx, ptF.cy);
        await page.mouse.down();
        for (let t = 0.25; t <= 1.001; t += 0.25) {
            const a = a0 + (35 * Math.PI / 180) * t;
            await page.mouse.move(ptF.anchorCx + Math.cos(a) * rr, ptF.anchorCy + Math.sin(a) * rr);
            await new Promise(r => setTimeout(r, 25));
        }
        await page.mouse.up();
        await new Promise(r => setTimeout(r, 150));
        const kidAfter = await page.evaluate((slot, kid) => {
            const fp = App.pose();
            const ke = fp.getEntry(kid);
            return { tx: ke.mLogical.tx, ty: ke.mLogical.ty, rot: fp.getEntry(slot).pose.rotation };
        }, ptF.slot, kidBefore.kid);
        check(Math.abs(kidAfter.rot - kidBefore.rot - 35) < 12,
            `FK 关：旋转生效 Δ=${(kidAfter.rot - kidBefore.rot).toFixed(1)}°`);
        check(Math.abs(kidAfter.tx - kidBefore.tx) < 0.01 && Math.abs(kidAfter.ty - kidBefore.ty) < 0.01,
            `FK 关：子槽 ${kidBefore.kid} 保持原位（Δtx=${Math.abs(kidAfter.tx - kidBefore.tx).toExponential(1)}）`);
        // footY 增量模式：手臂旋转不动脚 → footY 保持原值
        const footY1 = await page.evaluate(() => HFJ.getV(App.char.getFrame(1), 'footY'));
        check(footY1 === footY0, `footY 保持不变（${footY0} → ${footY1}）`);
        await page.evaluate(() => App.undo.undo());
    } else {
        check(false, 'FK 关测试：找不到命中点');
    }
    await page.click('#toggle-fk');   // 恢复 FK 开

    const fkClean = await frameText(page, 1);
    check(fkClean === base4b, 'FK 测试撤销后帧数据还原');

    // 添加部位（同槽位二次添加左武器1）
    const addPartRes = await page.evaluate(async () => {
        const f = App.char.getFrame(1);
        const uzLen0 = HFJ.arrLen(HFJ.get(f, 'uz'));
        const row = document.querySelector('.add-part-row');
        if (!row) return { error: '找不到添加部位控件' };
        const sel = row.querySelector('select');
        sel.value = '20';   // 左武器1（帧里已有 → 二次添加）
        sel.onchange();
        row.querySelector('button').click();
        await new Promise(r => setTimeout(r, 300));
        const f2 = App.char.getFrame(1);
        const uz = HFJ.get(f2, 'uz');
        const uzLen1 = HFJ.arrLen(uz);
        const lastLz = HFJ.arrGet(uz, uzLen1 - 1);
        const fp = App.pose(1);
        const cnt20 = fp.entries.filter(e => e.slot === 20).length;
        return {
            uzLen0, uzLen1,
            lastSlot: HFJ.getV(lastLz, 'i') | 0,
            cnt20,
            selection: App.selection,
            canUndo: App.undo.canUndo()
        };
    });
    if (addPartRes.error) {
        check(false, '添加部位', addPartRes.error);
    } else {
        check(addPartRes.uzLen1 === addPartRes.uzLen0 + 1, `添加部位：uz ${addPartRes.uzLen0} → ${addPartRes.uzLen1}`);
        check(addPartRes.lastSlot === 20, `新条目在顶层（槽 ${addPartRes.lastSlot}）`);
        check(addPartRes.cnt20 === 2, `同槽位重复添加：槽20 条目数 = ${addPartRes.cnt20}`);
    }
    await shot(page, 'm4b-addpart.png');
    await page.evaluate(() => App.undo.undo());
    const addClean = await frameText(page, 1);
    check(addClean === base4b, '添加部位撤销后帧数据还原');

    // 移除部位（左武器1）
    const removeRes = await page.evaluate(async () => {
        window.confirm = () => true;   // 跳过确认弹窗
        const f = App.char.getFrame(1);
        const uzLen0 = HFJ.arrLen(HFJ.get(f, 'uz'));
        App.selection = 20;
        App.refreshAll();
        const btn = [...document.querySelectorAll('#limb-props .limb-head button')]
            .find(b => b.textContent === '移除');
        if (!btn) return { error: '找不到移除按钮' };
        btn.click();
        await new Promise(r => setTimeout(r, 300));
        const f2 = App.char.getFrame(1);
        const uzLen1 = HFJ.arrLen(HFJ.get(f2, 'uz'));
        const fp = App.pose(1);
        return { uzLen0, uzLen1, has20: !!fp.getEntry(20) };
    });
    if (removeRes.error) {
        check(false, '移除部位', removeRes.error);
    } else {
        check(removeRes.uzLen1 === removeRes.uzLen0 - 1 && !removeRes.has20,
            `移除部位：uz ${removeRes.uzLen0} → ${removeRes.uzLen1}，槽20 已不在帧中`);
    }
    await page.evaluate(() => App.undo.undo());
    const rmClean = await frameText(page, 1);
    check(rmClean === base4b, '移除部位撤销后帧数据还原');
    const m4bSptClean = await page.evaluate(() => App.char.spt.serialize() === App.char.spt.origText);
    check(m4bSptClean, 'M4b 全部撤销后 Spt 与原文逐字节一致');

    // ---------------- M5 判定框 ----------------
    section('M5 判定框叠加与编辑');
    // 找一个带 editAttack 的帧
    const atkFrame = await page.evaluate(() => {
        for (let i = 0; i < App.char.frameCount(); i++) {
            const f = App.char.getFrame(i);
            if (!f) continue;
            const arr = HFJ.get(f, 'editAttack');
            if (arr && HFJ.isHfwArray(arr) && HFJ.arrLen(arr) > 0) {
                // 找包含该帧的动作
                const acts = App.char.listActions();
                for (const a of acts) {
                    const r = App.char.actionFrameRange(a.index);
                    if (r && i >= r.start && i <= r.end) return { fi: i, action: a.index, name: a.name };
                }
                return { fi: i, action: -1, name: null };
            }
        }
        return null;
    });
    check(!!atkFrame, `找到带攻击框的帧：帧${atkFrame && atkFrame.fi}（动作 ${atkFrame && atkFrame.name}）`);
    if (atkFrame) {
        await page.evaluate(a => { if (a.action >= 0) App.selectAction(a.action); App.selectFrame(a.fi); }, atkFrame);
        const boxesOn = await page.$eval('#toggle-boxes', el => el.classList.contains('on'));
        if (!boxesOn) await page.click('#toggle-boxes');
        await new Promise(r => setTimeout(r, 250));
        await shot(page, 'm5-boxes.png');
        const pxNoBox = await page.evaluate(() => { App.showBoxes = false; App.requestDraw(); return 0; });
        await new Promise(r => setTimeout(r, 150));
        const p1 = await stagePixels(page);
        await page.evaluate(() => { App.showBoxes = true; App.requestDraw(); });
        await new Promise(r => setTimeout(r, 150));
        const p2 = await stagePixels(page);
        check(p2.nonBg > p1.nonBg, `判定框叠加绘制（像素 ${p1.nonBg} → ${p2.nonBg}）`);

        // 面板编辑：改第一个攻击框宽度
        await page.click('[data-tab="tab-box"]');
        const nCards = await page.$eval('#box-props', el => el.querySelectorAll('.box-card').length);
        check(nCards > 0, `判定框面板卡片数 = ${nCards}`);
        const editRes = await page.evaluate(fi2 => {
            const f = App.char.getFrame(fi2);
            const ea = HFJ.get(f, 'editAttack');
            const box = HFJ.arrGet(ea, 0);
            const oldW = HFJ.getV(box, 'x2');
            const atkBefore = HFJ.stringify(HFJ.get(f, 'attack'));
            // 模拟面板输入：宽 +30
            const inputs = document.querySelectorAll('#box-props .box-card input[type=number]');
            // 卡片字段顺序 l,j,x1,y1,x2,y2,z1 → x2 是第 5 个（下标 4）
            const secs = document.querySelectorAll('#box-props .box-section');
            let x2Input = null;
            for (const sec of secs) {
                if (sec.textContent.indexOf('editAttack）') !== -1) {
                    const card = sec.querySelector('.box-card');
                    if (card) x2Input = card.querySelectorAll('input[type=number]')[4];
                    break;
                }
            }
            if (!x2Input) return { error: '找不到宽度输入框' };
            x2Input.value = String(oldW + 30);
            x2Input.dispatchEvent(new Event('change'));
            const f2 = App.char.getFrame(fi2);
            const newW = HFJ.getV(HFJ.arrGet(HFJ.get(f2, 'editAttack'), 0), 'x2');
            const atk0 = HFJ.arrGet(HFJ.get(f2, 'attack'), 0);
            const rtW = HFJ.getV(atk0, 'x2') - HFJ.getV(atk0, 'x1');
            const atkAfter = HFJ.stringify(HFJ.get(f2, 'attack'));
            return { oldW, newW, rtW, baked: atkBefore !== atkAfter, canUndo: App.undo.canUndo() };
        }, atkFrame.fi);
        if (editRes.error) {
            check(false, '判定框编辑', editRes.error);
        } else {
            check(editRes.newW === editRes.oldW + 30, `面板改宽度 ${editRes.oldW} → ${editRes.newW}`);
            check(editRes.baked, '运行时 attack[] 已重烘焙');
            check(Math.abs(editRes.rtW - editRes.newW) < 0.001, `烘焙宽度一致（attack.x2-x1 = ${editRes.rtW}）`);
        }
        await page.evaluate(() => App.undo.undo());
        const m5clean = await page.evaluate(() => App.char.spt.serialize() === App.char.spt.origText);
        check(m5clean, '撤销后 Spt 与原文一致');
        await page.click('#toggle-boxes');   // 关掉
        await page.click('[data-tab="tab-limb"]');
    }

    // ---------------- M7 zip 导出（干净状态下先测，便于逐字节比对） ----------------
    let m6NewPicIndex = -1;
    if (what === 'all' || what === 'm7' || what === 'm6') {
        section('M7 zip 导出（干净状态逐字节验证）');
        // 回到 STAND
        await page.evaluate(() => {
            const stand = App.char.listActions().find(a => a.name === 'STAND');
            if (stand) App.selectAction(stand.index);
        });
        const client = await page.createCDPSession();
        await client.send('Browser.setDownloadBehavior', {
            behavior: 'allow', downloadPath: DL_DIR, eventsEnabled: true
        });
        const done = new Map();
        client.on('Browser.downloadWillBegin', ev => done.set(ev.guid, { name: ev.suggestedFilename, state: 'begin' }));
        client.on('Browser.downloadProgress', ev => {
            const d = done.get(ev.guid); if (d) d.state = ev.state;
        });
        await page.click('#btn-export');
        // 等两个下载完成
        const t0 = Date.now();
        while (Date.now() - t0 < 30000) {
            const arr = [...done.values()];
            if (arr.length >= 2 && arr.every(d => d.state === 'completed')) break;
            await new Promise(r => setTimeout(r, 200));
        }
        const dls = [...done.values()];
        check(dls.length === 2 && dls.every(d => d.state === 'completed'),
            `导出 2 个 zip：${dls.map(d => d.name + '(' + d.state + ')').join(', ')}`);

        // 解压并逐字节比对
        const extractBase = path.join(DL_DIR, 'x');
        fs.rmSync(extractBase, { recursive: true, force: true });
        let allSame = true, compared = 0, firstDiff = '';
        for (const d of dls) {
            const zipPath = path.join(DL_DIR, d.name);
            const out = path.join(extractBase, d.name.replace(/\.zip$/i, ''));
            execFileSync('powershell', ['-NoProfile', '-Command',
                `Expand-Archive -LiteralPath "${zipPath}" -DestinationPath "${out}" -Force`]);
            const isSpt = /Spt\.zip$/i.test(d.name) || /Spt$/i.test(d.name.replace(/\.zip$/i, ''));
            const srcDir = isSpt ? path.dirname(hfe.localSptPath) : hfe.localLmiDir;
            for (const f of fs.readdirSync(out)) {
                const a = fs.readFileSync(path.join(out, f));
                const bPath = path.join(srcDir, f);
                if (!fs.existsSync(bPath)) { allSame = false; firstDiff = firstDiff || (f + ' 原文件不存在'); continue; }
                const b = fs.readFileSync(bPath);
                compared++;
                if (!a.equals(b)) { allSame = false; firstDiff = firstDiff || f; }
            }
        }
        check(compared >= 278, `zip 内文件与原文件夹比对数 = ${compared}（Spt 1 + Lmi 277）`);
        check(allSame, 'zip 全部文件与原文件逐字节一致', firstDiff);
    }

    // ---------------- M6 贴图工具 ----------------
    if (what === 'all' || what === 'm6') {
        section('M6 贴图工具');
        await page.click('[data-tab="tab-tex"]');
        await new Promise(r => setTimeout(r, 500));
        const tex = await page.evaluate(() => {
            const sel = document.getElementById('tex-limb-sel');
            const cards = [...document.querySelectorAll('#tex-gallery .tex-card')];
            // 抽查第一张**有图**的缩略图是否画了内容（"无图"变体画布为空是正常的）
            let thumbOk = false, checkedCard = -1;
            for (let ci = 0; ci < cards.length; ci++) {
                if (cards[ci].querySelector('.tex-cap').textContent.indexOf('无图') !== -1) continue;
                checkedCard = ci;
                const cv = cards[ci].querySelector('canvas');
                const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
                for (let i = 3; i < d.length; i += 4) if (d[i] > 10) { thumbOk = true; break; }
                break;
            }
            return { limbs: sel ? sel.options.length : 0, cards: cards.length, thumbOk, checkedCard };
        });
        check(tex.limbs === 22, `部位下拉 = ${tex.limbs} 个 Limb`);
        check(tex.cards > 0, `贴图变体卡片 = ${tex.cards}`);
        check(tex.thumbOk, `缩略图有像素内容（卡片#${tex.checkedCard}）`);
        await shot(page, 'm6-textures.png');

        // 锚点/关节编辑器弹窗（选有图的卡片）
        await page.evaluate(() => {
            const cards = [...document.querySelectorAll('#tex-gallery .tex-card')];
            const card = cards.find(c => c.querySelector('.tex-cap').textContent.indexOf('无图') === -1);
            if (!card) return;
            const b = [...card.querySelectorAll('.tex-ops button')].find(x => x.textContent.indexOf('锚点') !== -1);
            if (b) b.click();
        });
        await new Promise(r => setTimeout(r, 400));
        const modalInfo = await page.evaluate(() => {
            const m = document.querySelector('.modal');
            if (!m) return null;
            const cv = m.querySelector('#anchor-cv');
            const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
            let drawn = 0;
            for (let i = 0; i < d.length; i += 4) {
                if (Math.abs(d[i] - 0x15) > 10 || Math.abs(d[i + 1] - 0x17) > 10 || Math.abs(d[i + 2] - 0x1c) > 10) drawn++;
            }
            return { drawn, cx: m.querySelector('#anc-cx').value, cy: m.querySelector('#anc-cy').value };
        });
        check(!!modalInfo, '锚点/关节编辑器可打开');
        if (modalInfo) {
            check(modalInfo.drawn > 500, `编辑器画布已绘制（像素 ${modalInfo.drawn}，cx=${modalInfo.cx} cy=${modalInfo.cy}）`);
            await shot(page, 'm6-anchor.png');
            await page.click('#anc-cancel');
        }

        // 新增贴图变体（拦截文件选择器，用现有 PNG 充当导入文件）
        const addRes = await page.evaluate(async () => {
            // 拦截 file input
            const firstPng = App.char.pngs.keys().next().value;
            const blob = App.char.pngs.get(firstPng);
            const file = new File([blob], 'newvariant.png', { type: 'image/png' });
            const origClick = HTMLInputElement.prototype.click;
            HTMLInputElement.prototype.click = function () {
                if (this.type === 'file') {
                    const dt = new DataTransfer();
                    dt.items.add(file);
                    this.files = dt.files;
                    const self = this;
                    setTimeout(() => self.onchange && self.onchange(), 0);
                } else origClick.call(this);
            };
            let maxBefore = -1;
            App.char.picFiles.forEach((_, n) => { if (n > maxBefore) maxBefore = n; });
            const limbSel = document.getElementById('tex-limb-sel');
            const limbName = limbSel.value;
            const reg = App.char.limbByName.get(limbName);
            const lpiLenBefore = HFJ.arrLen(HFJ.get(reg.node, 'limbPicIndex'));
            const addBtn = [...document.querySelectorAll('#texture-panel button')]
                .find(b => b.textContent.indexOf('新增贴图变体') !== -1);
            addBtn.click();
            await new Promise(r => setTimeout(r, 300));
            HTMLInputElement.prototype.click = origClick;
            const N = maxBefore + 1;
            const jf = App.char.picFiles.get(N);
            const lpiLenAfter = HFJ.arrLen(HFJ.get(reg.node, 'limbPicIndex'));
            const modal = document.querySelector('.modal');
            if (modal) modal.querySelector('#anc-cancel').click();
            return {
                N, limbName,
                fileCreated: !!jf, fileDirty: jf ? jf.dirty : false,
                fileName: jf ? jf.name : null,
                indexOk: jf ? HFJ.getV(App.char.picByIndex.get(N), 'index') === N : false,
                embeded: jf ? HFJ.getV(App.char.picByIndex.get(N), 'embeded') === true : false,
                lpiGrew: lpiLenAfter === lpiLenBefore + 1,
                limbDirty: reg.file.dirty,
                pngPending: App.pendingPngs.has(N + '.png')
            };
        });
        check(addRes.fileCreated, `新增变体生成 ${addRes.fileName}（图池#${addRes.N}，部位 ${addRes.limbName}）`);
        check(addRes.indexOk && addRes.embeded, 'LimbPic index/embeded 字段正确');
        check(addRes.lpiGrew, 'Limb_X.json limbPicIndex 追加成功');
        check(addRes.fileDirty && addRes.limbDirty, '新 LimbPic 与 Limb 均标脏');
        check(addRes.pngPending, `PNG 挂入待写队列（${addRes.N}.png）`);
        m6NewPicIndex = addRes.N;

        // 替换 PNG（皮肤）
        const repRes = await page.evaluate(async () => {
            const firstPng = App.char.pngs.keys().next().value;
            const blob = App.char.pngs.get(firstPng);
            const file = new File([blob], 'skin.png', { type: 'image/png' });
            const origClick = HTMLInputElement.prototype.click;
            HTMLInputElement.prototype.click = function () {
                if (this.type === 'file') {
                    const dt = new DataTransfer();
                    dt.items.add(file);
                    this.files = dt.files;
                    const self = this;
                    setTimeout(() => self.onchange && self.onchange(), 0);
                } else origClick.call(this);
            };
            const repBtn = [...document.querySelectorAll('#tex-gallery .tex-ops button')]
                .find(b => b.textContent === '替换PNG');
            if (!repBtn) { HTMLInputElement.prototype.click = origClick; return { error: '无替换按钮' }; }
            repBtn.click();
            await new Promise(r => setTimeout(r, 200));
            HTMLInputElement.prototype.click = origClick;
            return { pending: App.pendingPngs.size };
        });
        check(!repRes.error && repRes.pending >= 2, `替换 PNG 进入待写队列（pendingPngs=${repRes.pending}）`);

        // 再导出一次 zip，验证新增文件进入 Lmi zip
        if (what === 'all') {
            const doneMap = new Map();
            const client2 = await page.createCDPSession();
            await client2.send('Browser.setDownloadBehavior', {
                behavior: 'allow', downloadPath: path.join(DL_DIR, 'second'), eventsEnabled: true
            });
            fs.mkdirSync(path.join(DL_DIR, 'second'), { recursive: true });
            client2.on('Browser.downloadWillBegin', ev => doneMap.set(ev.guid, { name: ev.suggestedFilename, state: 'begin' }));
            client2.on('Browser.downloadProgress', ev => {
                const d = doneMap.get(ev.guid); if (d) d.state = ev.state;
            });
            await page.click('#btn-export');
            const t1 = Date.now();
            while (Date.now() - t1 < 30000) {
                const arr = [...doneMap.values()];
                if (arr.length >= 2 && arr.every(d => d.state === 'completed')) break;
                await new Promise(r => setTimeout(r, 200));
            }
            const lmiZip = [...doneMap.values()].find(d => /Lmi/.test(d.name));
            let hasNew = false, hasNewPng = false;
            if (lmiZip) {
                const out = path.join(DL_DIR, 'second', 'x');
                execFileSync('powershell', ['-NoProfile', '-Command',
                    `Expand-Archive -LiteralPath "${path.join(DL_DIR, 'second', lmiZip.name)}" -DestinationPath "${out}" -Force`]);
                hasNew = fs.existsSync(path.join(out, `LimbPic_${m6NewPicIndex}.json`));
                hasNewPng = fs.existsSync(path.join(out, `${m6NewPicIndex}.png`));
            }
            check(hasNew, `修改后导出：Lmi zip 含 LimbPic_${m6NewPicIndex}.json`);
            check(hasNewPng, `修改后导出：Lmi zip 含 ${m6NewPicIndex}.png`);
        }
        await page.click('[data-tab="tab-limb"]');
    }

    // ---------------- HFEX 冒烟 ----------------
    section('HFEX 冒烟（加载+渲染）');
    const hfex = datasetSpec('HFEX角色SPT及贴图', port);
    const infoX = await loadCharacter(page, hfex);
    check(infoX.version === 'HFEX', `版本识别 = ${infoX.version}`);
    check(infoX.frames === 522 && infoX.actions === 118, `帧 ${infoX.frames} / 动作 ${infoX.actions}`);
    check(infoX.actionName === 'STAND', `默认动作 = ${infoX.actionName}`);
    await new Promise(r => setTimeout(r, 500));
    const pxX = await stagePixels(page);
    check(pxX.nonBg > 3000, `HFEX STAND 渲染像素 = ${pxX.nonBg}`);
    await shot(page, 'hfex-stand.png');

    // ---------------- 多 Lmi / 缺部位诊断 ----------------
    section('多 Lmi 加载与缺部位诊断');
    // 1) rudolf（Spt 引用 rudolf_* 部位，folder 里只有 yaga_* Lmi）→ 应弹缺部位警告
    const rudolfSpec = datasetSpec('测试角色', port);
    const dlgBefore = dialogs.length;
    const infoR = await loadCharacter(page, rudolfSpec);
    check(infoR.version === 'HFEX' && infoR.frames === 368, `rudolf 加载：${infoR.version} / ${infoR.frames} 帧`);
    const missDlg = dialogs.slice(dlgBefore).find(d => d.indexOf('部位') !== -1);
    check(!!missDlg, '缺部位警告弹出', dialogs.slice(dlgBefore).join(' | ') || '（无弹窗）');
    check(missDlg && missDlg.indexOf('rudolf_00Head') !== -1, '警告列出缺失部位名 rudolf_00Head');

    // 2) jenny 主集合 + yaga 附加集合：全局注册合并、主集合渲染不受影响
    const jennySpec = datasetSpec('HFE角色SPT及贴图', port);
    jennySpec.extraLmi = [{
        lmiFolder: rudolfSpec.lmiFolder,
        lmiJsonUrls: rudolfSpec.lmiJsonUrls,
        pngUrls: rudolfSpec.pngUrls
    }];
    const infoJ2 = await loadCharacter(page, jennySpec);
    check(infoJ2.lmiSets === 2, `Lmi 集合数 = ${infoJ2.lmiSets}`);
    check(infoJ2.limbNames === 42, `全局 Limb 注册 = ${infoJ2.limbNames}（jenny 22 + yaga 20）`);
    check(infoJ2.actionName === 'STAND', `默认动作 = ${infoJ2.actionName}`);
    await new Promise(r => setTimeout(r, 400));
    const pxJ2 = await stagePixels(page);
    check(pxJ2.nonBg > 3000, `多集合下 STAND 渲染像素 = ${pxJ2.nonBg}`);
    const setChecks = await page.evaluate(() => {
        const yreg = App.char.limbByName.get('yaga_00Head');
        let pool = null;
        HFJ.arrEach(HFJ.get(yreg.node, 'limbPicIndex'), n => {
            if (pool === null && n && n.t === 'n') pool = parseFloat(n.raw) | 0;
        });
        const info = App.char.picInfoIn(yreg.set, pool);
        return {
            qualified: info && info.pngName && info.pngName.indexOf('/') > 0,
            bitmapOk: info && info.pngName ? !!App.images.blobs.has(info.pngName) : false
        };
    });
    check(setChecks.qualified && setChecks.bitmapOk, '附加集合贴图键带前缀且位图可取');

    // ---------------- 汇总 ----------------
    section('汇总');
    check(pageErrors.length === 0, `全程无页面 JS 错误（${pageErrors.length}）`, pageErrors.slice(0, 3).join(' | '));

    const fails = results.filter(r => !r.ok);
    console.log(`\n共 ${results.length} 项检查，通过 ${results.length - fails.length}，失败 ${fails.length}`);
    if (fails.length) fails.forEach(f => console.log(`  ✗ [${f.section}] ${f.msg}`));

    await browser.close();
    server.close();
    process.exit(fails.length ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(2); });
