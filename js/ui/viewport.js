/**
 * ui/viewport.js — 中央画布：视图平移缩放、部位选择与拖拽编辑（旋转/移动/缩放）、
 *                  洋葱皮、骨骼/地面叠加层
 *
 * 交互：
 *   滚轮=缩放（以光标为中心）；中键/右键/空格+左键 拖动=平移
 *   左键点击=选择部位（像素级命中）
 *   选中后按工具拖拽：旋转（绕挂接点）/ 移动（dp）/ 缩放（到挂接点距离比）
 *   拖拽根部位（胸）时 = 整体位移
 */
(function (g) {
    'use strict';
    var HFJ = g.HFJ, Skel = g.HFSkel, Render = g.HFRender;

    function init(App) {
        var wrap = document.getElementById('viewport');
        var canvas = document.getElementById('stage');
        var ctx = canvas.getContext('2d');

        var view = { s: 1, tx: 0, ty: 0 };   // 画布像素 = 舞台坐标·s + t
        var needDraw = true;
        var drag = null;

        // 工具条
        var toolBtns = {};
        ['select', 'rotate', 'move', 'scale'].forEach(function (t) {
            var btn = document.getElementById('tool-' + t);
            toolBtns[t] = btn;
            btn.onclick = function () { App.tool = t; refreshTools(); };
        });
        bindToggle('toggle-onion', function (v) { App.onion = v; requestDraw(); }, App.onion);
        bindToggle('toggle-fk', function (v) { App.fkEnabled = v; }, App.fkEnabled);
        bindToggle('toggle-skel', function (v) { App.showSkeleton = v; requestDraw(); }, App.showSkeleton);
        bindToggle('toggle-boxes', function (v) { App.showBoxes = v; requestDraw(); }, App.showBoxes);
        bindToggle('toggle-smooth', function (v) { App.smoothing = v; requestDraw(); }, App.smoothing);
        document.getElementById('btn-fit').onclick = fitView;

        function bindToggle(id, fn, initVal) {
            var el = document.getElementById(id);
            el.classList.toggle('on', !!initVal);
            el.onclick = function () {
                var v = !el.classList.contains('on');
                el.classList.toggle('on', v);
                fn(v);
            };
        }

        function refreshTools() {
            Object.keys(toolBtns).forEach(function (t) {
                toolBtns[t].classList.toggle('on', App.tool === t);
            });
        }
        refreshTools();

        function viewMatrix() {
            return { a: view.s, b: 0, c: 0, d: view.s, tx: view.tx, ty: view.ty };
        }

        function resize() {
            var r = wrap.getBoundingClientRect();
            if (canvas.width !== (r.width | 0) || canvas.height !== (r.height | 0)) {
                canvas.width = r.width | 0;
                canvas.height = r.height | 0;
                requestDraw();
            }
        }
        new ResizeObserver(resize).observe(wrap);

        function fitView() {
            resize();
            view.s = Math.min(canvas.width / 500, canvas.height / 450);
            view.tx = canvas.width / 2 - Skel.ROOT_X * view.s;
            view.ty = canvas.height * 0.72 - Skel.ROOT_Y * view.s;
            requestDraw();
        }

        // ---------- 绘制 ----------

        function requestDraw() { needDraw = true; }

        function draw() {
            if (!needDraw) return;
            needDraw = false;
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.fillStyle = '#20242b';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            drawGrid();
            var fp = App.pose ? App.pose() : null;
            if (!fp) return;
            var vm = viewMatrix();
            // 洋葱皮：前后帧
            if (App.onion) {
                var range = App.actionRange();
                if (range) {
                    var prev = App.frameIndex > range.start ? App.pose(App.frameIndex - 1) : null;
                    var next = App.frameIndex < range.end ? App.pose(App.frameIndex + 1) : null;
                    if (prev) Render.drawFrame(ctx, prev, App.images, vm, { alpha: 0.25, smoothing: App.smoothing });
                    if (next) Render.drawFrame(ctx, next, App.images, vm, { alpha: 0.18, smoothing: App.smoothing });
                }
            }
            Render.drawFrame(ctx, fp, App.images, vm, { smoothing: App.smoothing });
            Render.drawGround(ctx, fp, vm, canvas.width);
            if (App.showSkeleton) Render.drawSkeleton(ctx, fp, vm, App.selection);
            if (App.selection >= 0) Render.drawSelection(ctx, fp, App.images, vm, App.selection);
            if (App.showBoxes && g.HFBoxes) g.HFBoxes.drawOverlay(ctx, App, fp, vm);
        }

        function drawGrid() {
            var step = 50 * view.s;
            if (step < 12) return;
            ctx.strokeStyle = 'rgba(255,255,255,0.05)';
            ctx.lineWidth = 1;
            var ox = view.tx % step, oy = view.ty % step;
            ctx.beginPath();
            for (var x = ox; x < canvas.width; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); }
            for (var y = oy; y < canvas.height; y += step) { ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); }
            ctx.stroke();
        }

        (function loop() {
            draw();
            requestAnimationFrame(loop);
        })();

        // ---------- 坐标换算 ----------

        function toStage(px, py) {
            return { x: (px - view.tx) / view.s, y: (py - view.ty) / view.s };
        }

        function canvasPos(ev) {
            var r = canvas.getBoundingClientRect();
            return { x: ev.clientX - r.left, y: ev.clientY - r.top };
        }

        // ---------- 交互 ----------

        canvas.addEventListener('wheel', function (ev) {
            ev.preventDefault();
            var p = canvasPos(ev);
            var factor = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
            var ns = Math.min(8, Math.max(0.1, view.s * factor));
            factor = ns / view.s;
            view.tx = p.x - (p.x - view.tx) * factor;
            view.ty = p.y - (p.y - view.ty) * factor;
            view.s = ns;
            requestDraw();
        }, { passive: false });

        canvas.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });

        var spaceDown = false;
        document.addEventListener('keydown', function (ev) {
            if (ev.code === 'Space' && ev.target === document.body) spaceDown = true;
        });
        document.addEventListener('keyup', function (ev) {
            if (ev.code === 'Space') spaceDown = false;
        });

        canvas.addEventListener('pointerdown', function (ev) {
            canvas.setPointerCapture(ev.pointerId);
            var p = canvasPos(ev);
            if (ev.button === 1 || ev.button === 2 || (ev.button === 0 && spaceDown)) {
                drag = { kind: 'pan', px: p.x, py: p.y };
                return;
            }
            if (ev.button !== 0) return;
            var fp = App.pose();
            if (!fp) return;
            var vm = viewMatrix();
            var hit = Render.hitTest(fp, App.images, vm, p.x, p.y);
            if (hit >= 0 && hit !== App.selection) {
                App.selection = hit;
                App.refreshAll();
            } else if (hit < 0) {
                if (App.selection !== -1) { App.selection = -1; App.refreshAll(); }
                return;
            }
            // 选中且工具可编辑 → 开始手势
            if (App.tool === 'select' || App.selection < 0) return;
            if (fp.refSource) {
                App.toast('该帧复用帧 #' + fp.refSource + ' 的画面，姿势请到源帧编辑');
                return;
            }
            var e = fp.getEntry(App.selection);
            if (!e || !e.pose) return;
            var isSlave = !!Skel.SLAVE_OF[App.selection];
            if (isSlave) {
                App.toast('该部位为联动从属部位（随 ' + Skel.slotName(Skel.SLAVE_OF[App.selection].master) + ' 同步），请编辑主部位');
                return;
            }
            var sp = toStage(p.x, p.y);
            var anchor = { x: e.pose._anchorX, y: e.pose._anchorY };
            App.beginPoseEdit();
            drag = {
                kind: App.tool,
                slot: App.selection,
                startStage: sp,
                anchor: anchor,
                startRotation: e.pose.rotation,
                startScaleX: e.pose.xScale,
                startScaleY: e.pose.yScale,
                startDp: { x: e.pose.dpx, y: e.pose.dpy },
                startAngle: Math.atan2(sp.y - anchor.y, sp.x - anchor.x),
                startDist: Math.hypot(sp.x - anchor.x, sp.y - anchor.y)
            };
        });

        canvas.addEventListener('pointermove', function (ev) {
            if (!drag) return;
            var p = canvasPos(ev);
            if (drag.kind === 'pan') {
                view.tx += p.x - drag.px;
                view.ty += p.y - drag.py;
                drag.px = p.x; drag.py = p.y;
                requestDraw();
                return;
            }
            var fp = App.pose();
            if (!fp) return;
            var e = fp.getEntry(drag.slot);
            if (!e || !e.pose) return;
            var sp = toStage(p.x, p.y);
            var rebuild = function (slot) {
                if (App.fkEnabled) fp.rebuildChain(slot);
                else fp.rebuildDetached(slot);
            };
            if (drag.kind === 'rotate') {
                drag.moved = true;
                var ang = Math.atan2(sp.y - drag.anchor.y, sp.x - drag.anchor.x);
                var deg = (ang - drag.startAngle) / AS3.PI_180;
                if (ev.shiftKey) deg = Math.round(deg / 15) * 15; // 15° 吸附
                e.pose.rotation = drag.startRotation + deg;
                rebuild(drag.slot);
            } else if (drag.kind === 'move') {
                drag.moved = true;
                e.pose.dpx = drag.startDp.x + (sp.x - drag.startStage.x);
                e.pose.dpy = drag.startDp.y + (sp.y - drag.startStage.y);
                rebuild(drag.slot);
            } else if (drag.kind === 'scale') {
                drag.moved = true;
                var dist = Math.hypot(sp.x - drag.anchor.x, sp.y - drag.anchor.y);
                var k = drag.startDist > 1 ? dist / drag.startDist : 1;
                if (ev.shiftKey) {
                    // Shift = 仅纵向
                    e.pose.yScale = drag.startScaleY * k;
                } else {
                    e.pose.xScale = drag.startScaleX * k;
                    e.pose.yScale = drag.startScaleY * k;
                }
                rebuild(drag.slot);
            }
            requestDraw();
            var limbs = App.panels.limbs;
            if (limbs && limbs.refreshValues) limbs.refreshValues();
        });

        function endDrag(ev) {
            if (!drag) return;
            var d = drag;
            drag = null;
            if (d.kind === 'pan') return;
            if (!d.moved) {
                // 单击选中未拖动：不烘焙、不产生撤销记录
                App.discardPoseEdit();
                return;
            }
            var labels = { rotate: '旋转', move: '移动', scale: '缩放' };
            App.commitPoseEdit(labels[d.kind] + ' ' + Skel.slotName(d.slot));
        }
        canvas.addEventListener('pointerup', endDrag);
        canvas.addEventListener('pointercancel', function () {
            if (drag && drag.kind !== 'pan') App.cancelPoseEdit();
            drag = null;
        });

        var AS3 = g.AS3;

        function refresh() { requestDraw(); }

        return { refresh: refresh, requestDraw: requestDraw, fitView: fitView };
    }

    g.HFPanel_viewport = { init: init };
})(window);
