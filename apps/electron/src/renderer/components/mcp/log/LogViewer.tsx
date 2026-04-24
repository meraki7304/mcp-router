import React, { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
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

  return (
    <div className="p-4 flex flex-col h-full gap-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">
          {t("logs.activity.title", "Activity")}
        </h2>
        <button
          onClick={handleRefresh}
          className="px-3 py-1.5 bg-primary/10 hover:bg-primary/20 rounded text-primary text-sm transition-colors"
          aria-label={t("logs.viewer.refresh", "Refresh")}
        >
          {t("logs.viewer.refresh", "Refresh")}
        </button>
      </div>

      <div className="flex-1 min-h-0">
        <ActivityLog items={activityItems} loading={loading} />
      </div>
    </div>
  );
};

export default LogViewer;
