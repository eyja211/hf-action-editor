/**
 * ui/frameprops.js — 右侧「帧」页：帧属性/事件编辑
 */
(function (g) {
    'use strict';
    var HFJ = g.HFJ;

    // [键, 中文名, 类型, 提示]
    var BASIC_FIELDS = [
        ['duration', '停留 tick 数', 'int', '该帧显示 duration+1 个 tick（30tick/秒）'],
        ['vx', '横向速度 vx', 'float', '每 tick 位移；一处特殊数据可能为数组，此时禁编'],
        ['vy', '纵向速度 vy', 'float', ''],
        ['dx', '瞬移 dx', 'float', ''],
        ['sfx', '音效编号', 'float', ''],
        ['footY', '脚底高度 footY', 'float', '角色贴地时根点到地面的距离'],
        ['effect', '颜色特效', 'int', '0无 1-3冰 10火 20暗'],
        ['last', '动作末帧', 'bool', '本动作最后一帧标志'],
        ['onGround', '贴地', 'bool', ''],
        ['atkXMirror', '攻击框镜像', 'bool', ''],
        ['quake', '震屏', 'int', '仅 HFE 数据有此字段']
    ];
    var ADV_FIELDS = [
        ['rootDx', '根点偏移 rootDx', 'float', ''],
        ['footDy', '脚底微调 footDy', 'float', ''],
        ['footA', 'footY取全关节最低点', 'bool', ''],
        ['r', '渲染缩放 r', 'float', '改动会影响矩阵烘焙，慎改'],
        ['r1', '显示放大 r1', 'float', ''],
        ['attackMany', 'attackMany', 'float', ''],
        ['lowPicReuse', 'lowPicReuse', 'float', ''],
        ['upPicReuse', 'upPicReuse', 'float', ''],
        ['topPicReuse', 'topPicReuse', 'float', ''],
        ['botPicIndex', 'botPicIndex', 'float', ''],
        ['upPicReuseRotate', 'upPicReuseRotate', 'float', '']
    ];

    function init(App) {
        var el = document.getElementById('frame-props');

        document.getElementById('btn-footy-auto').onclick = function () {
            var fp = App.pose();
            if (!fp) return;
            var fy = fp.computeFootY();
            App.editFrameField('footY', HFJ.num(fy, 'float'), '自动重算 footY');
        };
        var autoEl = document.getElementById('toggle-autofoot');
        autoEl.classList.toggle('on', App.autoFootY);
        autoEl.onclick = function () {
            App.autoFootY = !App.autoFootY;
            autoEl.classList.toggle('on', App.autoFootY);
        };

        function refresh() {
            el.innerHTML = '';
            if (!App.char || App.frameIndex < 0) return;
            var f = App.char.getFrame(App.frameIndex);
            if (!f) return;

            var info = document.createElement('div');
            info.className = 'hint';
            var range = App.actionRange();
            var rsn = HFJ.getV(f, 'rsn');
            var refIdx = HFJ.getV(f, 'refIndex');
            var uls = HFJ.getV(f, 'ULseparate');
            info.textContent = '帧池 #' + App.frameIndex +
                (range ? '（动作内第 ' + (App.frameIndex - range.start) + ' 帧）' : '') +
                (uls ? ' · 上下半身分离' : '') +
                (rsn ? ' · 引用外部姿势 rsn=' + rsn : '') +
                (typeof refIdx === 'number' && refIdx > 0 ? ' · 复用帧 #' + refIdx + ' 的渲染' : '');
            el.appendChild(info);

            BASIC_FIELDS.forEach(function (fd) { addField(el, f, fd); });

            var det = document.createElement('details');
            var sum = document.createElement('summary');
            sum.textContent = '高级字段';
            det.appendChild(sum);
            ADV_FIELDS.forEach(function (fd) { addField(det, f, fd); });
            el.appendChild(det);
        }

        function addField(parent, f, fd) {
            var key = fd[0], label = fd[1], type = fd[2], tip = fd[3];
            var node = HFJ.get(f, key);
            if (node === undefined) return; // 版本差异字段（如 HFEX 无 quake）自动隐藏
            var row = document.createElement('label');
            row.className = 'num-row';
            row.title = tip || '';
            var span = document.createElement('span');
            span.textContent = label;
            row.appendChild(span);

            if (type === 'bool') {
                var chk = document.createElement('input');
                chk.type = 'checkbox';
                chk.checked = HFJ.val(node) === true;
                chk.onchange = function () {
                    App.editFrameField(key, HFJ.lit(chk.checked), '修改 ' + label);
                };
                row.appendChild(chk);
            } else {
                var input = document.createElement('input');
                input.type = 'number';
                input.step = type === 'int' ? 1 : 0.1;
                if (node.t === 'n') {
                    input.value = HFJ.val(node);
                } else {
                    input.disabled = true;    // 非数字（如 vx 为数组的特例）
                    input.placeholder = '(非数值)';
                }
                input.onchange = function () {
                    var v = parseFloat(input.value);
                    if (isNaN(v)) return;
                    App.editFrameField(key, HFJ.num(v, 'float'), '修改 ' + label);
                };
                row.appendChild(input);
            }
            parent.appendChild(row);
        }

        return { refresh: refresh };
    }

    g.HFPanel_frameprops = { init: init };
})(window);
