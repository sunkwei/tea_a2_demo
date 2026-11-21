/**
 * 中药大全 · 历史验方数据（22 首）
 *
 * 合规（Q9）：
 *   · v1 只列 方名 / 出处 / 功效 / 主治 / 组成药名与君臣佐使角色
 *   · **不含剂量（克数），不含煎服法** —— 避免被当作处方使用
 *   · note 统一带「仅供研习」，并写清使用注意
 *
 * 组成里的药名能与药材库对上时，页面会自动变成可点击链接（core.buildIndex 负责匹配，
 * 支持「炙甘草 / 生甘草 / 炒白术」这类炮制前缀回退）。
 */
(function (root, factory) {
  const data = factory();
  if (typeof module === 'object' && module.exports) module.exports = data;
  if (root) root.TCM_FORMULAS = data;
})(typeof globalThis !== 'undefined' ? globalThis : null, function () {
  'use strict';

  const NOTE = '仅供研习，不作为处方依据；使用请遵医嘱。';

  return [
    {
      id: 'gui-zhi-tang', name: '桂枝汤', source: '《伤寒论》· 汉',
      composition: [
        { name: '桂枝', role: '君' }, { name: '白芍', role: '臣' },
        { name: '生姜', role: '佐' }, { name: '大枣', role: '佐' }, { name: '炙甘草', role: '使' }
      ],
      efficacy: '解肌发表，调和营卫',
      indications: '外感风寒表虚证：头痛发热、汗出恶风、鼻鸣干呕、苔白不渴。',
      relatedSymptoms: ['gan-mao', 'bi-sai-liu-ti', 'fu-tong'],
      note: NOTE + '表实无汗者不宜。'
    },
    {
      id: 'ma-huang-tang', name: '麻黄汤', source: '《伤寒论》· 汉',
      composition: [
        { name: '麻黄', role: '君' }, { name: '桂枝', role: '臣' },
        { name: '苦杏仁', role: '佐' }, { name: '炙甘草', role: '使' }
      ],
      efficacy: '发汗解表，宣肺平喘',
      indications: '外感风寒表实证：恶寒发热、无汗而喘、身疼腰痛、苔薄白。',
      relatedSymptoms: ['gan-mao', 'ke-sou', 'fa-re'],
      note: NOTE + '发汗力强，体虚自汗、高血压与心悸者慎用。'
    },
    {
      id: 'yin-qiao-san', name: '银翘散', source: '《温病条辨》· 清',
      composition: [
        { name: '金银花', role: '君' }, { name: '连翘', role: '君' },
        { name: '薄荷', role: '臣' }, { name: '荆芥穗', role: '臣' },
        { name: '牛蒡子', role: '佐' }, { name: '桔梗', role: '佐' },
        { name: '淡豆豉', role: '佐' }, { name: '淡竹叶', role: '佐' }, { name: '生甘草', role: '使' }
      ],
      efficacy: '辛凉透表，清热解毒',
      indications: '温病初起：发热、微恶风寒、头痛口渴、咳嗽咽痛、舌尖红。',
      relatedSymptoms: ['gan-mao', 'fa-re', 'yan-tong', 'bi-sai-liu-ti'],
      note: NOTE + '风寒表证（恶寒重、无汗）不宜。'
    },
    {
      id: 'sang-ju-yin', name: '桑菊饮', source: '《温病条辨》· 清',
      composition: [
        { name: '桑叶', role: '君' }, { name: '菊花', role: '君' },
        { name: '苦杏仁', role: '臣' }, { name: '连翘', role: '臣' },
        { name: '薄荷', role: '佐' }, { name: '桔梗', role: '佐' },
        { name: '芦根', role: '佐' }, { name: '生甘草', role: '使' }
      ],
      efficacy: '疏风清热，宣肺止咳',
      indications: '风温初起：咳嗽、身热不甚、口微渴、苔薄白。',
      relatedSymptoms: ['ke-sou', 'tou-tong', 'shi-wu-mo-hu'],
      note: NOTE + '风寒咳嗽不适用。'
    },
    {
      id: 'zhi-sou-san', name: '止嗽散', source: '《医学心悟》· 清',
      composition: [
        { name: '桔梗', role: '君' }, { name: '紫菀', role: '君' },
        { name: '百部', role: '臣' }, { name: '白前', role: '臣' },
        { name: '陈皮', role: '佐' }, { name: '荆芥', role: '佐' }, { name: '甘草', role: '使' }
      ],
      efficacy: '宣利肺气，疏风止咳',
      indications: '风邪犯肺：咳嗽咽痒、咯痰不爽，或微有恶风发热。',
      relatedSymptoms: ['ke-sou', 'ke-sou-tan-duo'],
      note: NOTE + '阴虚劳嗽、痰中带血者不宜。'
    },
    {
      id: 'xiao-chai-hu-tang', name: '小柴胡汤', source: '《伤寒论》· 汉',
      composition: [
        { name: '柴胡', role: '君' }, { name: '黄芩', role: '臣' },
        { name: '半夏', role: '佐' }, { name: '人参', role: '佐' },
        { name: '生姜', role: '佐' }, { name: '大枣', role: '佐' }, { name: '炙甘草', role: '使' }
      ],
      efficacy: '和解少阳',
      indications: '伤寒少阳证：往来寒热、胸胁苦满、不欲饮食、心烦喜呕、口苦咽干目眩。',
      relatedSymptoms: ['fa-re', 'ou-tu', 'wei-zhang'],
      note: NOTE + '阴虚血少者不宜久用。'
    },
    {
      id: 'huo-xiang-zheng-qi-san', name: '藿香正气散', source: '《太平惠民和剂局方》· 宋',
      composition: [
        { name: '藿香', role: '君' }, { name: '紫苏叶', role: '臣' }, { name: '白芷', role: '臣' },
        { name: '半夏', role: '佐' }, { name: '陈皮', role: '佐' }, { name: '白术', role: '佐' },
        { name: '茯苓', role: '佐' }, { name: '厚朴', role: '佐' }, { name: '桔梗', role: '佐' },
        { name: '大腹皮', role: '佐' }, { name: '甘草', role: '使' }
      ],
      efficacy: '解表化湿，理气和中',
      indications: '外感风寒、内伤湿滞：头痛昏重、胸膈痞闷、脘腹胀痛、呕吐泄泻。',
      relatedSymptoms: ['gan-mao', 'ou-tu', 'fu-xie', 'wei-zhang'],
      note: NOTE + '湿热霍乱、阴虚火旺者不宜。'
    },
    {
      id: 'ping-wei-san', name: '平胃散', source: '《简要济众方》· 宋',
      composition: [
        { name: '苍术', role: '君' }, { name: '厚朴', role: '臣' },
        { name: '陈皮', role: '佐' }, { name: '甘草', role: '使' },
        { name: '生姜', role: '佐' }, { name: '大枣', role: '佐' }
      ],
      efficacy: '燥湿运脾，行气和胃',
      indications: '湿滞脾胃：脘腹胀满、不思饮食、口淡无味、恶心呕吐、肢体沉重。',
      relatedSymptoms: ['wei-zhang', 'shi-yu-bu-zhen', 'fu-xie'],
      note: NOTE + '脾胃虚弱、阴虚津亏者慎用。'
    },
    {
      id: 'er-chen-tang', name: '二陈汤', source: '《太平惠民和剂局方》· 宋',
      composition: [
        { name: '半夏', role: '君' }, { name: '陈皮', role: '臣' },
        { name: '茯苓', role: '佐' }, { name: '炙甘草', role: '使' },
        { name: '生姜', role: '佐' }, { name: '乌梅', role: '佐' }
      ],
      efficacy: '燥湿化痰，理气和中',
      indications: '痰湿咳嗽：咳嗽痰多色白易咯、胸膈痞闷、恶心呕吐、肢体困重。',
      relatedSymptoms: ['ke-sou-tan-duo', 'ke-sou', 'ou-tu'],
      note: NOTE + '燥痰、阴虚咳嗽者不宜。'
    },
    {
      id: 'si-jun-zi-tang', name: '四君子汤', source: '《太平惠民和剂局方》· 宋',
      composition: [
        { name: '人参', role: '君' }, { name: '白术', role: '臣' },
        { name: '茯苓', role: '佐' }, { name: '炙甘草', role: '使' }
      ],
      efficacy: '益气健脾',
      indications: '脾胃气虚：面色苍白、语音低微、气短乏力、食少便溏。',
      relatedSymptoms: ['fa-li-qi-duan', 'shi-yu-bu-zhen', 'mian-se-cang-bai', 'fu-xie'],
      note: NOTE + '湿热内盛、阴虚火旺者不宜。'
    },
    {
      id: 'bu-zhong-yi-qi-tang', name: '补中益气汤', source: '《脾胃论》· 金',
      composition: [
        { name: '黄芪', role: '君' }, { name: '人参', role: '臣' }, { name: '白术', role: '臣' },
        { name: '炙甘草', role: '佐' }, { name: '当归', role: '佐' }, { name: '陈皮', role: '佐' },
        { name: '升麻', role: '佐' }, { name: '柴胡', role: '佐' }
      ],
      efficacy: '补中益气，升阳举陷',
      indications: '脾胃气虚、中气下陷：体倦乏力、食少腹胀、久泻脱肛、脏器下垂。',
      relatedSymptoms: ['fa-li-qi-duan', 'shi-yu-bu-zhen', 'shui-zhong'],
      note: NOTE + '阴虚发热、实证发热者不宜。'
    },
    {
      id: 'si-wu-tang', name: '四物汤', source: '《太平惠民和剂局方》· 宋',
      composition: [
        { name: '熟地黄', role: '君' }, { name: '当归', role: '臣' },
        { name: '白芍', role: '臣' }, { name: '川芎', role: '使' }
      ],
      efficacy: '补血调血',
      indications: '营血虚滞：面色萎黄、唇甲无华、头晕目眩、心悸失眠、月经不调、脐腹作痛。',
      relatedSymptoms: ['mian-se-cang-bai', 'yue-jing-bu-tiao', 'tong-jing', 'pi-fu-sao-yang'],
      note: NOTE + '湿盛中满、大便溏泄者慎用。'
    },
    {
      id: 'gui-pi-tang', name: '归脾汤', source: '《济生方》· 宋',
      composition: [
        { name: '黄芪', role: '君' }, { name: '人参', role: '臣' }, { name: '白术', role: '臣' },
        { name: '当归', role: '臣' }, { name: '龙眼肉', role: '臣' },
        { name: '茯神', role: '佐' }, { name: '远志', role: '佐' }, { name: '酸枣仁', role: '佐' },
        { name: '木香', role: '佐' }, { name: '炙甘草', role: '使' },
        { name: '生姜', role: '佐' }, { name: '大枣', role: '佐' }
      ],
      efficacy: '益气补血，健脾养心',
      indications: '心脾两虚：心悸怔忡、健忘失眠、体倦食少、面色萎黄、崩漏便血。',
      relatedSymptoms: ['shi-mian', 'jian-wang', 'fa-li-qi-duan', 'mian-se-cang-bai', 'ai-er-ci-hai-mo-bing'],
      note: NOTE + '阴虚火旺、痰热内扰者不宜。'
    },
    {
      id: 'xiao-yao-san', name: '逍遥散', source: '《太平惠民和剂局方》· 宋',
      composition: [
        { name: '柴胡', role: '君' }, { name: '当归', role: '臣' }, { name: '白芍', role: '臣' },
        { name: '白术', role: '佐' }, { name: '茯苓', role: '佐' }, { name: '炙甘草', role: '使' },
        { name: '薄荷', role: '佐' }, { name: '生姜', role: '佐' }
      ],
      efficacy: '疏肝解郁，养血健脾',
      indications: '肝郁血虚脾弱：两胁作痛、头痛目眩、口燥咽干、神疲食少、月经不调、乳房胀痛。',
      relatedSymptoms: ['yue-jing-bu-tiao', 'wei-zhang', 'shi-mian', 'tou-tong'],
      note: NOTE + '阴虚阳亢者不宜。'
    },
    {
      id: 'chai-hu-shu-gan-san', name: '柴胡疏肝散', source: '《证治准绳》· 明',
      composition: [
        { name: '柴胡', role: '君' }, { name: '香附', role: '臣' }, { name: '川芎', role: '臣' },
        { name: '陈皮', role: '佐' }, { name: '枳壳', role: '佐' }, { name: '白芍', role: '佐' },
        { name: '炙甘草', role: '使' }
      ],
      efficacy: '疏肝理气，活血止痛',
      indications: '肝气郁滞：胁肋疼痛、胸闷善太息、情志抑郁易怒、脘腹胀满、月经不调。',
      relatedSymptoms: ['wei-zhang', 'fu-tong', 'tou-tong', 'tong-jing'],
      note: NOTE + '孕妇慎用；气虚者不宜久服。'
    },
    {
      id: 'yu-ping-feng-san', name: '玉屏风散', source: '《医方类聚》· 明',
      composition: [
        { name: '黄芪', role: '君' }, { name: '白术', role: '臣' }, { name: '防风', role: '使' }
      ],
      efficacy: '益气固表止汗',
      indications: '表虚自汗、易感风邪：汗出恶风、面色㿠白、舌淡苔薄白。',
      relatedSymptoms: ['gan-mao', 'fa-li-qi-duan'],
      note: NOTE + '外感发热期间不宜。'
    },
    {
      id: 'tao-he-cheng-qi-tang', name: '桃核承气汤', source: '《伤寒论》· 汉',
      composition: [
        { name: '桃仁', role: '君' }, { name: '大黄', role: '臣' },
        { name: '桂枝', role: '佐' }, { name: '芒硝', role: '佐' }, { name: '炙甘草', role: '使' }
      ],
      efficacy: '逐瘀泻热',
      indications: '下焦蓄血：少腹急结、小便自利、烦躁谵语、至夜发热；亦用于血瘀经闭、痛经。',
      relatedSymptoms: ['tong-jing', 'bian-mi', 'zhi-chuang'],
      note: NOTE + '孕妇禁用；体虚、出血倾向者慎用。'
    },
    {
      id: 'xue-fu-zhu-yu-tang', name: '血府逐瘀汤', source: '《医林改错》· 清',
      composition: [
        { name: '桃仁', role: '君' }, { name: '红花', role: '君' },
        { name: '当归', role: '臣' }, { name: '生地黄', role: '臣' },
        { name: '川芎', role: '臣' }, { name: '赤芍', role: '臣' },
        { name: '牛膝', role: '佐' }, { name: '桔梗', role: '佐' },
        { name: '柴胡', role: '佐' }, { name: '枳壳', role: '佐' }, { name: '甘草', role: '使' }
      ],
      efficacy: '活血化瘀，行气止痛',
      indications: '胸中血瘀：胸痛头痛日久、痛如针刺而有定处、舌暗红或有瘀斑。',
      relatedSymptoms: ['tou-tong', 'tong-jing'],
      note: NOTE + '孕妇禁用；无瘀血者不宜。'
    },
    {
      id: 'liu-wei-di-huang-wan', name: '六味地黄丸', source: '《小儿药证直诀》· 宋',
      composition: [
        { name: '熟地黄', role: '君' }, { name: '山茱萸', role: '臣' }, { name: '山药', role: '臣' },
        { name: '泽泻', role: '佐' }, { name: '牡丹皮', role: '佐' }, { name: '茯苓', role: '佐' }
      ],
      efficacy: '滋补肝肾',
      indications: '肝肾阴虚：腰膝酸软、头晕耳鸣、盗汗遗精、消渴、手足心热。',
      relatedSymptoms: ['chao-re-dao-han', 'tou-yun', 'er-ming-ting-li-xia-jiang', 'shi-wu-mo-hu', 'tang-niao-bing', 'gao-xue-ya', 'gu-zhi-shu-song'],
      note: NOTE + '脾虚便溏、痰湿内盛者慎用。'
    },
    {
      id: 'shen-qi-wan', name: '肾气丸', source: '《金匮要略》· 汉',
      composition: [
        { name: '熟地黄', role: '君' }, { name: '山药', role: '臣' }, { name: '山茱萸', role: '臣' },
        { name: '泽泻', role: '佐' }, { name: '茯苓', role: '佐' }, { name: '牡丹皮', role: '佐' },
        { name: '桂枝', role: '佐' }, { name: '附子', role: '佐' }
      ],
      efficacy: '补肾助阳，化气行水',
      indications: '肾阳不足：腰痛脚软、身半以下常有冷感、少腹拘急、小便不利或反多、水肿。',
      relatedSymptoms: ['shui-zhong', 'ye-niao-pin-duo', 'qian-lie-xian-zeng-sheng', 'gu-zhi-shu-song'],
      note: NOTE + '阴虚火旺、咽干口燥者不宜。'
    },
    {
      id: 'zuo-jin-wan', name: '左金丸', source: '《丹溪心法》· 元',
      composition: [
        { name: '黄连', role: '君' }, { name: '吴茱萸', role: '佐' }
      ],
      efficacy: '清泻肝火，降逆止呕',
      indications: '肝火犯胃：胁肋胀痛、呕吐吞酸、嘈杂嗳气、口苦。',
      relatedSymptoms: ['wei-suan-guo-duo', 'ou-tu'],
      note: NOTE + '脾胃虚寒者不宜；吴茱萸为小毒之品，不可久服过量。'
    },
    {
      id: 'tian-ma-gou-teng-yin', name: '天麻钩藤饮', source: '《中医内科杂病证治新义》· 近代',
      composition: [
        { name: '天麻', role: '君' }, { name: '钩藤', role: '君' },
        { name: '石决明', role: '臣' }, { name: '栀子', role: '臣' }, { name: '黄芩', role: '臣' },
        { name: '杜仲', role: '佐' }, { name: '桑寄生', role: '佐' }, { name: '益母草', role: '佐' },
        { name: '首乌藤', role: '佐' }, { name: '茯苓', role: '佐' }, { name: '川牛膝', role: '佐' }
      ],
      efficacy: '平肝息风，清热活血，补益肝肾',
      indications: '肝阳偏亢、肝风上扰：头痛眩晕、失眠多梦；高血压属肝阳上亢者的辅助调理。',
      relatedSymptoms: ['gao-xue-ya', 'tou-tong', 'tou-yun', 'shi-mian', 'pa-jin-sen-bing'],
      note: NOTE + '不能替代降压药；低血压、孕妇慎用。'
    }
  ];
});
