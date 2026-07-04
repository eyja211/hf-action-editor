/**
 * render.js — 帧渲染器：把 FramePose 按游戏规则画到 Canvas
 *
 * 复刻 RenderFrameOnBitmap（Spt.as 2421-2789）的绘制语义：
 *   - 逐条目按列表顺序绘制（数组顺序 = 遮挡层级，先画在底层）
 *   - ULseparate 帧：lowAtBottom=true → 先下半身后上半身；false → 相反
 *   - blurX/blurY：BlurFilter 近似（canvas 均匀模糊）；x==-10 → 'screen' 叠加
 *   - effect>0：ColorTransform 乘色近似；槽 22/26 不着色；effect≥10 时槽 26 用 screen
 *   - smoothing：HFE=true / HFEX=false（可覆盖）
 *
 * 编辑器叠加层：选中高亮、关节点、骨骼连线、地面线、判定框由 viewport 调用单独方法绘制。
 */
(function (g) {
    'use strict';
    var HFJ = g.HFJ, Skel = g.HFSkel;

    /**
     * 绘制一帧。
     * ctx: 画布上下文（调用前应已设置好视图变换外的状态）
     * fp: FramePose（矩阵为舞台逻辑空间，根在 (500,400)）
     * images: ImageStore
     * view: {a,b,c,d,tx,ty} 视图变换（舞台坐标 → 画布像素）
     * opts: { smoothing, alpha, effect(帧特效值), skipSlots:Set, onlySlots:Set }
     */
    function drawFrame(ctx, fp, images, view, opts) {
        opts = opts || {};
        var effect = opts.effect !== undefined ? opts.effect
            : (HFJ.getV(fp.frame, 'effect') || 0);
        var order = listOrder(fp);
        ctx.save();
        if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;
        ctx.imageSmoothingEnabled = opts.smoothing !== false;
        for (var oi = 0; oi < order.length; oi++) {
            var e = order[oi];
            if (!e.pic || !e.pic.pngName) continue;
            if (opts.skipSlots && opts.skipSlots.has(e.slot)) continue;
            if (opts.onlySlots && !opts.onlySlots.has(e.slot)) continue;
            drawEntry(ctx, e, images, view, effect, opts);
        }
        ctx.restore();
    }

    /** ULseparate 叠放顺序（ObjH.as 951-989）；复用帧的叠放参数取源帧 */
    function listOrder(fp) {
        if (!fp.ULseparate) return fp.entries;
        var lowAtBottom = HFJ.getV(fp.srcFrame || fp.frame, 'lowAtBottom') !== false; // 默认 true
        var uz = fp.entries.filter(function (e) { return e.list === 'uz'; });
        var lz = fp.entries.filter(function (e) { return e.list === 'lz'; });
        return lowAtBottom ? lz.concat(uz) : uz.concat(lz);
    }

    function drawEntry(ctx, e, images, view, effect, opts) {
        var img;
        var comp = null;
        if (effect > 0) {
            if (e.slot === 26 && effect >= 10) {
                img = images.get(e.pic.pngName);
                comp = 'screen';
            } else if (e.slot === 22 || e.slot === 26) {
                img = images.get(e.pic.pngName);
            } else {
                img = images.getTinted(e.pic.pngName, effect);
            }
        } else {
            img = images.get(e.pic.pngName);
        }
        if (!img) return; // 位图未就绪（异步加载后由 onLoad 触发重绘）

        var m = e.mLogical;
        ctx.save();
        ctx.setTransform(view.a, view.b, view.c, view.d, view.tx, view.ty);
        ctx.transform(m.a, m.b, m.c, m.d, m.tx, m.ty);
        if (e.blurX === -10) {
            ctx.globalCompositeOperation = 'screen';
        } else if (comp) {
            ctx.globalCompositeOperation = comp;
        } else if (e.blurX !== 0 || e.blurY !== 0) {
            // BlurFilter(x,y) 的近似：canvas 均匀模糊（源像素空间）
            var blur = Math.max(0, (Math.abs(e.blurX) + Math.abs(e.blurY)) / 4);
            if (blur > 0 && 'filter' in ctx) ctx.filter = 'blur(' + blur + 'px)';
        }
        ctx.drawImage(img, 0, 0);
        ctx.restore();
    }

    // ---------- 编辑器叠加层 ----------

    /** 骨骼连线 + 关节点 */
    function drawSkeleton(ctx, fp, view, selection) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        var lk = Skel.linkage(fp.sptType);
        // 连线：父关节 → 子挂接点
        ctx.strokeStyle = 'rgba(80,200,255,0.55)';
        ctx.lineWidth = 1.5;
        for (var i = 1; i < lk.length; i++) {
            var childE = fp.bySlot.get(lk[i].toLimb);
            var parentE = fp.bySlot.get(lk[i].fromLimb);
            if (!childE || !parentE || !childE.joints || !parentE.joints) continue;
            var pj = parentE.joints[lk[i].fromJ];
            var cj = childE.joints[lk[i].toJ];
            if (!pj || !cj) continue;
            var p1 = tp(view, pj), p2 = tp(view, cj);
            ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
        }
        // 关节点
        fp.entries.forEach(function (e) {
            if (!e.joints) return;
            var sel = selection === e.slot;
            for (var k = 0; k < e.joints.length; k++) {
                var pt = tp(view, e.joints[k]);
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, sel ? 4 : 2.5, 0, Math.PI * 2);
                ctx.fillStyle = sel ? '#ffd23c' : (k === 0 ? 'rgba(255,110,110,0.9)' : 'rgba(120,220,120,0.9)');
                ctx.fill();
            }
        });
        ctx.restore();
    }

    /** 选中部位的贴图外框 */
    function drawSelection(ctx, fp, images, view, slot) {
        var e = fp.bySlot.get(slot);
        if (!e || !e.pic || !e.pic.pngName) return;
        var img = images.get(e.pic.pngName);
        if (!img) return;
        var m = e.mLogical;
        ctx.save();
        ctx.setTransform(view.a, view.b, view.c, view.d, view.tx, view.ty);
        ctx.transform(m.a, m.b, m.c, m.d, m.tx, m.ty);
        ctx.strokeStyle = '#ffd23c';
        ctx.lineWidth = 1.5 / (view.a * Math.hypot(m.a, m.b) || 1);
        ctx.strokeRect(0, 0, img.width, img.height);
        ctx.restore();
    }

    /** 地面线（root.y + footY 处）与根点十字 */
    function drawGround(ctx, fp, view, canvasW) {
        var footY = HFJ.getV(fp.frame, 'footY') || 0;
        var gy = tp(view, { x: 0, y: Skel.ROOT_Y + footY }).y;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.strokeStyle = 'rgba(140,120,80,0.8)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(canvasW, gy); ctx.stroke();
        var rp = tp(view, { x: fp.rootX, y: fp.rootY });
        ctx.strokeStyle = 'rgba(255,90,90,0.9)';
        ctx.beginPath();
        ctx.moveTo(rp.x - 7, rp.y); ctx.lineTo(rp.x + 7, rp.y);
        ctx.moveTo(rp.x, rp.y - 7); ctx.lineTo(rp.x, rp.y + 7);
        ctx.stroke();
        ctx.restore();
    }

    function tp(view, pt) {
        return {
            x: view.a * pt.x + view.c * pt.y + view.tx,
            y: view.b * pt.x + view.d * pt.y + view.ty
        };
    }

    /** 命中检测：画布像素点 → 命中的槽位（按绘制顺序从顶层往下找，先查像素 alpha） */
    function hitTest(fp, images, view, px, py) {
        var order = listOrder(fp);
        for (var i = order.length - 1; i >= 0; i--) {
            var e = order[i];
            if (!e.pic || !e.pic.pngName) continue;
            var img = images.get(e.pic.pngName);
            if (!img) continue;
            // 画布点 → 舞台点 → 贴图像素点
            var inv = invertView(view);
            var sx = inv.a * px + inv.c * py + inv.tx;
            var sy = inv.b * px + inv.d * py + inv.ty;
            var mi = e.mLogical.clone().invert();
            var lp = mi.transformPoint(sx, sy);
            if (lp.x < 0 || lp.y < 0 || lp.x >= img.width || lp.y >= img.height) continue;
            if (alphaAt(images, e.pic.pngName, img, lp.x | 0, lp.y | 0) > 20) {
                return e.slot;
            }
        }
        return -1;
    }

    var alphaCache = new Map();
    function alphaAt(images, name, img, x, y) {
        var data = alphaCache.get(name);
        if (!data) {
            var cv = document.createElement('canvas');
            cv.width = img.width; cv.height = img.height;
            var c2 = cv.getContext('2d', { willReadFrequently: true });
            c2.drawImage(img, 0, 0);
            data = { w: img.width, px: c2.getImageData(0, 0, img.width, img.height).data };
            alphaCache.set(name, data);
        }
        return data.px[(y * data.w + x) * 4 + 3];
    }

    function invalidateAlpha(name) { alphaCache.delete(name); }

    function invertView(v) {
        var det = v.a * v.d - v.b * v.c;
        return {
            a: v.d / det, b: -v.b / det, c: -v.c / det, d: v.a / det,
            tx: -(v.tx * v.d - v.ty * v.c) / det,
            ty: -(v.ty * v.a - v.tx * v.b) / det
        };
    }

    g.HFRender = {
        drawFrame: drawFrame,
        drawSkeleton: drawSkeleton,
        drawSelection: drawSelection,
        drawGround: drawGround,
        hitTest: hitTest,
        listOrder: listOrder,
        invalidateAlpha: invalidateAlpha,
        invertView: invertView
    };
})(typeof window !== 'undefined' ? window : globalThis);
