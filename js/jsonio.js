/**
 * jsonio.js — HFWorkshop JSON 的保序、保格式解析/序列化器
 *
 * HFWorkshop 导出的 JSON 特征（已实测确认）：
 *  - 4 空格缩进，LF 换行，文件末尾无换行符
 *  - "数组"通常序列化为对象：{"HFW_ArrayLenXXX": N, "0": ..., "1": ...}
 *    但也存在极少量真 JSON 数组（如某帧 "vx": [127, 255, ...]）
 *  - 数字为 Python repr 风格：浮点带 .0（3.0 / -0.0），小数使用最短往返表示，
 *    极小值用小写 e 指数（2.755364296100349e-17）；HFW_ArrayLenXXX 与真数组内为纯整数
 *  - 字符串无转义序列（无反斜杠出现）
 *
 * 原生 JSON.parse 不可用：JS 对象会把 "0","1" 等数字键重排到最前、丢失 3.0/3 的区别。
 * 本解析器产出保序节点树，序列化可逐字节还原原文（load→save 字节一致）。
 *
 * 节点类型：
 *   对象   {t:'o', e:[[key, node], ...]}        key 为解码后的字符串
 *   真数组 {t:'a', e:[node, ...]}
 *   数字   {t:'n', raw:'3.0'}                    raw 保留原文
 *   字符串 {t:'s', raw:'"abc"'}                  raw 含引号
 *   字面量 {t:'l', raw:'true'|'false'|'null'}
 */
