/**
 * app.js — 主控制器：应用状态、角色加载、选择/播放、撤销、保存、面板协调
 */
(function (g) {
    'use strict';
    var HFJ = g.HFJ, Skel = g.HFSkel;

    var App = {
        char: null,          // HFCharacter
        handles: null,       // { sptDir, lmiDir }
        images: null,        // ImageStore
        undo: new g.HFUndo.UndoStack(200),

        actionIndex: -1,
        frameIndex: -1,
        selection: -1,       // 选中槽位
        tool: 'rotate',      // select | rotate | move | scale
        fkEnabled: true,     // 骨骼联动（FK）：关闭后编辑部位不带动子部位
        onion: false,
        showSkeleton: true,
        showBoxes: false,
        autoFootY: true,
        smoothing: true,

        playing: false,
        playTick: 0,         // 当前帧已停留 tick 数
        playSpeed: 1,

        poseCache: new Map(),
        panels: {},          // 各 UI 面板注册于此
    };

    // ---------- 角色加载 ----------

    App.openCharacter = async function () {
        var files;
        if (g.HFFs.supported()) {
            var scan;
            try {
                scan = await g.HFFs.openCharacterFolder();
            } catch (e) {
                if (e && e.name === 'AbortError') return;
                alert('打开文件夹失败：' + e.message);
                return;
            }
            var sptDir = scan.sptDirs[0];
            if (scan.sptDirs.length > 1) {
                var names = scan.sptDirs.map(function (d, i) { return i + ': ' + d.name; }).join('\n');
                var pick = prompt('发现多个角色 Spt 文件夹，输入编号选择：\n' + names, '0');
                var pi = parseInt(pick, 10);
                if (isNaN(pi) || pi < 0 || pi >= scan.sptDirs.length) return;
                sptDir = scan.sptDirs[pi];
            }
            var lmiDir = g.HFFs.pairLmi(sptDir, scan.lmiDirs);
            var extraLmiDirs = scan.lmiDirs.filter(function (d) { return d !== lmiDir; });
            var busyRead = App.setBusy('正在读取角色数据…');
            try {
                files = await g.HFFs.readCharacter(sptDir, lmiDir, extraLmiDirs);
            } catch (e) {
                console.error(e);
                alert('加载失败：' + (e && e.message));
                return;
            } finally {
                busyRead();
            }
        } else {
            // 降级：只读载入 + zip 导出保存
            try {
                files = await g.HFFs.openViaInput();
            } catch (e) {
                alert(e.message);
                return;
            }
            App.toast('当前浏览器不支持直接写回文件夹：保存请用「导出 zip」');
        }
        var busy = App.setBusy('正在解析数据…');
        try {
            App.loadCharacterFiles(files);
        } catch (e) {
            console.error(e);
            alert('加载失败：' + (e && e.message));
        } finally {
            busy();
        }
    };

    /** 用 readCharacter/openViaInput 结构的 files 完成装载（测试可直接调用） */
    App.loadCharacterFiles = function (files) {
        App.char = new g.HFModel.HFCharacter(files);
        App.handles = files.handles;
        App.images = new g.HFImages.ImageStore(App.char.allPngs());
        App.images.onLoad = function () { App.requestDraw(); };
        App.undo.clear();
        App.poseCache.clear();
        App.selection = -1;
        App.smoothing = App.char.version !== 'HFEX'; // HFEX 默认关闭平滑（Spt.smoothing=false）

        // 缺部位诊断：游戏的 Limb 注册是全局的（Global.limb），角色可跨 Lmi 借用部位
        //（共享特效如 icefire / weapon_effect 也是这种机制）。只统计帧里真正用到的槽位。
        var missing = App.char.missingLimbNames();
        if (missing.length) {
            var usedSlots = new Set();
            HFJ.arrEach(App.char.framesArr(), function (f) {
                if (!f || f.t !== 'o') return;
                ['uz', 'lz'].forEach(function (ln) {
                    var a = HFJ.get(f, ln);
                    if (a && HFJ.isHfwArray(a)) {
                        HFJ.arrEach(a, function (lz) {
                            if (lz && lz.t === 'o') usedSlots.add(HFJ.getV(lz, 'i') | 0);
                        });
                    }
                });
            });
            var usedMissing = missing.filter(function (m) { return usedSlots.has(m.slot); });
            if (usedMissing.length) {
                var names = {};
                usedMissing.forEach(function (m) { names[m.name] = true; });
                var nameList = Object.keys(names);
                var hint = '这些部位在其他 Lmi 数据里：请在 HFWorkshop 找到包含它们的 ' +
                    '"* - Data.Global_*Lmi" 并导出，解压后与本角色放进同一目录再重新打开' +
                    '（工具会自动加载目录里的全部 Lmi 文件夹）。';
                console.warn('缺失部位:', nameList, hint);
                if (usedMissing.length >= 5) {
                    alert('⚠ 有 ' + usedMissing.length + ' 个使用中的部位找不到贴图数据：\n\n' +
                        nameList.join('\n') + '\n\n' + hint);
                } else {
                    App.toast('缺 ' + nameList.join('、') + ' 等 ' + usedMissing.length +
                        ' 个借用部位（不影响其余编辑，详见控制台）');
                }
            }
        }

        // 兼容性体检（后台执行，异常时提示）
        setTimeout(function () {
            var bad = App.char.roundTripReport().filter(function (r) { return !r.ok; });
            if (bad.length) {
                console.warn('round-trip 差异:', bad);
                alert('警告：' + bad.length + ' 个文件的解析-序列化结果与原文不一致，' +
                    '保存可能引入格式差异。请把控制台信息反馈给工具作者。\n首个: ' + bad[0].name);
            }
        }, 100);

        App.images.preloadAll().then(function () {
            App.refreshAll();      // 位图就绪后重刷（时间轴缩略图、贴图面板首绘依赖位图）
            App.requestDraw();
        });

        // 默认选中 STAND（无则第一个有帧的动作）
        var acts = App.char.listActions();
        var stand = acts.find(function (a) { return a.name === 'STAND'; }) || acts[0];
        App.selectAction(stand ? stand.index : 0);
        App.refreshAll();
        var vp = App.panels.viewport;
        if (vp && vp.fitView) vp.fitView();
    };

    App.setBusy = function (text) {
        var el = document.getElementById('busy');
        el.textContent = text;
        el.style.display = 'flex';
        return function () { el.style.display = 'none'; };
    };

    // ---------- 选择 ----------

    App.selectAction = function (i) {
        if (!App.char) return;
        App.stopPlay();
        App.actionIndex = i;
        var range = App.char.actionFrameRange(i);
        App.frameIndex = range ? range.start : -1;
        App.playTick = 0;
        App.refreshAll();
    };

    App.selectFrame = function (fi) {
        App.frameIndex = fi;
        App.playTick = 0;
        App.refreshAll();
    };

    App.actionRange = function () {
        return App.actionIndex >= 0 ? App.char.actionFrameRange(App.actionIndex) : null;
    };

    /** 当前帧 FramePose（缓存） */
    App.pose = function (fi) {
        if (fi === undefined) fi = App.frameIndex;
        if (fi < 0 || !App.char) return null;
        var fp = App.poseCache.get(fi);
        if (!fp) {
            try {
                fp = new g.HFPose.FramePose(App.char, fi);
                App.poseCache.set(fi, fp);
            } catch (e) {
                console.error('帧解析失败', fi, e);
                return null;
            }
        }
        return fp;
    };

    App.invalidateFrame = function (fi) {
        if (fi === undefined) App.poseCache.clear();
        else App.poseCache.delete(fi);
        var tl = App.panels.timeline;
        if (tl && tl.invalidateThumb) tl.invalidateThumb(fi);
    };

    // ---------- 姿势编辑（拖拽手势 + 撤销整合） ----------

    var gesture = null;

    App.beginPoseEdit = function () {
        if (App.frameIndex < 0) return;
        var fp = App.pose(App.frameIndex);
        gesture = {
            fi: App.frameIndex,
            before: HFJ.clone(App.char.getFrame(App.frameIndex)),
            // footY 增量基线：编辑前按公式算一次。提交时只把"计算值的变化量"加到存档
            // footY 上——避免把与存档口径不同的绝对计算值写进去（HFEX 存档 footY 与
            // 公式普遍有十几像素的固定差，直接覆盖会导致角色在游戏里悬空/下沉）。
            footYBefore: fp ? fp.computeFootY() : null
        };
    };

    /** 手势结束：重烘焙 + 生成撤销命令 */
    App.commitPoseEdit = function (label) {
        if (!gesture) return;
        var fi = gesture.fi;
        var fp = App.pose(fi);
        if (fp) g.HFRebake.rebakeFrame(fp, App.images, App.autoFootY, gesture.footYBefore);
        var before = gesture.before;
        var after = HFJ.clone(App.char.getFrame(fi));
        gesture = null;
        App.undo.push({
            label: label,
            undo: function () { App._restoreFrame(fi, before); },
            redo: function () { App._restoreFrame(fi, after); }
        });
        App.invalidateFrame(fi);
        App.refreshAll();
    };

    App.cancelPoseEdit = function () {
        if (!gesture) return;
        App._restoreFrame(gesture.fi, gesture.before);
        gesture = null;
    };

    /** 丢弃手势（期间未发生任何修改时用：不还原、不烘焙、不入撤销栈） */
    App.discardPoseEdit = function () {
        gesture = null;
    };

    App._restoreFrame = function (fi, clone) {
        HFJ.arrSet(App.char.framesArr(), fi, HFJ.clone(clone));
        App.char.markSptDirty();
        App.invalidateFrame(fi);
        App.refreshAll();
    };

    /** 数值面板等一次性姿势修改：fn(fp) 内做修改 */
    App.poseEditOnce = function (label, fn) {
        if (App.frameIndex < 0) return;
        var fp0 = App.pose(App.frameIndex);
        if (!fp0) return;
        if (fp0.refSource) {
            App.toast('该帧复用帧 #' + fp0.refSource + ' 的画面，请到源帧编辑姿势');
            return;
        }
        App.beginPoseEdit();
        var fp = App.pose(App.frameIndex);
        if (!fp) { gesture = null; return; }
        fn(fp);
        App.commitPoseEdit(label);
    };

    // ---------- 帧/动作字段编辑 ----------

    App.editFrameField = function (key, valueNode, label) {
        var fi = App.frameIndex;
        if (fi < 0) return;
        var f = App.char.getFrame(fi);
        if (!f) return;
        var before = HFJ.clone(f);
        HFJ.set(f, key, valueNode);
        App.char.markSptDirty();
        var after = HFJ.clone(f);
        App.undo.push({
            label: label || ('修改帧字段 ' + key),
            undo: function () { App._restoreFrame(fi, before); },
            redo: function () { App._restoreFrame(fi, after); }
        });
        App.invalidateFrame(fi);
        App.refreshAll();
    };

    App.editActionField = function (key, valueNode, label) {
        var ai = App.actionIndex;
        if (ai < 0) return;
        var a = App.char.getAction(ai);
        if (!a) return;
        var before = HFJ.clone(a);
        HFJ.set(a, key, valueNode);
        App.char.markSptDirty();
        var after = HFJ.clone(a);
        App.undo.push({
            label: label || ('修改动作字段 ' + key),
            undo: function () {
                HFJ.arrSet(App.char.actionsArr(), ai, HFJ.clone(before));
                App.char.markSptDirty();
                App.refreshAll();
            },
            redo: function () {
                HFJ.arrSet(App.char.actionsArr(), ai, HFJ.clone(after));
                App.char.markSptDirty();
                App.refreshAll();
            }
        });
        App.refreshAll();
    };

    // ---------- 帧/动作结构操作 ----------

    App.duplicateCurrentFrame = function () {
        var fi = App.frameIndex;
        if (fi < 0) return;
        var FS = g.HFFrameStore;
        var info = FS.duplicateFrame(App.char, fi);
        if (!info) return;
        App.undo.push({
            label: '复制帧',
            undo: function () {
                FS.undoDuplicateFrame(App.char, fi, info.srcWasLast);
                App.invalidateFrame();
                if (App.frameIndex > fi) App.frameIndex--;
                App.refreshAll();
            },
            redo: function () {
                FS.duplicateFrame(App.char, fi);
                App.invalidateFrame();
                App.refreshAll();
            }
        });
        App.invalidateFrame();
        App.selectFrame(info.newIndex);
    };

    App.deleteCurrentFrame = function () {
        var fi = App.frameIndex, ai = App.actionIndex;
        if (fi < 0 || ai < 0) return;
        var FS = g.HFFrameStore;
        var refs = FS.frameReferencedBy(App.char, fi);
        if (refs.length && !confirm('该帧被帧 ' + refs.join(',') + ' 引用，删除会清除这些引用。继续？')) return;
        var res = FS.deleteFrame(App.char, ai, fi);
        if (res.error) { alert(res.error); return; }
        if (res.warnings && res.warnings.length) console.warn(res.warnings.join('\n'));
        var removed = res.removedNode, wasLast = res.wasLast;
        App.undo.push({
            label: '删除帧',
            undo: function () {
                if (wasLast) {
                    var prev = App.char.getFrame(fi - 1);
                    if (prev) HFJ.set(prev, 'last', HFJ.lit(false));
                }
                FS.spliceFrames(App.char, fi, 0, [HFJ.clone(removed)]);
                App.invalidateFrame();
                App.refreshAll();
            },
            redo: function () {
                FS.deleteFrame(App.char, App.actionIndex, fi);
                App.invalidateFrame();
                App.refreshAll();
            }
        });
        App.invalidateFrame();
        App.selectFrame(Math.max(App.actionRange().start, fi - 1));
    };

    App.duplicateCurrentAction = function () {
        var ai = App.actionIndex;
        if (ai < 0) return;
        var srcName = HFJ.getV(App.char.getAction(ai), 'name') || ('ACT' + ai);
        var name = prompt('新动作名称：', srcName + '_COPY');
        if (!name) return;
        var FS = g.HFFrameStore;
        var info = FS.duplicateAction(App.char, ai, name);
        if (!info) return;
        App.undo.push({
            label: '复制动作',
            undo: function () {
                FS.undoDuplicateAction(App.char, info);
                App.invalidateFrame();
                if (App.actionIndex === info.actionIndex) App.selectAction(ai);
                App.refreshAll();
            },
            redo: function () {
                FS.duplicateAction(App.char, ai, name);
                App.invalidateFrame();
                App.refreshAll();
            }
        });
        App.invalidateFrame();
        App.selectAction(info.actionIndex);
    };

    // ---------- 播放 ----------

    var rafId = null, lastTime = 0, acc = 0;
    var TICK = 1000 / 30;

    App.togglePlay = function () {
        if (App.playing) App.stopPlay();
        else App.startPlay();
        App.refreshTransport();
    };

    App.startPlay = function () {
        if (App.playing || App.actionIndex < 0) return;
        App.playing = true;
        App.playTick = 0;
        lastTime = performance.now();
        acc = 0;
        var loop = function (t) {
            if (!App.playing) return;
            acc += (t - lastTime) * App.playSpeed;
            lastTime = t;
            var advanced = false;
            while (acc >= TICK) {
                acc -= TICK;
                advanced = App._stepTick() || advanced;
            }
            if (advanced) {
                App.requestDraw();
                var tl = App.panels.timeline;
                if (tl && tl.highlight) tl.highlight(App.frameIndex);
            }
            rafId = requestAnimationFrame(loop);
        };
        rafId = requestAnimationFrame(loop);
    };

    App.stopPlay = function () {
        App.playing = false;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = null;
    };

    /** 一个游戏 tick：帧停留 duration+1 tick（ObjH.as 7426：++dur; if(dur>duration) 前进） */
    App._stepTick = function () {
        var f = App.char.getFrame(App.frameIndex);
        if (!f) return false;
        var duration = HFJ.getV(f, 'duration') || 0;
        App.playTick++;
        if (App.playTick > duration) {
            App.playTick = 0;
            var range = App.actionRange();
            if (!range) return false;
            App.frameIndex = HFJ.getV(f, 'last') === true || App.frameIndex >= range.end
                ? range.start : App.frameIndex + 1;
            return true;
        }
        return false;
    };

    // ---------- 保存 ----------

    App.saveAll = async function () {
        if (!App.char) return;
        if (!App.handles) {
            App.toast('当前为只读模式，无法直接写回：请用「📦 导出 zip」保存成果');
            return;
        }
        var dirty = App.char.serializeDirty();
        var pendingPngs = App.pendingPngs || new Map();
        if (dirty.length === 0 && pendingPngs.size === 0) {
            App.toast('没有需要保存的修改');
            return;
        }
        var busy = App.setBusy('正在保存…');
        try {
            var written = await g.HFFs.saveDirty(App.char, App.handles);
            for (var [name, blob] of pendingPngs) {
                // 键可能带集合前缀（"folder/N.png"）：解析出目标 Lmi 文件夹
                var si = 0, fname = name;
                var slash = name.indexOf('/');
                if (slash > 0) {
                    var folder = name.slice(0, slash);
                    fname = name.slice(slash + 1);
                    si = App.char.lmiSets.findIndex(function (s) { return s.folder === folder; });
                    if (si < 0) throw new Error('找不到 PNG 所属的 Lmi 集合：' + name);
                }
                var dir = App.handles.lmiDirs ? App.handles.lmiDirs[si] : App.handles.lmiDir;
                await g.HFFs.writeBinary(dir, fname, blob);
                written.push(fname);
            }
            pendingPngs.clear();
            App.toast('已保存 ' + written.length + ' 个文件');
            App.refreshTopbar();
        } catch (e) {
            console.error(e);
            alert('保存失败：' + e.message);
        } finally {
            busy();
        }
    };

    // ---------- UI 协调 ----------

    App.requestDraw = function () {
        var vp = App.panels.viewport;
        if (vp && vp.requestDraw) vp.requestDraw();
    };

    App.refreshAll = function () {
        Object.keys(App.panels).forEach(function (k) {
            var p = App.panels[k];
            if (p && p.refresh) p.refresh();
        });
        App.refreshTopbar();
    };

    App.refreshTransport = function () {
        var tl = App.panels.timeline;
        if (tl && tl.refreshTransport) tl.refreshTransport();
    };

    App.refreshTopbar = function () {
        var badge = document.getElementById('version-badge');
        if (App.char) {
            badge.textContent = App.char.version + ' · ' + (App.char.charName() || App.char.charId());
            badge.style.display = '';
        } else {
            badge.style.display = 'none';
        }
        var dirtyCount = App.char
            ? App.char.allJsonFiles().filter(function (it) { return it.file.dirty; }).length
            : 0;
        document.getElementById('btn-save').classList.toggle('attention', dirtyCount > 0);
        document.getElementById('btn-undo').disabled = !App.undo.canUndo();
        document.getElementById('btn-redo').disabled = !App.undo.canRedo();
    };

    var toastTimer = null;
    App.toast = function (text) {
        var el = document.getElementById('toast');
        el.textContent = text;
        el.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2200);
    };

    // ---------- 初始化 ----------

    App.init = function () {
        document.getElementById('btn-open').onclick = App.openCharacter;
        document.getElementById('btn-save').onclick = App.saveAll;
        document.getElementById('btn-undo').onclick = function () { App.undo.undo(); };
        document.getElementById('btn-redo').onclick = function () { App.undo.redo(); };
        document.getElementById('btn-export').onclick = function () {
            if (g.HFZipUI && App.char) g.HFZipUI.exportZips(App);
            else App.toast('请先打开角色');
        };
        document.getElementById('btn-check').onclick = function () {
            if (!App.char) { App.toast('请先打开角色'); return; }
            var report = App.char.roundTripReport();
            var bad = report.filter(function (r) { return !r.ok; });
            if (bad.length === 0) App.toast('兼容性体检通过：' + report.length + ' 个文件全部一致 ✓');
            else alert('体检发现 ' + bad.length + ' 个文件不一致：\n' +
                bad.slice(0, 5).map(function (b) { return b.name + ' @' + b.firstDiff.pos; }).join('\n'));
        };

        App.undo.onChange = function () { App.refreshTopbar(); };

        document.addEventListener('keydown', function (ev) {
            if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'SELECT' || ev.target.tagName === 'TEXTAREA') return;
            if (ev.ctrlKey && ev.key.toLowerCase() === 'z') { ev.preventDefault(); App.undo.undo(); }
            else if (ev.ctrlKey && ev.key.toLowerCase() === 'y') { ev.preventDefault(); App.undo.redo(); }
            else if (ev.ctrlKey && ev.key.toLowerCase() === 's') { ev.preventDefault(); App.saveAll(); }
            else if (ev.key === ' ') { ev.preventDefault(); App.togglePlay(); }
            else if (ev.key === ',' || ev.key === 'ArrowLeft') { App._nudgeFrame(-1); }
            else if (ev.key === '.' || ev.key === 'ArrowRight') { App._nudgeFrame(1); }
        });

        // 面板初始化
        ['actions', 'timeline', 'viewport', 'limbs', 'frameprops', 'actionprops', 'boxes', 'textures']
            .forEach(function (name) {
                var mod = g['HFPanel_' + name];
                if (mod && mod.init) App.panels[name] = mod.init(App);
            });
        App.refreshTopbar();
    };

    App._nudgeFrame = function (d) {
        var range = App.actionRange();
        if (!range) return;
        var fi = Math.min(range.end, Math.max(range.start, App.frameIndex + d));
        if (fi !== App.frameIndex) App.selectFrame(fi);
    };

    g.App = App;
    if (typeof window !== 'undefined') {
        window.addEventListener('DOMContentLoaded', App.init);
    }
})(typeof window !== 'undefined' ? window : globalThis);
