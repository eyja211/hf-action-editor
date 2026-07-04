/**
 * ui/boxes.js — 判定框：可视化叠加 + 编辑 + 运行时烘焙
 *
 * 数据模型（Frame.as ResetBoxes 392-621 / GetLimbJointCoordinates 322-357）：
 *   editBody / editAttack / editAttackB 条目锚定在部位关节上：
 *     l=槽位(-1=根), j=关节序号, x1/y1=框中心相对关节的偏移, x2/y2=宽/高, z1=厚度
 *   运行时框（相对根点坐标，根=(500,400)舞台点）：
 *     rt.x1 = jointX−rootX + x1 − x2/2 ；rt.x2 = rt.x1 + x2 ；z=±z1/2
 *   游戏加载烘焙数据后**不重跑 ResetBoxes**（其唯一调用点在 CalculatePoses），
 *   因此编辑后必须把 attack[]/body[]/bx*~bz* 一并烘焙写回 —— bakeBoxes()。
 */
(function (g) {
    'use strict';
    var HFJ = g.HFJ, Skel = g.HFSkel;

    // ---------- 烘焙（供 rebake.js 与本面板调用） ----------

    /** 关节的根相对坐标：返回 {x,y,l,j}（l/j 为校验后的值，无效时 l=-1 且 x=y=0） */
    function jointRel(fp, l, j) {
        var e = fp.bySlot.get(l);
        if (l >= 0 && e && e.joints && j >= 0 && j < e.joints.length) {
            var pt = e.joints[j];
            return { x: Math.floor(pt.x) - Skel.ROOT_X, y: Math.floor(pt.y) - Skel.ROOT_Y, l: l, j: j };
        }
        return { x: 0, y: 0, l: -1, j: -1 };
    }

    /** 把 editBody/editAttack/editAttackB 烘焙为 attack[]/body[]/bx*（完全复刻 ResetBoxes） */
    function bakeBoxes(char, fp) {
        var f = fp.frame;
        var bodyOut = [];   // 节点数组
        var attackOut = [];
        var spt = char.sptRoot;
        var defW = HFJ.getV(spt, 'defBodyW') || 0;
        var defH = HFJ.getV(spt, 'defBodyH') || 0;
        var defT = HFJ.getV(spt, 'defBodyT') || 0;
        var onGround = HFJ.getV(f, 'onGround') === true;
        var footY = HFJ.getV(f, 'footY') || 0;
        var isHorse = char.sptType() === Skel.SPT_TYPE.HORSE;

        // editBody → body[]
        var editBody = HFJ.get(f, 'editBody');
        if (editBody && HFJ.isHfwArray(editBody)) {
            HFJ.arrEach(editBody, function (eb) {
                if (!eb || eb.t !== 'o') return;
                var l = HFJ.getV(eb, 'l') | 0, j = HFJ.getV(eb, 'j') | 0;
                var anchor = jointRel(fp, l, j);
                // 校验后的 l/j 写回编辑框（原实现行为）
                HFJ.setNum(eb, 'l', anchor.l, 'float');
                HFJ.setNum(eb, 'j', anchor.j, 'float');
                var ox = HFJ.getV(eb, 'x1') || 0, oy = HFJ.getV(eb, 'y1') || 0;
                var w = HFJ.getV(eb, 'x2') || 0, h = HFJ.getV(eb, 'y2') || 0;
                var t = HFJ.getV(eb, 'z1') || 0;
                var x1 = anchor.x - w / 2 + ox, y1 = anchor.y - h / 2 + oy;
                bodyOut.push(makeBodyNode(eb, {
                    x1: x1, y1: y1, x2: x1 + w, y2: y1 + h,
                    z1: -t / 2, z2: t / 2,
                    cx: x1 + w / 2, cy: y1 + h / 2, w: w, h: h, t: t
                }));
            });
        }

        // editAttack → attack[]
        var editAttack = HFJ.get(f, 'editAttack');
        if (editAttack && HFJ.isHfwArray(editAttack)) {
            HFJ.arrEach(editAttack, function (ea) {
                if (!ea || ea.t !== 'o') return;
                var l = HFJ.getV(ea, 'l') | 0, j = HFJ.getV(ea, 'j') | 0;
                var anchor = jointRel(fp, l, j);
                HFJ.setNum(ea, 'l', anchor.l, 'float');
                HFJ.setNum(ea, 'j', anchor.j, 'float');
                var ox = HFJ.getV(ea, 'x1') || 0, oy = HFJ.getV(ea, 'y1') || 0;
                var w = HFJ.getV(ea, 'x2') || 0, h = HFJ.getV(ea, 'y2') || 0;
                var t = HFJ.getV(ea, 'z1') || 0;
                var x1 = anchor.x - w / 2 + ox, y1 = anchor.y - h / 2 + oy;
                attackOut.push(makeBoxNode(ea, {
                    x1: x1, y1: y1, x2: x1 + w, y2: y1 + h, z1: -t / 2, z2: t / 2
                }));
            });
        }

        // 默认身体框
        var useDef = HFJ.getV(f, 'UseDefBody') === true;
        var defY1, defY2;
        if (isHorse) {
            defY1 = onGround ? -defH + 10 : -defH / 2;
            defY2 = onGround ? 10 : defH / 2;
        } else if (onGround) {
            defY1 = -footY - defH / 2; defY2 = -footY + defH / 2;
        } else {
            defY1 = -defH / 2; defY2 = defH / 2;
        }
        if (useDef) {
            bodyOut.push(makeBodyNode(null, {
                x1: -defW / 2, y1: defY1, x2: defW / 2, y2: defY2,
                z1: -defT / 2, z2: defT / 2,
                cx: 0, cy: (defY1 + defY2) / 2, w: defW, h: defH, t: defT
            }));
        }

        // bx*/by*/bz* 聚合（马的 by 用 defH 规则）
        var bx1, bx2, by1, by2, bz1, bz2;
        if (isHorse) {
            by1 = onGround ? -defH : -defH / 2;
            by2 = onGround ? 0 : defH / 2;
        } else if (onGround) {
            by1 = -footY - defH / 2; by2 = -footY + defH / 2;
        } else {
            by1 = -defH / 2; by2 = defH / 2;
        }
        bx1 = -defW / 2; bx2 = defW / 2;
        bz1 = -defT / 2; bz2 = defT / 2;
        var expand = function (node) {
            var x1 = HFJ.getV(node, 'x1'), y1 = HFJ.getV(node, 'y1');
            var x2 = HFJ.getV(node, 'x2'), y2 = HFJ.getV(node, 'y2');
            var z1 = HFJ.getV(node, 'z1'), z2 = HFJ.getV(node, 'z2');
            if (x1 < bx1) bx1 = x1;
            if (y1 < by1) by1 = y1;
            if (z1 < bz1) bz1 = z1;
            if (x2 > bx2) bx2 = x2;
            if (y2 > by2) by2 = y2;
            if (z2 > bz2) bz2 = z2;
        };
        bodyOut.forEach(expand);
        attackOut.forEach(expand);

        HFJ.rebuildHfwArray(ensureArr(f, 'body'), bodyOut);
        HFJ.rebuildHfwArray(ensureArr(f, 'attack'), attackOut);
        HFJ.setNum(f, 'bx1', bx1, 'float'); HFJ.setNum(f, 'bx2', bx2, 'float');
        HFJ.setNum(f, 'by1', by1, 'float'); HFJ.setNum(f, 'by2', by2, 'float');
        if (HFJ.has(f, 'bz1')) { HFJ.setNum(f, 'bz1', bz1, 'float'); HFJ.setNum(f, 'bz2', bz2, 'float'); }
        char.markSptDirty();
    }

    function ensureArr(f, key) {
        var arr = HFJ.get(f, key);
        if (!arr || arr.t !== 'o') {
            arr = HFJ.newHfwArray();
            HFJ.set(f, key, arr);
        }
        return arr;
    }

    /** 运行时 Body 节点（键序参照 Data.Body 字段；由编辑框克隆可保留额外字段如 g0/g1） */
    function makeBodyNode(srcEdit, v) {
        var node = srcEdit ? HFJ.clone(srcEdit) : buildTemplate('Data.Body',
            ['l', 'j', 'x1', 'x2', 'y1', 'y2', 'z1', 'z2', 'cx', 'cy', 'w', 'h', 't', 'g0', 'g1']);
        ['x1', 'x2', 'y1', 'y2', 'z1', 'z2', 'cx', 'cy', 'w', 'h', 't'].forEach(function (k) {
            if (v[k] !== undefined) HFJ.setNum(node, k, v[k], 'float');
        });
        return node;
    }

    function makeBoxNode(srcEdit, v) {
        var node = HFJ.clone(srcEdit);
        ['x1', 'x2', 'y1', 'y2', 'z1', 'z2'].forEach(function (k) {
            HFJ.setNum(node, k, v[k], 'float');
        });
        return node;
    }

    function buildTemplate(className, keys) {
        var node = { t: 'o', e: [['HFW_classNameXXX', HFJ.str(className)]] };
        keys.forEach(function (k) { node.e.push([k, HFJ.num(0, 'float')]); });
        return node;
    }

    // ---------- 画布叠加 ----------

    function drawOverlay(ctx, App, fp, view) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        var f = fp.frame;
        drawEditList(ctx, App, fp, view, 'editBody', 'rgba(60,200,120,0.85)', 'rgba(60,200,120,0.15)');
        drawEditList(ctx, App, fp, view, 'editAttack', 'rgba(255,80,80,0.9)', 'rgba(255,80,80,0.15)');
        drawEditList(ctx, App, fp, view, 'editAttackB', 'rgba(255,170,60,0.9)', 'rgba(255,170,60,0.12)');
        // 默认身体框
        if (HFJ.getV(f, 'UseDefBody') === true) {
            var spt = App.char.sptRoot;
            var defW = HFJ.getV(spt, 'defBodyW') || 0, defH = HFJ.getV(spt, 'defBodyH') || 0;
            var onGround = HFJ.getV(f, 'onGround') === true;
            var footY = HFJ.getV(f, 'footY') || 0;
            var y1 = onGround ? -footY - defH / 2 : -defH / 2;
            strokeRootRect(ctx, view, -defW / 2, y1, defW, defH,
                'rgba(90,160,255,0.8)', 'rgba(90,160,255,0.10)');
        }
        ctx.restore();
    }

    function drawEditList(ctx, App, fp, view, key, stroke, fill) {
        var arr = HFJ.get(fp.frame, key);
        if (!arr || !HFJ.isHfwArray(arr)) return;
        HFJ.arrEach(arr, function (box) {
            if (!box || box.t !== 'o') return;
            var anchor = jointRel(fp, HFJ.getV(box, 'l') | 0, HFJ.getV(box, 'j') | 0);
            var ox = HFJ.getV(box, 'x1') || 0, oy = HFJ.getV(box, 'y1') || 0;
            var w = HFJ.getV(box, 'x2') || 0, h = HFJ.getV(box, 'y2') || 0;
            strokeRootRect(ctx, view,
                anchor.x + ox - w / 2, anchor.y + oy - h / 2, w, h, stroke, fill);
        });
    }

    function strokeRootRect(ctx, view, rx, ry, w, h, stroke, fill) {
        var x = view.a * (rx + Skel.ROOT_X) + view.tx;
        var y = view.d * (ry + Skel.ROOT_Y) + view.ty;
        ctx.fillStyle = fill;
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1.5;
        ctx.fillRect(x, y, w * view.a, h * view.d);
        ctx.strokeRect(x, y, w * view.a, h * view.d);
    }

    // ---------- 面板 ----------

    var LIST_DEFS = [
        ['editBody', '受击框（editBody）'],
        ['editAttack', '攻击框（editAttack）'],
        ['editAttackB', '攻击框B（editAttackB）']
    ];

    function init(App) {
        var el = document.getElementById('box-props');

        function refresh() {
            el.innerHTML = '';
            if (!App.char || App.frameIndex < 0) return;
            var f = App.char.getFrame(App.frameIndex);
            if (!f) return;

            // UseDefBody
            var row = document.createElement('label');
            row.className = 'num-row';
            row.innerHTML = '<span>使用默认受击框</span>';
            var chk = document.createElement('input');
            chk.type = 'checkbox';
            chk.checked = HFJ.getV(f, 'UseDefBody') === true;
            chk.onchange = function () {
                boxEdit('默认受击框', function (f2) {
                    HFJ.set(f2, 'UseDefBody', HFJ.lit(chk.checked));
                });
            };
            row.appendChild(chk);
            el.appendChild(row);

            LIST_DEFS.forEach(function (def) { renderList(f, def[0], def[1]); });
        }

        function renderList(f, key, title) {
            var arr = HFJ.get(f, key);
            var sec = document.createElement('div');
            sec.className = 'box-section';
            var head = document.createElement('div');
            head.className = 'row-label';
            var count = arr && HFJ.isHfwArray(arr) ? HFJ.arrLen(arr) : 0;
            head.textContent = title + '　' + count + ' 个';
            var addBtn = document.createElement('button');
            addBtn.textContent = '＋新增';
            addBtn.onclick = function () { addBox(key); };
            head.appendChild(addBtn);
            sec.appendChild(head);

            if (arr && HFJ.isHfwArray(arr)) {
                HFJ.arrEach(arr, function (box, bi) {
                    if (!box || box.t !== 'o') return;
                    sec.appendChild(renderBox(key, box, bi));
                });
            }
            el.appendChild(sec);
        }

        function renderBox(key, box, bi) {
            var card = document.createElement('div');
            card.className = 'box-card';
            var fields = [
                ['l', '锚定槽位'], ['j', '关节'],
                ['x1', '偏移x'], ['y1', '偏移y'],
                ['x2', '宽'], ['y2', '高'], ['z1', '厚(z)']
            ];
            var headEl = document.createElement('div');
            headEl.className = 'box-card-head';
            headEl.textContent = '#' + bi + (HFJ.has(box, 'refName') && key !== 'editBody'
                ? '' : '');
            var delBtn = document.createElement('button');
            delBtn.textContent = '删除';
            delBtn.onclick = function () { deleteBox(key, bi); };
            headEl.appendChild(delBtn);
            card.appendChild(headEl);

            fields.forEach(function (fd) {
                var r = document.createElement('label');
                r.className = 'num-row mini';
                r.innerHTML = '<span>' + fd[1] + '</span>';
                var input = document.createElement('input');
                input.type = 'number';
                input.value = HFJ.getV(box, fd[0]);
                input.onchange = function () {
                    var v = parseFloat(input.value);
                    if (isNaN(v)) return;
                    boxEdit('修改判定框', function (f2) {
                        var arr2 = HFJ.get(f2, key);
                        var b2 = HFJ.arrGet(arr2, bi);
                        if (b2) HFJ.setNum(b2, fd[0], v, 'float');
                    });
                };
                r.appendChild(input);
                card.appendChild(r);
            });

            if (key !== 'editBody') {
                var r2 = document.createElement('label');
                r2.className = 'num-row mini';
                r2.innerHTML = '<span>攻击定义名</span>';
                var nameInput = document.createElement('input');
                nameInput.type = 'text';
                var rn = HFJ.get(box, 'refName');
                nameInput.value = rn && rn.t === 's' ? HFJ.val(rn) : '';
                nameInput.title = '如 hard(fist)；对应全局攻击表';
                nameInput.onchange = function () {
                    boxEdit('修改攻击定义', function (f2) {
                        var arr2 = HFJ.get(f2, key);
                        var b2 = HFJ.arrGet(arr2, bi);
                        if (b2) HFJ.set(b2, 'refName', nameInput.value ? HFJ.str(nameInput.value) : HFJ.lit(null));
                    });
                };
                r2.appendChild(nameInput);
                card.appendChild(r2);
                var r3 = document.createElement('label');
                r3.className = 'num-row mini';
                r3.innerHTML = '<span>攻击表编号 ref</span>';
                var refInput = document.createElement('input');
                refInput.type = 'number';
                refInput.value = HFJ.getV(box, 'ref');
                refInput.onchange = function () {
                    var v = parseFloat(refInput.value);
                    if (isNaN(v)) return;
                    boxEdit('修改攻击编号', function (f2) {
                        var arr2 = HFJ.get(f2, key);
                        var b2 = HFJ.arrGet(arr2, bi);
                        if (b2) HFJ.setNum(b2, 'ref', v, 'float');
                    });
                };
                r3.appendChild(refInput);
                card.appendChild(r3);
            }
            return card;
        }

        function addBox(key) {
            boxEdit('新增判定框', function (f2) {
                var arr2 = ensureArr(f2, key);
                var tmpl = findBoxTemplate(key);
                var node = tmpl ? HFJ.clone(tmpl) : buildTemplate(
                    key === 'editBody' ? 'Data.Body' : 'Data.Box',
                    key === 'editBody'
                        ? ['l', 'j', 'x1', 'x2', 'y1', 'y2', 'z1', 'z2', 'cx', 'cy', 'w', 'h', 't', 'g0', 'g1']
                        : ['l', 'j', 'x1', 'x2', 'y1', 'y2', 'z1', 'z2', 'ref', 'refName']);
                HFJ.setNum(node, 'l', 1, 'float');
                HFJ.setNum(node, 'j', 0, 'float');
                HFJ.setNum(node, 'x1', 0, 'float');
                HFJ.setNum(node, 'y1', 0, 'float');
                HFJ.setNum(node, 'x2', key === 'editBody' ? 110 : 150, 'float');
                HFJ.setNum(node, 'y2', key === 'editBody' ? 240 : 150, 'float');
                HFJ.setNum(node, 'z1', 60, 'float');
                HFJ.arrPush(arr2, node);
            });
        }

        /** 在全角色现有数据中找同类框做键序模板（保证版本兼容） */
        function findBoxTemplate(key) {
            var found = null;
            HFJ.arrEach(App.char.framesArr(), function (fr) {
                if (found || !fr || fr.t !== 'o') return;
                var arr = HFJ.get(fr, key);
                if (arr && HFJ.isHfwArray(arr) && HFJ.arrLen(arr) > 0) {
                    var first = HFJ.arrGet(arr, 0);
                    if (first && first.t === 'o') found = first;
                }
            });
            return found;
        }

        function deleteBox(key, bi) {
            boxEdit('删除判定框', function (f2) {
                var arr2 = HFJ.get(f2, key);
                if (arr2) HFJ.arrSplice(arr2, bi, 1, []);
            });
        }

        /** 判定框编辑通用流程：改 edit 数据 → 重烘焙运行时框 → 撤销命令 */
        function boxEdit(label, fn) {
            var fi = App.frameIndex;
            var f = App.char.getFrame(fi);
            if (!f) return;
            var before = HFJ.clone(f);
            fn(f);
            var fp = App.pose(fi);
            if (fp) bakeBoxes(App.char, fp);
            App.char.markSptDirty();
            var after = HFJ.clone(f);
            App.undo.push({
                label: label,
                undo: function () { App._restoreFrame(fi, before); },
                redo: function () { App._restoreFrame(fi, after); }
            });
            App.invalidateFrame(fi);
            App.refreshAll();
        }

        return { refresh: refresh };
    }

    g.HFBoxes = { drawOverlay: drawOverlay, bakeBoxes: bakeBoxes };
    g.HFPanel_boxes = { init: init };
})(window);
