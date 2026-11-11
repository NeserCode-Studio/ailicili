import { Navigate, useLocation, useParams } from "react-router";

import { BILIBILI_PLATFORM_ID } from "@/api/live";
import { liveRoomPath } from "@/lib/live-routes";

export default function LegacyLiveRoomRedirect() {
  const { roomId = "" } = useParams();
  const location = useLocation();

  return (
    <Navigate
      replace
      to={`${liveRoomPath(BILIBILI_PLATFORM_ID, roomId)}${location.search}`}
    />
  );
}
