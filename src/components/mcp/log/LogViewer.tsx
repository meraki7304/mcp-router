import React, { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { useActivityData } from "./hooks/useActivityData";
import ActivityLog from "./components/ActivityLog";

const getTodayString = (): string => {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
};

const LogViewer: React.FC = () => {
  const { t } = useTranslation();

  const [selectedDate] = useState<string>(getTodayString());
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);

  const { activityItems, loading } = useActivityData({
    selectedDate,
    refreshTrigger,
  });

  const handleRefresh = useCallback(() => {
    setRefreshTrigger((prev) => prev + 1);
  }, []);

  const handleClear = useCallback(async () => {
    if (!window.confirm("确定清空所有活动日志？此操作不可撤销。")) return;
    try {
      // logs_trim(max_rows) 保留最近 N 条；传 0 即全删
      const removed = await invoke<number>("logs_trim", { maxRows: 0 });
      toast.success(`已清空 ${removed} 条日志`);
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      toast.error(`清空失败：${String(err)}`);
    }
  }, []);

  return (
    <div className="p-4 flex flex-col h-full gap-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">
          {t("logs.activity.title", "Activity")}
        </h2>
        <div className="flex gap-2">
          <button
            onClick={handleRefresh}
            className="px-3 py-1.5 bg-primary/10 hover:bg-primary/20 rounded text-primary text-sm transition-colors"
          >
            刷新
          </button>
          <button
            onClick={handleClear}
            className="px-3 py-1.5 bg-destructive/10 hover:bg-destructive/20 rounded text-destructive text-sm transition-colors"
          >
            清空
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <ActivityLog items={activityItems} loading={loading} />
      </div>
    </div>
  );
};

export default LogViewer;
