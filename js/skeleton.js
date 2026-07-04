/**
 * skeleton.js — 从游戏代码转录的骨骼静态表（权威来源：HFE Scripts）
 *
 * 转录自：
 *   Spt.as InitStaticData (427-927)：limbLinkage / defaultLimbOrder / defaultLimbPic
 *   Spt.as SetRelatedLimbPosesToTheSameScale...(1700-1716)：主从槽位联动表
 *   Spt.as CalculatePoses (2049-2172)：根槽位、footY 参考关节
 *   Limb.as LimbIsUpperBody (25-122) / TypeIDToTypeName (124-228) / NumType (230-241)
 *
 * 正确性由矩阵回归测试保证（decompose→recompose 对比原 lmat，见 test/matrix.js）。
 */
(function (g) {
    'use strict';

    // Spt 类型常量（Spt.as 224-232）
    var SPT_TYPE = { HUMAN: 1, OBJBG: 2, EFFECT: 101, ITEM: 201, HORSE: 401 };

    // 每种类型的部位槽数量（Limb.NumType）
    function numSlots(sptType) {
        if (sptType === SPT_TYPE.HUMAN) return 45;
        if (sptType === SPT_TYPE.HORSE) return 29;
        return 1;
    }

    // 骨骼连接表：[0] 为根（toLimb 挂在 (x0,y0)），其余按父→子顺序
    // {fromLimb, fromJ, toLimb, toJ}：子部位 toLimb 的关节 toJ 挂到父部位 fromLimb 的关节 fromJ
    var LINK_HUMAN = [
        { fromLimb: 1, fromJ: 0, toLimb: 1, toJ: 0 },   // 根：胸
        { fromLimb: 1, fromJ: 1, toLimb: 0, toJ: 0 },   // 头
        { fromLimb: 1, fromJ: 4, toLimb: 28, toJ: 0 },  // 披风
        { fromLimb: 1, fromJ: 4, toLimb: 27, toJ: 0 },  // 披风2
        { fromLimb: 0, fromJ: 1, toLimb: 30, toJ: 0 },  // 发辫
        { fromLimb: 0, fromJ: 0, toLimb: 31, toJ: 0 },  // 前发
        { fromLimb: 0, fromJ: 2, toLimb: 32, toJ: 0 },  // 头盔
        { fromLimb: 1, fromJ: 2, toLimb: 4, toJ: 0 },   // 左肩
        { fromLimb: 1, fromJ: 2, toLimb: 5, toJ: 0 },   // 左上臂
        { fromLimb: 5, fromJ: 1, toLimb: 6, toJ: 0 },   // 左前臂
        { fromLimb: 6, fromJ: 1, toLimb: 7, toJ: 0 },   // 左拳
        { fromLimb: 6, fromJ: 1, toLimb: 8, toJ: 0 },   // 左拳覆盖
        { fromLimb: 7, fromJ: 1, toLimb: 20, toJ: 0 },  // 左武器1
        { fromLimb: 20, fromJ: 1, toLimb: 21, toJ: 0 }, // 左武器2
        { fromLimb: 7, fromJ: 1, toLimb: 41, toJ: 0 },  // 左武器1覆盖
        { fromLimb: 1, fromJ: 0, toLimb: 22, toJ: 0 },  // 冰火1
        { fromLimb: 1, fromJ: 0, toLimb: 23, toJ: 0 },  // 衣领
        { fromLimb: 1, fromJ: 3, toLimb: 9, toJ: 0 },   // 右肩
        { fromLimb: 1, fromJ: 3, toLimb: 10, toJ: 0 },  // 右上臂
        { fromLimb: 10, fromJ: 1, toLimb: 11, toJ: 0 }, // 右前臂
        { fromLimb: 11, fromJ: 1, toLimb: 12, toJ: 0 }, // 右拳
        { fromLimb: 11, fromJ: 1, toLimb: 13, toJ: 0 }, // 右拳覆盖
        { fromLimb: 12, fromJ: 1, toLimb: 24, toJ: 0 }, // 右武器1
        { fromLimb: 24, fromJ: 1, toLimb: 25, toJ: 0 }, // 右武器2
        { fromLimb: 12, fromJ: 1, toLimb: 42, toJ: 0 }, // 右武器1覆盖
        { fromLimb: 1, fromJ: 0, toLimb: 26, toJ: 0 },  // 冰火2
        { fromLimb: 1, fromJ: 0, toLimb: 29, toJ: 0 },  // 裙摆
        { fromLimb: 1, fromJ: 0, toLimb: 3, toJ: 0 },   // 髋
        { fromLimb: 3, fromJ: 1, toLimb: 14, toJ: 0 },  // 左大腿
        { fromLimb: 14, fromJ: 1, toLimb: 15, toJ: 0 }, // 左小腿
        { fromLimb: 15, fromJ: 1, toLimb: 16, toJ: 0 }, // 左脚
        { fromLimb: 3, fromJ: 2, toLimb: 17, toJ: 0 },  // 右大腿
        { fromLimb: 17, fromJ: 1, toLimb: 18, toJ: 0 }, // 右小腿
        { fromLimb: 18, fromJ: 1, toLimb: 19, toJ: 0 }, // 右脚
        { fromLimb: 1, fromJ: 0, toLimb: 33, toJ: 0 },  // 护胸
        { fromLimb: 3, fromJ: 0, toLimb: 34, toJ: 0 },  // 护髋
        { fromLimb: 6, fromJ: 0, toLimb: 35, toJ: 0 },  // 左护腕
        { fromLimb: 11, fromJ: 0, toLimb: 36, toJ: 0 }, // 右护腕
        { fromLimb: 15, fromJ: 0, toLimb: 37, toJ: 0 }, // 左护腿
        { fromLimb: 18, fromJ: 0, toLimb: 38, toJ: 0 }, // 右护腿
        { fromLimb: 16, fromJ: 0, toLimb: 39, toJ: 0 }, // 左鞋
        { fromLimb: 19, fromJ: 0, toLimb: 40, toJ: 0 }, // 右鞋
        { fromLimb: 1, fromJ: 0, toLimb: 43, toJ: 0 },  // 武器特效1
        { fromLimb: 1, fromJ: 0, toLimb: 44, toJ: 0 }   // 武器特效2
    ];

    var LINK_HORSE = [
        { fromLimb: 1, fromJ: 0, toLimb: 1, toJ: 0 },
        { fromLimb: 1, fromJ: 1, toLimb: 0, toJ: 0 },
        { fromLimb: 0, fromJ: 1, toLimb: 9, toJ: 0 },
        { fromLimb: 1, fromJ: 2, toLimb: 5, toJ: 0 },
        { fromLimb: 1, fromJ: 3, toLimb: 10, toJ: 0 },
        { fromLimb: 1, fromJ: 4, toLimb: 14, toJ: 0 },
        { fromLimb: 1, fromJ: 5, toLimb: 17, toJ: 0 },
        { fromLimb: 1, fromJ: 6, toLimb: 28, toJ: 0 },
        { fromLimb: 5, fromJ: 1, toLimb: 6, toJ: 0 },
        { fromLimb: 6, fromJ: 1, toLimb: 7, toJ: 0 },
        { fromLimb: 10, fromJ: 1, toLimb: 11, toJ: 0 },
        { fromLimb: 11, fromJ: 1, toLimb: 12, toJ: 0 },
        { fromLimb: 14, fromJ: 1, toLimb: 15, toJ: 0 },
        { fromLimb: 15, fromJ: 1, toLimb: 16, toJ: 0 },
        { fromLimb: 17, fromJ: 1, toLimb: 18, toJ: 0 },
        { fromLimb: 18, fromJ: 1, toLimb: 19, toJ: 0 }
    ];

    var LINK_SINGLE = [{ fromLimb: 0, fromJ: 0, toLimb: 0, toJ: 0 }];

    function linkage(sptType) {
        if (sptType === SPT_TYPE.HUMAN) return LINK_HUMAN;
        if (sptType === SPT_TYPE.HORSE) return LINK_HORSE;
        return LINK_SINGLE; // ITEM / EFFECT / 其他
    }

    // 默认绘制顺序（先画=底层）
    var ORDER_HUMAN = [30, 28, 29, 27, 12, 10, 11, 36, 24, 13, 42, 25, 26, 3, 34,
        17, 19, 40, 18, 38, 14, 16, 39, 15, 37, 2, 1, 33, 9, 0,
        23, 32, 31, 5, 4, 7, 6, 35, 20, 8, 41, 21, 22, 43, 44];
    var ORDER_HORSE = [28, 18, 17, 19, 11, 10, 12, 15, 16, 6, 7, 1, 14, 5, 0, 9];

    function defaultOrder(sptType) {
        if (sptType === SPT_TYPE.HUMAN) return ORDER_HUMAN;
        if (sptType === SPT_TYPE.HORSE) return ORDER_HORSE;
        return [0];
    }

    // 新建帧时各槽位默认造型序号（-1 = 无）
    var DEFPIC_HUMAN = [1, 4, 4, 4, 0, 4, 4, 5, 5, 1, 0, 0, 7, 7, 2, 2, 2, 2, 2, 5,
        0, 0, -1, 0, 0, 0, -1, 0, 0, 0, 1, 2, 2, 4, 0, 4, 0, 0, 0, 2, 5, 0, 0, -1, -1];

    function defaultPic(sptType) {
        if (sptType === SPT_TYPE.HUMAN) return DEFPIC_HUMAN;
        if (sptType === SPT_TYPE.HORSE) {
            var a = []; for (var i = 0; i <= 28; i++) a.push(0); return a;
        }
        return [0];
    }

    // 新建帧时默认旋转 75° 的槽位（武器）：Spt.as 1990-1993
    var DEFAULT_ROT75 = [20, 24, 41, 42];

    // 上半身槽位（ULseparate 帧用；Limb.as LimbIsUpperBody）
    var UPPER_SET = {};
    [0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 20, 21, 22, 23, 24, 25, 26, 27, 28,
        30, 31, 32, 33, 35, 36, 41, 42, 43, 44].forEach(function (i) { UPPER_SET[i] = true; });
    function isUpperBody(slot) { return UPPER_SET[slot] === true; }

    // 主从联动表（Spt.as 1700-1716）：编辑主槽位后从槽位自动同步
    // mode 'pic'：复制 xScale/yScale/rotation/limbPicIndex/blur/dp
    // mode 'dxy'：复制 xScale/yScale/rotation/blur/dp（不复制 limbPicIndex）
    // zeroDp：同步后 dpx/dpy 强制为 0
    var SLAVE_SYNC = [
        { slave: 26, master: 22, mode: 'dxy' },
        { slave: 8, master: 7, mode: 'pic' },
        { slave: 13, master: 12, mode: 'pic' },
        { slave: 31, master: 0, mode: 'pic' },
        { slave: 33, master: 1, mode: 'pic' },
        { slave: 23, master: 1, mode: 'pic', zeroDp: true },
        { slave: 35, master: 6, mode: 'pic' },
        { slave: 36, master: 11, mode: 'pic' },
        { slave: 37, master: 15, mode: 'dxy', zeroDp: true },
        { slave: 38, master: 18, mode: 'dxy', zeroDp: true },
        { slave: 39, master: 16, mode: 'pic' },
        { slave: 40, master: 19, mode: 'pic' },
        { slave: 41, master: 20, mode: 'pic' },
        { slave: 42, master: 24, mode: 'pic' }
    ];
    var SLAVE_OF = {};   // slave → 联动项
    SLAVE_SYNC.forEach(function (s) { SLAVE_OF[s.slave] = s; });
    var MASTERS = {};    // master → [联动项...]
    SLAVE_SYNC.forEach(function (s) { (MASTERS[s.master] = MASTERS[s.master] || []).push(s); });

    // 槽位中文名（对照 Limb.as TypeIDToTypeName 英文名翻译）
    var NAME_CN_HUMAN = [
        '头', '胸', '腹(保留)', '髋', '左肩', '左上臂', '左前臂', '左拳', '左拳覆盖',
        '右肩', '右上臂', '右前臂', '右拳', '右拳覆盖',
        '左大腿', '左小腿', '左脚', '右大腿', '右小腿', '右脚',
        '左武器1', '左武器2', '冰火1', '衣领', '右武器1', '右武器2', '冰火2',
        '披风2', '披风', '裙摆', '发辫', '前发', '头盔', '护胸', '护髋',
        '左护腕', '右护腕', '左护腿', '右护腿', '左鞋', '右鞋',
        '左武器1覆盖', '右武器1覆盖', '武器特效1', '武器特效2'
    ];

    function slotName(slot, sptType) {
        if ((sptType === undefined || sptType === SPT_TYPE.HUMAN) && NAME_CN_HUMAN[slot]) {
            return String(slot).padStart(2, '0') + ' ' + NAME_CN_HUMAN[slot];
        }
        return String(slot).padStart(2, '0');
    }

    // footY 参考关节（CalculatePoses 2120-2152，非 footA 模式取这些关节 y 的最大值，初值 0）
    // HUMAN：胸.j[1]、胸.j[0]、髋.j[3]、左脚16.j[1]、右脚19.j[1]；HORSE 另加 7.j[1]、12.j[1]
    function footRefJoints(sptType) {
        if (sptType === SPT_TYPE.HORSE) {
            return [[1, 1], [1, 0], [3, 3], [16, 1], [19, 1], [7, 1], [12, 1]];
        }
        return [[1, 1], [1, 0], [3, 3], [16, 1], [19, 1]];
    }

    /** 每个槽位的子槽位表（FK 编辑用）：slot → [{child, fromJ, toJ}] */
    function childrenMap(sptType) {
        var map = {};
        var lk = linkage(sptType);
        for (var i = 1; i < lk.length; i++) {
            var e = lk[i];
            (map[e.fromLimb] = map[e.fromLimb] || []).push({
                child: e.toLimb, fromJ: e.fromJ, toJ: e.toJ
            });
        }
        return map;
    }

    /** 槽位 → 其挂接信息 {parent, fromJ, toJ}（根槽位 parent=-1） */
    function attachMap(sptType) {
        var map = {};
        var lk = linkage(sptType);
        map[lk[0].toLimb] = { parent: -1, fromJ: lk[0].fromJ, toJ: lk[0].toJ };
        for (var i = 1; i < lk.length; i++) {
            var e = lk[i];
            map[e.toLimb] = { parent: e.fromLimb, fromJ: e.fromJ, toJ: e.toJ };
        }
        return map;
    }

    g.HFSkel = {
        SPT_TYPE: SPT_TYPE,
        numSlots: numSlots,
        linkage: linkage,
        defaultOrder: defaultOrder,
        defaultPic: defaultPic,
        DEFAULT_ROT75: DEFAULT_ROT75,
        isUpperBody: isUpperBody,
        SLAVE_SYNC: SLAVE_SYNC,
        SLAVE_OF: SLAVE_OF,
        MASTERS: MASTERS,
        slotName: slotName,
        footRefJoints: footRefJoints,
        childrenMap: childrenMap,
        attachMap: attachMap,
        rootSlot: function (sptType) { return linkage(sptType)[0].toLimb; },
        rootJoint: function (sptType) { return linkage(sptType)[0].toJ; },
        // 舞台常量（C.as）
        STAGE_W: 1000, STAGE_H: 800, ROOT_X: 500, ROOT_Y: 400
    };
})(typeof window !== 'undefined' ? window : globalThis);
