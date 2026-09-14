import {
  HEALTH_PLEDGE,
  NO_ACCIDENT_PLEDGE,
  WORK_ACK_PLEDGE,
} from "@/lib/legal/dailyPledges";
import type { WorkerLocale } from "./workerLocale";

export type PledgeKind = "work" | "noAccident" | "health";

const EN: Record<PledgeKind, string> = {
  work:
    "I confirm today's assigned work, hazards, controls, and PPE rules, consistent with the Occupational Safety and Health Act (risk assessment and contractor prevention). I will follow the rules and stop work and report immediately if I find danger.",
  noAccident:
    "I confirm today's work was completed without an accident. There was no injury, illness, equipment damage, or near miss. If I know of any, I will not hide it and will report it. False confirmation may lead to legal or site-rule liability.",
  health:
    "I confirm I have no fever, dizziness, breathing difficulty, chest pain, or vision/hearing problems that would affect work. If I do, I will stop and report. I understand this is sensitive health information.",
};

const ZH: Record<PledgeKind, string> = {
  work:
    "本人确认今日分配的作业内容、危险因素、安全对策及防护用品要求，符合产业安全保健法关于风险评估与承包灾害预防的宗旨。将遵守安全规则；发现危险时停止作业并立即向管理监督者、安全管理员报告。",
  noAccident:
    "本人确认今日作业无事故完成。未发生伤害、疾病、设备损坏或未遂事故。如有知情事项，不会隐瞒并立即报告。虚假确认可能承担相关法令及现场规定责任。",
  health:
    "本人确认目前无发热、头晕、呼吸困难、胸痛、视力或听力异常等影响作业的症状。如有异常将停止作业并报告。本人知晓本确认为健康敏感信息处理。",
};

const JA: Record<PledgeKind, string> = {
  work:
    "本日割り当てられた作業内容、危険要因、安全対策および保護具基準を、産業安全保健法（リスクアセスメントおよび請負時の災害予防）の趣旨に沿って確認しました。安全規則を守り、危険を発見した場合は作業を中止し、管理監督者・安全管理者に直ちに報告します。",
  noAccident:
    "本日の担当作業を無災害で完了したことを確認します。負傷、疾病、設備損傷、ヒヤリハットはありません。知っている事実があれば隠さず報告します。虚偽確認は関係法令および現場規定の責任を伴うことがあります。",
  health:
    "発熱、めまい、呼吸困難、胸痛、視力・聴力の異常など、作業に支障を与える症状がないことを確認します。異常があれば作業を中止して報告します。本確認が健康に関する機微情報の処理に当たることを承知しています。",
};

const KO: Record<PledgeKind, string> = {
  work: WORK_ACK_PLEDGE,
  noAccident: NO_ACCIDENT_PLEDGE,
  health: HEALTH_PLEDGE,
};

/** Display-only. Stored / signed legal text stays Korean. */
export function displayPledge(kind: PledgeKind, locale: WorkerLocale): string {
  if (locale === "en") return EN[kind];
  if (locale === "zh") return ZH[kind];
  if (locale === "ja") return JA[kind];
  return KO[kind];
}