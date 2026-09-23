// src/hooks/useLegBatchOps.ts
// 2026-09-22新增，从useLegEditing.ts里"批量选择/统一数量-行权价-到期日"
// 这部分抽出来的独立小hook——这部分逻辑本来就是纯粹的"legs数组"变换，不
// 像展期/保护/对冲/决策对比那样依赖"legs vs trackedLegs"这组特定的双数
// 据源概念，是useLegEditing.ts里唯一真正跟"当前操作的是主combo还是对比
// 槽位"无关、可以直接参数化复用的部分。抽出来是为了满足xue的要求——"批
// 量选择/全选/统一数量-行权价-到期日"这几个操作要在A/B/C三个combo槽位
// 完全对等生效，而不是再维护三份几乎一样的实现（CLAUDE.md"五、19"：一套
// 判断/操作逻辑同一时刻只该有一份权威实现，不要为新用途并行起第二套）。
//
// useLegEditing.ts现在内部调用这个hook喂给主combo(legs)，返回值原样透传
// ——它对外的返回形状/字段名完全没变，App.tsx对A(legs)这一路的调用点不
// 用改一个字符。App.tsx另外为两个对比槽位各自固定调用一次（hooks不能在
// .map里变量数量地调用，跟ComboCompareSlots.tsx里归因/统计那两份固定调
// 用是同样的限制），把结果传给ComboCompareSlots.tsx，驱动"当前激活的槽
// 位显示同一套批量工具栏"。
//
// confirmBeforeBulkDelete：A保持原有行为（先弹ConfirmBulkDeleteDialog二
// 次确认）；B/C是临时候选方案，本来就可以随时被覆盖/清空——跟
// applyPresetToSlot直接应用预设、不走"未保存变更"确认流程是同一个已经
// 跟xue确认过的设计决定（见useCompareSlots.ts），批量删除同理直接执行，
// 不弹二次确认。
import { useMemo, useState } from "react";
import type { Leg } from "@/lib/types";

export type LegBatchOps = ReturnType<typeof useLegBatchOps>;

export function useLegBatchOps(
  legs: Leg[],
  setLegs: React.Dispatch<React.SetStateAction<Leg[]>>,
  options?: { confirmBeforeBulkDelete?: boolean },
) {
  const confirmBeforeBulkDelete = options?.confirmBeforeBulkDelete ?? true;
  const [selectedLegIds, setSelectedLegIds] = useState<Set<string>>(new Set());
  const [confirmBulkDeleteOpen, setConfirmBulkDeleteOpen] = useState(false);

  const toggleLegSelection = (id: string) => {
    setSelectedLegIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearLegSelection = () => setSelectedLegIds(new Set());
  const selectAllLegs = () => setSelectedLegIds(new Set(legs.map((l) => l.id)));

  // 一条腿被删除后，它的id即使还留在selectedLegIds这个Set里也不要紧——
  // selectedLegsList每次都用当前legs反过来过滤，不存在的id天然不会再匹
  // 配到任何东西，selectedCount/canUnifyLegs等派生值不会失真。所以这个
  // hook不需要（也没有）暴露一个"从选择里移除某个id"的方法给deleteLeg之
  // 类的调用方主动清理，纯粹是省事，不是遗漏。
  const selectedLegsList = useMemo(
    () => legs.filter((l) => selectedLegIds.has(l.id)),
    [legs, selectedLegIds],
  );
  const selectedCount = selectedLegsList.length;
  const allSelectedDisabled = selectedCount > 0 && selectedLegsList.every((l) => l.disabled);

  const bulkToggleDisable = () => {
    if (selectedCount === 0) return;
    setLegs((prev) => prev.map((l) => (selectedLegIds.has(l.id) ? { ...l, disabled: !allSelectedDisabled } : l)));
  };

  const doBulkDelete = () => {
    setLegs((prev) => prev.filter((l) => !selectedLegIds.has(l.id)));
    setConfirmBulkDeleteOpen(false);
    clearLegSelection();
  };
  const requestBulkDelete = () => {
    if (selectedCount === 0) return;
    if (confirmBeforeBulkDelete) {
      setConfirmBulkDeleteOpen(true);
    } else {
      doBulkDelete();
    }
  };
  const confirmBulkDelete = () => {
    doBulkDelete();
  };

  // "统一数量/行权价/到期日"：把其余选中腿同步成第一条选中腿的值，限
  // option腿（stock腿的strike字段实际是成本价，没有dte/qty，语义不通用，
  // 见useLegEditing.ts原本这段逻辑的注释）。
  const eligibleForUnify = useMemo(
    () => selectedLegsList.filter((l) => l.kind !== "stock"),
    [selectedLegsList],
  );
  const canUnifyLegs = eligibleForUnify.length >= 2;

  const unifyLegField = (field: "qty" | "strike" | "dte") => {
    if (eligibleForUnify.length < 2) return;
    const baseline = eligibleForUnify[0];
    const targetIds = new Set(eligibleForUnify.slice(1).map((l) => l.id));
    setLegs((prev) =>
      prev.map((l) => {
        if (!targetIds.has(l.id)) return l;
        if (field === "qty") return { ...l, qty: baseline.qty ?? 1 };
        if (field === "strike") return { ...l, strike: baseline.strike, premium: 0 };
        return { ...l, dte: baseline.dte, premium: 0 };
      }),
    );
  };
  const unifyQty = () => unifyLegField("qty");
  const unifyStrike = () => unifyLegField("strike");
  const unifyDte = () => unifyLegField("dte");

  return {
    selectedLegIds,
    confirmBulkDeleteOpen,
    setConfirmBulkDeleteOpen,
    toggleLegSelection,
    clearLegSelection,
    selectAllLegs,
    selectedCount,
    allSelectedDisabled,
    bulkToggleDisable,
    requestBulkDelete,
    confirmBulkDelete,
    canUnifyLegs,
    unifyQty,
    unifyStrike,
    unifyDte,
  };
}