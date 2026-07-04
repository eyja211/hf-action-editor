/**
 * ui/limbs.js — 右侧「部位」页：绘制顺序列表（=uz/lz 顺序）、选中联动、
 *               数值编辑（旋转/缩放/位移）、贴图造型切换、层级调整
 */
(function (g) {
    'use strict';
    var HFJ = g.HFJ, Skel = g.HFSkel;

    function init(App) {
        var listEl = document.getElementById('limb-list');
        var propsEl = document.getElementById('limb-props');

        function refresh() {
            renderList();
            renderAddRow();
            renderProps();
        }

        function renderList() {
            listEl.innerHTML = '';
            var fp = App.pose && App.pose();
            if (!fp) return;
            if (fp.refSource) {
                var hint = document.createElement('li');
                hint.className = 'hint';
                hint.textContent = '复用帧：显示帧 #' + fp.refSource + ' 的画面（只读，姿势请到源帧编辑）';
                listEl.appendChild(hint);
            }
            var entries = fp.entries;
            // 顶层显示在列表上方：倒序展示（数组末尾 = 最上层）
            for (var i = entries.length - 1; i >= 0; i--) {
                (function (e, idx) {
                    var li = document.createElement('li');
                    li.className = (e.slot === App.selection ? 'sel' : '') +
                        (Skel.SLAVE_OF[e.slot] ? ' slave' : '');
                    li.innerHTML =
                        '<span class="lname">' + Skel.slotName(e.slot, fp.sptType) + '</span>' +
                        '<span class="lpic">p' + e.p + (e.list === 'lz' ? ' 下' : '') + '</span>' +
                        '<span class="order-btns">' +
                        '<button data-d="1" title="上移一层">▲</button>' +
                        '<button data-d="-1" title="下移一层">▼</button></span>';
                    li.onclick = function (ev) {
                        if (ev.target.tagName === 'BUTTON') return;
                        App.selection = e.slot;
                        App.refreshAll();
                    };
                    li.querySelectorAll('button').forEach(function (btn) {
                        btn.onclick = function () {
                            moveLayer(e, parseInt(btn.dataset.d, 10));
                        };
                    });
                    listEl.appendChild(li);
                })(entries[i], i);
            }
        }

        /** 层级调整：交换 uz/lz 数组中的相邻条目（d=1 向上层=向数组尾部） */
        function moveLayer(entry, d) {
            var fi = App.frameIndex;
            var fp = App.pose(fi);
            if (fp && fp.refSource) {
                App.toast('复用帧不可调整层级，请到源帧 #' + fp.refSource + ' 编辑');
                return;
            }
            var f = App.char.getFrame(fi);
            var arr = HFJ.get(f, entry.list);
            if (!arr) return;
            var n = HFJ.arrLen(arr);
            var k = entry.k, k2 = k + d;
            if (k2 < 0 || k2 >= n) return;
            var before = HFJ.clone(f);
            var a = HFJ.arrGet(arr, k), b = HFJ.arrGet(arr, k2);
            HFJ.arrSet(arr, k, b);
            HFJ.arrSet(arr, k2, a);
            App.char.markSptDirty();
            var after = HFJ.clone(f);
            App.undo.push({
                label: '调整层级 ' + Skel.slotName(entry.slot),
                undo: function () { App._restoreFrame(fi, before); },
                redo: function () { App._restoreFrame(fi, after); }
            });
            App.invalidateFrame(fi);
            App.refreshAll();
        }

        // ---------- 添加/移除部位条目 ----------

        var addRowEl = null;

        /** 「添加部位」控件行：槽位下拉 + 造型序号 + 按钮（同槽位可重复添加） */
        function renderAddRow() {
            if (addRowEl) { addRowEl.remove(); addRowEl = null; }
            var fp = App.pose && App.pose();
            if (!fp) return;
            addRowEl = document.createElement('div');
            addRowEl.className = 'add-part-row';
            if (fp.refSource) {
                addRowEl.innerHTML = '<div class="hint">复用帧不能添加部位（画面来自帧 #' + fp.refSource + '）</div>';
                listEl.parentNode.insertBefore(addRowEl, propsEl);
                return;
            }
            var slotSel = document.createElement('select');
            var nSlots = Skel.numSlots(fp.sptType);
            for (var s = 0; s < nSlots; s++) {
                if (!App.char.limbOfSlot(s)) continue;   // 未绑定 Limb 的槽位加了也没图
                var opt = document.createElement('option');
                opt.value = s;
                opt.textContent = Skel.slotName(s, fp.sptType) + (fp.getEntry(s) ? '（已有）' : '');
                slotSel.appendChild(opt);
            }
            var pInput = document.createElement('input');
            pInput.type = 'number';
            pInput.min = 0;
            pInput.style.width = '52px';
            pInput.title = '贴图造型序号 p';
            var syncP = function () {
                var s = parseInt(slotSel.value, 10);
                var dp = Skel.defaultPic(fp.sptType)[s];
                pInput.value = dp >= 0 ? dp : 0;
            };
            slotSel.onchange = syncP;
            if (slotSel.options.length) syncP();
            var btn = document.createElement('button');
            btn.textContent = '＋添加部位';
            btn.title = '把该部位加入本帧（顶层）。同一部位可重复添加多份贴图';
            btn.onclick = function () {
                addPart(parseInt(slotSel.value, 10), parseInt(pInput.value, 10) || 0);
            };
            addRowEl.appendChild(slotSel);
            addRowEl.appendChild(pInput);
            addRowEl.appendChild(btn);
            listEl.parentNode.insertBefore(addRowEl, propsEl);
        }

        /** 添加部位条目到本帧 uz 末尾（=顶层），默认姿势挂到父关节 */
        function addPart(slot, p) {
            var fi = App.frameIndex;
            if (fi < 0 || isNaN(slot)) return;
            var f = App.char.getFrame(fi);
            if (!f) return;
            var fp0 = App.pose(fi);
            if (fp0 && fp0.refSource) { App.toast('复用帧不能添加部位'); return; }
            if (!App.char.resolvePic(slot, p)) {
                App.toast('该部位没有 p=' + p + ' 的可用贴图造型');
                return;
            }
            var footYBefore = fp0 ? fp0.computeFootY() : null;
            var before = HFJ.clone(f);

            // 模板：全帧池找一个 uz 条目克隆键结构（版本兼容）
            var tmpl = null;
            HFJ.arrEach(App.char.framesArr(), function (fr) {
                if (tmpl || !fr || fr.t !== 'o') return;
                var uz = HFJ.get(fr, 'uz');
                if (uz && HFJ.isHfwArray(uz) && HFJ.arrLen(uz) > 0) {
                    var first = HFJ.arrGet(uz, 0);
                    if (first && first.t === 'o' && HFJ.get(first, 'm')) tmpl = first;
                }
            });
            if (!tmpl) { App.toast('找不到可作模板的部位条目'); return; }
            var node = HFJ.clone(tmpl);
            HFJ.setNum(node, 'i', slot, 'float');
            HFJ.setNum(node, 'p', p, 'float');
            HFJ.setNum(node, 'x', 0, 'float');
            HFJ.setNum(node, 'y', 0, 'float');
            var arr = HFJ.get(f, 'uz');
            if (!arr || !HFJ.isHfwArray(arr)) { App.toast('该帧没有 uz 列表'); return; }
            HFJ.arrPush(arr, node);
            // lmat[slot] 不是矩阵对象时补一个（writeBack 需要）
            var lmat = HFJ.get(f, 'lmat');
            if (lmat && HFJ.isHfwArray(lmat)) {
                var mn = HFJ.arrGet(lmat, slot);
                if (!mn || mn.t !== 'o') HFJ.arrSet(lmat, slot, HFJ.clone(HFJ.get(node, 'm')));
            }
            App.char.markSptDirty();
            App.invalidateFrame(fi);

            // 默认姿势：挂父关节、旋转 0（武器槽 75°）、缩放 1
            var fp = App.pose(fi);
            var uzEntries = fp.entries.filter(function (x) { return x.list === 'uz'; });
            var e = uzEntries[uzEntries.length - 1];
            if (e && e.pic) {
                var pj = fp.parentJointOf(slot) || { x: fp.rootX, y: fp.rootY };
                e.pose = {
                    rotation: Skel.DEFAULT_ROT75.indexOf(slot) >= 0 ? 75 : 0,
                    xScale: 1, yScale: 1, dpx: 0, dpy: 0,
                    _anchorX: pj.x, _anchorY: pj.y,
                    _parentX: pj.x, _parentY: pj.y
                };
                fp._rebuildOne(e);
                g.HFRebake.rebakeFrame(fp, App.images, App.autoFootY, footYBefore);
            }
            var after = HFJ.clone(f);
            App.undo.push({
                label: '添加部位 ' + Skel.slotName(slot),
                undo: function () { App._restoreFrame(fi, before); },
                redo: function () { App._restoreFrame(fi, after); }
            });
            App.selection = slot;
            App.invalidateFrame(fi);
            App.refreshAll();
            App.toast('已添加 ' + Skel.slotName(slot) + '（顶层）。可用旋转/移动/缩放调整');
        }

        /** 从本帧移除条目（同槽位多份时移除列表里最上层那份） */
        function removePart(entry) {
            var fi = App.frameIndex;
            var f = App.char.getFrame(fi);
            if (!f) return;
            var fp0 = App.pose(fi);
            if (fp0 && fp0.refSource) { App.toast('复用帧不能移除部位'); return; }
            var footYBefore = fp0 ? fp0.computeFootY() : null;
            var before = HFJ.clone(f);
            var arr = HFJ.get(f, entry.list);
            if (!arr || !HFJ.isHfwArray(arr)) return;
            HFJ.arrSplice(arr, entry.k, 1, []);
            // 该槽位不再出现在任何列表 → lmat[slot] 置 null
            var stillUsed = false;
            ['uz', 'lz'].forEach(function (ln) {
                var a = HFJ.get(f, ln);
                if (a && HFJ.isHfwArray(a)) {
                    HFJ.arrEach(a, function (lz) {
                        if (lz && lz.t === 'o' && (HFJ.getV(lz, 'i') | 0) === entry.slot) stillUsed = true;
                    });
                }
            });
            if (!stillUsed) {
                var lmat = HFJ.get(f, 'lmat');
                if (lmat && HFJ.isHfwArray(lmat)) HFJ.arrSet(lmat, entry.slot, HFJ.lit(null));
            }
            App.char.markSptDirty();
            App.invalidateFrame(fi);
            var fp = App.pose(fi);
            if (fp) g.HFRebake.rebakeFrame(fp, App.images, App.autoFootY, footYBefore);
            var after = HFJ.clone(f);
            App.undo.push({
                label: '移除部位 ' + Skel.slotName(entry.slot),
                undo: function () { App._restoreFrame(fi, before); },
                redo: function () { App._restoreFrame(fi, after); }
            });
            if (App.selection === entry.slot && !stillUsed) App.selection = -1;
            App.invalidateFrame(fi);
            App.refreshAll();
        }

        function renderProps() {
            propsEl.innerHTML = '';
            var fp = App.pose && App.pose();            if (!fp || App.selection < 0) {
                propsEl.innerHTML = '<div class="hint">点击画布或列表选择部位</div>';
                return;
            }
            var e = fp.getEntry(App.selection);
            if (!e) {
                propsEl.innerHTML = '<div class="hint">当前帧未绘制该部位</div>';
                return;
            }
            var slave = Skel.SLAVE_OF[e.slot];
            var head = document.createElement('div');
            head.className = 'limb-head';
            head.textContent = Skel.slotName(e.slot, fp.sptType) +
                (slave ? '（联动：随 ' + Skel.slotName(slave.master) + '）' : '');
            if (!fp.refSource) {
                var rmBtn = document.createElement('button');
                rmBtn.textContent = '移除';
                rmBtn.title = '从本帧移除该部位条目（同槽位多份时移除最上层那份）';
                rmBtn.style.cssText = 'float:right';
                rmBtn.onclick = function () {
                    if (confirm('从本帧移除 ' + Skel.slotName(e.slot, fp.sptType) + '？')) removePart(e);
                };
                head.appendChild(rmBtn);
            }
            propsEl.appendChild(head);

            if (e.pose && !slave) {
                propsEl.appendChild(numRow('旋转°', e.pose.rotation, 1, function (v, fp2, e2) { e2.pose.rotation = v; }));
                propsEl.appendChild(numRow('横向缩放', e.pose.xScale, 0.01, function (v, fp2, e2) { e2.pose.xScale = v; }));
                propsEl.appendChild(numRow('纵向缩放', e.pose.yScale, 0.01, function (v, fp2, e2) { e2.pose.yScale = v; }));
                propsEl.appendChild(numRow('位移 dpx', e.pose.dpx, 1, function (v, fp2, e2) { e2.pose.dpx = v; }));
                propsEl.appendChild(numRow('位移 dpy', e.pose.dpy, 1, function (v, fp2, e2) { e2.pose.dpy = v; }));
            }

            // 贴图造型选择
            var reg = App.char.limbOfSlot(e.slot);
            if (reg) {
                var lpiArr = HFJ.get(reg.node, 'limbPicIndex');
                var count = lpiArr ? HFJ.arrLen(lpiArr) : 0;
                var gallery = document.createElement('div');
                gallery.className = 'pic-gallery';
                var gTitle = document.createElement('div');
                gTitle.className = 'row-label';
                gTitle.textContent = '贴图造型（p）';
                propsEl.appendChild(gTitle);
                for (var p = 0; p < count; p++) {
                    (function (p) {
                        var info = App.char.resolvePic(e.slot, p);
                        if (!info || info.disabled || !info.pngName) return;
                        var cell = document.createElement('div');
                        cell.className = 'pic-cell' + (p === e.p ? ' sel' : '');
                        cell.title = 'p=' + p + ' → 图池#' + info.picIndex;
                        var cv = document.createElement('canvas');
                        cv.width = 44; cv.height = 44;
                        drawPicThumb(cv, info);
                        cell.appendChild(cv);
                        var tag = document.createElement('span');
                        tag.textContent = p;
                        cell.appendChild(tag);
                        cell.onclick = function () {
                            App.poseEditOnce('切换造型 ' + Skel.slotName(e.slot), function (fp2) {
                                fp2.setPicVariant(e.slot, p);
                            });
                        };
                        gallery.appendChild(cell);
                    })(p);
                }
                propsEl.appendChild(gallery);
            }
        }

        function drawPicThumb(cv, info) {
            var img = App.images && App.images.get(info.pngName);
            if (!img) return;
            var ctx = cv.getContext('2d');
            var s = Math.min(cv.width / img.width, cv.height / img.height, 1);
            ctx.drawImage(img, (cv.width - img.width * s) / 2, (cv.height - img.height * s) / 2,
                img.width * s, img.height * s);
        }

        function numRow(label, value, step, apply) {
            var row = document.createElement('label');
            row.className = 'num-row';
            var span = document.createElement('span');
            span.textContent = label;
            var input = document.createElement('input');
            input.type = 'number';
            input.step = step;
            input.value = round4(value);
            input.onchange = function () {
                var v = parseFloat(input.value);
                if (isNaN(v)) return;
                var slot = App.selection;
                App.poseEditOnce(label + ' ' + Skel.slotName(slot), function (fp2) {
                    var e2 = fp2.getEntry(slot);
                    if (!e2 || !e2.pose) return;
                    apply(v, fp2, e2);
                    if (App.fkEnabled) fp2.rebuildChain(slot);
                    else fp2.rebuildDetached(slot);
                });
            };
            row.appendChild(span);
            row.appendChild(input);
            return row;
        }

        /** 拖拽过程中仅刷新数值输入框（不重建 DOM） */
        function refreshValues() {
            var fp = App.pose && App.pose();
            if (!fp || App.selection < 0) return;
            var e = fp.getEntry(App.selection);
            if (!e || !e.pose) return;
            var inputs = propsEl.querySelectorAll('.num-row input');
            var vals = [e.pose.rotation, e.pose.xScale, e.pose.yScale, e.pose.dpx, e.pose.dpy];
            inputs.forEach(function (input, i) {
                if (i < vals.length && document.activeElement !== input) {
                    input.value = round4(vals[i]);
                }
            });
        }

        function round4(v) { return Math.round(v * 10000) / 10000; }

        return { refresh: refresh, refreshValues: refreshValues };
    }

    g.HFPanel_limbs = { init: init };
})(window);
