export interface BilibiliRegion {
  id: number;
  name: string;
  nameEn: string;
}

export const BILIBILI_REGIONS: BilibiliRegion[] = [
  { id: 1005, name: "动画", nameEn: "Animation" },
  { id: 1008, name: "游戏", nameEn: "Games" },
  { id: 1007, name: "鬼畜", nameEn: "Kichiku" },
  { id: 1003, name: "音乐", nameEn: "Music" },
  { id: 1004, name: "舞蹈", nameEn: "Dance" },
  { id: 1001, name: "影视", nameEn: "Film" },
  { id: 1002, name: "娱乐", nameEn: "Entertainment" },
  { id: 1010, name: "知识", nameEn: "Knowledge" },
  { id: 1012, name: "科技数码", nameEn: "Technology" },
  { id: 1009, name: "资讯", nameEn: "News" },
  { id: 1020, name: "美食", nameEn: "Food" },
  { id: 1021, name: "小剧场", nameEn: "Short drama" },
  { id: 1013, name: "汽车", nameEn: "Cars" },
  { id: 1014, name: "时尚美妆", nameEn: "Fashion" },
  { id: 1018, name: "体育运动", nameEn: "Sports" },
  { id: 1024, name: "动物", nameEn: "Animals" },
  { id: 1029, name: "vlog", nameEn: "Vlog" },
  { id: 1006, name: "绘画", nameEn: "Art" },
  { id: 1011, name: "人工智能", nameEn: "AI" },
  { id: 1015, name: "家装房产", nameEn: "Home" },
  { id: 1016, name: "户外潮流", nameEn: "Outdoor" },
  { id: 1017, name: "健身", nameEn: "Fitness" },
  { id: 1019, name: "手工", nameEn: "Crafts" },
  { id: 1022, name: "旅游出行", nameEn: "Travel" },
  { id: 1023, name: "三农", nameEn: "Rural" },
  { id: 1025, name: "亲子", nameEn: "Family" },
  { id: 1026, name: "健康", nameEn: "Health" },
  { id: 1027, name: "情感", nameEn: "Relationships" },
  { id: 1030, name: "生活兴趣", nameEn: "Hobbies" },
  { id: 1031, name: "生活经验", nameEn: "Life" },
];

export const DEFAULT_REGION_ID = BILIBILI_REGIONS[0].id;

export function regionName(region: BilibiliRegion, language: string): string {
  return language === "en-US" ? region.nameEn : region.name;
}
