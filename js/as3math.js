/**
 * as3math.js — flash.geom.Matrix 的精确 JS 复刻 + 姿势分解/重构数学
 *
 * AS3 Matrix 语义（行向量约定，与 Canvas2D setTransform(a,b,c,d,tx,ty) 完全同构）：
 *   transformPoint(p) = (a·px + c·py + tx,  b·px + d·py + ty)
 *   scale/rotate/translate 均为"输出侧"复合（作用于已有变换的结果上）：
 *     translate(dx,dy): tx+=dx; ty+=dy
 *     scale(sx,sy):     a*=sx; c*=sx; tx*=sx;  b*=sy; d*=sy; ty*=sy
 *     rotate(q):        [a,b] [c,d] [tx,ty] 各绕原点旋转 q（弧度）
 */
(function (g) {
    'use strict';

    function M(a, b, c, d, tx, ty) {
        this.a = a !== undefined ? a : 1;
        this.b = b !== undefined ? b : 0;
        this.c = c !== undefined ? c : 0;
        this.d = d !== undefined ? d : 1;
        this.tx = tx !== undefined ? tx : 0;
        this.ty = ty !== undefined ? ty : 0;
    }

    M.prototype.identity = function () {
        this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.tx = 0; this.ty = 0;
        return this;
    };

    M.prototype.clone = function () {
        return new M(this.a, this.b, this.c, this.d, this.tx, this.ty);
    };

    M.prototype.translate = function (dx, dy) {
        this.tx += dx; this.ty += dy;
        return this;
    };

    M.prototype.scale = function (sx, sy) {
        this.a *= sx; this.c *= sx; this.tx *= sx;
        this.b *= sy; this.d *= sy; this.ty *= sy;
        return this;
    };

    M.prototype.rotate = function (q) {
        var cos = Math.cos(q), sin = Math.sin(q);
        var a = this.a, b = this.b, c = this.c, d = this.d, tx = this.tx, ty = this.ty;
        this.a = a * cos - b * sin;
        this.b = a * sin + b * cos;
        this.c = c * cos - d * sin;
        this.d = c * sin + d * cos;
        this.tx = tx * cos - ty * sin;
        this.ty = tx * sin + ty * cos;
        return this;
    };

    /** this = this · 后接 m（m 作用在 this 的输出上；等价 AS3 concat） */
    M.prototype.concat = function (m) {
        var a = this.a, b = this.b, c = this.c, d = this.d, tx = this.tx, ty = this.ty;
        this.a = a * m.a + b * m.c;
        this.b = a * m.b + b * m.d;
        this.c = c * m.a + d * m.c;
        this.d = c * m.b + d * m.d;
        this.tx = tx * m.a + ty * m.c + m.tx;
        this.ty = tx * m.b + ty * m.d + m.ty;
        return this;
    };

    M.prototype.invert = function () {
        var a = this.a, b = this.b, c = this.c, d = this.d, tx = this.tx, ty = this.ty;
        var det = a * d - b * c;
        if (det === 0) { this.identity(); return this; }
        var ia = d / det, ib = -b / det, ic = -c / det, id = a / det;
        this.a = ia; this.b = ib; this.c = ic; this.d = id;
        this.tx = -(tx * ia + ty * ic);
        this.ty = -(tx * ib + ty * id);
        return this;
    };

    M.prototype.transformPoint = function (px, py) {
        return {
            x: this.a * px + this.c * py + this.tx,
            y: this.b * px + this.d * py + this.ty
        };
    };

    var PI_180 = Math.PI / 180;

    /**
     * 复刻 Spt.SetLimbPose 的矩阵构造（Spt.as 2388-2408）。
     * pose:  { rotation(度), xScale, yScale, dpx, dpy }
     * pic:   { cx, cy, joints:[{x,y}], r }
     * slot:  { xScale, yScale }（SpriteLimb 槽缩放）
     * attachJ: 挂接关节序号（linkage.toJ）
     * parentX/parentY: 父关节世界坐标（舞台逻辑空间）
     * crop:  null 或 {cx1, cy1, r}（帧裁剪空间；null = 逻辑空间矩阵）
     * 返回 {lmat: M(最终矩阵), world: M(关节世界坐标用矩阵，无 1/r 预缩放与裁剪步)}
     */
    function buildLimbMatrix(pose, pic, slot, attachJ, parentX, parentY, crop) {
        var j = pic.joints[attachJ] || { x: 0, y: 0 };
        var lmat = new M();
        var world = new M();
        lmat.scale(1 / pic.r, 1 / pic.r);
        lmat.translate(-j.x + pic.cx, -j.y + pic.cy);
        world.translate(-j.x + pic.cx, -j.y + pic.cy);
        var sx = pose.xScale * slot.xScale, sy = pose.yScale * slot.yScale;
        lmat.scale(sx, sy);
        world.scale(sx, sy);
        var q = pose.rotation * PI_180;
        lmat.rotate(q);
        world.rotate(q);
        lmat.translate(parentX + pose.dpx, parentY + pose.dpy);
        world.translate(parentX + pose.dpx, parentY + pose.dpy);
        if (crop) {
            lmat.translate(-crop.cx1, -crop.cy1);
            lmat.scale(crop.r, crop.r);
        }
        return { lmat: lmat, world: world };
    }

    /**
     * 关节世界坐标（Spt.as 2409-2418）：world · (j[k] − (cx,cy))
     */
    function jointWorld(worldMat, pic, k) {
        var jk = pic.joints[k];
        return worldMat.transformPoint(jk.x - pic.cx, jk.y - pic.cy);
    }

    /**
     * 从逻辑空间矩阵反解姿势参数（buildLimbMatrix 的逆运算）。
     * mLogical: 已去除裁剪步的矩阵（若帧 cx1≠-1 需先 uncrop）
     * 返回 { rotation(度), xScale, yScale, anchorX, anchorY }
     *   anchor = 挂接关节的世界坐标 = 父关节 + dp（调用方再减父关节得 dp）
     * 数学：线性部分 L = R(θ)·S(sx·slx/r, sy·sly/r)（行向量约定下
     *   a=Sx·cosθ, b=Sx·sinθ, c=−Sy·sinθ, d=Sy·cosθ，Sx=sx·slx/r）
     *   平移部分 tx,ty = anchor + L·(cx−j.x, cy−j.y)
     */
    function decomposeLimbMatrix(mLogical, pic, slot, attachJ) {
        var a = mLogical.a, b = mLogical.b, c = mLogical.c, d = mLogical.d;
        var det = a * d - b * c;
        var Sx = Math.hypot(a, b);
        var Sy = Math.hypot(c, d) * (det < 0 ? -1 : 1);
        var rotation;
        if (Sx === 0 && (c !== 0 || d !== 0)) {
            // 退化：xScale=0 时第一列全 0，旋转只能从第二列恢复
            // （c=−Sy·sinθ, d=Sy·cosθ，取 Sy>0 的等价解）
            rotation = Math.atan2(-c, d) / PI_180;
            Sy = Math.hypot(c, d);
        } else {
            rotation = Math.atan2(b, a) / PI_180;
        }
        var xScale = Sx * pic.r / slot.xScale;
        var yScale = Sy * pic.r / slot.yScale;
        // anchor = t − L·(cx−jx, cy−jy)，L 为不含 1/r 的线性部分
        var j = pic.joints[attachJ] || { x: 0, y: 0 };
        var vx = pic.cx - j.x, vy = pic.cy - j.y;
        // L = [a,b,c,d]·r（乘回 r 抵消 1/r 预缩放）
        var Lx = (a * vx + c * vy) * pic.r;
        var Ly = (b * vx + d * vy) * pic.r;
        return {
            rotation: rotation,
            xScale: xScale,
            yScale: yScale,
            anchorX: mLogical.tx - Lx,
            anchorY: mLogical.ty - Ly
        };
    }

    /** 裁剪空间 → 逻辑空间：m_logical = T(cx1,cy1) ∘ S(1/r) ∘ m_final（RenderFrameOnBitmap 2718-2727 同款） */
    function uncrop(mFinal, cx1, cy1, r) {
        var m = mFinal.clone();
        m.scale(1 / r, 1 / r);
        m.translate(cx1, cy1);
        return m;
    }

    /** 逻辑空间 → 裁剪空间：m_final = S(r) ∘ T(−cx1,−cy1) ∘ m_logical（SetLimbPose 2399-2408 同款） */
    function crop(mLogical, cx1, cy1, r) {
        var m = mLogical.clone();
        m.translate(-cx1, -cy1);
        m.scale(r, r);
        return m;
    }

    g.AS3 = {
        Matrix: M,
        PI_180: PI_180,
        buildLimbMatrix: buildLimbMatrix,
        jointWorld: jointWorld,
        decomposeLimbMatrix: decomposeLimbMatrix,
        uncrop: uncrop,
        crop: crop
    };
})(typeof window !== 'undefined' ? window : globalThis);
