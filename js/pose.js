/**
 * pose.js — 帧姿势引擎：烘焙矩阵 ⇄ 姿势参数（旋转/缩放/位移）双向转换 + FK 链重建
 *
 * 序列化的帧只存烘焙矩阵（uz[].m 与 lmat[]，两者数值相同）。本引擎：
 *   1. fromFrame：把每个部位的矩阵反解为 {rotation, xScale, yScale, dpx, dpy}
 *      （关节世界坐标直接由矩阵推出，无需依赖父子处理顺序）
 *   2. 编辑姿势参数后 rebuild：按 limbLinkage 父→子顺序重建矩阵（FK 联动），
 *      并执行游戏的主从槽位同步（SetRelatedLimbPoses... 复刻）
 *   3. writeBack：烘焙回 JSON（lmat + uz.m 同步写、lp1/lp3 同步、可选 footY 重算）
 *
 * 裁剪空间规则（SetLimbPose 2399-2408）：
 *   槽位属上半身或帧不分离 → cx1≠-1 时矩阵含 T(−cx1,−cy1)∘S(r)
 *   帧分离且槽位属下半身   → cx1_2≠-1 时含 T(−cx1_2,−cy1_2)∘S(r)
 */
(function (g) {
    'use strict';
    var HFJ = g.HFJ, AS3 = g.AS3, Skel = g.HFSkel;

    /** 读 JSON 矩阵节点 {a,b,c,d,tx,ty} → AS3.Matrix */
    function readMatrix(mNode) {
        return new AS3.Matrix(
            HFJ.getV(mNode, 'a'), HFJ.getV(mNode, 'b'),
            HFJ.getV(mNode, 'c'), HFJ.getV(mNode, 'd'),
            HFJ.getV(mNode, 'tx'), HFJ.getV(mNode, 'ty'));
    }

    /** 写 AS3.Matrix → JSON 矩阵节点（float 风格） */
    function writeMatrix(mNode, m) {
        HFJ.setNum(mNode, 'a', m.a, 'float');
        HFJ.setNum(mNode, 'b', m.b, 'float');
        HFJ.setNum(mNode, 'c', m.c, 'float');
        HFJ.setNum(mNode, 'd', m.d, 'float');
        HFJ.setNum(mNode, 'tx', m.tx, 'float');
        HFJ.setNum(mNode, 'ty', m.ty, 'float');
    }

    /**
     * FramePose — 一帧的可编辑姿势模型
     * entries: 按 uz/lz 顺序的部位条目：
     *   { list:'uz'|'lz', k(列表内序号), slot, p, blurX, blurY,
     *     mNode(JSON m 节点引用), pic(picInfo), slotScale{xScale,yScale},
     *     mLogical(AS3.Matrix 逻辑空间), pose{rotation,xScale,yScale,dpx,dpy},
     *     joints:[{x,y}...](世界坐标), parentKnown:bool }
     */
    function FramePose(char, frameIndex) {
        this.char = char;
        this.frameIndex = frameIndex;
        this.frame = char.getFrame(frameIndex);
        if (!this.frame) throw new Error('帧不存在: ' + frameIndex);
        this.sptType = char.sptType();
        this.attach = Skel.attachMap(this.sptType);
        this.children = Skel.childrenMap(this.sptType);
        this.rootSlot = Skel.rootSlot(this.sptType);

        var f = this.frame;
        // ref 复用帧（Spt.as 1238-1245 / ObjH 795）：自身无 uz 且 refIndex>0 时，
        // 显示 frame[refIndex] 的画面；duration/footY/判定框等逻辑属性仍属本帧。
        // 此类帧姿势不可编辑（要改请编辑源帧）。
        this.refSource = 0;
        this.srcFrame = f;
        var refIndex = num(HFJ.getV(f, 'refIndex'), 0);
        var ownUz = HFJ.get(f, 'uz');
        var hasOwnUz = ownUz && ownUz.t === 'o' && HFJ.isHfwArray(ownUz) && HFJ.arrLen(ownUz) > 0;
        if (!hasOwnUz && refIndex > 0) {
            var rf = char.getFrame(refIndex);
            if (rf) { this.srcFrame = rf; this.refSource = refIndex; }
        }
        var sf = this.srcFrame;
        this.ULseparate = HFJ.getV(sf, 'ULseparate') === true;
        this.r = num(HFJ.getV(sf, 'r'), 0.5);
        this.cx1 = num(HFJ.getV(sf, 'cx1'), -1);
        this.cy1 = num(HFJ.getV(sf, 'cy1'), -1);
        this.cx1_2 = num(HFJ.getV(sf, 'cx1_2'), -1);
        this.cy1_2 = num(HFJ.getV(sf, 'cy1_2'), -1);
        this.rootDx = num(HFJ.getV(f, 'rootDx'), 0);
        this.rootX = Skel.ROOT_X + this.rootDx;
        this.rootY = Skel.ROOT_Y;

        this.entries = [];
        this.bySlot = new Map();
        this._readList('uz');
        if (this.ULseparate) this._readList('lz');
        this._decomposeAll();
    }

    function num(v, dflt) { return typeof v === 'number' && !isNaN(v) ? v : dflt; }

    /** 该槽位的裁剪参数（null = 矩阵无裁剪步） */
    FramePose.prototype.cropOf = function (slot) {
        if (!this.ULseparate || Skel.isUpperBody(slot)) {
            return this.cx1 !== -1 ? { cx1: this.cx1, cy1: this.cy1, r: this.r } : null;
        }
        return this.cx1_2 !== -1 ? { cx1: this.cx1_2, cy1: this.cy1_2, r: this.r } : null;
    };

    FramePose.prototype._readList = function (listName) {
        var arr = HFJ.get(this.srcFrame, listName);
        if (!arr || arr.t !== 'o' || !HFJ.isHfwArray(arr)) return;
        var self = this;
        HFJ.arrEach(arr, function (lz, k) {
            if (!lz || lz.t !== 'o') return;
            var slot = HFJ.getV(lz, 'i') | 0;
            var p = HFJ.getV(lz, 'p') | 0;
            var mNode = HFJ.get(lz, 'm');
            if (!mNode || mNode.t !== 'o') return;
            var pic = self.char.resolvePic(slot, p);
            var sl = self.char.getSpriteLimb(slot);
            var entry = {
                list: listName, k: k, slot: slot, p: p,
                blurX: HFJ.getV(lz, 'x') | 0, blurY: HFJ.getV(lz, 'y') | 0,
                lzNode: lz, mNode: mNode,
                pic: pic,
                slotScale: sl ? {
                    xScale: num(HFJ.getV(sl, 'xScale'), 1),
                    yScale: num(HFJ.getV(sl, 'yScale'), 1)
                } : { xScale: 1, yScale: 1 },
                mLogical: null, pose: null, joints: null, parentKnown: false
            };
            var mFinal = readMatrix(mNode);
            var crop = self.cropOf(slot);
            entry.mLogical = crop ? AS3.uncrop(mFinal, crop.cx1, crop.cy1, crop.r) : mFinal;
            self.entries.push(entry);
            self.bySlot.set(slot, entry);
        });
    };

    /** 由矩阵直接计算关节世界坐标 + 反解姿势参数（无需父子顺序） */
    FramePose.prototype._decomposeAll = function () {
        var self = this;
        // 1. 各槽位关节世界坐标：world = mLogical ∘ 输入侧 S(pic.r)
        this.entries.forEach(function (e) {
            if (!e.pic) return;
            var m = e.mLogical, r = e.pic.r;
            var world = new AS3.Matrix(m.a * r, m.b * r, m.c * r, m.d * r, m.tx, m.ty);
            e.joints = e.pic.joints.map(function (j) {
                return world.transformPoint(j.x - e.pic.cx, j.y - e.pic.cy);
            });
        });
        // 2. 反解姿势参数（dp = 挂接点 − 父关节）
        this.entries.forEach(function (e) {
            if (!e.pic) return;
            var at = self.attach[e.slot];
            var attachJ = at ? at.toJ : 0;
            var d = AS3.decomposeLimbMatrix(e.mLogical, e.pic, e.slotScale, attachJ);
            var parent = self.parentJointOf(e.slot);
            e.parentKnown = parent !== null;
            e.pose = {
                rotation: d.rotation,
                xScale: d.xScale,
                yScale: d.yScale,
                dpx: parent ? d.anchorX - parent.x : 0,
                dpy: parent ? d.anchorY - parent.y : 0,
                _anchorX: d.anchorX, _anchorY: d.anchorY,
                // 父关节基准（父不可用时=锚点自身，dp=0）：重建 fallback 的固定参考点，
                // 保证父部位缺失（跨 Lmi 借用未加载等）时 dp 编辑仍然生效
                _parentX: parent ? parent.x : d.anchorX,
                _parentY: parent ? parent.y : d.anchorY
            };
        });
    };

    /** 槽位的父关节世界坐标；根槽位 → 根点；父不可用 → null */
    FramePose.prototype.parentJointOf = function (slot) {
        var at = this.attach[slot];
        if (!at) return null;
        if (at.parent === -1 || slot === this.rootSlot) {
            return { x: this.rootX, y: this.rootY };
        }
        var pe = this.bySlot.get(at.parent);
        if (!pe || !pe.joints || at.fromJ >= pe.joints.length) return null;
        return pe.joints[at.fromJ];
    };

    /**
     * 重建单个槽位的矩阵与关节（父关节坐标已知的前提下），返回是否成功。
     * 不递归 —— 链式重建用 rebuildChain。
     */
    FramePose.prototype._rebuildOne = function (entry) {
        if (!entry.pic || !entry.pose) return false;
        var parent = this.parentJointOf(entry.slot);
        if (!parent) {
            // 父不可用：用分解时记录的父关节基准（固定点，dp 编辑仍生效）
            parent = { x: entry.pose._parentX, y: entry.pose._parentY };
        }
        var at = this.attach[entry.slot];
        var attachJ = at ? at.toJ : 0;
        var built = AS3.buildLimbMatrix(
            entry.pose, entry.pic, entry.slotScale, attachJ,
            parent.x, parent.y, null);
        entry.mLogical = built.lmat;
        entry.pose._parentX = parent.x;
        entry.pose._parentY = parent.y;
        entry.pose._anchorX = parent.x + entry.pose.dpx;
        entry.pose._anchorY = parent.y + entry.pose.dpy;
        var pic = entry.pic;
        entry.joints = pic.joints.map(function (j) {
            return built.world.transformPoint(j.x - pic.cx, j.y - pic.cy);
        });
        return true;
    };

    /**
     * 从某槽位起沿骨骼向下游重建（含自身）。slot 为 null 时重建全部。
     * 顺序按 linkage 表（父先于子）。主从同步只在编辑传播时执行
     * （affected 非空且主槽位受影响）——纯重建不得改写存档姿势，
     * 存档里从槽位可能并不严格等于主槽位（HFEX 数据即如此）。
     */
    FramePose.prototype.rebuildChain = function (slot) {
        var affected = slot === null || slot === undefined
            ? null : this._descendantsOf(slot);
        var lk = Skel.linkage(this.sptType);
        for (var i = 0; i < lk.length; i++) {
            var s = lk[i].toLimb;
            if (i > 0 && s === this.rootSlot) continue; // 根只处理一次
            if (affected && !affected.has(s)) continue;
            var e = this.bySlot.get(s);
            if (!e) continue;
            if (affected) this._applySlaveSync(s, affected);
            this._rebuildOne(e);
        }
    };

    /**
     * 关闭骨骼联动（FK）时的重建：只重建该槽位自身，直接子部位保持世界位置不动
     * （用新的父关节世界坐标反推子部位 dp）。不做主从同步。
     */
    FramePose.prototype.rebuildDetached = function (slot) {
        var e = this.bySlot.get(slot);
        if (!e) return;
        this._rebuildOne(e);
        var self = this;
        (this.children[slot] || []).forEach(function (c) {
            var ce = self.bySlot.get(c.child);
            if (!ce || !ce.pose) return;
            var pj = self.parentJointOf(c.child);
            if (!pj) return;
            // 子部位矩阵不动：dp 改为「原锚点 − 新父关节」
            ce.pose.dpx = ce.pose._anchorX - pj.x;
            ce.pose.dpy = ce.pose._anchorY - pj.y;
            ce.pose._parentX = pj.x;
            ce.pose._parentY = pj.y;
        });
    };

    /** slot 及其全部骨骼后代（含联动从槽位） */
    FramePose.prototype._descendantsOf = function (slot) {        var set = new Set();
        var self = this;
        (function walk(s) {
            if (set.has(s)) return;
            set.add(s);
            (self.children[s] || []).forEach(function (c) { walk(c.child); });
            (Skel.MASTERS[s] || []).forEach(function (link) { walk(link.slave); });
        })(slot);
        return set;
    };

    /** 复刻 SetLimbPosesToTheSame...：把主槽位姿势同步到从槽位（仅当主槽位在本次编辑影响集内） */
    FramePose.prototype._applySlaveSync = function (slot, affected) {
        var link = Skel.SLAVE_OF[slot];
        if (!link || !affected || !affected.has(link.master)) return;
        var slave = this.bySlot.get(slot);
        var master = this.bySlot.get(link.master);
        if (!slave || !master || !slave.pose || !master.pose) return;
        slave.pose.rotation = master.pose.rotation;
        slave.pose.xScale = master.pose.xScale;
        slave.pose.yScale = master.pose.yScale;
        slave.blurX = master.blurX;
        slave.blurY = master.blurY;
        if (link.mode === 'pic') {
            // limbPicIndex 同步（从槽位无该造型时置 -1 → 条目失效，此处保持 p 不变以免破坏数据，
            // 仅当从槽位确有对应造型时跟随）
            var info = this.char.resolvePic(slot, master.p);
            if (info) { slave.p = master.p; slave.pic = info; }
        }
        if (link.zeroDp) {
            slave.pose.dpx = 0; slave.pose.dpy = 0;
        } else {
            slave.pose.dpx = master.pose.dpx;
            slave.pose.dpy = master.pose.dpy;
        }
    };

    // ---------- 编辑操作 ----------

    FramePose.prototype.getEntry = function (slot) { return this.bySlot.get(slot) || null; };

    FramePose.prototype.setRotation = function (slot, deg) {
        var e = this.bySlot.get(slot);
        if (!e || !e.pose) return;
        e.pose.rotation = deg;
        this.rebuildChain(slot);
    };

    FramePose.prototype.rotateBy = function (slot, ddeg) {
        var e = this.bySlot.get(slot);
        if (!e || !e.pose) return;
        e.pose.rotation += ddeg;
        this.rebuildChain(slot);
    };

    FramePose.prototype.setScale = function (slot, sx, sy) {
        var e = this.bySlot.get(slot);
        if (!e || !e.pose) return;
        if (sx !== null && sx !== undefined) e.pose.xScale = sx;
        if (sy !== null && sy !== undefined) e.pose.yScale = sy;
        this.rebuildChain(slot);
    };

    FramePose.prototype.setDp = function (slot, dpx, dpy) {
        var e = this.bySlot.get(slot);
        if (!e || !e.pose) return;
        if (dpx !== null && dpx !== undefined) e.pose.dpx = dpx;
        if (dpy !== null && dpy !== undefined) e.pose.dpy = dpy;
        this.rebuildChain(slot);
    };

    /** 切换贴图造型（保持挂接不动） */
    FramePose.prototype.setPicVariant = function (slot, p) {
        var e = this.bySlot.get(slot);
        if (!e) return false;
        var info = this.char.resolvePic(slot, p);
        if (!info) return false;
        e.p = p;
        e.pic = info;
        this.rebuildChain(slot);
        return true;
    };

    // ---------- 写回 JSON ----------

    /**
     * 烘焙写回：lmat[slot] 与对应 uz/lz 条目的 m 同步写入；
     * cropOverride 可传 {cx1,cy1,cx2,cy2, cx1_2...}（M4 裁剪框重算后的新值）；
     * 同时按游戏规则同步 lp1/lp3（胸/髋姿势）。
     */
    FramePose.prototype.writeBack = function () {
        if (this.refSource) return; // 复用帧：条目属于源帧，禁止写回
        var f = this.frame;
        var lmatArr = HFJ.get(f, 'lmat');
        var self = this;
        this.entries.forEach(function (e) {
            if (!e.pose || !e.pic) return;
            var crop = self.cropOf(e.slot);
            var mFinal = crop ? AS3.crop(e.mLogical, crop.cx1, crop.cy1, crop.r) : e.mLogical;
            writeMatrix(e.mNode, mFinal);
            // p / blur 回写
            HFJ.setNum(e.lzNode, 'p', e.p, 'float');
            HFJ.setNum(e.lzNode, 'x', e.blurX, 'float');
            HFJ.setNum(e.lzNode, 'y', e.blurY, 'float');
            // lmat[slot] 与 uz.m 保持一致
            if (lmatArr) {
                var mn = HFJ.arrGet(lmatArr, e.slot);
                if (mn && mn.t === 'o') writeMatrix(mn, mFinal);
            }
        });
        this._syncLP(1, 'lp1');
        this._syncLP(3, 'lp3');
        this.char.markSptDirty();
    };

    /** 复刻 lp1/lp3 同步（RenderFrameOnBitmap 2438-2506）：lp1=胸(槽1)姿势, lp3=髋(槽3)姿势 */
    FramePose.prototype._syncLP = function (slot, key) {
        if (this.sptType !== Skel.SPT_TYPE.HUMAN && this.sptType !== Skel.SPT_TYPE.HORSE) {
            if (slot === 3) return; // 非人/马：仅 lp1（对应槽 0）
            slot = 0;
        }
        var e = this.bySlot.get(slot);
        if (!e || !e.pose) return;
        var lp = HFJ.get(this.frame, key);
        if (!lp || lp.t !== 'o') return; // 无该字段则不动（保持原结构）
        HFJ.setNum(lp, 'rotation', e.pose.rotation, 'float');
        HFJ.setNum(lp, 'xScale', e.pose.xScale, 'float');
        HFJ.setNum(lp, 'yScale', e.pose.yScale, 'float');
        HFJ.setNum(lp, 'dpx', e.pose.dpx, 'float');
        HFJ.setNum(lp, 'dpy', e.pose.dpy, 'float');
    };

    /**
     * footY 重算（CalculatePoses 2070-2167 复刻，非 footA 路径 + footA 路径）。
     * 返回新 footY（不写回；由调用方决定）。
     */
    FramePose.prototype.computeFootY = function () {
        var f = this.frame;
        var footDy = num(HFJ.getV(f, 'footDy'), 0);
        var footA = HFJ.getV(f, 'footA') === true;
        var maxY = 0;
        var self = this;
        if (footA) {
            // 游戏只遍历 upLimbs（uz），ULseparate 的 lz 不参与
            this.entries.forEach(function (e) {
                if (e.list !== 'uz') return;
                (e.joints || []).forEach(function (pt) {
                    if (pt.y > maxY) maxY = Math.floor(pt.y);
                });
            });
        } else if (this.sptType === Skel.SPT_TYPE.EFFECT || this.sptType === Skel.SPT_TYPE.ITEM) {
            var e0 = this.bySlot.get(0);
            (e0 && e0.joints || []).forEach(function (pt) {
                if (pt.y > maxY) maxY = Math.floor(pt.y);
            });
        } else {
            Skel.footRefJoints(this.sptType).forEach(function (ref) {
                var e = self.bySlot.get(ref[0]);
                if (e && e.joints && e.joints.length > ref[1]) {
                    var y = e.joints[ref[1]].y;
                    if (y > maxY) maxY = Math.floor(y);
                }
            });
        }
        var rootE = this.bySlot.get(this.rootSlot);
        var rootJ = Skel.rootJoint(this.sptType);
        if (rootE && rootE.joints && rootE.joints.length > rootJ) {
            return maxY - rootE.joints[rootJ].y - footDy;
        }
        return num(HFJ.getV(f, 'footY'), 0);
    };

    g.HFPose = {
        FramePose: FramePose,
        readMatrix: readMatrix,
        writeMatrix: writeMatrix
    };
})(typeof window !== 'undefined' ? window : globalThis);
