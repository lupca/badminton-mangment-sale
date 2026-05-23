export interface Product {
  ma_hang: string;
  ten_hang: string;
  don_gia_ban_le: number; // parsed as number
  don_gia_ban_buon: number; // parsed as number
  phan_tram_giam_gia?: string;
  gia_sau_giam?: number; // parsed as number
  series?: string; // e.g., Axforce, Bladex, Halbertec, Aeronaut, Tectonic, etc.
  spec?: string; // e.g., 3U, 4U, 5U
}

export interface CartItem {
  product: Product;
  quantity: number;
  catalogId: 1 | 2 | 3;
}

export interface FreeGiftSelection {
  product: Product;
  quantity: number;
}
