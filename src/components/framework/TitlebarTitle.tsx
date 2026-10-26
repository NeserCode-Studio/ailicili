import { TitleContext } from "@/contexts/title";
import { usePageTitlebar } from "@/contexts/pageTitlebar";
import { memo, useContext } from "react";

const TitlebarTitle = memo(function TitlebarTitle() {
  const { title } = useContext(TitleContext);
  const { pageTitle } = usePageTitlebar();
  return (
    // 绝对定位居中：窗口宽度变化时标题不会因左右两侧宽度不等而偏移
    <div className="text-muted-foreground pointer-events-none absolute left-1/2 max-w-[min(32%,24rem)] -translate-x-1/2 truncate text-xs font-medium transition-colors duration-100 ease-in-out">
      {pageTitle ?? title}
    </div>
  );
});

export default TitlebarTitle;
