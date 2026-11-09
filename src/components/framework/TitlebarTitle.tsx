import { TitleContext } from "@/contexts/title";
import { memo, useContext } from "react";

const TitlebarTitle = memo(function TitlebarTitle() {
  const { title } = useContext(TitleContext);
  return (
    <div className="pointer-events-none w-full min-w-0 truncate text-center text-sm font-medium text-neutral-600 transition-colors duration-100 ease-in-out select-none dark:text-neutral-200">
      {title}
    </div>
  );
});

export default TitlebarTitle;
