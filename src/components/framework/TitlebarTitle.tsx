import { TitleContext } from "@/contexts/title";
import { memo, useContext } from "react";

const TitlebarTitle = memo(function TitlebarTitle() {
  const { title } = useContext(TitleContext);
  return (
    // 绝对定位居中：窗口宽度变化时标题不会因左右两侧宽度不等而偏移
    <div className="text-muted-foreground pointer-events-none absolute left-1/2 max-w-[40%] -translate-x-1/2 truncate text-xs font-medium transition-colors duration-100 ease-in-out">
      {title}
    </div>
  );
});

export default TitlebarTitle;
