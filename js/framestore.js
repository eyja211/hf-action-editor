/**
 * framestore.js — 帧池与动作的结构化操作（插入/删除/复制帧、新建/复制动作）
 *
 * 不变量维护（对应游戏 ResetFrameIndex 与加载逻辑）：
 *   - frame[i].index === i（全帧重编号）
 *   - action[].frameIndex 指向各动作起始帧（splice 后平移）
 *   - frame[].refIndex / refIndex_2：仅 >0 有效（0=无引用），splice 后平移；
 *     引用被删帧 → 置 0 并警告
 *   - 动作帧序列以 last=true 结尾
 *   - HFW_ArrayLenXXX 同步
 */
(function (g) {
    'use strict';
    var HFJ = g.HFJ;

    /** 供撤销用：对帧池执行 splice 并修正全部索引。insertNodes 为节点数组。返回受影响说明。 */
    function spliceFrames(char, index, deleteCount, insertNodes) {
        var frames = char.framesArr();
        var delta = (insertNodes ? insertNodes.length : 0) - deleteCount;
        var warnings = [];

        HFJ.arrSplice(frames, index, deleteCount, insertNodes || []);

        // 重写 frame[].index 与引用
        var n = HFJ.arrLen(frames);
        for (var i = 0; i < n; i++) {
            var f = HFJ.arrGet(frames, i);
            if (!f || f.t !== 'o') continue;
            HFJ.setNum(f, 'index', i, 'float');
            fixRef(f, 'refIndex', index, deleteCount, delta, warnings, i);
            fixRef(f, 'refIndex_2', index, deleteCount, delta, warnings, i);
        }
        // 动作起始帧平移
        var actions = char.actionsArr();
        HFJ.arrEach(actions, function (a) {
            if (!a || a.t !== 'o') return;
            var fi = HFJ.getV(a, 'frameIndex');
            if (typeof fi !== 'number' || fi < 0) return;
            if (fi >= index + deleteCount) {
                HFJ.setNum(a, 'frameIndex', fi + delta, 'float');
            } else if (fi >= index && deleteCount > 0) {
                // 起始帧被删：指向删除点（调用方应避免这种情况）
                HFJ.setNum(a, 'frameIndex', Math.min(index, HFJ.arrLen(frames) - 1), 'float');
                warnings.push('动作 "' + HFJ.getV(a, 'name') + '" 的起始帧被删除，已重定位');
            }
        });
        char.markSptDirty();
        return warnings;
    }

    function fixRef(f, key, index, deleteCount, delta, warnings, atFrame) {
        var v = HFJ.getV(f, key);
        if (typeof v !== 'number' || v <= 0) return;
        if (v >= index + deleteCount) {
            HFJ.setNum(f, key, v + delta, 'float');
        } else if (v >= index && deleteCount > 0) {
            HFJ.setNum(f, key, 0, 'float');
            warnings.push('帧 ' + atFrame + ' 的 ' + key + ' 引用了被删除的帧，已清除');
        }
    }

    /** 检查帧是否被引用（refIndex/refIndex_2 == index 且 >0） */
    function frameReferencedBy(char, index) {
        if (index <= 0) return [];
        var refs = [];
        HFJ.arrEach(char.framesArr(), function (f, i) {
            if (!f || f.t !== 'o') return;
            if (HFJ.getV(f, 'refIndex') === index || HFJ.getV(f, 'refIndex_2') === index) {
                refs.push(i);
            }
        });
        return refs;
    }

    /**
     * 复制帧：把 srcIndex 的克隆插到其后。若 src 是动作末帧（last=true），
     * 原帧改 last=false、克隆保持 last=true（动作向后延一帧）。
     * 返回 {newIndex, undoData}。
     */
    function duplicateFrame(char, srcIndex) {
        var src = char.getFrame(srcIndex);
        if (!src) return null;
        var clone = HFJ.clone(src);
        var srcWasLast = HFJ.getV(src, 'last') === true;
        if (srcWasLast) HFJ.set(src, 'last', HFJ.lit(false));
        spliceFrames(char, srcIndex + 1, 0, [clone]);
        return { newIndex: srcIndex + 1, srcWasLast: srcWasLast };
    }

    /** 撤销复制帧 */
    function undoDuplicateFrame(char, srcIndex, srcWasLast) {
        spliceFrames(char, srcIndex + 1, 1, []);
        if (srcWasLast) {
            var src = char.getFrame(srcIndex);
            if (src) HFJ.set(src, 'last', HFJ.lit(true));
        }
        char.markSptDirty();
    }

    /**
     * 删除帧（动作至少保留 1 帧）。若删的是末帧，前一帧改 last=true。
     * 返回 {removedNode, wasLast, warnings} 或 {error}。
     */
    function deleteFrame(char, actionIndex, frameIndex) {
        var range = char.actionFrameRange(actionIndex);
        if (!range || frameIndex < range.start || frameIndex > range.end) {
            return { error: '帧不在当前动作范围内' };
        }
        if (range.end === range.start) return { error: '动作至少需要保留一帧' };
        var refs = frameReferencedBy(char, frameIndex);
        var node = char.getFrame(frameIndex);
        var wasLast = HFJ.getV(node, 'last') === true;
        var removed = HFJ.clone(node);
        var warnings = spliceFrames(char, frameIndex, 1, []);
        if (refs.length) warnings.push('帧被 ' + refs.join(',') + ' 引用，引用已清除');
        if (wasLast) {
            var prev = char.getFrame(frameIndex - 1);
            if (prev) HFJ.set(prev, 'last', HFJ.lit(true));
        }
        return { removedNode: removed, wasLast: wasLast, warnings: warnings };
    }

    /**
     * 新建动作：克隆 srcActionIndex 的动作对象和它的整段帧（追加到帧池末尾），
     * 动作对象追加到 action 数组，name 重命名。返回新动作 index。
     * 注意：新动作不会自动加入任何 actionGroup（进阶用法；键触发等由用户后续配置）。
     */
    function duplicateAction(char, srcActionIndex, newName) {
        var srcAction = char.getAction(srcActionIndex);
        var range = char.actionFrameRange(srcActionIndex);
        if (!srcAction || !range) return null;

        var frames = char.framesArr();
        var insertAt = HFJ.arrLen(frames);
        var clones = [];
        for (var i = range.start; i <= range.end; i++) {
            clones.push(HFJ.clone(char.getFrame(i)));
        }
        spliceFrames(char, insertAt, 0, clones);

        var newAction = HFJ.clone(srcAction);
        HFJ.set(newAction, 'name', HFJ.str(newName));
        HFJ.setNum(newAction, 'frameIndex', insertAt, 'float');
        var actions = char.actionsArr();
        var newIndex = HFJ.arrPush(actions, newAction);
        HFJ.setNum(newAction, 'index', newIndex, 'float');
        char.markSptDirty();
        return { actionIndex: newIndex, frameStart: insertAt, frameCount: clones.length };
    }

    /** 撤销新建动作（动作在数组末尾、帧在池末尾时才可安全撤销） */
    function undoDuplicateAction(char, info) {
        var actions = char.actionsArr();
        HFJ.arrSplice(actions, info.actionIndex, 1, []);
        spliceFrames(char, info.frameStart, info.frameCount, []);
        char.markSptDirty();
    }

    /** 动作被引用检查（nextAi、landAi 或 actionGroup / keyTgr 引用其 index 时不可删） */
    function actionReferencedBy(char, actionIndex) {
        var refs = [];
        HFJ.arrEach(char.actionsArr(), function (a, i) {
            if (!a || a.t !== 'o' || i === actionIndex) return;
            ['nextAi', 'landAi'].forEach(function (key) {
                if (HFJ.getV(a, key) === actionIndex) refs.push('动作' + i + '.' + key);
            });
        });
        // actionGroup 内 actionIndex 桶引用
        HFJ.arrEach(char.actionGroupArr(), function (ag, gi) {
            if (!ag || ag.t !== 'o') return;
            var idxBuckets = HFJ.get(ag, 'actionIndex');
            if (!idxBuckets) return;
            HFJ.arrEach(idxBuckets, function (bucket, bi) {
                if (!bucket || bucket.t !== 'o') return;
                HFJ.arrEach(bucket, function (v, k) {
                    if (v && v.t === 'n' && parseFloat(v.raw) === actionIndex) {
                        refs.push('动作组' + gi + '[' + bi + '][' + k + ']');
                    }
                });
            });
        });
        return refs;
    }

    g.HFFrameStore = {
        spliceFrames: spliceFrames,
        frameReferencedBy: frameReferencedBy,
        duplicateFrame: duplicateFrame,
        undoDuplicateFrame: undoDuplicateFrame,
        deleteFrame: deleteFrame,
        duplicateAction: duplicateAction,
        undoDuplicateAction: undoDuplicateAction,
        actionReferencedBy: actionReferencedBy
    };
})(typeof window !== 'undefined' ? window : globalThis);
