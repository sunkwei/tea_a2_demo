/**
 * 中药大全 · 药材数据（86 味）
 *
 * 说明：
 *   · 每味药含 图片 / 简介(indications) / 功效(efficacy) / 属性(性味归经、升降、分类、用法用量、炮制、毒性、禁忌、产地)
 *   · usage 为药典口径的科普摘录，统一附「遵医嘱」，不构成处方建议
 *   · 关联病症由 data-symptoms.js 单向定义并在 core.buildIndex() 里反查生成，避免两处漂移
 *   · 关联方剂由 data-formulas.js 的组成反查生成
 *   · 图片来自 Wikimedia Commons，作者与许可见 assets/herbs/sources.js
 */
(function (root, factory) {
  const data = factory();
  if (typeof module === 'object' && module.exports) module.exports = data;
  if (root) root.TCM_HERBS = data;
})(typeof globalThis !== 'undefined' ? globalThis : null, function () {
  'use strict';

  const DICT = '《中国药典》2020 年版';
  const HERBS = [
    {
      id: 'ma-huang', name: '麻黄', alias: ['龙沙', '狗骨'], pinyin: 'mahuang', initial: 'mh',
      category: '解表药', nature: '温', flavor: ['辛', '微苦'], meridians: ['肺', '膀胱'], ascending: '升浮',
      efficacy: ['发汗解表', '宣肺平喘', '利水消肿'],
      indications: '风寒表实无汗、咳嗽气喘、风水水肿；蜜炙后长于润肺止咳。',
      usage: '煎服，2–10 g；遵医嘱', processing: ['生麻黄', '蜜炙麻黄'], toxicity: '无毒',
      contraindication: ['表虚自汗、阴虚盗汗者慎用', '高血压、心悸失眠者慎用'],
      origin: '内蒙古、山西、甘肃', image: 'assets/herbs/ma-huang.jpg', source: DICT
    },
    {
      id: 'gui-zhi', name: '桂枝', alias: ['柳桂'], pinyin: 'guizhi', initial: 'gz',
      category: '解表药', nature: '温', flavor: ['辛', '甘'], meridians: ['心', '肺', '膀胱'], ascending: '升浮',
      efficacy: ['发汗解肌', '温通经脉', '助阳化气'],
      indications: '风寒感冒、寒凝血滞诸痛证、痰饮水肿、心悸奔豚。',
      usage: '煎服，3–10 g；遵医嘱', processing: ['生桂枝', '桂枝尖'], toxicity: '无毒',
      contraindication: ['温热病、阴虚火旺、血热出血者慎用', '孕妇慎用'],
      origin: '广西、广东', image: 'assets/herbs/gui-zhi.jpg', source: DICT
    },
    {
      id: 'zi-su-ye', name: '紫苏叶', alias: ['苏叶', '紫苏'], pinyin: 'zisuye', initial: 'zsy',
      category: '解表药', nature: '温', flavor: ['辛'], meridians: ['肺', '脾'], ascending: '升浮',
      efficacy: ['解表散寒', '行气和胃', '解鱼蟹毒'],
      indications: '风寒感冒、咳嗽呕恶、妊娠呕吐、鱼蟹中毒。',
      usage: '煎服，5–10 g；遵医嘱', processing: ['生紫苏叶'], toxicity: '无毒',
      contraindication: ['气虚表虚者慎用'],
      origin: '江苏、浙江', image: 'assets/herbs/zi-su-ye.jpg', source: DICT
    },
    {
      id: 'jing-jie', name: '荆芥', alias: ['假苏', '姜芥'], pinyin: 'jingjie', initial: 'jj',
      category: '解表药', nature: '微温', flavor: ['辛'], meridians: ['肺', '肝'], ascending: '升浮',
      efficacy: ['解表散风', '透疹消疮', '止血'],
      indications: '感冒头痛、麻疹不透、疮疡初起、便血崩漏（炒炭用）。',
      usage: '煎服，5–10 g；遵医嘱', processing: ['生荆芥', '荆芥穗', '荆芥炭'], toxicity: '无毒',
      contraindication: ['表虚自汗者慎用'],
      origin: '江苏、浙江', image: 'assets/herbs/jing-jie.jpg', source: DICT
    },
    {
      id: 'fang-feng', name: '防风', alias: ['关防风', '东防风'], pinyin: 'fangfeng', initial: 'ff',
      category: '解表药', nature: '微温', flavor: ['辛', '甘'], meridians: ['膀胱', '肝', '脾'], ascending: '升浮',
      efficacy: ['祛风解表', '胜湿止痛', '止痉'],
      indications: '感冒头痛、风湿痹痛、风疹瘙痒、破伤风。',
      usage: '煎服，5–10 g；遵医嘱', processing: ['生防风', '炒防风'], toxicity: '无毒',
      contraindication: ['阴虚血燥、热病动风者慎用'],
      origin: '东北、华北', image: 'assets/herbs/fang-feng.jpg', source: DICT
    },
    {
      id: 'bo-he', name: '薄荷', alias: ['银丹草'], pinyin: 'bohe', initial: 'bh',
      category: '解表药', nature: '凉', flavor: ['辛'], meridians: ['肺', '肝'], ascending: '升浮',
      efficacy: ['疏散风热', '清利头目', '利咽透疹', '疏肝行气'],
      indications: '风热感冒、头痛目赤、咽喉肿痛、麻疹不透、肝郁气滞。',
      usage: '煎服，3–6 g，后下；遵医嘱', processing: ['生薄荷', '薄荷炭'], toxicity: '无毒',
      contraindication: ['体虚多汗者慎用'],
      origin: '江苏、安徽', image: 'assets/herbs/bo-he.jpg', source: DICT
    },
    {
      id: 'chai-hu', name: '柴胡', alias: ['北柴胡', '硬柴胡'], pinyin: 'chaihu', initial: 'ch',
      category: '解表药', nature: '微寒', flavor: ['辛', '苦'], meridians: ['肝', '胆', '肺'], ascending: '升浮',
      efficacy: ['解表退热', '疏肝解郁', '升举阳气'],
      indications: '感冒发热、寒热往来、胸胁胀痛、月经不调、中气下陷。',
      usage: '煎服，3–10 g；遵医嘱', processing: ['生柴胡', '醋柴胡'], toxicity: '无毒',
      contraindication: ['真阴亏损、肝阳上亢者慎用'],
      origin: '河北、河南', image: 'assets/herbs/chai-hu.jpg', source: DICT
    },
    {
      id: 'shi-gao', name: '石膏', alias: ['生石膏'], pinyin: 'shigao', initial: 'sg',
      category: '清热药', nature: '大寒', flavor: ['辛', '甘'], meridians: ['肺', '胃'], ascending: '沉降',
      efficacy: ['清热泻火', '除烦止渴', '收湿生肌（煅用）'],
      indications: '高热烦渴、肺热喘咳、胃火牙痛、疮疡不敛（煅用）。',
      usage: '煎服，15–60 g，先煎；遵医嘱', processing: ['生石膏', '煅石膏'], toxicity: '无毒',
      contraindication: ['脾胃虚寒、阴虚内热者忌用'],
      origin: '湖北、安徽', image: 'assets/herbs/shi-gao.jpg', source: DICT
    },
    {
      id: 'zhi-mu', name: '知母', alias: ['肥知母'], pinyin: 'zhimu', initial: 'zm',
      category: '清热药', nature: '寒', flavor: ['苦', '甘'], meridians: ['肺', '胃', '肾'], ascending: '沉降',
      efficacy: ['清热泻火', '滋阴润燥'],
      indications: '外感热病高热、肺热燥咳、骨蒸潮热、内热消渴、肠燥便秘。',
      usage: '煎服，6–12 g；遵医嘱', processing: ['生知母', '盐知母'], toxicity: '无毒',
      contraindication: ['脾虚便溏者慎用'],
      origin: '河北、山西', image: 'assets/herbs/zhi-mu.jpg', source: DICT
    },
    {
      id: 'huang-qin', name: '黄芩', alias: ['枯芩', '条芩'], pinyin: 'huangqin', initial: 'hq',
      category: '清热药', nature: '寒', flavor: ['苦'], meridians: ['肺', '胆', '脾', '大肠'], ascending: '沉降',
      efficacy: ['清热燥湿', '泻火解毒', '止血安胎'],
      indications: '肺热咳嗽、湿温暑湿、黄疸、泻痢、血热吐衄、胎动不安。',
      usage: '煎服，3–10 g；遵医嘱', processing: ['生黄芩', '酒黄芩', '黄芩炭'], toxicity: '无毒',
      contraindication: ['脾胃虚寒者慎用'],
      origin: '河北、山西', image: 'assets/herbs/huang-qin.jpg', source: DICT
    },
    {
      id: 'huang-lian', name: '黄连', alias: ['川连', '味连'], pinyin: 'huanglian', initial: 'hl',
      category: '清热药', nature: '寒', flavor: ['苦'], meridians: ['心', '脾', '胃', '肝', '胆', '大肠'], ascending: '沉降',
      efficacy: ['清热燥湿', '泻火解毒'],
      indications: '湿热痞满、呕吐吞酸、泻痢、高热神昏、心火亢盛、痈肿疮毒。',
      usage: '煎服，2–5 g；遵医嘱', processing: ['生黄连', '酒黄连', '姜黄连', '萸黄连'], toxicity: '无毒',
      contraindication: ['脾胃虚寒者慎用', '苦燥伤阴，不宜久服'],
      origin: '四川、湖北', image: 'assets/herbs/huang-lian.jpg', source: DICT
    },
    {
      id: 'zhi-zi', name: '栀子', alias: ['山栀', '黄栀子'], pinyin: 'zhizi', initial: 'zz',
      category: '清热药', nature: '寒', flavor: ['苦'], meridians: ['心', '肺', '三焦'], ascending: '沉降',
      efficacy: ['泻火除烦', '清热利湿', '凉血解毒'],
      indications: '热病心烦、湿热黄疸、淋证涩痛、血热吐衄、目赤肿痛、火毒疮疡。',
      usage: '煎服，6–10 g；遵医嘱', processing: ['生栀子', '焦栀子', '栀子炭'], toxicity: '无毒',
      contraindication: ['脾虚便溏者慎用'],
      origin: '江西、湖南', image: 'assets/herbs/zhi-zi.jpg', source: DICT
    },
    {
      id: 'lian-qiao', name: '连翘', alias: ['青翘', '连壳'], pinyin: 'lianqiao', initial: 'lq',
      category: '清热药', nature: '微寒', flavor: ['苦'], meridians: ['肺', '心', '小肠'], ascending: '升浮',
      efficacy: ['清热解毒', '消肿散结', '疏散风热'],
      indications: '风热感冒、温病初起、痈肿疮毒、瘰疬痰核、热淋涩痛。',
      usage: '煎服，6–15 g；遵医嘱', processing: ['生连翘', '连翘心'], toxicity: '无毒',
      contraindication: ['脾胃虚寒者慎用'],
      origin: '山西、河南', image: 'assets/herbs/lian-qiao.jpg', source: DICT
    },
    {
      id: 'jin-yin-hua', name: '金银花', alias: ['忍冬花', '双花'], pinyin: 'jinyinhua', initial: 'jyh',
      category: '清热药', nature: '寒', flavor: ['甘'], meridians: ['肺', '心', '胃'], ascending: '升浮',
      efficacy: ['清热解毒', '疏散风热'],
      indications: '痈肿疔疮、喉痹、丹毒、风热感冒、温病发热、热毒血痢。',
      usage: '煎服，6–15 g；遵医嘱', processing: ['生金银花', '金银花炭'], toxicity: '无毒',
      contraindication: ['脾胃虚寒者慎用'],
      origin: '山东、河南', image: 'assets/herbs/jin-yin-hua.jpg', source: DICT
    },
    {
      id: 'pu-gong-ying', name: '蒲公英', alias: ['黄花地丁', '婆婆丁'], pinyin: 'pugongying', initial: 'pgy',
      category: '清热药', nature: '寒', flavor: ['苦', '甘'], meridians: ['肝', '胃'], ascending: '沉降',
      efficacy: ['清热解毒', '消肿散结', '利湿通淋'],
      indications: '疔疮肿毒、乳痈、瘰疬、目赤、咽痛、湿热黄疸、热淋涩痛。',
      usage: '煎服，10–15 g；遵医嘱', processing: ['生蒲公英'], toxicity: '无毒',
      contraindication: ['阳虚外寒、脾胃虚弱者慎用'],
      origin: '全国各地', image: 'assets/herbs/pu-gong-ying.jpg', source: DICT
    },
    {
      id: 'da-huang', name: '大黄', alias: ['川军', '锦纹'], pinyin: 'dahuang', initial: 'dh',
      category: '泻下药', nature: '寒', flavor: ['苦'], meridians: ['脾', '胃', '大肠', '肝', '心包'], ascending: '沉降',
      efficacy: ['泻下攻积', '清热泻火', '凉血解毒', '逐瘀通经', '利湿退黄'],
      indications: '实热积滞便秘、血热吐衄、目赤咽痛、痈肿疔疮、瘀血经闭、湿热黄疸。',
      usage: '煎服，3–15 g；遵医嘱', processing: ['生大黄', '酒大黄', '熟大黄', '大黄炭'], toxicity: '无毒',
      contraindication: ['孕妇、月经期、哺乳期慎用', '脾胃虚弱者慎用'],
      origin: '甘肃、青海', image: 'assets/herbs/da-huang.jpg', source: DICT
    },
    {
      id: 'fan-xie-ye', name: '番泻叶', alias: ['泻叶', '旃那叶'], pinyin: 'fanxieye', initial: 'fxy',
      category: '泻下药', nature: '寒', flavor: ['甘', '苦'], meridians: ['大肠'], ascending: '沉降',
      efficacy: ['泻热行滞', '通便', '利水'],
      indications: '热结积滞、便秘腹痛、水肿胀满。',
      usage: '煎服或泡服，2–6 g，后下；遵医嘱', processing: ['生番泻叶'], toxicity: '无毒',
      contraindication: ['孕妇、哺乳期、月经期慎用', '不宜久服'],
      origin: '印度、埃及（进口）', image: 'assets/herbs/fan-xie-ye.jpg', source: DICT
    },
    {
      id: 'huo-ma-ren', name: '火麻仁', alias: ['大麻仁', '麻子仁'], pinyin: 'huomaren', initial: 'hmr',
      category: '泻下药', nature: '平', flavor: ['甘'], meridians: ['脾', '胃', '大肠'], ascending: '沉降',
      efficacy: ['润肠通便'],
      indications: '血虚津亏、肠燥便秘。',
      usage: '煎服，10–15 g；遵医嘱', processing: ['生火麻仁', '炒火麻仁'], toxicity: '无毒',
      contraindication: ['肠滑便溏者慎用'],
      origin: '山东、河北', image: 'assets/herbs/huo-ma-ren.jpg', source: DICT
    },
    {
      id: 'du-huo', name: '独活', alias: ['川独活', '香独活'], pinyin: 'duhuo', initial: 'dh',
      category: '祛风湿药', nature: '微温', flavor: ['辛', '苦'], meridians: ['肾', '膀胱'], ascending: '升浮',
      efficacy: ['祛风除湿', '通痹止痛'],
      indications: '风寒湿痹、腰膝疼痛、少阴头痛。',
      usage: '煎服，3–10 g；遵医嘱', processing: ['生独活'], toxicity: '无毒',
      contraindication: ['阴虚血燥者慎用'],
      origin: '湖北、四川', image: 'assets/herbs/du-huo.jpg', source: DICT
    },
    {
      id: 'wei-ling-xian', name: '威灵仙', alias: ['铁脚威灵仙'], pinyin: 'weilingxian', initial: 'wlx',
      category: '祛风湿药', nature: '温', flavor: ['辛', '咸'], meridians: ['膀胱'], ascending: '升浮',
      efficacy: ['祛风湿', '通络止痛', '消骨鲠'],
      indications: '风湿痹痛、肢体麻木、筋脉拘挛、骨鲠咽喉。',
      usage: '煎服，6–10 g；遵医嘱', processing: ['生威灵仙', '酒威灵仙'], toxicity: '无毒',
      contraindication: ['气血虚弱者慎用'],
      origin: '江苏、安徽', image: 'assets/herbs/wei-ling-xian.jpg', source: DICT
    },
    {
      id: 'qin-jiao', name: '秦艽', alias: ['左秦艽', '西秦艽'], pinyin: 'qinjiao', initial: 'qj',
      category: '祛风湿药', nature: '平', flavor: ['辛', '苦'], meridians: ['胃', '肝', '胆'], ascending: '升浮',
      efficacy: ['祛风湿', '清湿热', '止痹痛', '退虚热'],
      indications: '风湿痹痛、筋脉拘挛、骨蒸潮热、湿热黄疸。',
      usage: '煎服，3–10 g；遵医嘱', processing: ['生秦艽'], toxicity: '无毒',
      contraindication: ['久痛虚羸、溲多便溏者慎用'],
      origin: '陕西、甘肃', image: 'assets/herbs/qin-jiao.jpg', source: DICT
    },
    {
      id: 'sang-ji-sheng', name: '桑寄生', alias: ['寄生', '广寄生'], pinyin: 'sangjisheng', initial: 'sjs',
      category: '祛风湿药', nature: '平', flavor: ['苦', '甘'], meridians: ['肝', '肾'], ascending: '平',
      efficacy: ['祛风湿', '补肝肾', '强筋骨', '安胎'],
      indications: '风湿痹痛、腰膝酸软、筋骨无力、崩漏经多、胎动不安。',
      usage: '煎服，9–15 g；遵医嘱', processing: ['生桑寄生'], toxicity: '无毒',
      contraindication: ['—'],
      origin: '广西、广东', image: 'assets/herbs/sang-ji-sheng.jpg', source: DICT
    },
    {
      id: 'huo-xiang', name: '藿香', alias: ['广藿香', '土藿香'], pinyin: 'huoxiang', initial: 'hx',
      category: '化湿药', nature: '微温', flavor: ['辛'], meridians: ['脾', '胃', '肺'], ascending: '升浮',
      efficacy: ['芳香化浊', '和中止呕', '发表解暑'],
      indications: '湿浊中阻、脘痞呕吐、暑湿倦怠、寒湿闭暑、胸闷。',
      usage: '煎服，3–10 g；遵医嘱', processing: ['生藿香', '藿香梗'], toxicity: '无毒',
      contraindication: ['阴虚火旺者慎用'],
      origin: '广东、海南', image: 'assets/herbs/huo-xiang.jpg', source: DICT
    },
    {
      id: 'cang-zhu', name: '苍术', alias: ['茅苍术', '北苍术'], pinyin: 'cangzhu', initial: 'cz',
      category: '化湿药', nature: '温', flavor: ['辛', '苦'], meridians: ['脾', '胃', '肝'], ascending: '升浮',
      efficacy: ['燥湿健脾', '祛风散寒', '明目'],
      indications: '湿阻中焦、脘腹胀满、风湿痹痛、风寒感冒、夜盲。',
      usage: '煎服，3–9 g；遵医嘱', processing: ['生苍术', '麸炒苍术'], toxicity: '无毒',
      contraindication: ['阴虚内热、气虚多汗者慎用'],
      origin: '江苏、湖北', image: 'assets/herbs/cang-zhu.jpg', source: DICT
    },
    {
      id: 'hou-po', name: '厚朴', alias: ['川朴', '紫油厚朴'], pinyin: 'houpo', initial: 'hp',
      category: '化湿药', nature: '温', flavor: ['苦', '辛'], meridians: ['脾', '胃', '肺', '大肠'], ascending: '升浮',
      efficacy: ['燥湿消痰', '下气除满'],
      indications: '湿滞伤中、脘痞吐泻、食积气滞、腹胀便秘、痰饮喘咳。',
      usage: '煎服，3–10 g；遵医嘱', processing: ['生厚朴', '姜厚朴'], toxicity: '无毒',
      contraindication: ['孕妇慎用', '气虚津亏者慎用'],
      origin: '四川、湖北', image: 'assets/herbs/hou-po.jpg', source: DICT
    },
    {
      id: 'sha-ren', name: '砂仁', alias: ['春砂仁', '缩砂仁'], pinyin: 'sharen', initial: 'sr',
      category: '化湿药', nature: '温', flavor: ['辛'], meridians: ['脾', '胃', '肾'], ascending: '升浮',
      efficacy: ['化湿开胃', '温脾止泻', '理气安胎'],
      indications: '湿浊中阻、脘痞不饥、脾胃虚寒吐泻、妊娠恶阻、胎动不安。',
      usage: '煎服，3–6 g，后下；遵医嘱', processing: ['生砂仁', '盐砂仁'], toxicity: '无毒',
      contraindication: ['阴虚血燥者慎用'],
      origin: '广东、广西', image: 'assets/herbs/sha-ren.jpg', source: DICT
    },
    {
      id: 'fu-ling', name: '茯苓', alias: ['云苓', '白茯苓'], pinyin: 'fuling', initial: 'fl',
      category: '利水渗湿药', nature: '平', flavor: ['甘', '淡'], meridians: ['心', '肺', '脾', '肾'], ascending: '平',
      efficacy: ['利水渗湿', '健脾', '宁心'],
      indications: '水肿尿少、痰饮眩悸、脾虚食少、便溏泄泻、心神不安、惊悸失眠。',
      usage: '煎服，10–15 g；遵医嘱', processing: ['白茯苓', '赤茯苓', '茯苓皮'], toxicity: '无毒',
      contraindication: ['虚寒精滑者慎用'],
      origin: '云南、安徽', image: 'assets/herbs/fu-ling.jpg', source: DICT
    },
    {
      id: 'yi-yi-ren', name: '薏苡仁', alias: ['苡米', '六谷米'], pinyin: 'yiyiren', initial: 'yyr',
      category: '利水渗湿药', nature: '凉', flavor: ['甘', '淡'], meridians: ['脾', '胃', '肺'], ascending: '沉降',
      efficacy: ['利水渗湿', '健脾止泻', '除湿排脓', '解毒散结'],
      indications: '水肿脚气、小便不利、脾虚泄泻、肺痈肠痈、赘疣。',
      usage: '煎服，9–30 g；遵医嘱', processing: ['生薏苡仁', '麸炒薏苡仁'], toxicity: '无毒',
      contraindication: ['孕妇慎用'],
      origin: '福建、河北', image: 'assets/herbs/yi-yi-ren.jpg', source: DICT
    },
    {
      id: 'ze-xie', name: '泽泻', alias: ['建泽泻', '福泽泻'], pinyin: 'zexie', initial: 'zx',
      category: '利水渗湿药', nature: '寒', flavor: ['甘', '淡'], meridians: ['肾', '膀胱'], ascending: '沉降',
      efficacy: ['利水渗湿', '泄热', '化浊降脂'],
      indications: '小便不利、水肿胀满、泄泻尿少、痰饮眩晕、热淋涩痛、高脂血症。',
      usage: '煎服，6–10 g；遵医嘱', processing: ['生泽泻', '盐泽泻'], toxicity: '无毒',
      contraindication: ['肾虚精滑者慎用'],
      origin: '福建、四川', image: 'assets/herbs/ze-xie.jpg', source: DICT
    },
    {
      id: 'zhu-ling', name: '猪苓', alias: ['粉猪苓'], pinyin: 'zhuling', initial: 'zl',
      category: '利水渗湿药', nature: '平', flavor: ['甘', '淡'], meridians: ['肾', '膀胱'], ascending: '沉降',
      efficacy: ['利水渗湿'],
      indications: '小便不利、水肿胀满、泄泻、淋浊、带下。',
      usage: '煎服，6–12 g；遵医嘱', processing: ['生猪苓'], toxicity: '无毒',
      contraindication: ['无水湿者慎用'],
      origin: '陕西、云南', image: 'assets/herbs/zhu-ling.jpg', source: DICT
    },
    {
      id: 'jin-qian-cao', name: '金钱草', alias: ['过路黄', '对座草'], pinyin: 'jinqiancao', initial: 'jqc',
      category: '利水渗湿药', nature: '微寒', flavor: ['甘', '咸'], meridians: ['肝', '胆', '肾', '膀胱'], ascending: '沉降',
      efficacy: ['利湿退黄', '利尿通淋', '解毒消肿'],
      indications: '湿热黄疸、胆胀胁痛、石淋、热淋、痈肿疔疮、毒蛇咬伤。',
      usage: '煎服，15–60 g；遵医嘱', processing: ['生金钱草'], toxicity: '无毒',
      contraindication: ['—'],
      origin: '四川、广西', image: 'assets/herbs/jin-qian-cao.jpg', source: DICT
    },
    {
      id: 'fu-zi', name: '附子', alias: ['附片', '黑顺片'], pinyin: 'fuzi', initial: 'fz',
      category: '温里药', nature: '大热', flavor: ['辛', '甘'], meridians: ['心', '肾', '脾'], ascending: '升浮',
      efficacy: ['回阳救逆', '补火助阳', '散寒止痛'],
      indications: '亡阳虚脱、肢冷脉微、肾阳不足、阳痿宫冷、虚寒泄泻、寒湿痹痛。',
      usage: '煎服，3–15 g，先煎 0.5–1 小时；遵医嘱', processing: ['盐附子', '黑顺片', '白附片', '炮附片'], toxicity: '有毒',
      contraindication: ['孕妇禁用', '不宜与半夏、瓜蒌、贝母、白蔹、白及同用', '须炮制并久煎，严禁生用'],
      origin: '四川、陕西', image: 'assets/herbs/fu-zi.jpg', source: DICT
    },
    {
      id: 'gan-jiang', name: '干姜', alias: ['白姜', '均姜'], pinyin: 'ganjiang', initial: 'gj',
      category: '温里药', nature: '热', flavor: ['辛'], meridians: ['脾', '胃', '肾', '心', '肺'], ascending: '升浮',
      efficacy: ['温中散寒', '回阳通脉', '温肺化饮'],
      indications: '脘腹冷痛、呕吐泄泻、肢冷脉微、寒饮喘咳。',
      usage: '煎服，3–10 g；遵医嘱', processing: ['生干姜', '炮姜'], toxicity: '无毒',
      contraindication: ['阴虚内热、血热妄行者慎用'],
      origin: '四川、贵州', image: 'assets/herbs/gan-jiang.jpg', source: DICT
    },
    {
      id: 'rou-gui', name: '肉桂', alias: ['桂皮', '玉桂'], pinyin: 'rougui', initial: 'rg',
      category: '温里药', nature: '大热', flavor: ['辛', '甘'], meridians: ['肾', '脾', '心', '肝'], ascending: '升浮',
      efficacy: ['补火助阳', '引火归元', '散寒止痛', '温通经脉'],
      indications: '阳痿宫冷、腰膝冷痛、虚阳上浮、胸腹冷痛、寒疝、痛经。',
      usage: '煎服，1–5 g；遵医嘱', processing: ['肉桂', '肉桂心'], toxicity: '无毒',
      contraindication: ['孕妇慎用', '有出血倾向者慎用', '不宜与赤石脂同用'],
      origin: '广西、广东', image: 'assets/herbs/rou-gui.jpg', source: DICT
    },
    {
      id: 'wu-zhu-yu', name: '吴茱萸', alias: ['吴萸', '茶辣'], pinyin: 'wuzhuyu', initial: 'wzy',
      category: '温里药', nature: '热', flavor: ['辛', '苦'], meridians: ['肝', '脾', '胃', '肾'], ascending: '升浮',
      efficacy: ['散寒止痛', '降逆止呕', '助阳止泻'],
      indications: '厥阴头痛、寒疝腹痛、痛经、脘腹胀痛、呕吐吞酸、五更泄泻。',
      usage: '煎服，2–5 g；遵医嘱', processing: ['生吴茱萸', '制吴茱萸'], toxicity: '小毒',
      contraindication: ['孕妇慎用', '阴虚有热者忌用', '不宜过量久服'],
      origin: '四川、贵州', image: 'assets/herbs/wu-zhu-yu.jpg', source: DICT
    },
    {
      id: 'chen-pi', name: '陈皮', alias: ['橘皮', '广陈皮'], pinyin: 'chenpi', initial: 'cp',
      category: '理气药', nature: '温', flavor: ['辛', '苦'], meridians: ['脾', '肺'], ascending: '升浮',
      efficacy: ['理气健脾', '燥湿化痰'],
      indications: '脘腹胀满、食少吐泻、咳嗽痰多。',
      usage: '煎服，3–10 g；遵医嘱', processing: ['陈皮', '炒陈皮'], toxicity: '无毒',
      contraindication: ['气虚、阴虚燥咳者慎用'],
      origin: '广东、福建', image: 'assets/herbs/chen-pi.jpg', source: DICT
    },
    {
      id: 'zhi-shi', name: '枳实', alias: ['川枳实', '江枳实'], pinyin: 'zhishi', initial: 'zs',
      category: '理气药', nature: '微寒', flavor: ['苦', '辛', '酸'], meridians: ['脾', '胃'], ascending: '沉降',
      efficacy: ['破气消积', '化痰散痞'],
      indications: '积滞内停、痞满胀痛、泻痢后重、大便不通、痰滞胸痹、脏器下垂。',
      usage: '煎服，3–10 g；遵医嘱', processing: ['生枳实', '麸炒枳实'], toxicity: '无毒',
      contraindication: ['孕妇慎用', '脾胃虚弱者慎用'],
      origin: '江西、四川', image: 'assets/herbs/zhi-shi.jpg', source: DICT
    },
    {
      id: 'mu-xiang', name: '木香', alias: ['云木香', '广木香'], pinyin: 'muxiang', initial: 'mx',
      category: '理气药', nature: '温', flavor: ['辛', '苦'], meridians: ['脾', '胃', '大肠', '三焦', '胆'], ascending: '升浮',
      efficacy: ['行气止痛', '健脾消食'],
      indications: '胸胁脘腹胀痛、泻痢后重、食积不消、不思饮食。',
      usage: '煎服，3–6 g；遵医嘱', processing: ['生木香', '煨木香'], toxicity: '无毒',
      contraindication: ['阴虚津亏者慎用'],
      origin: '云南、四川', image: 'assets/herbs/mu-xiang.jpg', source: DICT
    },
    {
      id: 'xiang-fu', name: '香附', alias: ['香附子', '莎草根'], pinyin: 'xiangfu', initial: 'xf',
      category: '理气药', nature: '平', flavor: ['辛', '微苦', '微甘'], meridians: ['肝', '脾', '三焦'], ascending: '平',
      efficacy: ['疏肝解郁', '理气宽中', '调经止痛'],
      indications: '肝郁气滞、胸胁胀痛、疝气疼痛、月经不调、痛经、乳房胀痛。',
      usage: '煎服，6–10 g；遵医嘱', processing: ['生香附', '醋香附'], toxicity: '无毒',
      contraindication: ['气虚无滞、阴虚血热者慎用'],
      origin: '山东、浙江', image: 'assets/herbs/xiang-fu.jpg', source: DICT
    },
    {
      id: 'wu-yao', name: '乌药', alias: ['台乌', '天台乌药'], pinyin: 'wuyao', initial: 'wy',
      category: '理气药', nature: '温', flavor: ['辛'], meridians: ['肺', '脾', '肾', '膀胱'], ascending: '升浮',
      efficacy: ['行气止痛', '温肾散寒'],
      indications: '寒凝气滞、胸腹胀痛、气逆喘急、膀胱虚冷、遗尿尿频、疝气痛经。',
      usage: '煎服，6–10 g；遵医嘱', processing: ['生乌药', '酒乌药'], toxicity: '无毒',
      contraindication: ['气虚、内热者慎用'],
      origin: '浙江、湖南', image: 'assets/herbs/wu-yao.jpg', source: DICT
    },
    {
      id: 'shan-zha', name: '山楂', alias: ['山里红', '红果'], pinyin: 'shanzha', initial: 'sz',
      category: '消食药', nature: '微温', flavor: ['酸', '甘'], meridians: ['脾', '胃', '肝'], ascending: '平',
      efficacy: ['消食健胃', '行气散瘀', '化浊降脂'],
      indications: '肉食积滞、胃脘胀满、泻痢腹痛、瘀血经闭、产后瘀阻、高脂血症。',
      usage: '煎服，9–12 g；遵医嘱', processing: ['生山楂', '炒山楂', '焦山楂'], toxicity: '无毒',
      contraindication: ['胃酸过多者慎用', '孕妇慎用'],
      origin: '山东、河北', image: 'assets/herbs/shan-zha.jpg', source: DICT
    },
    {
      id: 'shen-qu', name: '神曲', alias: ['六神曲', '焦神曲'], pinyin: 'shenqu', initial: 'sq',
      category: '消食药', nature: '温', flavor: ['甘', '辛'], meridians: ['脾', '胃'], ascending: '平',
      efficacy: ['消食和胃'],
      indications: '饮食积滞、脘腹胀满、食少纳呆、肠鸣腹泻。',
      usage: '煎服，6–15 g；遵医嘱', processing: ['生神曲', '炒神曲', '焦神曲'], toxicity: '无毒',
      contraindication: ['胃阴不足者慎用'],
      origin: '全国各地', image: 'assets/herbs/shen-qu.jpg', source: '《中华本草》整理'
    },
    {
      id: 'mai-ya', name: '麦芽', alias: ['大麦芽', '焦麦芽'], pinyin: 'maiya', initial: 'my',
      category: '消食药', nature: '平', flavor: ['甘'], meridians: ['脾', '胃', '肝'], ascending: '平',
      efficacy: ['行气消食', '健脾开胃', '回乳消胀'],
      indications: '食积不消、脘腹胀痛、脾虚食少、乳汁郁积、乳房胀痛、断乳。',
      usage: '煎服，10–15 g；遵医嘱', processing: ['生麦芽', '炒麦芽', '焦麦芽'], toxicity: '无毒',
      contraindication: ['哺乳期妇女慎用（回乳）'],
      origin: '全国各地', image: 'assets/herbs/mai-ya.jpg', source: DICT
    },
    {
      id: 'san-qi', name: '三七', alias: ['田七', '金不换'], pinyin: 'sanqi', initial: 'sq',
      category: '止血药', nature: '温', flavor: ['甘', '微苦'], meridians: ['肝', '胃'], ascending: '平',
      efficacy: ['散瘀止血', '消肿定痛'],
      indications: '咯血、吐血、衄血、便血、崩漏、外伤出血、胸腹刺痛、跌扑肿痛。',
      usage: '煎服或研粉吞服，3–9 g；遵医嘱', processing: ['三七粉', '熟三七'], toxicity: '无毒',
      contraindication: ['孕妇慎用'],
      origin: '云南、广西', image: 'assets/herbs/san-qi.jpg', source: DICT
    },
    {
      id: 'bai-ji', name: '白及', alias: ['白芨', '甘根'], pinyin: 'baiji', initial: 'bj',
      category: '止血药', nature: '微寒', flavor: ['苦', '甘', '涩'], meridians: ['肺', '胃', '肝'], ascending: '沉降',
      efficacy: ['收敛止血', '消肿生肌'],
      indications: '咯血吐血、外伤出血、疮疡肿毒、皮肤皲裂、肺结核咳血、溃疡病出血。',
      usage: '煎服，6–15 g；遵医嘱', processing: ['生白及', '白及粉'], toxicity: '无毒',
      contraindication: ['不宜与川乌、草乌、附子同用'],
      origin: '贵州、四川', image: 'assets/herbs/bai-ji.jpg', source: DICT
    },
    {
      id: 'di-yu', name: '地榆', alias: ['绵地榆', '黄瓜香'], pinyin: 'diyu', initial: 'dy',
      category: '止血药', nature: '微寒', flavor: ['苦', '酸', '涩'], meridians: ['肝', '大肠'], ascending: '沉降',
      efficacy: ['凉血止血', '解毒敛疮'],
      indications: '便血、痔血、血痢、崩漏、水火烫伤、痈肿疮毒。',
      usage: '煎服，9–15 g；遵医嘱', processing: ['生地榆', '地榆炭'], toxicity: '无毒',
      contraindication: ['大面积烧伤不宜外涂', '虚寒性出血慎用'],
      origin: '江苏、安徽', image: 'assets/herbs/di-yu.jpg', source: DICT
    },
    {
      id: 'chuan-xiong', name: '川芎', alias: ['芎藭', '小叶川芎'], pinyin: 'chuanxiong', initial: 'cx',
      category: '活血化瘀药', nature: '温', flavor: ['辛'], meridians: ['肝', '胆', '心包'], ascending: '升浮',
      efficacy: ['活血行气', '祛风止痛'],
      indications: '胸痹心痛、胸胁刺痛、月经不调、经闭痛经、癥瘕腹痛、头痛、风湿痹痛。',
      usage: '煎服，3–10 g；遵医嘱', processing: ['生川芎', '酒川芎'], toxicity: '无毒',
      contraindication: ['阴虚火旺、月经过多者慎用', '孕妇慎用'],
      origin: '四川、云南', image: 'assets/herbs/chuan-xiong.jpg', source: DICT
    },
    {
      id: 'hong-hua', name: '红花', alias: ['草红花', '刺红花'], pinyin: 'honghua', initial: 'hh',
      category: '活血化瘀药', nature: '温', flavor: ['辛'], meridians: ['心', '肝'], ascending: '升浮',
      efficacy: ['活血通经', '散瘀止痛'],
      indications: '经闭痛经、恶露不行、癥瘕痞块、胸痹心痛、瘀滞腹痛、跌扑损伤、疮疡肿痛。',
      usage: '煎服，3–10 g；遵医嘱', processing: ['生红花'], toxicity: '无毒',
      contraindication: ['孕妇慎用', '有出血倾向者慎用'],
      origin: '新疆、河南', image: 'assets/herbs/hong-hua.jpg', source: DICT
    },
    {
      id: 'dan-shen', name: '丹参', alias: ['赤参', '紫丹参'], pinyin: 'danshen', initial: 'ds',
      category: '活血化瘀药', nature: '微寒', flavor: ['苦'], meridians: ['心', '肝'], ascending: '沉降',
      efficacy: ['活血祛瘀', '通经止痛', '清心除烦', '凉血消痈'],
      indications: '胸痹心痛、脘腹胁痛、癥瘕积聚、热痹疼痛、心烦不眠、月经不调、疮疡肿痛。',
      usage: '煎服，10–15 g；遵医嘱', processing: ['生丹参', '酒丹参'], toxicity: '无毒',
      contraindication: ['不宜与藜芦同用', '孕妇慎用'],
      origin: '四川、山东', image: 'assets/herbs/dan-shen.jpg', source: DICT
    },
    {
      id: 'tao-ren', name: '桃仁', alias: ['毛桃仁', '扁桃仁'], pinyin: 'taoren', initial: 'tr',
      category: '活血化瘀药', nature: '平', flavor: ['苦', '甘'], meridians: ['心', '肝', '大肠'], ascending: '沉降',
      efficacy: ['活血祛瘀', '润肠通便', '止咳平喘'],
      indications: '经闭痛经、癥瘕痞块、肺痈肠痈、跌扑损伤、肠燥便秘、咳嗽气喘。',
      usage: '煎服，5–10 g；遵医嘱', processing: ['生桃仁', '燀桃仁', '炒桃仁'], toxicity: '小毒',
      contraindication: ['孕妇慎用', '便溏者慎用', '不宜过量'],
      origin: '陕西、山东', image: 'assets/herbs/tao-ren.jpg', source: DICT
    },
    {
      id: 'yi-mu-cao', name: '益母草', alias: ['茺蔚', '坤草'], pinyin: 'yimucao', initial: 'ymc',
      category: '活血化瘀药', nature: '微寒', flavor: ['苦', '辛'], meridians: ['肝', '心包', '膀胱'], ascending: '沉降',
      efficacy: ['活血调经', '利尿消肿', '清热解毒'],
      indications: '月经不调、痛经经闭、恶露不尽、水肿尿少、疮疡肿毒。',
      usage: '煎服，9–30 g；遵医嘱', processing: ['生益母草', '益母草膏'], toxicity: '无毒',
      contraindication: ['孕妇慎用', '阴虚血少者慎用'],
      origin: '全国各地', image: 'assets/herbs/yi-mu-cao.jpg', source: DICT
    },
    {
      id: 'ban-xia', name: '半夏', alias: ['三叶半夏', '麻芋果'], pinyin: 'banxia', initial: 'bx',
      category: '化痰止咳平喘药', nature: '温', flavor: ['辛'], meridians: ['脾', '胃', '肺'], ascending: '沉降',
      efficacy: ['燥湿化痰', '降逆止呕', '消痞散结'],
      indications: '湿痰寒痰、咳喘痰多、痰饮眩悸、风痰眩晕、痰厥头痛、呕吐反胃、胸脘痞闷。',
      usage: '煎服，3–9 g，须制用；遵医嘱', processing: ['法半夏', '姜半夏', '清半夏', '竹沥半夏'], toxicity: '有毒',
      contraindication: ['生品内服宜慎，须炮制', '不宜与川乌、草乌、附子同用', '孕妇慎用'],
      origin: '四川、湖北', image: 'assets/herbs/ban-xia.jpg', source: DICT
    },
    {
      id: 'chuan-bei-mu', name: '川贝母', alias: ['松贝', '青贝'], pinyin: 'chuanbeimu', initial: 'cbm',
      category: '化痰止咳平喘药', nature: '微寒', flavor: ['苦', '甘'], meridians: ['肺', '心'], ascending: '沉降',
      efficacy: ['清热润肺', '化痰止咳', '散结消痈'],
      indications: '肺热燥咳、干咳少痰、阴虚劳嗽、痰中带血、瘰疬、乳痈、肺痈。',
      usage: '煎服，3–10 g；遵医嘱', processing: ['川贝母', '川贝粉'], toxicity: '无毒',
      contraindication: ['不宜与川乌、草乌、附子同用', '脾胃虚寒者慎用'],
      origin: '四川、青海', image: 'assets/herbs/chuan-bei-mu.jpg', source: DICT
    },
    {
      id: 'jie-geng', name: '桔梗', alias: ['苦桔梗', '白桔梗'], pinyin: 'jiegeng', initial: 'jg',
      category: '化痰止咳平喘药', nature: '平', flavor: ['苦', '辛'], meridians: ['肺'], ascending: '升浮',
      efficacy: ['宣肺', '利咽', '祛痰', '排脓'],
      indications: '咳嗽痰多、胸闷不畅、咽痛音哑、肺痈吐脓。',
      usage: '煎服，3–10 g；遵医嘱', processing: ['生桔梗'], toxicity: '无毒',
      contraindication: ['阴虚久咳、咳血者慎用', '用量过大易致恶心'],
      origin: '安徽、河南', image: 'assets/herbs/jie-geng.jpg', source: DICT
    },
    {
      id: 'ku-xing-ren', name: '苦杏仁', alias: ['杏仁', '北杏仁'], pinyin: 'kuxingren', initial: 'kxr',
      category: '化痰止咳平喘药', nature: '微温', flavor: ['苦'], meridians: ['肺', '大肠'], ascending: '沉降',
      efficacy: ['降气止咳平喘', '润肠通便'],
      indications: '咳嗽气喘、胸满痰多、肠燥便秘。',
      usage: '煎服，5–10 g；遵医嘱', processing: ['燀苦杏仁', '炒苦杏仁'], toxicity: '小毒',
      contraindication: ['孕妇慎用', '不宜过量，婴幼儿慎用'],
      origin: '内蒙古、辽宁', image: 'assets/herbs/ku-xing-ren.jpg', source: DICT
    },
    {
      id: 'pi-pa-ye', name: '枇杷叶', alias: ['巴叶', '芦橘叶'], pinyin: 'pipaye', initial: 'ppy',
      category: '化痰止咳平喘药', nature: '微寒', flavor: ['苦'], meridians: ['肺', '胃'], ascending: '沉降',
      efficacy: ['清肺止咳', '降逆止呕'],
      indications: '肺热咳嗽、气逆喘急、胃热呕逆、烦热口渴。',
      usage: '煎服，6–10 g；遵医嘱', processing: ['生枇杷叶', '蜜枇杷叶'], toxicity: '无毒',
      contraindication: ['胃寒呕吐者慎用'],
      origin: '广东、江苏', image: 'assets/herbs/pi-pa-ye.jpg', source: DICT
    },
    {
      id: 'suan-zao-ren', name: '酸枣仁', alias: ['枣仁', '山枣仁'], pinyin: 'suanzaoren', initial: 'szr',
      category: '安神药', nature: '平', flavor: ['甘', '酸'], meridians: ['心', '肝', '胆'], ascending: '平',
      efficacy: ['养心补肝', '宁心安神', '敛汗生津'],
      indications: '虚烦不眠、惊悸多梦、体虚多汗、津伤口渴。',
      usage: '煎服，10–15 g；遵医嘱', processing: ['生酸枣仁', '炒酸枣仁'], toxicity: '无毒',
      contraindication: ['—'],
      origin: '河北、陕西', image: 'assets/herbs/suan-zao-ren.jpg', source: DICT
    },
    {
      id: 'bai-zi-ren', name: '柏子仁', alias: ['柏实', '侧柏仁'], pinyin: 'baiziren', initial: 'bzr',
      category: '安神药', nature: '平', flavor: ['甘'], meridians: ['心', '肾', '大肠'], ascending: '平',
      efficacy: ['养心安神', '润肠通便', '止汗'],
      indications: '阴血不足、虚烦失眠、心悸怔忡、肠燥便秘、阴虚盗汗。',
      usage: '煎服，3–10 g；遵医嘱', processing: ['生柏子仁', '柏子仁霜'], toxicity: '无毒',
      contraindication: ['便溏者慎用'],
      origin: '山东、河南', image: 'assets/herbs/bai-zi-ren.jpg', source: DICT
    },
    {
      id: 'shou-wu-teng', name: '首乌藤', alias: ['夜交藤'], pinyin: 'shouwuteng', initial: 'swt',
      category: '安神药', nature: '平', flavor: ['甘'], meridians: ['心', '肝'], ascending: '平',
      efficacy: ['养血安神', '祛风通络'],
      indications: '失眠多梦、血虚身痛、风湿痹痛、皮肤瘙痒。',
      usage: '煎服，9–15 g；遵医嘱', processing: ['生首乌藤'], toxicity: '无毒',
      contraindication: ['—'],
      origin: '湖南、湖北', image: 'assets/herbs/shou-wu-teng.jpg', source: DICT
    },
    {
      id: 'tian-ma', name: '天麻', alias: ['赤箭', '明天麻'], pinyin: 'tianma', initial: 'tm',
      category: '平肝息风药', nature: '平', flavor: ['甘'], meridians: ['肝'], ascending: '平',
      efficacy: ['息风止痉', '平抑肝阳', '祛风通络'],
      indications: '小儿惊风、癫痫抽搐、破伤风、头痛眩晕、肢体麻木、风湿痹痛。',
      usage: '煎服，3–10 g；遵医嘱', processing: ['生天麻', '天麻粉'], toxicity: '无毒',
      contraindication: ['—'],
      origin: '四川、云南', image: 'assets/herbs/tian-ma.jpg', source: DICT
    },
    {
      id: 'gou-teng', name: '钩藤', alias: ['双钩藤', '钩丁'], pinyin: 'gouteng', initial: 'gt',
      category: '平肝息风药', nature: '凉', flavor: ['甘'], meridians: ['肝', '心包'], ascending: '沉降',
      efficacy: ['息风定惊', '清热平肝'],
      indications: '肝风内动、惊痫抽搐、高热惊厥、头痛眩晕。',
      usage: '煎服，3–12 g，后下；遵医嘱', processing: ['生钩藤'], toxicity: '无毒',
      contraindication: ['—'],
      origin: '广西、江西', image: 'assets/herbs/gou-teng.jpg', source: DICT
    },
    {
      id: 'shi-jue-ming', name: '石决明', alias: ['鲍鱼壳', '九孔石决明'], pinyin: 'shijueming', initial: 'sjm',
      category: '平肝息风药', nature: '寒', flavor: ['咸'], meridians: ['肝'], ascending: '沉降',
      efficacy: ['平肝潜阳', '清肝明目', '收敛制酸（煅用）'],
      indications: '头痛眩晕、目赤翳障、视物昏花、青盲雀目；煅用治胃酸过多。',
      usage: '煎服，6–20 g，先煎；遵医嘱', processing: ['生石决明', '煅石决明'], toxicity: '无毒',
      contraindication: ['脾胃虚寒者慎用'],
      origin: '广东、福建', image: 'assets/herbs/shi-jue-ming.jpg', source: DICT
    },
    {
      id: 'di-long', name: '地龙', alias: ['蚯蚓', '广地龙'], pinyin: 'dilong', initial: 'dl',
      category: '平肝息风药', nature: '寒', flavor: ['咸'], meridians: ['肝', '脾', '膀胱'], ascending: '沉降',
      efficacy: ['清热定惊', '通络平喘', '利尿'],
      indications: '高热神昏、惊痫抽搐、关节痹痛、肢体麻木、肺热喘咳、尿少水肿。',
      usage: '煎服，5–10 g；遵医嘱', processing: ['生地龙', '酒地龙'], toxicity: '无毒',
      contraindication: ['脾胃虚寒者慎用'],
      origin: '广东、广西', image: 'assets/herbs/di-long.jpg', source: DICT
    },
    {
      id: 'shi-chang-pu', name: '石菖蒲', alias: ['九节菖蒲', '水剑草'], pinyin: 'shichangpu', initial: 'scp',
      category: '开窍药', nature: '温', flavor: ['辛', '苦'], meridians: ['心', '胃'], ascending: '升浮',
      efficacy: ['开窍豁痰', '醒神益智', '化湿开胃'],
      indications: '神昏癫痫、健忘失眠、耳鸣耳聋、脘痞不饥、噤口下痢。',
      usage: '煎服，3–10 g；遵医嘱', processing: ['生石菖蒲'], toxicity: '无毒',
      contraindication: ['阴虚阳亢、烦躁多汗者慎用'],
      origin: '四川、浙江', image: 'assets/herbs/shi-chang-pu.jpg', source: DICT
    },
    {
      id: 'sheng-jiang', name: '生姜', alias: ['鲜姜', '姜'], pinyin: 'shengjiang', initial: 'sj',
      category: '解表药', nature: '微温', flavor: ['辛'], meridians: ['肺', '脾', '胃'], ascending: '升浮',
      efficacy: ['解表散寒', '温中止呕', '化痰止咳', '解鱼蟹毒'],
      indications: '风寒感冒、胃寒呕吐、寒痰咳嗽、鱼蟹中毒。',
      usage: '煎服，3–10 g；遵医嘱', processing: ['生姜', '生姜汁', '生姜皮'], toxicity: '无毒',
      contraindication: ['阴虚内热、血热妄行者慎用'],
      origin: '四川、山东、河北', image: 'assets/herbs/sheng-jiang.jpg', source: DICT
    },
    {
      id: 'ren-shen', name: '人参', alias: ['红参', '白参', '吉林参'], pinyin: 'renshen', initial: 'rs',
      category: '补虚药', nature: '微温', flavor: ['甘', '微苦'], meridians: ['脾', '肺', '心', '肾'], ascending: '升浮',
      efficacy: ['大补元气', '复脉固脱', '补脾益肺', '生津养血', '安神益智'],
      indications: '体虚欲脱、肢冷脉微、脾虚食少、肺虚喘咳、津伤口渴、内热消渴、气血亏虚、久病虚羸、惊悸失眠。',
      usage: '煎服，3–9 g；遵医嘱', processing: ['生晒参', '红参', '糖参'], toxicity: '无毒',
      contraindication: ['不宜与藜芦、五灵脂同用', '实证、热证而正气不虚者慎用'],
      origin: '吉林、辽宁', image: 'assets/herbs/ren-shen.jpg', source: DICT
    },
    {
      id: 'dang-shen', name: '党参', alias: ['潞党参', '台党参'], pinyin: 'dangshen', initial: 'ds',
      category: '补虚药', nature: '平', flavor: ['甘'], meridians: ['脾', '肺'], ascending: '平',
      efficacy: ['健脾益肺', '养血生津'],
      indications: '脾肺气虚、食少倦怠、咳嗽虚喘、气血不足、面色萎黄、心悸气短、津伤口渴。',
      usage: '煎服，9–30 g；遵医嘱', processing: ['生党参', '米炒党参'], toxicity: '无毒',
      contraindication: ['不宜与藜芦同用', '实证、热证慎用'],
      origin: '山西、甘肃', image: 'assets/herbs/dang-shen.jpg', source: DICT
    },
    {
      id: 'huang-qi', name: '黄芪', alias: ['北芪', '绵黄芪'], pinyin: 'huangqi', initial: 'hq',
      category: '补虚药', nature: '微温', flavor: ['甘'], meridians: ['肺', '脾'], ascending: '升浮',
      efficacy: ['补气升阳', '固表止汗', '利水消肿', '生津养血', '托毒排脓'],
      indications: '气虚乏力、食少便溏、中气下陷、久泻脱肛、便血崩漏、表虚自汗、气虚水肿、痈疽难溃。',
      usage: '煎服，9–30 g；遵医嘱', processing: ['生黄芪', '蜜炙黄芪'], toxicity: '无毒',
      contraindication: ['表实邪盛、阴虚阳亢、疮疡初起者慎用'],
      origin: '内蒙古、山西', image: 'assets/herbs/huang-qi.jpg', source: DICT
    },
    {
      id: 'bai-zhu', name: '白术', alias: ['于术', '冬术'], pinyin: 'baizhu', initial: 'bz',
      category: '补虚药', nature: '温', flavor: ['苦', '甘'], meridians: ['脾', '胃'], ascending: '升浮',
      efficacy: ['健脾益气', '燥湿利水', '止汗安胎'],
      indications: '脾虚食少、腹胀泄泻、痰饮眩悸、水肿、自汗、胎动不安。',
      usage: '煎服，6–12 g；遵医嘱', processing: ['生白术', '麸炒白术', '焦白术'], toxicity: '无毒',
      contraindication: ['阴虚内热、津液亏耗者慎用'],
      origin: '浙江、湖南', image: 'assets/herbs/bai-zhu.jpg', source: DICT
    },
    {
      id: 'dang-gui', name: '当归', alias: ['秦归', '云归'], pinyin: 'danggui', initial: 'dg',
      category: '补虚药', nature: '温', flavor: ['甘', '辛'], meridians: ['肝', '心', '脾'], ascending: '升浮',
      efficacy: ['补血活血', '调经止痛', '润肠通便'],
      indications: '血虚萎黄、眩晕心悸、月经不调、经闭痛经、虚寒腹痛、风湿痹痛、跌扑损伤、肠燥便秘。',
      usage: '煎服，6–12 g；遵医嘱', processing: ['全当归', '当归头', '当归身', '当归尾', '酒当归'], toxicity: '无毒',
      contraindication: ['湿盛中满、大便溏泄者慎用'],
      origin: '甘肃、陕西', image: 'assets/herbs/dang-gui.jpg', source: DICT
    },
    {
      id: 'shu-di-huang', name: '熟地黄', alias: ['熟地', '大熟地'], pinyin: 'shudihuang', initial: 'sdh',
      category: '补虚药', nature: '微温', flavor: ['甘'], meridians: ['肝', '肾'], ascending: '沉降',
      efficacy: ['补血滋阴', '益精填髓'],
      indications: '血虚萎黄、心悸怔忡、月经不调、崩漏下血、肝肾阴虚、腰膝酸软、骨蒸潮热、盗汗遗精、眩晕耳鸣。',
      usage: '煎服，9–15 g；遵医嘱', processing: ['熟地黄', '熟地黄炭'], toxicity: '无毒',
      contraindication: ['脾虚便溏、痰湿内盛者慎用'],
      origin: '河南', image: 'assets/herbs/shu-di-huang.jpg', source: DICT
    },
    {
      id: 'gou-qi-zi', name: '枸杞子', alias: ['宁夏枸杞', '杞子'], pinyin: 'gouqizi', initial: 'gqz',
      category: '补虚药', nature: '平', flavor: ['甘'], meridians: ['肝', '肾'], ascending: '平',
      efficacy: ['滋补肝肾', '益精明目'],
      indications: '虚劳精亏、腰膝酸痛、眩晕耳鸣、阳痿遗精、内热消渴、血虚萎黄、目昏不明。',
      usage: '煎服，6–12 g；遵医嘱', processing: ['生枸杞子'], toxicity: '无毒',
      contraindication: ['外邪实热、脾虚泄泻者慎用'],
      origin: '宁夏、甘肃', image: 'assets/herbs/gou-qi-zi.jpg', source: DICT
    },
    {
      id: 'nv-zhen-zi', name: '女贞子', alias: ['女贞实', '冬青子'], pinyin: 'nvzhenzi', initial: 'nzz',
      category: '补虚药', nature: '凉', flavor: ['甘', '苦'], meridians: ['肝', '肾'], ascending: '沉降',
      efficacy: ['滋补肝肾', '明目乌发'],
      indications: '肝肾阴虚、眩晕耳鸣、腰膝酸软、须发早白、目暗不明、内热消渴。',
      usage: '煎服，6–12 g；遵医嘱', processing: ['生女贞子', '酒女贞子'], toxicity: '无毒',
      contraindication: ['脾胃虚寒泄泻者慎用'],
      origin: '浙江、江苏', image: 'assets/herbs/nv-zhen-zi.jpg', source: DICT
    },
    {
      id: 'du-zhong', name: '杜仲', alias: ['川杜仲', '绵杜仲'], pinyin: 'duzhong', initial: 'dz',
      category: '补虚药', nature: '温', flavor: ['甘'], meridians: ['肝', '肾'], ascending: '升浮',
      efficacy: ['补肝肾', '强筋骨', '安胎'],
      indications: '肝肾不足、腰膝酸软、筋骨无力、头晕目眩、妊娠漏血、胎动不安、高血压。',
      usage: '煎服，6–10 g；遵医嘱', processing: ['生杜仲', '盐杜仲'], toxicity: '无毒',
      contraindication: ['阴虚火旺者慎用'],
      origin: '贵州、四川', image: 'assets/herbs/du-zhong.jpg', source: DICT
    },
    {
      id: 'wu-wei-zi', name: '五味子', alias: ['北五味子', '辽五味'], pinyin: 'wuweizi', initial: 'wwz',
      category: '收涩药', nature: '温', flavor: ['酸', '甘'], meridians: ['肺', '心', '肾'], ascending: '沉降',
      efficacy: ['收敛固涩', '益气生津', '补肾宁心'],
      indications: '久嗽虚喘、梦遗滑精、遗尿尿频、久泻不止、自汗盗汗、津伤口渴、心悸失眠。',
      usage: '煎服，2–6 g；遵医嘱', processing: ['生五味子', '醋五味子'], toxicity: '无毒',
      contraindication: ['表邪未解、内有实热者慎用'],
      origin: '辽宁、黑龙江', image: 'assets/herbs/wu-wei-zi.jpg', source: DICT
    },
    {
      id: 'wu-mei', name: '乌梅', alias: ['酸梅', '梅实'], pinyin: 'wumei', initial: 'wm',
      category: '收涩药', nature: '平', flavor: ['酸', '涩'], meridians: ['肝', '脾', '肺', '大肠'], ascending: '沉降',
      efficacy: ['敛肺', '涩肠', '生津', '安蛔'],
      indications: '肺虚久咳、久泻久痢、虚热消渴、蛔厥呕吐腹痛、崩漏不止。',
      usage: '煎服，6–12 g；遵医嘱', processing: ['生乌梅', '乌梅炭'], toxicity: '无毒',
      contraindication: ['有实邪者慎用'],
      origin: '四川、浙江', image: 'assets/herbs/wu-mei.jpg', source: DICT
    },
    {
      id: 'shan-zhu-yu', name: '山茱萸', alias: ['山萸肉', '枣皮'], pinyin: 'shanzhuyu', initial: 'szy',
      category: '收涩药', nature: '微温', flavor: ['酸', '涩'], meridians: ['肝', '肾'], ascending: '沉降',
      efficacy: ['补益肝肾', '收涩固脱'],
      indications: '眩晕耳鸣、腰膝酸痛、阳痿遗精、遗尿尿频、崩漏带下、大汗虚脱、内热消渴。',
      usage: '煎服，6–12 g；遵医嘱', processing: ['山茱萸', '酒山茱萸'], toxicity: '无毒',
      contraindication: ['命门火炽、湿热下注者慎用'],
      origin: '浙江、河南', image: 'assets/herbs/shan-zhu-yu.jpg', source: DICT
    },
    {
      id: 'gan-cao', name: '甘草', alias: ['国老', '甜草', '粉甘草'], pinyin: 'gancao', initial: 'gc',
      category: '补虚药', nature: '平', flavor: ['甘'], meridians: ['心', '肺', '脾', '胃'], ascending: '平',
      efficacy: ['补脾益气', '清热解毒', '祛痰止咳', '缓急止痛', '调和诸药'],
      indications: '脾胃虚弱、倦怠乏力、心悸气短、咳嗽痰多、脘腹四肢挛急疼痛、痈肿疮毒、药食中毒；生用偏清热解毒，炙用偏补脾益气。',
      usage: '煎服，2–10 g；遵医嘱', processing: ['生甘草', '蜜炙甘草'], toxicity: '无毒',
      contraindication: ['不宜与海藻、京大戟、红大戟、甘遂、芫花同用', '湿盛胀满、水肿者慎用', '长期大剂量服用可引起水肿、血压升高、低血钾'],
      origin: '内蒙古、甘肃、新疆', image: 'assets/herbs/gan-cao.jpg', source: DICT
    },
    {
      id: 'pang-da-hai', name: '胖大海', alias: ['安南子', '大海子'], pinyin: 'pangdahai', initial: 'pdh',
      category: '其他', nature: '寒', flavor: ['甘'], meridians: ['肺', '大肠'], ascending: '沉降',
      efficacy: ['清热润肺', '利咽开音', '润肠通便'],
      indications: '肺热声哑、干咳无痰、咽喉干痛、热结便闭、头痛目赤。',
      usage: '泡服，2–3 枚；遵医嘱', processing: ['生胖大海'], toxicity: '无毒',
      contraindication: ['脾胃虚寒、腹泻者慎用'],
      origin: '泰国、越南', image: 'assets/herbs/pang-da-hai.jpg', source: DICT
    },
    {
      id: 'bai-shao', name: '白芍', alias: ['白芍药', '杭白芍'], pinyin: 'baishao', initial: 'bs',
      category: '补虚药', nature: '微寒', flavor: ['苦', '酸'], meridians: ['肝', '脾'], ascending: '沉降',
      efficacy: ['养血调经', '敛阴止汗', '柔肝止痛', '平抑肝阳'],
      indications: '血虚萎黄、月经不调、自汗盗汗、胁痛腹痛、四肢挛痛、头痛眩晕。',
      usage: '煎服，6–15 g；遵医嘱', processing: ['生白芍', '酒白芍', '炒白芍'], toxicity: '无毒',
      contraindication: ['不宜与藜芦同用', '虚寒腹痛泄泻者慎用'],
      origin: '浙江、安徽、四川', image: 'assets/herbs/bai-shao.jpg', source: DICT
    },
    {
      id: 'yin-yang-huo', name: '淫羊藿', alias: ['仙灵脾', '三枝九叶草'], pinyin: 'yinyanghuo', initial: 'yyh',
      category: '补虚药', nature: '温', flavor: ['辛', '甘'], meridians: ['肝', '肾'], ascending: '升浮',
      efficacy: ['补肾阳', '强筋骨', '祛风湿'],
      indications: '肾阳虚衰、阳痿遗精、筋骨痿软、风湿痹痛、麻木拘挛、更年期高血压。',
      usage: '煎服，6–10 g；遵医嘱', processing: ['生淫羊藿', '羊脂油炙淫羊藿'], toxicity: '无毒',
      contraindication: ['阴虚火旺者慎用'],
      origin: '陕西、湖南', image: 'assets/herbs/yin-yang-huo.jpg', source: DICT
    },
    {
      id: 'xu-duan', name: '续断', alias: ['川续断', '接骨草'], pinyin: 'xuduan', initial: 'xd',
      category: '补虚药', nature: '微温', flavor: ['苦', '辛'], meridians: ['肝', '肾'], ascending: '升浮',
      efficacy: ['补肝肾', '强筋骨', '续折伤', '止崩漏'],
      indications: '肝肾不足、腰膝酸软、风湿痹痛、跌扑损伤、筋伤骨折、崩漏经多、胎漏下血。',
      usage: '煎服，9–15 g；遵医嘱', processing: ['生续断', '酒续断', '盐续断'], toxicity: '无毒',
      contraindication: ['—'],
      origin: '四川、湖北', image: 'assets/herbs/xu-duan.jpg', source: DICT
    },
    {
      id: 'yuan-zhi', name: '远志', alias: ['小草', '细草'], pinyin: 'yuanzhi', initial: 'yz',
      category: '安神药', nature: '温', flavor: ['苦', '辛'], meridians: ['心', '肾', '肺'], ascending: '升浮',
      efficacy: ['安神益智', '交通心肾', '祛痰消肿'],
      indications: '心肾不交、失眠多梦、健忘惊悸、神志恍惚、咳痰不爽、疮疡肿毒。',
      usage: '煎服，3–10 g；遵医嘱', processing: ['生远志', '制远志'], toxicity: '无毒',
      contraindication: ['胃炎、胃溃疡者慎用', '实热或痰火内盛者慎用'],
      origin: '山西、陕西', image: 'assets/herbs/yuan-zhi.jpg', source: DICT
    },
    {
      id: 'ju-hua', name: '菊花', alias: ['甘菊', '杭菊'], pinyin: 'juhua', initial: 'jh',
      category: '解表药', nature: '微寒', flavor: ['甘', '苦'], meridians: ['肺', '肝'], ascending: '升浮',
      efficacy: ['疏散风热', '平抑肝阳', '清肝明目', '清热解毒'],
      indications: '风热感冒、头痛眩晕、目赤肿痛、眼目昏花、疮痈肿毒。',
      usage: '煎服，5–10 g；遵医嘱', processing: ['生菊花', '菊花炭'], toxicity: '无毒',
      contraindication: ['气虚胃寒者慎用'],
      origin: '浙江、安徽', image: 'assets/herbs/ju-hua.jpg', source: DICT
    },
    {
      id: 'hai-piao-xiao', name: '海螵蛸', alias: ['乌贼骨', '墨鱼骨'], pinyin: 'haipiaoxiao', initial: 'hpx',
      category: '收涩药', nature: '温', flavor: ['咸', '涩'], meridians: ['脾', '肾'], ascending: '沉降',
      efficacy: ['收敛止血', '涩精止带', '制酸止痛', '收湿敛疮'],
      indications: '吐血衄血、崩漏便血、遗精滑精、赤白带下、胃痛吞酸、湿疹湿疮、溃疡不敛。',
      usage: '煎服，5–10 g；遵医嘱', processing: ['生海螵蛸', '煅海螵蛸'], toxicity: '无毒',
      contraindication: ['阴虚多热者慎用'],
      origin: '浙江、福建', image: 'assets/herbs/hai-piao-xiao.jpg', source: DICT
    },
    {
      id: 'che-qian-zi', name: '车前子', alias: ['车前实', '凤眼前仁'], pinyin: 'cheqianzi', initial: 'cqz',
      category: '利水渗湿药', nature: '微寒', flavor: ['甘'], meridians: ['肝', '肾', '肺', '小肠'], ascending: '沉降',
      efficacy: ['清热利尿通淋', '渗湿止泻', '明目', '祛痰'],
      indications: '热淋涩痛、水肿胀满、暑湿泄泻、目赤肿痛、痰热咳嗽。',
      usage: '煎服，9–15 g，包煎；遵医嘱', processing: ['生车前子', '盐车前子'], toxicity: '无毒',
      contraindication: ['孕妇慎用', '肾虚精滑者慎用'],
      origin: '江西、河南', image: 'assets/herbs/che-qian-zi.jpg', source: DICT
    }
  ];

  return HERBS;
});
