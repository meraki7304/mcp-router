import React, { useEffect, useState } from "react";
import { usePlatformAPI } from "@/renderer/platform-api";

export function TitleBar() {
  const platformAPI = usePlatformAPI();
  const [platform, setPlatform] = useState<"darwin" | "win32" | "linux">(
    "darwin",
  );

  useEffect(() => {
    platformAPI.packages.system.getPlatform().then(setPlatform);
  }, [platformAPI]);

  return (
    <div
      className="h-[50px] fixed top-0 left-0 right-0 z-50 flex items-center justify-between bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      {/* macOS 交通灯按钮留白 */}
      <div className={platform === "darwin" ? "w-20" : "w-4"} />

      <div className="flex-1 text-center text-sm font-medium text-muted-foreground select-none">
        MCP Router
      </div>

      <div className={platform === "win32" ? "pr-[140px]" : "pr-4"} />
    </div>
  );
}
