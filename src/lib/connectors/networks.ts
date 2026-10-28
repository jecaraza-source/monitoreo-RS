// Networks an unofficial source can read (shown with the source; client-safe).
export const UNOFFICIAL_NETWORKS = {
  x: "X",
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
  telegram: "Telegram",
  youtube: "YouTube",
  otra: "Otra",
} as const;

export type UnofficialNetwork = keyof typeof UNOFFICIAL_NETWORKS;

export const NETWORK_VALUES = Object.keys(UNOFFICIAL_NETWORKS) as [UnofficialNetwork, ...UnofficialNetwork[]];
