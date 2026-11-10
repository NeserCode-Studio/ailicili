import { invoke } from "@tauri-apps/api/core";

export type CommentSort = "hot" | "time";

export interface CommentAuthor {
  id: number;
  name: string;
  avatarUrl?: string;
  level?: number;
  isUp: boolean;
}

export interface CommentPicture {
  url: string;
  width?: number;
  height?: number;
}

export interface CommentEmote {
  text: string;
  url: string;
}

export interface VideoComment {
  id: number;
  author: CommentAuthor;
  message: string;
  pictures: CommentPicture[];
  emotes: CommentEmote[];
  createdAt: number;
  likeCount: number;
  replyCount: number;
  location?: string;
  replies: VideoComment[];
  isPinned: boolean;
}

export interface CommentPage {
  total: number;
  items: VideoComment[];
  hasMore: boolean;
  nextCursor?: string;
}

export interface CommentReplyPage {
  items: VideoComment[];
  hasMore: boolean;
  nextPage?: number;
}

export async function getVideoComments(
  aid: number,
  sort: CommentSort,
  next?: string
): Promise<CommentPage> {
  return invoke("get_video_comments", { aid, sort, next });
}

export async function getCommentReplies(
  aid: number,
  rootRpid: number,
  page = 1
): Promise<CommentReplyPage> {
  return invoke("get_comment_replies", { aid, rootRpid, page });
}