(function (g) {
    'use strict';

    // ---------- 解析 ----------

    function parse(text) {
        var pos = 0;
        var len = text.length;

        function error(msg) {
            var line = 1, col = 1;
            for (var i = 0; i < pos && i < len; i++) {
                if (text.charCodeAt(i) === 10) { line++; col = 1; } else { col++; }
            }
            throw new Error('JSON 解析错误 (行 ' + line + ' 列 ' + col + '): ' + msg);
        }

        function skipWs() {
            while (pos < len) {
                var c = text.charCodeAt(pos);
                if (c === 32 || c === 10 || c === 13 || c === 9) { pos++; } else { break; }
            }
        }

        function parseString() {
            // pos 指向开头的引号
            var start = pos;
            pos++; // skip "
            while (pos < len) {
                var c = text.charCodeAt(pos);
                if (c === 92) { pos += 2; continue; } // 反斜杠转义
                if (c === 34) { pos++; return text.slice(start, pos); }
                pos++;
            }
            error('字符串未闭合');
        }

        function parseNumber() {
            var start = pos;
            var c = text.charCodeAt(pos);
            if (c === 45) pos++; // -
            while (pos < len) {
                c = text.charCodeAt(pos);
                if ((c >= 48 && c <= 57) || c === 46 || c === 101 || c === 69 || c === 43 || c === 45) {
                    pos++;
                } else break;
            }
            return { t: 'n', raw: text.slice(start, pos) };
        }

        function parseValue() {
            skipWs();
            if (pos >= len) error('意外的文件结尾');
            var c = text.charCodeAt(pos);
            if (c === 123) return parseObject();   // {
            if (c === 91) return parseArray();     // [
            if (c === 34) return { t: 's', raw: parseString() }; // "
            if (c === 116) { expectLit('true'); return { t: 'l', raw: 'true' }; }
            if (c === 102) { expectLit('false'); return { t: 'l', raw: 'false' }; }
            if (c === 110) { expectLit('null'); return { t: 'l', raw: 'null' }; }
            if (c === 45 || (c >= 48 && c <= 57)) return parseNumber();
            error('意外的字符 ' + text[pos]);
        }

        function expectLit(lit) {
            if (text.substr(pos, lit.length) !== lit) error('期望 ' + lit);
            pos += lit.length;
        }

        function parseObject() {
            pos++; // {
            var entries = [];
            skipWs();
            if (text.charCodeAt(pos) === 125) { pos++; return { t: 'o', e: entries }; } // }
            for (;;) {
                skipWs();
                if (text.charCodeAt(pos) !== 34) error('期望键名引号');
                var rawKey = parseString();
                // 键无转义时直接去引号；有转义走完整解码
                var key = rawKey.indexOf('\\') === -1 ? rawKey.slice(1, -1) : JSON.parse(rawKey);
                skipWs();
                if (text.charCodeAt(pos) !== 58) error('期望冒号'); // :
                pos++;
                var val = parseValue();
                entries.push([key, val]);
                skipWs();
                var c = text.charCodeAt(pos);
                if (c === 44) { pos++; continue; } // ,
                if (c === 125) { pos++; return { t: 'o', e: entries }; } // }
                error('对象中期望 , 或 }');
            }
        }

        function parseArray() {
            pos++; // [
            var items = [];
            skipWs();
            if (text.charCodeAt(pos) === 93) { pos++; return { t: 'a', e: items }; } // ]
            for (;;) {
                items.push(parseValue());
                skipWs();
                var c = text.charCodeAt(pos);
                if (c === 44) { pos++; continue; } // ,
                if (c === 93) { pos++; return { t: 'a', e: items }; } // ]
                error('数组中期望 , 或 ]');
            }
        }

        var root = parseValue();
        skipWs();
        if (pos !== len) error('根值之后存在多余内容');
        return root;
    }

    // ---------- 序列化 ----------

    var INDENT_CACHE = [''];
    function indentStr(depth) {
        while (INDENT_CACHE.length <= depth) {
            INDENT_CACHE.push(INDENT_CACHE[INDENT_CACHE.length - 1] + '    ');
        }
        return INDENT_CACHE[depth];
    }

    function encodeKey(key) {
        // 实测数据中键无需转义；含特殊字符时走完整编码
        for (var i = 0; i < key.length; i++) {
            var c = key.charCodeAt(i);
            if (c === 34 || c === 92 || c < 32) return JSON.stringify(key);
        }
        return '"' + key + '"';
    }

    function stringify(node) {
        var out = [];
        writeNode(node, 0, out);
        return out.join('');
    }

    function writeNode(node, depth, out) {
        switch (node.t) {
            case 'n':
            case 's':
            case 'l':
                out.push(node.raw);
                return;
            case 'o': {
                var e = node.e;
                if (e.length === 0) { out.push('{}'); return; }
                out.push('{\n');
                var childIndent = indentStr(depth + 1);
                for (var i = 0; i < e.length; i++) {
                    out.push(childIndent, encodeKey(e[i][0]), ': ');
                    writeNode(e[i][1], depth + 1, out);
                    out.push(i < e.length - 1 ? ',\n' : '\n');
                }
                out.push(indentStr(depth), '}');
                return;
            }
            case 'a': {
                var items = node.e;
                if (items.length === 0) { out.push('[]'); return; }
                out.push('[\n');
                var ci = indentStr(depth + 1);
                for (var j = 0; j < items.length; j++) {
                    out.push(ci);
                    writeNode(items[j], depth + 1, out);
                    out.push(j < items.length - 1 ? ',\n' : '\n');
                }
                out.push(indentStr(depth), ']');
                return;
            }
            default:
                throw new Error('未知节点类型: ' + node.t);
        }
    }

    // ---------- 值读写辅助 ----------

    /** 节点 → JS 值（数字/字符串/布尔/null；对象与数组原样返回节点） */
    function val(node) {
        if (node == null) return undefined;
        switch (node.t) {
            case 'n': return parseFloat(node.raw);
            case 's': return node.raw.indexOf('\\') === -1
                ? node.raw.slice(1, -1) : JSON.parse(node.raw);
            case 'l': return node.raw === 'true' ? true : (node.raw === 'false' ? false : null);
            default: return node;
        }
    }

    /**
     * 数字 → HFWorkshop 风格原文。
     * style 'float'：整数值补 .0（Python repr 风格，含 -0.0）；小数用 JS 最短往返表示
     * style 'int'  ：纯整数（HFW_ArrayLenXXX、真数组内元素）
     */
    function numRaw(v, style) {
        if (typeof v !== 'number' || !isFinite(v)) throw new Error('非法数值: ' + v);
        if (style === 'int') return String(Math.round(v));
        if (Number.isInteger(v)) {
            if (Object.is(v, -0)) return '-0.0';
            // 大整数 toFixed 保持普通记法（数据中最大量级 ~16777215）
            if (Math.abs(v) < 1e15) return v.toFixed(1);
            return String(v);
        }
        return String(v);
    }

    function numNode(v, style) { return { t: 'n', raw: numRaw(v, style) }; }
    function strNode(s) {
        for (var i = 0; i < s.length; i++) {
            var c = s.charCodeAt(i);
            if (c === 34 || c === 92 || c < 32) return { t: 's', raw: JSON.stringify(s) };
        }
        return { t: 's', raw: '"' + s + '"' };
    }
    function litNode(v) { return { t: 'l', raw: v === true ? 'true' : (v === false ? 'false' : 'null') }; }

    /** 任意 JS 值 → 节点（数字默认 float 风格） */
    function toNode(v, numStyle) {
        if (v === null || v === true || v === false) return litNode(v);
        if (typeof v === 'number') return numNode(v, numStyle || 'float');
        if (typeof v === 'string') return strNode(v);
        if (v && (v.t === 'o' || v.t === 'a' || v.t === 'n' || v.t === 's' || v.t === 'l')) return v;
        throw new Error('无法转换为节点: ' + v);
    }

    // ---------- 对象操作 ----------

    function get(objNode, key) {
        if (!objNode || objNode.t !== 'o') return undefined;
        var e = objNode.e;
        for (var i = 0; i < e.length; i++) {
            if (e[i][0] === key) return e[i][1];
        }
        return undefined;
    }

    function getV(objNode, key) { return val(get(objNode, key)); }

    function has(objNode, key) { return get(objNode, key) !== undefined; }

    /** 替换已有键的值；键不存在时追加到末尾（新建对象场景应克隆模板以保键序） */
    function set(objNode, key, valueNode) {
        var e = objNode.e;
        for (var i = 0; i < e.length; i++) {
            if (e[i][0] === key) { e[i][1] = valueNode; return; }
        }
        e.push([key, valueNode]);
    }

    /** 设置数字字段；默认沿用该字段原有格式风格（原来是整数格式则保持整数格式） */
    function setNum(objNode, key, v, style) {
        if (!style) {
            var old = get(objNode, key);
            style = (old && old.t === 'n' && old.raw.indexOf('.') === -1 &&
                     old.raw.indexOf('e') === -1 && old.raw.indexOf('E') === -1)
                ? 'int' : 'float';
        }
        set(objNode, key, numNode(v, style));
    }

    function remove(objNode, key) {
        var e = objNode.e;
        for (var i = 0; i < e.length; i++) {
            if (e[i][0] === key) { e.splice(i, 1); return true; }
        }
        return false;
    }

    // ---------- HFW 数组操作 ----------
    // {"HFW_ArrayLenXXX": N, "0": ..., "1": ...}

    var LEN_KEY = 'HFW_ArrayLenXXX';

    function isHfwArray(node) {
        return !!(node && node.t === 'o' && node.e.length > 0 && has(node, LEN_KEY));
    }

    function arrLen(node) {
        var n = get(node, LEN_KEY);
        return n ? parseFloat(n.raw) | 0 : 0;
    }

    /** 取第 i 个元素节点；利用 "HFW_ArrayLenXXX 在首、其后 0..N-1 顺排" 的常见布局加速 */
    function arrGet(node, i) {
        var e = node.e;
        var key = String(i);
        var guess = i + 1; // 常见布局：e[0]=len, e[i+1]=第 i 项
        if (guess < e.length && e[guess][0] === key) return e[guess][1];
        for (var k = 0; k < e.length; k++) {
            if (e[k][0] === key) return e[k][1];
        }
        return undefined;
    }

    function arrSet(node, i, valueNode) { set(node, String(i), valueNode); }

    /** 遍历（跳过 len 键，按 0..N-1 顺序），cb(node, index)；cb 返回 false 提前终止 */
    function arrEach(node, cb) {
        var n = arrLen(node);
        for (var i = 0; i < n; i++) {
            if (cb(arrGet(node, i), i) === false) break;
        }
    }

    function arrToArray(node) {
        var out = [];
        arrEach(node, function (item) { out.push(item); });
        return out;
    }

    /** 追加元素并维护 HFW_ArrayLenXXX */
    function arrPush(node, valueNode) {
        var n = arrLen(node);
        set(node, LEN_KEY, numNode(n + 1, 'int'));
        node.e.push([String(n), valueNode]);
        return n;
    }

    /**
     * 在 index 处插入/删除元素（deleteCount 个），其后元素重编号，维护 len。
     * 重建 entries：len 键保持原位置（首位），数字键按 0..N-1 重排，其他键（不应出现）保留在尾部。
     */
    function arrSplice(node, index, deleteCount, insertNodes) {
        insertNodes = insertNodes || [];
        var items = arrToArray(node);
        Array.prototype.splice.apply(items, [index, deleteCount].concat(insertNodes));
        rebuildHfwArray(node, items);
        return items.length;
    }

    function rebuildHfwArray(node, items) {
        var extras = [];
        var e = node.e;
        for (var i = 0; i < e.length; i++) {
            var k = e[i][0];
            if (k !== LEN_KEY && !/^\d+$/.test(k)) extras.push(e[i]);
        }
        var ne = [[LEN_KEY, numNode(items.length, 'int')]];
        for (var j = 0; j < items.length; j++) ne.push([String(j), items[j]]);
        for (var x = 0; x < extras.length; x++) ne.push(extras[x]);
        node.e = ne;
    }

    /** 新建空 HFW 数组节点 */
    function newHfwArray() {
        return { t: 'o', e: [[LEN_KEY, numNode(0, 'int')]] };
    }

    // ---------- 通用 ----------

    function clone(node) {
        switch (node.t) {
            case 'n': case 's': case 'l':
                return { t: node.t, raw: node.raw };
            case 'o': {
                var e = new Array(node.e.length);
                for (var i = 0; i < node.e.length; i++) {
                    e[i] = [node.e[i][0], clone(node.e[i][1])];
                }
                return { t: 'o', e: e };
            }
            case 'a': {
                var items = new Array(node.e.length);
                for (var j = 0; j < node.e.length; j++) items[j] = clone(node.e[j]);
                return { t: 'a', e: items };
            }
        }
        throw new Error('未知节点类型: ' + node.t);
    }

    /** 类名（"HFW_classNameXXX" 字段），无则 null */
    function className(node) {
        var v = getV(node, 'HFW_classNameXXX');
        return typeof v === 'string' ? v : null;
    }

    g.HFJ = {
        parse: parse,
        stringify: stringify,
        val: val,
        numRaw: numRaw,
        num: numNode,
        str: strNode,
        lit: litNode,
        toNode: toNode,
        get: get,
        getV: getV,
        has: has,
        set: set,
        setNum: setNum,
        remove: remove,
        LEN_KEY: LEN_KEY,
        isHfwArray: isHfwArray,
        arrLen: arrLen,
        arrGet: arrGet,
        arrSet: arrSet,
        arrEach: arrEach,
        arrToArray: arrToArray,
        arrPush: arrPush,
        arrSplice: arrSplice,
        rebuildHfwArray: rebuildHfwArray,
        newHfwArray: newHfwArray,
        clone: clone,
        className: className
    };
})(typeof window !== 'undefined' ? window : globalThis);
