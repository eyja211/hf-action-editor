/**
 * rebake.js — 编辑后的重烘焙：裁剪框重算 + footY 重算 + 矩阵写回
 *
 * 复刻 CropAndStoreRenderedFrame（Spt.as 2973-3196）的测量语义：
 *   在未裁剪的 1000×800 舞台空间渲染整帧，扫描 alpha>20 的包围盒 → cx1/cy1/cx2/cy2。
 *   （原实现对 alpha 128-254 有符号位移怪癖且隔行扫描；此处取 alpha>20 全量扫描，
 *    结果为原算法的保守超集，仅影响裁剪余量，不影响显示位置。）
 * ULseparate 帧：上/下半身分别渲染测量（cx1 组 / cx1_2 组）。
 */
(function (g) {
    'use strict';
    var HFJ = g.HFJ, Skel = g.HFSkel, Render = g.HFRender;

    var IDENTITY = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
    var offscreen = null;

    function getOffscreen() {
        if (!offscreen) {
            offscreen = document.createElement('canvas');
            offscreen.width = Skel.STAGE_W;
            offscreen.height = Skel.STAGE_H;
        }
        return offscreen;
    }

    /** 在舞台空间渲染（可选只画某半身），返回 alpha>20 包围盒 {x1,y1,x2,y2} 或 null */
    function measureBBox(fp, images, half) {
        var cv = getOffscreen();
        var ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, cv.width, cv.height);
        var opts = { smoothing: false };
        if (half === 'upper') {
            opts.onlySlots = upperSlots(fp);
        } else if (half === 'lower') {
            opts.skipSlots = upperSlots(fp);
        }
        Render.drawFrame(ctx, fp, images, IDENTITY, opts);
        var data = ctx.getImageData(0, 0, cv.width, cv.height).data;
        var w = cv.width, h = cv.height;
        var x1 = -1, y1 = -1, x2 = -1, y2 = -1;
        for (var y = 0; y < h; y++) {
            for (var x = 0; x < w; x++) {
                if (data[(y * w + x) * 4 + 3] > 20) {
                    if (x1 === -1 || x < x1) x1 = x;
                    if (x > x2) x2 = x;
                    if (y1 === -1) y1 = y;
                    y2 = y;
                }
            }
        }
        return x1 === -1 ? null : { x1: x1, y1: y1, x2: x2, y2: y2 };
    }

    function upperSlots(fp) {
        var s = new Set();
        fp.entries.forEach(function (e) {
            if (Skel.isUpperBody(e.slot)) s.add(e.slot);
        });
        return s;
    }

    /**
     * 完整重烘焙：测量裁剪框 → 更新帧字段 → 写回矩阵（writeBack 会按新裁剪值烘焙）
     * autoFootY: true 时重算 footY。
     * footYBefore: 编辑前的公式计算值（增量模式）。传入时 footY 按
     *   存档值 + (编辑后计算值 − 编辑前计算值) 更新——保留存档自身的校准口径
     *   （HFEX 存档 footY 与公式有系统性偏差，绝对覆盖会让角色在游戏里悬空）。
     *   姿势没动到脚时增量≈0，footY 保持原值不动。
     *   不传 footYBefore（如「重算」按钮）则按公式绝对值覆盖。
     * 返回 { cx1..cy2 } 供显示
     */
    function rebakeFrame(fp, images, autoFootY, footYBefore) {
        if (fp.refSource) return null; // 复用帧：画面属于源帧，不烘焙
        var f = fp.frame;
        if (!fp.ULseparate) {
            var bb = measureBBox(fp, images, 'all') || { x1: 0, y1: 0, x2: 0, y2: 0 };
            setCrop(f, '', bb);
            fp.cx1 = bb.x1; fp.cy1 = bb.y1;
        } else {
            var up = measureBBox(fp, images, 'upper') || { x1: 0, y1: 0, x2: 0, y2: 0 };
            var low = measureBBox(fp, images, 'lower') || { x1: 0, y1: 0, x2: 0, y2: 0 };
            setCrop(f, '', up);
            setCrop(f, '_2', low);
            fp.cx1 = up.x1; fp.cy1 = up.y1;
            fp.cx1_2 = low.x1; fp.cy1_2 = low.y1;
        }
        if (autoFootY) {
            var calc = fp.computeFootY();
            if (typeof footYBefore === 'number' && !isNaN(footYBefore)) {
                var delta = calc - footYBefore;
                if (Math.abs(delta) >= 0.5) {
                    var stored = HFJ.getV(f, 'footY') || 0;
                    HFJ.setNum(f, 'footY', Math.round((stored + delta) * 1000) / 1000, 'float');
                }
                // 增量过小 → footY 保持原值（不因浮点噪声弄脏数据）
            } else {
                HFJ.setNum(f, 'footY', calc, 'float');
            }
        }
        fp.writeBack();
        // 关节位置变了 → 运行时判定框（attack[]/body[]/bx*）重新锚定
        if (g.HFBoxes) g.HFBoxes.bakeBoxes(fp.char, fp);
        return { cx1: fp.cx1, cy1: fp.cy1 };
    }

    function setCrop(f, suffix, bb) {
        HFJ.setNum(f, 'cx1' + suffix, bb.x1, 'float');
        HFJ.setNum(f, 'cy1' + suffix, bb.y1, 'float');
        HFJ.setNum(f, 'cx2' + suffix, bb.x2, 'float');
        HFJ.setNum(f, 'cy2' + suffix, bb.y2, 'float');
    }

    g.HFRebake = { rebakeFrame: rebakeFrame, measureBBox: measureBBox };
})(typeof window !== 'undefined' ? window : globalThis);
