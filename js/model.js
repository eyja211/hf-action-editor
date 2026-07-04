/**
 * model.js — 角色数据模型：Spt + Lmi 的封装、版本识别、索引解析、脏文件追踪
 *
 * 数据来源（HFWorkshop 导出并解压的文件夹）：
 *   XXX - Data.Global_xxxSpt/Spt.json
 *   YYY - Data.Global_xxxLmi/Limb_0..M.json, LimbPic_0..N.json, <index>.png
 *
 * 索引链（与游戏 LimbInfoFile.as / Spt.as 一致）：
 *   spriteLimb[槽位i].limbName ──► Limb（按 name 全局注册）
 *   uz[k].p（= 部位造型序号）──► limb.limbPicIndex[p] = 图池编号 N ──► LimbPic_N
 *   位图：embeded → N.png；否则 bmRefIndex → 目标图 PNG；否则按 filename 匹配 embeded 图
 *   （序列化数据中 ref 的关节 j[] 已被原编辑器物化复制，直接读各 pic 自身 j/cx/cy 即可）
 */
(function (g) {
    'use strict';
    var HFJ = g.HFJ;

    // ---------- 单个 JSON 文件封装 ----------

    function JsonFile(name, text) {
        this.name = name;        // 例如 "Spt.json" / "Limb_3.json" / "LimbPic_45.json"
        this.origText = text;    // 原始文本（round-trip 校验基准；保存成功后更新）
        this.tree = HFJ.parse(text);
        this.dirty = false;
    }
    JsonFile.prototype.serialize = function () { return HFJ.stringify(this.tree); };
    JsonFile.prototype.roundTripOk = function () { return this.serialize() === this.origText; };

    // ---------- Lmi 集合（一个 Lmi 文件夹 = 一个自洽的图池） ----------
    // 图池编号/filename 匹配都在集合内部完成；跨文件夹只通过 limbName（Global.limb 语义）。

    function LmiSet(si, folder, jsons, pngs) {
        this.si = si;                   // 集合序号（0 = 与 Spt 配对的主集合）
        this.folder = folder || '';
        this.limbFiles = new Map();     // "Limb_0.json" → JsonFile
        this.picFiles = new Map();      // 图池编号 N → JsonFile（LimbPic_N.json）
        this.pngs = pngs || new Map();  // "N.png" → 位图源（Blob/bytes）
        this.picByIndex = new Map();
        this.pngIndexByFilename = new Map();
        var self = this;
        (jsons || new Map()).forEach(function (text, name) {
            var m;
            if ((m = /^Limb_(\d+)\.json$/i.exec(name))) {
                self.limbFiles.set(name, new JsonFile(name, text));
            } else if ((m = /^LimbPic_(\d+)\.json$/i.exec(name))) {
                self.picFiles.set(parseInt(m[1], 10), new JsonFile(name, text));
            }
        });
        this.picFiles.forEach(function (jf, n) {
            var entry = jf.tree.e[0];
            if (!entry || entry[0] !== 'Data.LimbPic') return;
            var node = entry[1];
            self.picByIndex.set(n, node);
            if (HFJ.getV(node, 'embeded') === true) {
                var fn = HFJ.getV(node, 'filename');
                if (typeof fn === 'string') self.pngIndexByFilename.set(fn, n);
            }
        });
    }

    /** PNG 的全局键：主集合用裸名（"3.png"），附加集合加文件夹前缀避免冲突 */
    LmiSet.prototype.qualify = function (name) {
        return this.si === 0 ? name : this.folder + '/' + name;
    };

    // ---------- 角色 ----------

    /**
     * files: {
     *   sptFolder: string, sptText: string,
     *   lmiFolder: string, lmiJsons: Map, pngs: Map,      // 主 Lmi（与 Spt 配对）
     *   extraLmi: [{folder, jsons: Map, pngs: Map}]        // 可选：其他 Lmi 文件夹
     *                                                      //（游戏 Global.limb 为全局注册，
     *                                                      //  HFEX 角色常跨 Lmi 借用部位）
     * }
     */
    function HFCharacter(files) {
        this.sptFolder = files.sptFolder || '';
        this.spt = new JsonFile('Spt.json', files.sptText);

        this.lmiSets = [new LmiSet(0, files.lmiFolder || '', files.lmiJsons, files.pngs)];
        var self = this;
        (files.extraLmi || []).forEach(function (ex, k) {
            self.lmiSets.push(new LmiSet(k + 1, ex.folder, ex.jsons, ex.pngs));
        });

        // 主集合别名（历史接口/测试兼容）
        var p0 = this.lmiSets[0];
        this.lmiFolder = p0.folder;
        this.limbFiles = p0.limbFiles;
        this.picFiles = p0.picFiles;
        this.pngs = p0.pngs;
        this.picByIndex = p0.picByIndex;
        this.pngIndexByFilename = p0.pngIndexByFilename;

        this._buildIndex();
    }

    HFCharacter.prototype._buildIndex = function () {
        // Spt 根：{"Data.Spt": {...}}
        var rootEntry = this.spt.tree.e[0];
        if (!rootEntry || rootEntry[0] !== 'Data.Spt') {
            throw new Error('Spt.json 根节点不是 Data.Spt（实际: ' + (rootEntry && rootEntry[0]) + '）');
        }
        this.sptRoot = rootEntry[1];

        // 版本识别：HFEX 顶层多 hasPollHp。注意 HFWorkshop 导出的 JSON 不一定包含
        // 未显式赋值的类字段（例如 HFE 的 Frame.quake 可能缺省不导出），所以不要用
        // 单帧字段缺失反推版本矛盾。
        this.version = HFJ.has(this.sptRoot, 'hasPollHp') ? 'HFEX' : 'HFE';

        // Limb 名字注册表（Global.limb 等价物：跨全部 Lmi 集合；主集合优先，重名先到先得）
        this.limbByName = new Map();    // name → { file, node, set }
        var self = this;
        this.lmiSets.forEach(function (set) {
            set.limbFiles.forEach(function (jf) {
                var entry = jf.tree.e[0];
                if (!entry || entry[0] !== 'Data.Limb') return;
                var node = entry[1];
                var name = HFJ.getV(node, 'name');
                if (typeof name === 'string' && name !== '' && !self.limbByName.has(name)) {
                    self.limbByName.set(name, { file: jf, node: node, set: set });
                }
            });
        });
    };

    /** 全部集合的 PNG 合并视图（键已 qualify，供 ImageStore 用） */
    HFCharacter.prototype.allPngs = function () {
        var out = new Map();
        this.lmiSets.forEach(function (set) {
            set.pngs.forEach(function (blob, name) {
                out.set(set.qualify(name), blob);
            });
        });
        return out;
    };

    /** spriteLimb 里引用了但任何 Lmi 都没注册的部位名（跨 Lmi 借用缺文件的诊断） */
    HFCharacter.prototype.missingLimbNames = function () {
        var missing = [];
        var self = this;
        HFJ.arrEach(this.spriteLimbArr(), function (sl, i) {
            if (!sl || sl.t !== 'o') return;
            var name = HFJ.getV(sl, 'limbName');
            if (typeof name === 'string' && name !== '' && !self.limbByName.has(name)) {
                missing.push({ slot: i, name: name });
            }
        });
        return missing;
    };

    // ---------- Spt 顶层访问 ----------

    HFCharacter.prototype.framesArr = function () { return HFJ.get(this.sptRoot, 'frame'); };
    HFCharacter.prototype.actionsArr = function () { return HFJ.get(this.sptRoot, 'action'); };
    HFCharacter.prototype.spriteLimbArr = function () { return HFJ.get(this.sptRoot, 'spriteLimb'); };
    HFCharacter.prototype.actionGroupArr = function () { return HFJ.get(this.sptRoot, 'actionGroup'); };

    HFCharacter.prototype.sptType = function () { return HFJ.getV(this.sptRoot, 'type') | 0; };
    HFCharacter.prototype.charId = function () { return HFJ.getV(this.sptRoot, 'id'); };
    HFCharacter.prototype.charName = function () { return HFJ.getV(this.sptRoot, 'name'); };

    HFCharacter.prototype.frameCount = function () { return HFJ.arrLen(this.framesArr()); };
    HFCharacter.prototype.actionCount = function () { return HFJ.arrLen(this.actionsArr()); };

    /** 帧节点（Data.Frame）；越界/空槽返回 undefined */
    HFCharacter.prototype.getFrame = function (i) {
        var n = HFJ.arrGet(this.framesArr(), i);
        return n && n.t === 'o' ? n : undefined;
    };

    /** 动作节点（Data.Action） */
    HFCharacter.prototype.getAction = function (i) {
        var n = HFJ.arrGet(this.actionsArr(), i);
        return n && n.t === 'o' ? n : undefined;
    };

    /** 槽位的 SpriteLimb 节点 */
    HFCharacter.prototype.getSpriteLimb = function (slot) {
        var n = HFJ.arrGet(this.spriteLimbArr(), slot);
        return n && n.t === 'o' ? n : undefined;
    };

    /**
     * 动作的帧区间：从 frameIndex 起连续到 last=true 的帧（含）。
     * 返回 {start, end}（end 含）；frameIndex 非法返回 null。
     */
    HFCharacter.prototype.actionFrameRange = function (actionIndex) {
        var a = this.getAction(actionIndex);
        if (!a) return null;
        var start = HFJ.getV(a, 'frameIndex');
        if (typeof start !== 'number' || start < 0) return null;
        start |= 0;
        var total = this.frameCount();
        if (start >= total) return null;
        var end = start;
        for (var i = start; i < total; i++) {
            var f = this.getFrame(i);
            end = i;
            if (!f || HFJ.getV(f, 'last') === true) break;
        }
        return { start: start, end: end };
    };

    /** 全部动作摘要列表 [{index, name, frameIndex, type}] */
    HFCharacter.prototype.listActions = function () {
        var out = [];
        var self = this;
        HFJ.arrEach(this.actionsArr(), function (node, i) {
            if (!node || node.t !== 'o') return;
            out.push({
                index: i,
                name: HFJ.getV(node, 'name'),
                frameIndex: HFJ.getV(node, 'frameIndex'),
                type: HFJ.getV(node, 'type')
            });
        });
        return out;
    };

    // ---------- 部位/贴图解析 ----------

    /** 槽位 → Limb 注册项 { file, node }；槽位未绑定返回 null */
    HFCharacter.prototype.limbOfSlot = function (slot) {
        var sl = this.getSpriteLimb(slot);
        if (!sl) return null;
        var name = HFJ.getV(sl, 'limbName');
        if (typeof name !== 'string' || name === '') return null;
        return this.limbByName.get(name) || null;
    };

    /**
     * 解析（槽位, 造型序号 p）→ 渲染所需信息。
     * 返回 { picIndex, picNode, pngName, cx, cy, r, joints:[{x,y}], disabled } 或 null。
     * pngName 解析顺序：embeded → 自身 index.png；bmRefIndex 有效 → 目标 png；
     *                   否则按 filename 匹配任一 embeded 图；都无 → null（无位图）。
     */
    HFCharacter.prototype.resolvePic = function (slot, p) {
        var reg = this.limbOfSlot(slot);
        if (!reg) return null;
        var lpIdxArr = HFJ.get(reg.node, 'limbPicIndex');
        if (!lpIdxArr) return null;
        var n = HFJ.arrLen(lpIdxArr);
        if (p < 0 || p >= n) return null;
        var poolIdxNode = HFJ.arrGet(lpIdxArr, p);
        if (!poolIdxNode || poolIdxNode.t !== 'n') return null; // null 造型槽
        var poolIdx = parseFloat(poolIdxNode.raw) | 0;
        return this.picInfoIn(reg.set, poolIdx);
    };

    /** 图池编号 → 渲染信息（主集合；历史接口） */
    HFCharacter.prototype.picInfo = function (poolIdx) {
        return this.picInfoIn(this.lmiSets[0], poolIdx);
    };

    /** 指定 Lmi 集合内解析图池编号（pngName 已 qualify，可直接喂 ImageStore） */
    HFCharacter.prototype.picInfoIn = function (set, poolIdx) {
        var pic = set.picByIndex.get(poolIdx);
        if (!pic) return null;
        var pngName = null;
        if (HFJ.getV(pic, 'embeded') === true) {
            pngName = set.qualify(poolIdx + '.png');
        } else {
            var bm = HFJ.getV(pic, 'bmRefIndex');
            if (typeof bm === 'number' && bm >= 0 && bm !== poolIdx && set.picByIndex.has(bm | 0)) {
                var target = bm | 0;
                if (HFJ.getV(set.picByIndex.get(target), 'embeded') === true) {
                    pngName = set.qualify(target + '.png');
                }
            }
            if (pngName === null) {
                var fn = HFJ.getV(pic, 'filename');
                if (typeof fn === 'string' && set.pngIndexByFilename.has(fn)) {
                    pngName = set.qualify(set.pngIndexByFilename.get(fn) + '.png');
                }
            }
        }
        var joints = [];
        var jArr = HFJ.get(pic, 'j');
        if (jArr) {
            HFJ.arrEach(jArr, function (pt) {
                joints.push(pt && pt.t === 'o'
                    ? { x: HFJ.getV(pt, 'x'), y: HFJ.getV(pt, 'y') }
                    : { x: 0, y: 0 });
            });
        }
        return {
            picIndex: poolIdx,
            picNode: pic,
            set: set,
            pngName: pngName,
            cx: HFJ.getV(pic, 'cx') || 0,
            cy: HFJ.getV(pic, 'cy') || 0,
            r: HFJ.getV(pic, 'r') || 1,
            joints: joints,
            disabled: HFJ.getV(pic, 'disabled') === true
        };
    };

    // ---------- 脏文件与序列化 ----------

    HFCharacter.prototype.markSptDirty = function () { this.spt.dirty = true; };
    HFCharacter.prototype.markLimbDirty = function (fileName) {
        var jf = this.limbFiles.get(fileName);
        if (jf) jf.dirty = true;
    };
    HFCharacter.prototype.markPicDirty = function (poolIdx) {
        var jf = this.picFiles.get(poolIdx);
        if (jf) jf.dirty = true;
    };

    /** 所有 JSON 文件（含 Spt 与全部 Lmi 集合）；folder: 'spt'|'lmi'，si=Lmi 集合序号 */
    HFCharacter.prototype.allJsonFiles = function () {
        var out = [{ folder: 'spt', si: -1, file: this.spt }];
        this.lmiSets.forEach(function (set) {
            set.limbFiles.forEach(function (jf) { out.push({ folder: 'lmi', si: set.si, file: jf }); });
            set.picFiles.forEach(function (jf) { out.push({ folder: 'lmi', si: set.si, file: jf }); });
        });
        return out;
    };

    /** 脏文件列表 [{folder, si, name, text}] */
    HFCharacter.prototype.serializeDirty = function () {
        var out = [];
        this.allJsonFiles().forEach(function (it) {
            if (it.file.dirty) {
                out.push({ folder: it.folder, si: it.si, name: it.file.name, text: it.file.serialize() });
            }
        });
        return out;
    };

    /**
     * 兼容性体检：所有文件 load→serialize 与原文比对。
     * 返回 [{name, ok, firstDiff:{pos, expect, got} | null}]
     */
    HFCharacter.prototype.roundTripReport = function () {
        var out = [];
        this.allJsonFiles().forEach(function (it) {
            var text = it.file.serialize();
            var orig = it.file.origText;
            if (text === orig) {
                out.push({ name: it.file.name, ok: true, firstDiff: null });
                return;
            }
            var pos = 0;
            var max = Math.min(text.length, orig.length);
            while (pos < max && text[pos] === orig[pos]) pos++;
            out.push({
                name: it.file.name,
                ok: false,
                firstDiff: {
                    pos: pos,
                    expect: orig.slice(Math.max(0, pos - 40), pos + 40),
                    got: text.slice(Math.max(0, pos - 40), pos + 40)
                }
            });
        });
        return out;
    };

    g.HFModel = { HFCharacter: HFCharacter, JsonFile: JsonFile };
})(typeof window !== 'undefined' ? window : globalThis);
