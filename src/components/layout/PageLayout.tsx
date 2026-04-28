import React from "react";
import { Outlet } from "react-router-dom";

/**
 * PageLayout component provides consistent padding and styling across all pages
 */
const PageLayout: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  return (
    <div className={`flex flex-col min-h-full w-full px-6 pb-6`}>
      {children || <Outlet />}
    </div>
  );
};

export default PageLayout;
