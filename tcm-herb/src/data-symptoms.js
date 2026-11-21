/**
 * 中药大全 · 病症数据（39 条：30 个常见 + 9 个老年病种）
 *
 * 口径：现代症状/疾病描述（Q2），不使用「风寒/肝郁」等证型名。
 * 结构：
 *   groups   ['常见'] / ['老年'] / ['常见','老年'] —— 首页「老年常见」入口据此筛选
 *   herbs    [{id, role: primary|secondary, note}] —— 候选药材，note 是一句话依据
 *   pairs    [{herbs:[id...], desc}] —— 常用搭配（不提供剂量）
 *   formulas [id...] —— 历史验方，指向 data-formulas.js
 *   warning  需要就医的提示（老年病种与慢病必填）
 */
(function (root, factory) {
  const data = factory();
  if (typeof module === 'object' && module.exports) module.exports = data;
  if (root) root.TCM_SYMPTOMS = data;
})(typeof globalThis !== 'undefined' ? globalThis : null, function () {
  'use strict';

  return [
    {
      id: 'gan-mao', name: '感冒', alias: ['伤风', '普通感冒'], system: '呼吸', groups: ['常见'],
      desc: '鼻塞、打喷嚏、咽部不适、轻度发热与乏力等上呼吸道症状的统称，多由病毒引起，通常一周左右自行缓解。',
      herbs: [
        { id: 'ma-huang', role: 'primary', note: '风寒表实、无汗而喘' },
        { id: 'gui-zhi', role: 'primary', note: '风寒表虚、汗出恶风' },
        { id: 'jing-jie', role: 'secondary', note: '风寒风热皆可，解表散风' },
        { id: 'fang-feng', role: 'secondary', note: '祛风解表，常与荆芥同用' },
        { id: 'bo-he', role: 'secondary', note: '风热感冒、咽痛头胀' },
        { id: 'jin-yin-hua', role: 'secondary', note: '风热感冒、咽喉肿痛' },
        { id: 'lian-qiao', role: 'secondary', note: '风热感冒、温病初起' },
        { id: 'sheng-jiang', role: 'secondary', note: '风寒感冒初起，煎汤或配桂枝' }
      ],
      pairs: [
        { herbs: ['ma-huang', 'gui-zhi'], desc: '风寒表实无汗：麻黄发汗，桂枝助其解肌' },
        { herbs: ['jin-yin-hua', 'lian-qiao'], desc: '风热感冒、咽痛：清热解毒、疏散风热' },
        { herbs: ['jing-jie', 'fang-feng'], desc: '风寒风热皆可用，祛风解表而不燥' }
      ],
      formulas: ['gui-zhi-tang', 'ma-huang-tang', 'yin-qiao-san', 'yu-ping-feng-san']
    },
    {
      id: 'fa-re', name: '发热', alias: ['发烧', '体温升高'], system: '呼吸', groups: ['常见'],
      desc: '体温高于正常范围，常伴畏寒、头痛、乏力、口渴。持续高热、伴意识改变或皮疹时应及时就医。',
      herbs: [
        { id: 'shi-gao', role: 'primary', note: '高热烦渴，清气分热' },
        { id: 'zhi-mu', role: 'secondary', note: '清热滋阴，常与石膏相须' },
        { id: 'chai-hu', role: 'secondary', note: '寒热往来、解表退热' },
        { id: 'jin-yin-hua', role: 'secondary', note: '温病发热、热毒较盛' },
        { id: 'lian-qiao', role: 'secondary', note: '温病初起、发热微恶寒' },
        { id: 'huang-qin', role: 'secondary', note: '肺热、湿热所致发热' }
      ],
      pairs: [
        { herbs: ['shi-gao', 'zhi-mu'], desc: '气分高热、烦渴引饮的经典组合' },
        { herbs: ['chai-hu', 'huang-qin'], desc: '寒热往来、口苦咽干：和解少阳' }
      ],
      formulas: ['yin-qiao-san', 'xiao-chai-hu-tang']
    },
    {
      id: 'ke-sou', name: '咳嗽', alias: ['咳', '干咳'], system: '呼吸', groups: ['常见', '老年'],
      desc: '呼吸道受刺激后的保护性反射，可为干咳或伴少量痰。持续两周以上、咯血、胸痛或呼吸困难需就医。',
      herbs: [
        { id: 'jie-geng', role: 'primary', note: '宣肺利咽，载药上行' },
        { id: 'ku-xing-ren', role: 'primary', note: '降气止咳平喘' },
        { id: 'zi-su-ye', role: 'secondary', note: '风寒咳嗽、胸闷' },
        { id: 'chuan-bei-mu', role: 'secondary', note: '燥咳少痰、阴虚劳嗽' },
        { id: 'pi-pa-ye', role: 'secondary', note: '肺热咳嗽、气逆' },
        { id: 'chen-pi', role: 'secondary', note: '痰湿咳嗽、痰多易咯' },
        { id: 'gan-cao', role: 'secondary', note: '润肺止咳、调和诸药' }
      ],
      pairs: [
        { herbs: ['jie-geng', 'ku-xing-ren'], desc: '一宣一降，恢复肺气宣降' },
        { herbs: ['ma-huang', 'ku-xing-ren'], desc: '风寒咳嗽兼气喘：宣肺平喘' },
        { herbs: ['chuan-bei-mu', 'pi-pa-ye'], desc: '肺热燥咳、痰少而黏' }
      ],
      formulas: ['zhi-sou-san', 'sang-ju-yin', 'ma-huang-tang']
    },
    {
      id: 'ke-sou-tan-duo', name: '咳嗽痰多', alias: ['痰多', '咳痰'], system: '呼吸', groups: ['常见', '老年'],
      desc: '咳嗽伴痰量增多，痰白或黄、或黏稠难咯。长期大量脓痰、痰中带血、伴消瘦需就医。',
      herbs: [
        { id: 'ban-xia', role: 'primary', note: '燥湿化痰、降逆止咳' },
        { id: 'chen-pi', role: 'primary', note: '理气化痰，气顺则痰消' },
        { id: 'fu-ling', role: 'secondary', note: '健脾渗湿，绝生痰之源' },
        { id: 'jie-geng', role: 'secondary', note: '祛痰排脓、利咽' },
        { id: 'chuan-bei-mu', role: 'secondary', note: '热痰、燥痰' },
        { id: 'hou-po', role: 'secondary', note: '痰饮喘咳、下气除满' },
        { id: 'gan-cao', role: 'secondary', note: '润肺和中' }
      ],
      pairs: [
        { herbs: ['ban-xia', 'chen-pi'], desc: '燥湿化痰的基础组合，二陈汤的核心' },
        { herbs: ['chen-pi', 'fu-ling'], desc: '健脾理气化痰，标本兼顾' }
      ],
      formulas: ['er-chen-tang']
    },
    {
      id: 'yan-tong', name: '咽痛', alias: ['喉咙痛', '咽部疼痛'], system: '呼吸', groups: ['常见'],
      desc: '咽部疼痛、干燥或灼热感，常见于上呼吸道感染。伴高热、吞咽困难、扁桃体化脓需就医。',
      herbs: [
        { id: 'bo-he', role: 'primary', note: '疏散风热、清利咽喉' },
        { id: 'jie-geng', role: 'primary', note: '宣肺利咽、利咽开音' },
        { id: 'jin-yin-hua', role: 'secondary', note: '热毒咽痛' },
        { id: 'lian-qiao', role: 'secondary', note: '清热解毒、消肿散结' },
        { id: 'pu-gong-ying', role: 'secondary', note: '热毒壅盛、咽痛明显' },
        { id: 'pang-da-hai', role: 'secondary', note: '咽干声哑，泡服' }
      ],
      pairs: [
        { herbs: ['jin-yin-hua', 'lian-qiao'], desc: '风热咽痛：清热解毒、疏散风热' },
        { herbs: ['jie-geng', 'bo-he'], desc: '利咽开音、清利头目' }
      ],
      formulas: ['yin-qiao-san']
    },
    {
      id: 'bi-sai-liu-ti', name: '鼻塞流涕', alias: ['鼻塞', '流鼻涕', '鼻炎'], system: '呼吸', groups: ['常见'],
      desc: '鼻腔通气不畅、流清涕或浊涕，多见于感冒与过敏性鼻炎。单侧长期鼻塞或涕中带血需耳鼻喉科就诊。',
      herbs: [
        { id: 'jing-jie', role: 'primary', note: '祛风解表、通鼻窍' },
        { id: 'fang-feng', role: 'primary', note: '祛风解表、胜湿' },
        { id: 'zi-su-ye', role: 'secondary', note: '风寒鼻塞、胸闷' },
        { id: 'bo-he', role: 'secondary', note: '风热鼻塞、头胀' },
        { id: 'ma-huang', role: 'secondary', note: '风寒鼻塞无汗' },
        { id: 'gui-zhi', role: 'secondary', note: '风寒表虚、鼻鸣' }
      ],
      pairs: [
        { herbs: ['jing-jie', 'fang-feng'], desc: '祛风解表，风寒风热皆可' },
        { herbs: ['ma-huang', 'gui-zhi'], desc: '风寒鼻塞、无汗' }
      ],
      formulas: ['gui-zhi-tang', 'yin-qiao-san']
    },
    {
      id: 'tou-tong', name: '头痛', alias: ['头疼'], system: '神经', groups: ['常见'],
      desc: '头部疼痛，可为胀痛、刺痛或紧箍感。突发剧烈头痛、伴呕吐、肢体无力或意识改变应立即就医。',
      herbs: [
        { id: 'chuan-xiong', role: 'primary', note: '血瘀与风寒头痛，上行头目' },
        { id: 'tian-ma', role: 'secondary', note: '肝阳上亢、眩晕头痛' },
        { id: 'chai-hu', role: 'secondary', note: '少阳头痛、两侧为主' },
        { id: 'bo-he', role: 'secondary', note: '风热头痛、头胀目赤' },
        { id: 'gou-teng', role: 'secondary', note: '肝阳头痛、血压偏高' },
        { id: 'wu-zhu-yu', role: 'secondary', note: '厥阴头痛、巅顶痛' },
        { id: 'bai-shao', role: 'secondary', note: '柔肝缓急止痛' }
      ],
      pairs: [
        { herbs: ['chuan-xiong', 'bo-he'], desc: '风热或血瘀头痛，清利头目' },
        { herbs: ['tian-ma', 'gou-teng'], desc: '肝阳上亢之头痛眩晕' }
      ],
      formulas: ['chai-hu-shu-gan-san', 'xue-fu-zhu-yu-tang', 'tian-ma-gou-teng-yin']
    },
    {
      id: 'tou-yun', name: '头晕', alias: ['眩晕', '头昏'], system: '神经', groups: ['常见', '老年'],
      desc: '头昏、视物旋转或站立不稳。反复发作或伴耳鸣、肢体麻木、言语不清需就医排查。',
      herbs: [
        { id: 'tian-ma', role: 'primary', note: '平抑肝阳、息风止眩' },
        { id: 'gou-teng', role: 'primary', note: '清热平肝、息风' },
        { id: 'shi-jue-ming', role: 'secondary', note: '平肝潜阳、清肝明目' },
        { id: 'ju-hua', role: 'secondary', note: '清肝明目、平抑肝阳' },
        { id: 'shu-di-huang', role: 'secondary', note: '肝肾阴虚、髓海不足' },
        { id: 'shan-zhu-yu', role: 'secondary', note: '补益肝肾、固涩' },
        { id: 'gou-qi-zi', role: 'secondary', note: '滋补肝肾、益精明目' }
      ],
      pairs: [
        { herbs: ['tian-ma', 'gou-teng'], desc: '肝阳上亢之头晕，天麻钩藤饮的核心' },
        { herbs: ['gou-qi-zi', 'ju-hua'], desc: '肝肾不足、目眩昏花' }
      ],
      formulas: ['tian-ma-gou-teng-yin', 'liu-wei-di-huang-wan']
    },
    {
      id: 'shi-mian', name: '失眠', alias: ['入睡困难', '睡眠不好'], system: '睡眠', groups: ['常见', '老年'],
      desc: '入睡困难、易醒或早醒，影响白天精神与情绪。持续一个月以上、伴明显焦虑抑郁建议就医。',
      herbs: [
        { id: 'suan-zao-ren', role: 'primary', note: '养心补肝、宁心安神' },
        { id: 'bai-zi-ren', role: 'primary', note: '养心安神、润肠' },
        { id: 'shou-wu-teng', role: 'secondary', note: '养血安神、通络' },
        { id: 'yuan-zhi', role: 'secondary', note: '安神益智、交通心肾' },
        { id: 'wu-wei-zi', role: 'secondary', note: '补肾宁心、敛汗' },
        { id: 'dan-shen', role: 'secondary', note: '清心除烦、活血' },
        { id: 'shi-chang-pu', role: 'secondary', note: '醒神益智、化湿和胃' }
      ],
      pairs: [
        { herbs: ['suan-zao-ren', 'bai-zi-ren'], desc: '心血不足之虚烦不眠' },
        { herbs: ['yuan-zhi', 'shi-chang-pu'], desc: '心肾不交、健忘失眠' }
      ],
      formulas: ['gui-pi-tang', 'xiao-yao-san']
    },
    {
      id: 'jian-wang', name: '健忘', alias: ['记忆减退', '记性差'], system: '神经', groups: ['常见', '老年'],
      desc: '近期记忆减退、丢三落四，多与年龄、睡眠、情绪和慢性病有关。明显影响日常生活需记忆门诊评估。',
      herbs: [
        { id: 'yuan-zhi', role: 'primary', note: '安神益智、交通心肾' },
        { id: 'shi-chang-pu', role: 'primary', note: '开窍醒神、益智' },
        { id: 'ren-shen', role: 'secondary', note: '大补元气、安神益智' },
        { id: 'dang-gui', role: 'secondary', note: '养血，血足则神安' },
        { id: 'shu-di-huang', role: 'secondary', note: '补肾填精、益髓' },
        { id: 'wu-wei-zi', role: 'secondary', note: '补肾宁心' }
      ],
      pairs: [
        { herbs: ['yuan-zhi', 'shi-chang-pu'], desc: '开窍安神益智的常用组合' },
        { herbs: ['ren-shen', 'shu-di-huang'], desc: '气血与肾精并补' }
      ],
      formulas: ['gui-pi-tang', 'liu-wei-di-huang-wan']
    },
    {
      id: 'fa-li-qi-duan', name: '乏力气短', alias: ['乏力', '气短', '体力下降'], system: '全身', groups: ['常见', '老年'],
      desc: '容易疲倦、活动后气不够用，常见于贫血、心肺功能下降或病后体虚。伴胸闷、心悸、下肢水肿需就医。',
      herbs: [
        { id: 'huang-qi', role: 'primary', note: '补气升阳、固表' },
        { id: 'dang-shen', role: 'primary', note: '健脾益肺、养血生津' },
        { id: 'ren-shen', role: 'secondary', note: '大补元气，虚甚者用' },
        { id: 'bai-zhu', role: 'secondary', note: '健脾益气、燥湿' },
        { id: 'dang-gui', role: 'secondary', note: '补血活血，气血同补' },
        { id: 'gou-qi-zi', role: 'secondary', note: '滋补肝肾、益精' },
        { id: 'gan-cao', role: 'secondary', note: '补脾益气、调和诸药' }
      ],
      pairs: [
        { herbs: ['huang-qi', 'dang-shen'], desc: '脾肺气虚之乏力，平补而不燥' },
        { herbs: ['ren-shen', 'bai-zhu'], desc: '元气不足、食少倦怠' },
        { herbs: ['dang-gui', 'huang-qi'], desc: '气血两虚，黄芪补气以生血' }
      ],
      formulas: ['si-jun-zi-tang', 'bu-zhong-yi-qi-tang', 'gui-pi-tang']
    },
    {
      id: 'shi-yu-bu-zhen', name: '食欲不振', alias: ['没胃口', '食少', '纳差'], system: '消化', groups: ['常见', '老年'],
      desc: '进食欲望下降、食量减少，可伴腹胀、乏力。持续消瘦、吞咽困难或呕血黑便需就医。',
      herbs: [
        { id: 'shan-zha', role: 'primary', note: '消肉食积滞、行气' },
        { id: 'shen-qu', role: 'primary', note: '消米面食积、和胃' },
        { id: 'mai-ya', role: 'primary', note: '消淀粉类食积、健脾开胃' },
        { id: 'chen-pi', role: 'secondary', note: '理气健脾、醒脾' },
        { id: 'sha-ren', role: 'secondary', note: '化湿开胃、温脾' },
        { id: 'bai-zhu', role: 'secondary', note: '健脾益气' },
        { id: 'dang-shen', role: 'secondary', note: '健脾益肺、生津' }
      ],
      pairs: [
        { herbs: ['shan-zha', 'shen-qu', 'mai-ya'], desc: '焦三仙：消各种食积的经典组合' },
        { herbs: ['sha-ren', 'chen-pi'], desc: '湿阻中焦、脘痞不饥' }
      ],
      formulas: ['si-jun-zi-tang', 'ping-wei-san']
    },
    {
      id: 'wei-zhang', name: '胃胀', alias: ['腹胀', '脘腹胀满', '早饱'], system: '消化', groups: ['常见', '老年'],
      desc: '上腹胀满、嗳气或早饱，多与进食过快、消化不良或情绪紧张有关。持续加重、伴消瘦或黑便需胃镜检查。',
      herbs: [
        { id: 'chen-pi', role: 'primary', note: '理气健脾、燥湿' },
        { id: 'zhi-shi', role: 'primary', note: '破气消积、散痞' },
        { id: 'mu-xiang', role: 'secondary', note: '行气止痛、健脾消食' },
        { id: 'xiang-fu', role: 'secondary', note: '疏肝解郁、理气宽中' },
        { id: 'hou-po', role: 'secondary', note: '下气除满、燥湿' },
        { id: 'sha-ren', role: 'secondary', note: '化湿开胃、理气' },
        { id: 'cang-zhu', role: 'secondary', note: '燥湿健脾，湿滞胀满' }
      ],
      pairs: [
        { herbs: ['chen-pi', 'hou-po'], desc: '气滞湿阻之脘腹胀满' },
        { herbs: ['mu-xiang', 'sha-ren'], desc: '行气化湿、醒脾开胃' }
      ],
      formulas: ['ping-wei-san', 'chai-hu-shu-gan-san']
    },
    {
      id: 'fu-tong', name: '腹痛', alias: ['肚子痛', '脘腹痛'], system: '消化', groups: ['常见'],
      desc: '腹部疼痛，可因受凉、饮食不洁或情绪紧张诱发。突发剧痛、拒按、伴发热或便血需急诊。',
      herbs: [
        { id: 'xiang-fu', role: 'primary', note: '疏肝理气、止痛' },
        { id: 'mu-xiang', role: 'primary', note: '行气止痛，善治气滞胀痛' },
        { id: 'wu-yao', role: 'secondary', note: '温肾散寒、行气止痛' },
        { id: 'wu-zhu-yu', role: 'secondary', note: '寒凝腹痛、痛经' },
        { id: 'gan-jiang', role: 'secondary', note: '虚寒腹痛、喜温喜按' },
        { id: 'bai-shao', role: 'secondary', note: '柔肝缓急止痛' },
        { id: 'gan-cao', role: 'secondary', note: '缓急止痛、调和诸药' }
      ],
      pairs: [
        { herbs: ['bai-shao', 'gan-cao'], desc: '芍药甘草汤：柔肝缓急、止挛痛' },
        { herbs: ['xiang-fu', 'mu-xiang'], desc: '气滞腹痛、胀痛走窜' }
      ],
      formulas: ['chai-hu-shu-gan-san', 'gui-zhi-tang']
    },
    {
      id: 'ou-tu', name: '呕吐', alias: ['恶心呕吐', '反胃'], system: '消化', groups: ['常见'],
      desc: '胃内容物不自主地上逆吐出，可伴恶心、头晕。频繁呕吐、呕血、伴剧烈腹痛或头痛需就医。',
      herbs: [
        { id: 'ban-xia', role: 'primary', note: '降逆止呕，为止呕要药' },
        { id: 'sheng-jiang', role: 'primary', note: '温中止呕，善治胃寒呕吐' },
        { id: 'huo-xiang', role: 'secondary', note: '化湿和中、止呕' },
        { id: 'sha-ren', role: 'secondary', note: '温脾止泻、化湿行气' },
        { id: 'chen-pi', role: 'secondary', note: '理气健脾、降逆' },
        { id: 'wu-zhu-yu', role: 'secondary', note: '肝寒犯胃、吞酸呕吐' },
        { id: 'gan-cao', role: 'secondary', note: '和中缓急' }
      ],
      pairs: [
        { herbs: ['ban-xia', 'sheng-jiang'], desc: '胃寒或痰湿呕吐的经典组合' },
        { herbs: ['huo-xiang', 'sha-ren'], desc: '暑湿或湿浊中阻之呕吐' }
      ],
      formulas: ['huo-xiang-zheng-qi-san', 'xiao-chai-hu-tang']
    },
    {
      id: 'fu-xie', name: '腹泻', alias: ['拉肚子', '泄泻'], system: '消化', groups: ['常见', '老年'],
      desc: '排便次数增多、粪质稀薄或水样，可伴腹痛、腹胀。持续两周以上、伴发热、便血或明显脱水需就医。',
      herbs: [
        { id: 'fu-ling', role: 'primary', note: '利水渗湿、健脾止泻' },
        { id: 'bai-zhu', role: 'primary', note: '健脾益气、燥湿止泻' },
        { id: 'yi-yi-ren', role: 'secondary', note: '健脾止泻、渗湿' },
        { id: 'sha-ren', role: 'secondary', note: '温脾止泻、化湿' },
        { id: 'huo-xiang', role: 'secondary', note: '芳香化浊、和中' },
        { id: 'cang-zhu', role: 'secondary', note: '燥湿健脾，湿盛泄泻' },
        { id: 'gan-jiang', role: 'secondary', note: '脾胃虚寒、五更泄泻' }
      ],
      pairs: [
        { herbs: ['fu-ling', 'bai-zhu'], desc: '脾虚湿盛之泄泻，健脾渗湿' },
        { herbs: ['huo-xiang', 'hou-po'], desc: '湿浊中阻、暑湿吐泻' }
      ],
      formulas: ['huo-xiang-zheng-qi-san', 'ping-wei-san', 'si-jun-zi-tang']
    },
    {
      id: 'bian-mi', name: '便秘', alias: ['大便干结', '排便困难'], system: '消化', groups: ['常见', '老年'],
      desc: '排便次数减少、粪便干硬或排便费力。老年人、久坐与饮水不足者常见。伴便血、消瘦或排便习惯突然改变需就医。',
      herbs: [
        { id: 'da-huang', role: 'primary', note: '实热积滞便秘，泻下攻积' },
        { id: 'huo-ma-ren', role: 'primary', note: '津亏肠燥，润肠通便' },
        { id: 'fan-xie-ye', role: 'secondary', note: '急性便秘，泡服取效快，不宜久用' },
        { id: 'tao-ren', role: 'secondary', note: '活血润肠，兼瘀者宜' },
        { id: 'dang-gui', role: 'secondary', note: '血虚肠燥便秘' },
        { id: 'bai-zi-ren', role: 'secondary', note: '阴血不足、肠燥便秘' },
        { id: 'zhi-shi', role: 'secondary', note: '气滞便秘、腹满胀痛' }
      ],
      pairs: [
        { herbs: ['huo-ma-ren', 'dang-gui'], desc: '血虚津亏之肠燥便秘' },
        { herbs: ['da-huang', 'zhi-shi'], desc: '实热积滞、腹满便秘' }
      ],
      formulas: ['tao-he-cheng-qi-tang']
    },
    {
      id: 'kou-qiang-kui-yang', name: '口腔溃疡', alias: ['口疮', '嘴破'], system: '口腔', groups: ['常见'],
      desc: '口腔黏膜反复出现的小溃疡，疼痛影响进食。反复发作、久不愈合或伴发热需就医。',
      herbs: [
        { id: 'huang-lian', role: 'primary', note: '清心胃之火、解毒' },
        { id: 'zhi-zi', role: 'secondary', note: '泻火除烦、凉血解毒' },
        { id: 'lian-qiao', role: 'secondary', note: '清热解毒、消肿' },
        { id: 'pu-gong-ying', role: 'secondary', note: '清热解毒、消肿散结' },
        { id: 'gan-cao', role: 'secondary', note: '清热解毒、缓急止痛' },
        { id: 'zhi-mu', role: 'secondary', note: '滋阴润燥，虚火者宜' }
      ],
      pairs: [
        { herbs: ['huang-lian', 'zhi-zi'], desc: '心胃火盛之口舌生疮' },
        { herbs: ['gan-cao', 'jie-geng'], desc: '利咽解毒、缓急止痛' }
      ],
      formulas: []
    },
    {
      id: 'ya-tong', name: '牙痛', alias: ['牙疼', '齿痛'], system: '口腔', groups: ['常见'],
      desc: '牙齿或牙周疼痛，遇冷热酸甜加重。伴面部肿胀、发热或张口困难需口腔科急诊。',
      herbs: [
        { id: 'shi-gao', role: 'primary', note: '胃火牙痛、烦渴' },
        { id: 'zhi-mu', role: 'secondary', note: '清热滋阴，虚火牙痛' },
        { id: 'huang-lian', role: 'secondary', note: '胃火炽盛、牙龈肿痛' },
        { id: 'zhi-zi', role: 'secondary', note: '泻火凉血、消肿' },
        { id: 'lian-qiao', role: 'secondary', note: '清热解毒、消肿散结' },
        { id: 'pu-gong-ying', role: 'secondary', note: '热毒肿痛' }
      ],
      pairs: [
        { herbs: ['shi-gao', 'zhi-mu'], desc: '胃火牙痛、烦渴引饮' },
        { herbs: ['huang-lian', 'zhi-zi'], desc: '胃热心烦、牙龈肿痛' }
      ],
      formulas: []
    },
    {
      id: 'yan-hou-gan-zao', name: '咽喉干燥', alias: ['咽干', '口干咽燥'], system: '呼吸', groups: ['常见', '老年'],
      desc: '咽部干燥、发痒或有异物感，说话多、空气干燥时加重。持续声嘶、吞咽困难需就医。',
      herbs: [
        { id: 'pang-da-hai', role: 'primary', note: '清热润肺、利咽开音' },
        { id: 'jie-geng', role: 'secondary', note: '宣肺利咽、载药上行' },
        { id: 'zhi-mu', role: 'secondary', note: '滋阴润燥、生津' },
        { id: 'gou-qi-zi', role: 'secondary', note: '滋补肝肾、生津' },
        { id: 'wu-mei', role: 'secondary', note: '生津止渴、敛肺' },
        { id: 'wu-wei-zi', role: 'secondary', note: '益气生津、敛汗' },
        { id: 'gan-cao', role: 'secondary', note: '润肺利咽、调和' }
      ],
      pairs: [
        { herbs: ['pang-da-hai', 'jie-geng'], desc: '咽干声哑、干咳' },
        { herbs: ['wu-mei', 'wu-wei-zi'], desc: '津伤口渴、咽干，酸甘化阴' }
      ],
      formulas: []
    },
    {
      id: 'bi-chu-xue', name: '鼻出血', alias: ['流鼻血', '鼻衄'], system: '耳鼻喉', groups: ['常见'],
      desc: '鼻腔出血，多因干燥、挖鼻、鼻炎或血压升高引起。出血量大、持续不止或反复出血需耳鼻喉科就诊。',
      herbs: [
        { id: 'bai-ji', role: 'primary', note: '收敛止血、消肿生肌' },
        { id: 'di-yu', role: 'secondary', note: '凉血止血' },
        { id: 'san-qi', role: 'secondary', note: '散瘀止血，止血而不留瘀' },
        { id: 'zhi-zi', role: 'secondary', note: '凉血止血、泻火' },
        { id: 'huang-qin', role: 'secondary', note: '肺热鼻衄' }
      ],
      pairs: [
        { herbs: ['bai-ji', 'di-yu'], desc: '收敛与凉血并用，止血更稳' },
        { herbs: ['san-qi', 'bai-ji'], desc: '出血兼有瘀滞者' }
      ],
      formulas: []
    },
    {
      id: 'zhi-chuang', name: '痔疮', alias: ['痔', '痔核'], system: '消化', groups: ['常见', '老年'],
      desc: '肛门齿状线附近静脉丛曲张形成的柔软静脉团，久坐、便秘、妊娠常见。便血量多、疼痛剧烈或脱出不能回纳需肛肠科就诊。',
      herbs: [
        { id: 'di-yu', role: 'primary', note: '凉血止血，善治痔血' },
        { id: 'bai-ji', role: 'secondary', note: '收敛生肌、止血' },
        { id: 'san-qi', role: 'secondary', note: '化瘀止血、消肿' },
        { id: 'da-huang', role: 'secondary', note: '泻热通便，减少排便用力' },
        { id: 'dang-gui', role: 'secondary', note: '养血润肠' }
      ],
      pairs: [
        { herbs: ['di-yu', 'bai-ji'], desc: '痔血：凉血收敛止血' },
        { herbs: ['da-huang', 'dang-gui'], desc: '便秘诱发的痔疮，通便兼养血' }
      ],
      formulas: ['tao-he-cheng-qi-tang']
    },
    {
      id: 'tong-jing', name: '痛经', alias: ['经期腹痛'], system: '妇科', groups: ['常见'],
      desc: '月经期或前后出现下腹疼痛，可伴腰酸、恶心、腹泻。进行性加重、影响生活或伴异常出血需妇科就诊。',
      herbs: [
        { id: 'dang-gui', role: 'primary', note: '补血活血、调经止痛' },
        { id: 'chuan-xiong', role: 'primary', note: '活血行气、止痛' },
        { id: 'xiang-fu', role: 'secondary', note: '疏肝理气、调经止痛' },
        { id: 'yi-mu-cao', role: 'secondary', note: '活血调经' },
        { id: 'hong-hua', role: 'secondary', note: '活血通经、散瘀' },
        { id: 'tao-ren', role: 'secondary', note: '活血祛瘀' },
        { id: 'bai-shao', role: 'secondary', note: '柔肝缓急止痛' },
        { id: 'gan-cao', role: 'secondary', note: '缓急止痛、调和' }
      ],
      pairs: [
        { herbs: ['dang-gui', 'chuan-xiong'], desc: '血虚血瘀之痛经' },
        { herbs: ['xiang-fu', 'yi-mu-cao'], desc: '气滞血瘀、经前乳胀' },
        { herbs: ['bai-shao', 'gan-cao'], desc: '经期痉挛性疼痛，柔肝缓急' }
      ],
      formulas: ['si-wu-tang', 'xue-fu-zhu-yu-tang', 'tao-he-cheng-qi-tang', 'chai-hu-shu-gan-san']
    },
    {
      id: 'yue-jing-bu-tiao', name: '月经不调', alias: ['月经紊乱', '经期不准'], system: '妇科', groups: ['常见'],
      desc: '月经周期、经期或经量异常。需先排除妊娠与器质性疾病，持续异常建议妇科就诊。',
      herbs: [
        { id: 'dang-gui', role: 'primary', note: '补血活血、调经' },
        { id: 'bai-shao', role: 'primary', note: '养血调经、柔肝' },
        { id: 'shu-di-huang', role: 'secondary', note: '补血滋阴、填精' },
        { id: 'chuan-xiong', role: 'secondary', note: '活血行气，血中之气药' },
        { id: 'xiang-fu', role: 'secondary', note: '疏肝理气、调经' },
        { id: 'yi-mu-cao', role: 'secondary', note: '活血调经' },
        { id: 'chai-hu', role: 'secondary', note: '疏肝解郁，情绪相关者宜' }
      ],
      pairs: [
        { herbs: ['dang-gui', 'bai-shao'], desc: '养血调经的基础组合' },
        { herbs: ['chai-hu', 'xiang-fu'], desc: '肝郁气滞、经前乳胀' }
      ],
      formulas: ['si-wu-tang', 'xiao-yao-san']
    },
    {
      id: 'chao-re-dao-han', name: '潮热盗汗', alias: ['潮热', '盗汗', '夜间出汗'], system: '妇科', groups: ['常见', '老年'],
      desc: '阵发性发热、出汗，夜间明显，常见于更年期与阴虚体质。伴明显消瘦、长期低热或咳嗽需就医排查。',
      herbs: [
        { id: 'zhi-mu', role: 'primary', note: '清热滋阴、退虚热' },
        { id: 'shu-di-huang', role: 'primary', note: '滋阴补血、填精' },
        { id: 'shan-zhu-yu', role: 'secondary', note: '补益肝肾、收敛' },
        { id: 'nv-zhen-zi', role: 'secondary', note: '滋补肝肾、清虚热' },
        { id: 'gou-qi-zi', role: 'secondary', note: '滋补肝肾' },
        { id: 'wu-wei-zi', role: 'secondary', note: '敛汗生津、宁心' },
        { id: 'ze-xie', role: 'secondary', note: '泄肾浊，防滋补太过' }
      ],
      pairs: [
        { herbs: ['zhi-mu', 'shu-di-huang'], desc: '阴虚潮热、盗汗' },
        { herbs: ['shan-zhu-yu', 'wu-wei-zi'], desc: '收敛固涩、止汗' }
      ],
      formulas: ['liu-wei-di-huang-wan']
    },
    {
      id: 'mian-se-cang-bai', name: '面色苍白', alias: ['面色淡白', '气血不足'], system: '全身', groups: ['常见', '老年'],
      desc: '面色淡白无华，常伴乏力、头晕、心悸，多见于贫血或气血不足。持续苍白、伴出血或消瘦需查血常规。',
      herbs: [
        { id: 'dang-gui', role: 'primary', note: '补血活血' },
        { id: 'shu-di-huang', role: 'primary', note: '补血滋阴' },
        { id: 'bai-shao', role: 'secondary', note: '养血柔肝' },
        { id: 'huang-qi', role: 'secondary', note: '补气以生血' },
        { id: 'dang-shen', role: 'secondary', note: '健脾益气、生津' },
        { id: 'gou-qi-zi', role: 'secondary', note: '滋补肝肾' }
      ],
      pairs: [
        { herbs: ['dang-gui', 'huang-qi'], desc: '气血双补，黄芪补气生血' },
        { herbs: ['shu-di-huang', 'bai-shao'], desc: '养血滋阴，改善面色无华' }
      ],
      formulas: ['si-wu-tang', 'gui-pi-tang', 'si-jun-zi-tang']
    },
    {
      id: 'shui-zhong', name: '水肿', alias: ['浮肿', '肿胀'], system: '泌尿', groups: ['常见', '老年'],
      desc: '组织间隙液体潴留，表现为眼睑、下肢或全身浮肿。单侧肿胀、伴气促、尿量骤减或泡沫尿需就医。',
      herbs: [
        { id: 'fu-ling', role: 'primary', note: '利水渗湿、健脾' },
        { id: 'ze-xie', role: 'primary', note: '利水渗湿、泄热' },
        { id: 'zhu-ling', role: 'secondary', note: '利水渗湿，专于水湿' },
        { id: 'yi-yi-ren', role: 'secondary', note: '利水渗湿、健脾' },
        { id: 'che-qian-zi', role: 'secondary', note: '利尿通淋、渗湿' },
        { id: 'huang-qi', role: 'secondary', note: '气虚水肿，补气利水' },
        { id: 'ma-huang', role: 'secondary', note: '风水浮肿，宣肺利水' }
      ],
      pairs: [
        { herbs: ['fu-ling', 'ze-xie'], desc: '水湿内停、小便不利' },
        { herbs: ['huang-qi', 'bai-zhu'], desc: '气虚水肿、乏力' }
      ],
      formulas: ['shen-qi-wan', 'bu-zhong-yi-qi-tang']
    },
    {
      id: 'gao-xue-ya', name: '高血压', alias: ['血压高'], system: '循环', groups: ['常见', '老年'],
      desc: '动脉血压持续升高，多数早期无症状，长期可损伤心、脑、肾。确诊与用药请遵循心内科方案。',
      warning: '高血压需长期规范监测与用药，中药仅作辅助调理。血压 ≥180/120 mmHg，或出现胸痛、言语不清、肢体无力、剧烈头痛，请立即就医。',
      herbs: [
        { id: 'gou-teng', role: 'primary', note: '清热平肝、息风' },
        { id: 'tian-ma', role: 'primary', note: '平抑肝阳、止眩' },
        { id: 'shi-jue-ming', role: 'secondary', note: '平肝潜阳' },
        { id: 'ju-hua', role: 'secondary', note: '清肝明目、平抑肝阳' },
        { id: 'du-zhong', role: 'secondary', note: '补肝肾，药典载有降压应用' },
        { id: 'dan-shen', role: 'secondary', note: '活血化瘀，改善循环' },
        { id: 'ze-xie', role: 'secondary', note: '利水化浊降脂' }
      ],
      pairs: [
        { herbs: ['gou-teng', 'tian-ma'], desc: '肝阳上亢之头晕头痛' },
        { herbs: ['du-zhong', 'ju-hua'], desc: '肝肾不足兼肝阳偏亢' }
      ],
      formulas: ['tian-ma-gou-teng-yin', 'liu-wei-di-huang-wan']
    },
    {
      id: 'tang-niao-bing', name: '糖尿病', alias: ['消渴', '血糖高'], system: '内分泌', groups: ['常见', '老年'],
      desc: '以慢性高血糖为特征的代谢性疾病，典型表现为多饮、多食、多尿、体重下降，但多数早期无症状。',
      warning: '糖尿病需内分泌科规范治疗与血糖监测，中药不能替代降糖药或胰岛素。出现明显乏力、恶心呕吐、呼吸深快、意识改变（可能酮症）请立即就医。',
      herbs: [
        { id: 'zhi-mu', role: 'primary', note: '清热滋阴、生津' },
        { id: 'gou-qi-zi', role: 'primary', note: '滋补肝肾、生津' },
        { id: 'shan-zhu-yu', role: 'secondary', note: '补益肝肾、固涩' },
        { id: 'nv-zhen-zi', role: 'secondary', note: '滋补肝肾、清虚热' },
        { id: 'huang-qi', role: 'secondary', note: '补气生津，改善乏力' },
        { id: 'ren-shen', role: 'secondary', note: '益气生津' },
        { id: 'shu-di-huang', role: 'secondary', note: '滋阴补肾' }
      ],
      pairs: [
        { herbs: ['zhi-mu', 'gou-qi-zi'], desc: '阴虚燥热、口渴多饮' },
        { herbs: ['shan-zhu-yu', 'shu-di-huang'], desc: '肾阴不足、尿频' }
      ],
      formulas: ['liu-wei-di-huang-wan']
    },
    {
      id: 'feng-shi-guan-jie-tong', name: '风湿关节痛', alias: ['关节痛', '痹痛', '老寒腿'], system: '骨科', groups: ['常见', '老年'],
      desc: '关节疼痛、肿胀、晨僵或活动受限，阴雨寒冷时加重。关节红肿发热、畸形或伴发热需风湿免疫科就诊。',
      herbs: [
        { id: 'du-huo', role: 'primary', note: '祛风湿、通痹止痛，善治下半身痹痛' },
        { id: 'wei-ling-xian', role: 'primary', note: '祛风湿、通络止痛' },
        { id: 'qin-jiao', role: 'secondary', note: '祛风湿、清湿热、止痹痛' },
        { id: 'sang-ji-sheng', role: 'secondary', note: '祛风湿、补肝肾、强筋骨' },
        { id: 'du-zhong', role: 'secondary', note: '补肝肾、强筋骨' },
        { id: 'xu-duan', role: 'secondary', note: '补肝肾、续折伤' },
        { id: 'gui-zhi', role: 'secondary', note: '温通经脉、散寒止痛' },
        { id: 'fang-feng', role: 'secondary', note: '祛风胜湿止痛' }
      ],
      pairs: [
        { herbs: ['du-huo', 'sang-ji-sheng'], desc: '痹痛兼肝肾不足、腰膝酸软' },
        { herbs: ['gui-zhi', 'fang-feng'], desc: '风寒湿痹、遇冷加重' },
        { herbs: ['du-zhong', 'xu-duan'], desc: '久痹伤肾、筋骨无力' }
      ],
      formulas: []
    },
    {
      id: 'pa-jin-sen-bing', name: '帕金森病', alias: ['震颤麻痹', '手抖'], system: '神经', groups: ['老年'],
      desc: '以静止性震颤、动作迟缓、肌强直和姿势平衡障碍为主要表现的慢性神经系统疾病，多见于中老年人。',
      warning: '帕金森病需神经内科规范诊治。中药仅可能作为辅助调理，不能替代左旋多巴等处方药；出现吞咽困难、频繁跌倒或精神症状请及时就医。',
      herbs: [
        { id: 'tian-ma', role: 'primary', note: '平肝息风止颤' },
        { id: 'gou-teng', role: 'primary', note: '清热平肝、息风' },
        { id: 'bai-shao', role: 'secondary', note: '柔肝缓急、养血' },
        { id: 'shu-di-huang', role: 'secondary', note: '滋补肝肾、填精' },
        { id: 'shan-zhu-yu', role: 'secondary', note: '补益肝肾、固涩' },
        { id: 'di-long', role: 'secondary', note: '通络，改善肢体僵硬' }
      ],
      pairs: [
        { herbs: ['tian-ma', 'gou-teng'], desc: '肝风内动之震颤、头晕' },
        { herbs: ['bai-shao', 'shu-di-huang'], desc: '肝肾阴虚、筋脉失养' }
      ],
      formulas: ['tian-ma-gou-teng-yin']
    },
    {
      id: 'wei-suan-guo-duo', name: '胃酸过多', alias: ['反酸', '烧心', '吞酸'], system: '消化', groups: ['常见', '老年'],
      desc: '反酸、烧心、嗳气、上腹灼痛，餐后或平卧时加重，与胃食管反流、胃炎、消化性溃疡等有关。',
      warning: '长期反酸、烧心、黑便、吞咽困难或体重下降请及时就医，排除消化性溃疡与肿瘤。中药仅作辅助，不能替代抑酸药等规范治疗。',
      herbs: [
        { id: 'hai-piao-xiao', role: 'primary', note: '制酸止痛、收敛止血' },
        { id: 'huang-lian', role: 'primary', note: '清胃热、泻火' },
        { id: 'wu-zhu-yu', role: 'secondary', note: '降逆止呕，与黄连相配' },
        { id: 'bai-shao', role: 'secondary', note: '柔肝缓急止痛' },
        { id: 'gan-cao', role: 'secondary', note: '缓急和中、调和诸药' },
        { id: 'shi-jue-ming', role: 'secondary', note: '煅用收敛制酸' },
        { id: 'ban-xia', role: 'secondary', note: '降逆止呕、化痰' }
      ],
      pairs: [
        { herbs: ['huang-lian', 'wu-zhu-yu'], desc: '左金丸：肝火犯胃之吞酸嗳气' },
        { herbs: ['hai-piao-xiao', 'bai-shao'], desc: '制酸止痛、缓急' }
      ],
      formulas: ['zuo-jin-wan']
    },
    {
      id: 'gu-zhi-shu-song', name: '骨质疏松', alias: ['骨量减少', '骨痿'], system: '骨科', groups: ['老年'],
      desc: '骨量减少、骨微结构破坏、易发生脆性骨折，绝经后女性与高龄人群多见，常无明显症状。',
      warning: '骨质疏松需骨密度检查与规范补钙、维生素 D 及抗骨松治疗，中药为辅助。轻微外力即骨折、身高明显变矮或背痛加重请骨科就诊。',
      herbs: [
        { id: 'du-zhong', role: 'primary', note: '补肝肾、强筋骨' },
        { id: 'xu-duan', role: 'primary', note: '补肝肾、续折伤' },
        { id: 'yin-yang-huo', role: 'secondary', note: '补肾阳、强筋骨' },
        { id: 'shu-di-huang', role: 'secondary', note: '补肾填精' },
        { id: 'shan-zhu-yu', role: 'secondary', note: '补益肝肾、固涩' },
        { id: 'gou-qi-zi', role: 'secondary', note: '滋补肝肾' },
        { id: 'huang-qi', role: 'secondary', note: '益气，助气血生化' }
      ],
      pairs: [
        { herbs: ['du-zhong', 'xu-duan'], desc: '腰膝酸软、筋骨无力' },
        { herbs: ['yin-yang-huo', 'shu-di-huang'], desc: '肾阳不足兼精亏' }
      ],
      formulas: ['shen-qi-wan', 'liu-wei-di-huang-wan']
    },
    {
      id: 'qian-lie-xian-zeng-sheng', name: '前列腺增生', alias: ['前列腺肥大', '排尿不畅'], system: '泌尿', groups: ['老年'],
      desc: '中老年男性前列腺体积增大引起的尿频、夜尿增多、尿线变细、排尿不尽等下尿路症状。',
      warning: '排尿困难、尿潴留、血尿或反复尿路感染需泌尿外科就诊。中药不能替代手术或处方药；急性尿不出请立即就医。',
      herbs: [
        { id: 'che-qian-zi', role: 'primary', note: '利尿通淋、渗湿' },
        { id: 'ze-xie', role: 'primary', note: '利水渗湿、泄热' },
        { id: 'fu-ling', role: 'secondary', note: '利水渗湿、健脾' },
        { id: 'zhu-ling', role: 'secondary', note: '利水渗湿' },
        { id: 'wu-yao', role: 'secondary', note: '温肾行气、缩尿' },
        { id: 'rou-gui', role: 'secondary', note: '温阳化气，助膀胱气化' },
        { id: 'jin-qian-cao', role: 'secondary', note: '利尿通淋' }
      ],
      pairs: [
        { herbs: ['che-qian-zi', 'ze-xie'], desc: '小便不利、尿频尿急' },
        { herbs: ['wu-yao', 'rou-gui'], desc: '肾阳不足、膀胱气化无力' }
      ],
      formulas: ['shen-qi-wan']
    },
    {
      id: 'pi-fu-sao-yang', name: '老年性皮肤瘙痒', alias: ['皮肤瘙痒', '干痒'], system: '皮肤', groups: ['老年'],
      desc: '皮肤干燥、阵发性瘙痒，夜间加重，与皮脂分泌减少、洗澡过勤、空气干燥有关。',
      warning: '全身顽固瘙痒可能与肝胆疾病、糖尿病、肾病或血液病有关，伴黄疸、明显皮疹或体重下降请就医查明原因。',
      herbs: [
        { id: 'dang-gui', role: 'primary', note: '养血润燥、活血' },
        { id: 'shu-di-huang', role: 'primary', note: '滋阴养血' },
        { id: 'bai-shao', role: 'secondary', note: '养血柔肝' },
        { id: 'fang-feng', role: 'secondary', note: '祛风止痒' },
        { id: 'jing-jie', role: 'secondary', note: '祛风止痒、透疹' },
        { id: 'chuan-xiong', role: 'secondary', note: '活血行气，血行风自灭' },
        { id: 'gan-cao', role: 'secondary', note: '和中缓急、调和' }
      ],
      pairs: [
        { herbs: ['dang-gui', 'shu-di-huang'], desc: '血虚风燥之皮肤干痒' },
        { herbs: ['fang-feng', 'jing-jie'], desc: '祛风止痒，风寒风热皆可' }
      ],
      formulas: ['si-wu-tang']
    },
    {
      id: 'er-ming-ting-li-xia-jiang', name: '耳鸣听力下降', alias: ['耳鸣', '听力减退', '耳聋'], system: '耳鼻喉', groups: ['老年'],
      desc: '耳内鸣响、听力减退，多与年龄、噪声暴露和肝肾不足有关。',
      warning: '突发性耳聋属于耳鼻喉科急症，请在 72 小时内就诊；单侧持续耳鸣伴眩晕或面瘫也需尽快就医。',
      herbs: [
        { id: 'shu-di-huang', role: 'primary', note: '补肾填精，精足则耳聪' },
        { id: 'shan-zhu-yu', role: 'primary', note: '补益肝肾、固涩' },
        { id: 'gou-qi-zi', role: 'secondary', note: '滋补肝肾' },
        { id: 'nv-zhen-zi', role: 'secondary', note: '滋补肝肾、明目' },
        { id: 'shi-chang-pu', role: 'secondary', note: '开窍，古方常用于耳鸣耳聋' },
        { id: 'wu-wei-zi', role: 'secondary', note: '补肾宁心' }
      ],
      pairs: [
        { herbs: ['shu-di-huang', 'shan-zhu-yu'], desc: '肾精不足之耳鸣、腰膝酸软' },
        { herbs: ['shi-chang-pu', 'wu-wei-zi'], desc: '开窍宁心，改善耳鸣失眠' }
      ],
      formulas: ['liu-wei-di-huang-wan']
    },
    {
      id: 'shi-wu-mo-hu', name: '视物模糊', alias: ['眼花', '视力下降', '眼干'], system: '眼科', groups: ['老年'],
      desc: '看东西模糊、眼干或夜视力下降，常见于老花、白内障与干眼。',
      warning: '视力突然下降、眼痛、视野缺损或看灯有虹圈需眼科急诊，可能为青光眼或视网膜病变。',
      herbs: [
        { id: 'gou-qi-zi', role: 'primary', note: '益精明目' },
        { id: 'ju-hua', role: 'primary', note: '清肝明目' },
        { id: 'nv-zhen-zi', role: 'secondary', note: '滋补肝肾、明目乌发' },
        { id: 'shu-di-huang', role: 'secondary', note: '补肾填精，精血上荣于目' },
        { id: 'shan-zhu-yu', role: 'secondary', note: '补益肝肾' },
        { id: 'cang-zhu', role: 'secondary', note: '明目，古方用于夜盲' }
      ],
      pairs: [
        { herbs: ['gou-qi-zi', 'ju-hua'], desc: '肝肾不足、目暗昏花' },
        { herbs: ['nv-zhen-zi', 'shu-di-huang'], desc: '滋阴养血、明目' }
      ],
      formulas: ['liu-wei-di-huang-wan', 'sang-ju-yin']
    },
    {
      id: 'ye-niao-pin-duo', name: '夜尿频多', alias: ['夜尿多', '起夜频繁'], system: '泌尿', groups: ['老年'],
      desc: '夜间起床排尿次数增多（通常 ≥2 次），影响睡眠，常见于肾气不足、前列腺增生与饮水习惯不当。',
      warning: '夜尿增多也可能源于糖尿病、心力衰竭、前列腺疾病或睡眠呼吸暂停，持续出现建议就医查明原因。',
      herbs: [
        { id: 'shan-zhu-yu', role: 'primary', note: '补益肝肾、收涩缩尿' },
        { id: 'du-zhong', role: 'primary', note: '补肝肾、强筋骨' },
        { id: 'wu-yao', role: 'secondary', note: '温肾散寒、缩尿' },
        { id: 'rou-gui', role: 'secondary', note: '温阳化气' },
        { id: 'fu-ling', role: 'secondary', note: '利水渗湿、健脾' },
        { id: 'wu-wei-zi', role: 'secondary', note: '补肾固涩' }
      ],
      pairs: [
        { herbs: ['shan-zhu-yu', 'wu-wei-zi'], desc: '肾气不固、尿频遗尿' },
        { herbs: ['wu-yao', 'du-zhong'], desc: '肾阳不足、膀胱失约' }
      ],
      formulas: ['shen-qi-wan']
    },
    {
      id: 'ai-er-ci-hai-mo-bing', name: '阿尔茨海默病', alias: ['老年痴呆', '认知障碍'], system: '神经', groups: ['老年'],
      desc: '进行性认知功能下降，以记忆减退、语言与执行功能障碍为主，逐渐影响日常生活能力。',
      warning: '阿尔茨海默病需神经内科/记忆门诊规范评估与治疗。中药仅作辅助，不能替代胆碱酯酶抑制剂等处方药；出现走失、吞咽困难或精神行为异常请及时就医。',
      herbs: [
        { id: 'shi-chang-pu', role: 'primary', note: '开窍豁痰、醒神益智' },
        { id: 'yuan-zhi', role: 'primary', note: '安神益智、交通心肾' },
        { id: 'shu-di-huang', role: 'secondary', note: '补肾填精、益髓' },
        { id: 'shan-zhu-yu', role: 'secondary', note: '补益肝肾、固涩' },
        { id: 'gou-qi-zi', role: 'secondary', note: '滋补肝肾、益精' },
        { id: 'dan-shen', role: 'secondary', note: '活血化瘀，改善脑循环' },
        { id: 'ren-shen', role: 'secondary', note: '益气安神' }
      ],
      pairs: [
        { herbs: ['shi-chang-pu', 'yuan-zhi'], desc: '痰浊蒙窍、健忘呆滞' },
        { herbs: ['shu-di-huang', 'shan-zhu-yu'], desc: '肾精亏虚、髓海不足' }
      ],
      formulas: ['gui-pi-tang', 'liu-wei-di-huang-wan']
    }
  ];
});
