/**
 * ui/textures.js — 贴图/皮肤工具：
 *   1. 按部位浏览全部贴图变体（图池）
 *   2. 替换 PNG（做皮肤：几何不变，仅换画）
 *   3. 新增贴图变体：导入 PNG → 自动建 LimbPic_N.json + N.png + 更新 Limb_X.json 索引
 *   4. 锚点/关节编辑器：参照现有变体叠影，拖拽调整关节点（原画坐标系）
 *
 * 数据规则（LimbInfoFile.as / 导出格式实测）：
 *   新 LimbPic：index=N（图池号，=文件名与 PNG 名）、embeded=true、disabled=false、
 *   refIndex/bmRefIndex=-1、r0=r=1、j[] 关节（原画坐标）、cx/cy（裁剪偏移=位图(0,0)的原画坐标）
 *   Limb_X.json：limbPic 追加 null、limbPicIndex 追加 N（HFW len 同步 +1）
 */
(function (g) {
    'use strict';
    var HFJ = g.HFJ, Skel = g.HFSkel;

    function init(App) {
        var el = document.getElementById('texture-panel');
        if (!App.pendingPngs) App.pendingPngs = new Map();

        function refresh() {
            el.innerHTML = '';
            if (!App.char) { el.innerHTML = '<div class="hint">请先打开角色</div>'; return; }
            var limbSel = document.createElement('select');
            limbSel.id = 'tex-limb-sel';
            var names = [];
            App.char.limbByName.forEach(function (_, name) { names.push(name); });
            names.sort();
            names.forEach(function (n) {
                var opt = document.createElement('option');
                opt.value = n; opt.textContent = n;
                limbSel.appendChild(opt);
            });
            if (refresh._lastLimb && names.indexOf(refresh._lastLimb) >= 0) limbSel.value = refresh._lastLimb;
            limbSel.onchange = function () {
                refresh._lastLimb = limbSel.value;
                renderGallery(limbSel.value);
            };
            var row = document.createElement('div');
            row.className = 'num-row';
            row.innerHTML = '<span>部位（Limb）</span>';
            row.appendChild(limbSel);
            el.appendChild(row);

            var addBtn = document.createElement('button');
            addBtn.className = 'wide-btn';
            addBtn.textContent = '＋ 导入 PNG 为该部位新增贴图变体';
            addBtn.onclick = function () { importNewVariant(limbSel.value); };
            el.appendChild(addBtn);

            var gal = document.createElement('div');
            gal.id = 'tex-gallery';
            el.appendChild(gal);
            renderGallery(limbSel.value);
        }

        function renderGallery(limbName) {
            var gal = document.getElementById('tex-gallery');
            if (!gal) return;
            gal.innerHTML = '';
            var reg = App.char.limbByName.get(limbName);
            if (!reg) return;
            var lpi = HFJ.get(reg.node, 'limbPicIndex');
            if (!lpi) return;
            HFJ.arrEach(lpi, function (idxNode, p) {
                if (!idxNode || idxNode.t !== 'n') return;
                var poolIdx = parseFloat(idxNode.raw) | 0;
                var info = App.char.picInfoIn(reg.set, poolIdx);
                if (!info) return;
                var card = document.createElement('div');
                card.className = 'tex-card' + (info.disabled ? ' disabled' : '');
                var cv = document.createElement('canvas');
                cv.width = 84; cv.height = 84;
                if (info.pngName) drawThumb(cv, info.pngName);
                card.appendChild(cv);
                var cap = document.createElement('div');
                cap.className = 'tex-cap';
                cap.textContent = 'p' + p + ' · #' + poolIdx + (info.disabled ? ' 禁用' : '') +
                    (info.pngName ? '' : ' 无图');
                card.appendChild(cap);
                var ops = document.createElement('div');
                ops.className = 'tex-ops';
                if (info.pngName) {
                    var repBtn = document.createElement('button');
                    repBtn.textContent = '替换PNG';
                    repBtn.title = '保持锚点关节不变，仅替换图像（做皮肤）';
                    repBtn.onclick = function () { replacePng(info); };
                    ops.appendChild(repBtn);
                }
                var jointBtn = document.createElement('button');
                jointBtn.textContent = '锚点/关节';
                jointBtn.onclick = function () { openAnchorEditor(limbName, poolIdx, null); };
                ops.appendChild(jointBtn);
                card.appendChild(ops);
                gal.appendChild(card);
            });
        }

        function drawThumb(cv, pngName) {
            var img = App.images.get(pngName);
            if (!img) { setTimeout(function () { drawThumb(cv, pngName); }, 300); return; }
            var ctx = cv.getContext('2d');
            ctx.clearRect(0, 0, cv.width, cv.height);
            var s = Math.min(cv.width / img.width, cv.height / img.height, 1);
            ctx.drawImage(img, (cv.width - img.width * s) / 2, (cv.height - img.height * s) / 2,
                img.width * s, img.height * s);
        }

        // ---------- 替换 PNG（皮肤） ----------

        function replacePng(info) {
            pickPngFile(function (file) {
                App.pendingPngs.set(info.pngName, file);
                App.images.put(info.pngName, file);
                g.HFRender.invalidateAlpha(info.pngName);
                App.invalidateFrame();
                App.refreshAll();
                App.toast('已替换 ' + info.pngName + '（保存时写入文件）');
            });
        }

        function pickPngFile(cb) {
            var input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/png';
            input.onchange = function () {
                if (input.files && input.files[0]) cb(input.files[0]);
            };
            input.click();
        }

        // ---------- 新增变体 ----------

        function importNewVariant(limbName) {
            var reg = App.char.limbByName.get(limbName);
            if (!reg) return;
            var set = reg.set;   // 变体归属该 Limb 所在的 Lmi 集合（图池编号按集合独立）
            pickPngFile(function (file) {
                // 新图池编号（集合内）
                var maxIdx = -1;
                set.picFiles.forEach(function (_, n) { if (n > maxIdx) maxIdx = n; });
                var N = maxIdx + 1;
                // 键序模板：本集合里找一个 embeded=true 的现有 LimbPic 文件
                var tmplFile = null;
                set.picFiles.forEach(function (jf) {
                    if (tmplFile) return;
                    var node = jf.tree.e[0] && jf.tree.e[0][1];
                    if (node && HFJ.getV(node, 'embeded') === true) tmplFile = jf;
                });
                if (!tmplFile) {
                    // 集合内没有可作模板的 → 任一集合兜底（只借键序）
                    App.char.lmiSets.forEach(function (s) {
                        if (tmplFile) return;
                        s.picFiles.forEach(function (jf) {
                            if (tmplFile) return;
                            var node = jf.tree.e[0] && jf.tree.e[0][1];
                            if (node && HFJ.getV(node, 'embeded') === true) tmplFile = jf;
                        });
                    });
                }
                if (!tmplFile) { alert('找不到可作模板的 LimbPic'); return; }

                var tree = HFJ.clone(tmplFile.tree);
                var node = tree.e[0][1];
                var filename = 'png_custom/' + (App.char.charId() || 'char') + '_' + N + '.png';
                HFJ.setNum(node, 'index', N, 'float');
                HFJ.set(node, 'filename', HFJ.str(filename));
                HFJ.set(node, 'embeded', HFJ.lit(true));
                HFJ.set(node, 'disabled', HFJ.lit(false));
                HFJ.setNum(node, 'refIndex', -1, 'float');
                HFJ.setNum(node, 'bmRefIndex', -1, 'float');
                HFJ.set(node, 'ref', HFJ.lit(null));
                HFJ.set(node, 'bmRef', HFJ.lit(null));
                HFJ.set(node, 'ba', HFJ.lit(null));
                HFJ.set(node, 'bitmap', HFJ.lit(null));
                HFJ.setNum(node, 'r0', 1, 'float');
                HFJ.setNum(node, 'r', 1, 'float');
                // 默认几何：参照同部位第一个可用变体
                var refInfo = firstUsableInfo(reg);
                if (refInfo) {
                    HFJ.setNum(node, 'cx', refInfo.cx, 'float');
                    HFJ.setNum(node, 'cy', refInfo.cy, 'float');
                    setJoints(node, refInfo.joints);
                }

                // 注册进该集合
                var fileName = 'LimbPic_' + N + '.json';
                var jf = new g.HFModel.JsonFile(fileName, HFJ.stringify(tree));
                jf.tree = tree;
                jf.dirty = true;
                jf.origText = '';   // 新文件：强制视为脏
                set.picFiles.set(N, jf);
                set.picByIndex.set(N, node);
                set.pngIndexByFilename.set(filename, N);

                // Limb_X.json：limbPic+null、limbPicIndex+N
                var limbFile = reg.file;
                HFJ.arrPush(HFJ.get(reg.node, 'limbPic'), HFJ.lit(null));
                var newP = HFJ.arrPush(HFJ.get(reg.node, 'limbPicIndex'), HFJ.num(N, 'float'));
                limbFile.dirty = true;

                // PNG 数据（键带集合前缀）
                var pngKey = set.qualify(N + '.png');
                App.pendingPngs.set(pngKey, file);
                App.images.put(pngKey, file);

                App.toast('已新增变体 p' + newP + '（' + set.folder + ' 图池#' + N + '）。保存时写入文件。');
                renderGallery(limbName);
                openAnchorEditor(limbName, N, refInfo);
            });
        }

        function firstUsableInfo(reg) {
            var found = null;
            var lpi = HFJ.get(reg.node, 'limbPicIndex');
            HFJ.arrEach(lpi, function (idxNode) {
                if (found || !idxNode || idxNode.t !== 'n') return;
                var info = App.char.picInfoIn(reg.set, parseFloat(idxNode.raw) | 0);
                if (info && info.pngName && !info.disabled) found = info;
            });
            return found;
        }

        function setJoints(picNode, joints) {
            var jArr = HFJ.get(picNode, 'j');
            var items = joints.map(function (pt) {
                // 键序沿用样例 {"y":…,"x":…}
                return { t: 'o', e: [['y', HFJ.num(pt.y, 'float')], ['x', HFJ.num(pt.x, 'float')]] };
            });
            if (jArr && HFJ.isHfwArray(jArr)) HFJ.rebuildHfwArray(jArr, items);
            else HFJ.set(picNode, 'j', (function () {
                var arr = HFJ.newHfwArray();
                items.forEach(function (it) { HFJ.arrPush(arr, it); });
                return arr;
            })());
            if (HFJ.has(picNode, 'Jlen')) HFJ.setNum(picNode, 'Jlen', items.length, 'float');
        }

        // ---------- 锚点/关节编辑器（模态） ----------

        function openAnchorEditor(limbName, poolIdx, ghostInfo) {
            var reg = App.char.limbByName.get(limbName);
            if (!reg) return;
            var info = App.char.picInfoIn(reg.set, poolIdx);
            if (!info || !info.pngName) { App.toast('该变体无图像'); return; }
            if (!ghostInfo) {
                ghostInfo = firstUsableInfo(reg);
                if (ghostInfo && ghostInfo.picIndex === poolIdx) {
                    ghostInfo = null; // 自己不做自己的参照
                }
            }

            var modal = document.createElement('div');
            modal.className = 'modal';
            modal.innerHTML =
                '<div class="modal-box">' +
                '<div class="modal-title">锚点/关节编辑 — ' + limbName + ' 图池#' + poolIdx +
                '　<span class="hint">拖拽圆点调整关节；j0(红)=挂接父级点，j1+(绿)=子部位挂点</span></div>' +
                '<canvas id="anchor-cv" width="560" height="420"></canvas>' +
                '<div class="modal-row">' +
                '<label>cx <input id="anc-cx" type="number" step="1"></label>' +
                '<label>cy <input id="anc-cy" type="number" step="1"></label>' +
                '<label class="chk"><input id="anc-ghost" type="checkbox" checked> 显示参照变体</label>' +
                '<span style="flex:1"></span>' +
                '<button id="anc-ok">确定</button><button id="anc-cancel">取消</button>' +
                '</div></div>';
            document.body.appendChild(modal);

            var cv = modal.querySelector('#anchor-cv');
            var ctx = cv.getContext('2d');
            var cxInput = modal.querySelector('#anc-cx');
            var cyInput = modal.querySelector('#anc-cy');
            var ghostChk = modal.querySelector('#anc-ghost');

            var state = {
                cx: info.cx, cy: info.cy,
                joints: info.joints.map(function (p) { return { x: p.x, y: p.y }; }),
                zoom: 1, ox: 0, oy: 0, dragJ: -1
            };
            cxInput.value = state.cx; cyInput.value = state.cy;
            cxInput.onchange = function () { state.cx = parseFloat(cxInput.value) || 0; draw(); };
            cyInput.onchange = function () { state.cy = parseFloat(cyInput.value) || 0; draw(); };
            ghostChk.onchange = draw;

            function layout(img) {
                var s = Math.min((cv.width - 60) / img.width, (cv.height - 60) / img.height, 4);
                state.zoom = s;
                state.ox = (cv.width - img.width * s) / 2;
                state.oy = (cv.height - img.height * s) / 2;
            }

            // 原画坐标 → 画布：pixel = art − (cx,cy)；canvas = pixel·zoom + o
            function artToCv(pt) {
                return {
                    x: (pt.x - state.cx) * state.zoom + state.ox,
                    y: (pt.y - state.cy) * state.zoom + state.oy
                };
            }
            function cvToArt(x, y) {
                return {
                    x: (x - state.ox) / state.zoom + state.cx,
                    y: (y - state.oy) / state.zoom + state.cy
                };
            }

            function draw() {
                var img = App.images.get(info.pngName);
                ctx.fillStyle = '#15171c';
                ctx.fillRect(0, 0, cv.width, cv.height);
                if (!img) { requestAnimationFrame(draw); return; }
                layout(img);
                // 参照变体叠影（原画坐标对齐：ghost 像素(0,0) 在原画 (g.cx,g.cy)）
                if (ghostInfo && ghostChk.checked) {
                    var gimg = App.images.get(ghostInfo.pngName);
                    if (gimg) {
                        ctx.globalAlpha = 0.35;
                        var gpos = artToCv({ x: ghostInfo.cx, y: ghostInfo.cy });
                        ctx.drawImage(gimg, gpos.x, gpos.y, gimg.width * state.zoom, gimg.height * state.zoom);
                        ctx.globalAlpha = 1;
                    }
                }
                ctx.imageSmoothingEnabled = false;
                ctx.drawImage(img, state.ox, state.oy, img.width * state.zoom, img.height * state.zoom);
                // 关节点
                state.joints.forEach(function (pt, k) {
                    var p = artToCv(pt);
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
                    ctx.fillStyle = k === 0 ? 'rgba(255,90,90,0.95)' : 'rgba(110,230,110,0.95)';
                    ctx.fill();
                    ctx.fillStyle = '#fff';
                    ctx.font = '10px sans-serif';
                    ctx.fillText('j' + k, p.x + 8, p.y - 6);
                });
                // 参照关节（空心）
                if (ghostInfo && ghostChk.checked) {
                    ghostInfo.joints.forEach(function (pt, k) {
                        var p = artToCv(pt);
                        ctx.beginPath();
                        ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
                        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
                        ctx.stroke();
                    });
                }
            }
            draw();

            cv.onpointerdown = function (ev) {
                var r = cv.getBoundingClientRect();
                var x = ev.clientX - r.left, y = ev.clientY - r.top;
                state.dragJ = -1;
                for (var k = 0; k < state.joints.length; k++) {
                    var p = artToCv(state.joints[k]);
                    if (Math.hypot(p.x - x, p.y - y) < 10) { state.dragJ = k; break; }
                }
                cv.setPointerCapture(ev.pointerId);
            };
            cv.onpointermove = function (ev) {
                if (state.dragJ < 0) return;
                var r = cv.getBoundingClientRect();
                var pt = cvToArt(ev.clientX - r.left, ev.clientY - r.top);
                state.joints[state.dragJ].x = Math.round(pt.x);
                state.joints[state.dragJ].y = Math.round(pt.y);
                draw();
            };
            cv.onpointerup = function () { state.dragJ = -1; };

            modal.querySelector('#anc-cancel').onclick = function () { modal.remove(); };
            modal.querySelector('#anc-ok').onclick = function () {
                var jf = reg.set.picFiles.get(poolIdx);
                var node = reg.set.picByIndex.get(poolIdx);
                if (jf && node) {
                    HFJ.setNum(node, 'cx', state.cx, 'float');
                    HFJ.setNum(node, 'cy', state.cy, 'float');
                    setJoints(node, state.joints);
                    jf.dirty = true;
                    App.invalidateFrame();
                    App.refreshAll();
                    App.toast('锚点/关节已更新（保存时写入 LimbPic_' + poolIdx + '.json）');
                }
                modal.remove();
            };
        }

        return { refresh: refresh };
    }

    g.HFPanel_textures = { init: init };
})(window);
