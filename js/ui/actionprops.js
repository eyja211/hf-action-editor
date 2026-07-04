/**
 * ui/actionprops.js — 右侧「动作」页：动作属性编辑（衔接跳转、循环等）
 */
(function (g) {
    'use strict';
    var HFJ = g.HFJ;

    var FIELDS = [
        ['name', '名称', 'str', '动作标识名（如 ATTACK1）'],
        ['selfLoop', '自循环', 'bool', '末帧后回到本动作开头'],
        ['allowTurnFace', '允许转向', 'bool', ''],
        ['type', '类型 type', 'float', '-1=无 0..3 其他为特殊'],
        ['special', 'special', 'float', '特殊行为编号'],
        ['mpBurn', '耗蓝 mpBurn', 'float', ''],
        ['frameIndex', '起始帧', 'int', '指向帧池的绝对编号（改它=整段重定位，慎改）'],
        ['nextAgi', '结束跳转·组 nextAgi', 'float', '-1=不跳转'],
        ['nextAti', '结束跳转·类别 nextAti', 'float', '0基本 1受击 2攻击 3自定义'],
        ['nextAi', '结束跳转·动作 nextAi', 'float', '目标动作在类别桶内的序号'],
        ['landAgi', '落地跳转·组 landAgi', 'float', ''],
        ['landAti', '落地跳转·类别 landAti', 'float', ''],
        ['landAi', '落地跳转·动作 landAi', 'float', ''],
        ['aix1', 'AI 参数 aix1', 'float', ''],
        ['aix2', 'aix2', 'float', ''],
        ['aix1b', 'aix1b', 'float', ''],
        ['aix2b', 'aix2b', 'float', ''],
        ['aiz1', 'aiz1', 'float', ''],
        ['aiz2', 'aiz2', 'float', '']
    ];

    function init(App) {
        var el = document.getElementById('action-props');

        function refresh() {
            el.innerHTML = '';
            if (!App.char || App.actionIndex < 0) return;
            var a = App.char.getAction(App.actionIndex);
            if (!a) return;

            var info = document.createElement('div');
            info.className = 'hint';
            info.textContent = '动作 #' + App.actionIndex;
            el.appendChild(info);

            FIELDS.forEach(function (fd) {
                var key = fd[0], label = fd[1], type = fd[2], tip = fd[3];
                var node = HFJ.get(a, key);
                if (node === undefined) return;
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
                        App.editActionField(key, HFJ.lit(chk.checked), '修改动作·' + label);
                    };
                    row.appendChild(chk);
                } else if (type === 'str') {
                    var txt = document.createElement('input');
                    txt.type = 'text';
                    txt.value = node.t === 's' ? HFJ.val(node) : '';
                    txt.onchange = function () {
                        App.editActionField(key, HFJ.str(txt.value), '修改动作·' + label);
                    };
                    row.appendChild(txt);
                } else {
                    var input = document.createElement('input');
                    input.type = 'number';
                    input.step = type === 'int' ? 1 : 0.5;
                    if (node.t === 'n') input.value = HFJ.val(node);
                    else { input.disabled = true; input.placeholder = '(空)'; }
                    input.onchange = function () {
                        var v = parseFloat(input.value);
                        if (isNaN(v)) return;
                        App.editActionField(key, HFJ.num(v, 'float'), '修改动作·' + label);
                        if (key === 'frameIndex') { App.selectAction(App.actionIndex); }
                    };
                    row.appendChild(input);
                }
                el.appendChild(row);
            });
        }

        return { refresh: refresh };
    }

    g.HFPanel_actionprops = { init: init };
})(window);
