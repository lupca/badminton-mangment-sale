import { Product } from "./types";

// Helper to clean up pricing strings and cast to number
const parsePrice = (priceStr: string): number => {
  return Math.round(parseFloat(priceStr.replace(/\./g, "").replace(/,/g, "")));
};

export const RAW_CATALOG_1 = [
  {
    ma_hang: "P-AYPT417-5",
    ten_hang: "Khung vợt cầu lông Aeronaut 6000I",
    don_gia_ban_le: 2356364,
    don_gia_ban_buon: 1649455,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 1296000
  },
  {
    ma_hang: "P-AYPU109-4",
    ten_hang: "Khung vợt cầu lông Axforce10 -4U Blue",
    don_gia_ban_le: 932727,
    don_gia_ban_buon: 652909,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 513000
  },
  {
    ma_hang: "P-AYPP028-1",
    ten_hang: "Khung vợt cầu lông AERONAUT 7000i Green",
    don_gia_ban_le: 4516364,
    don_gia_ban_buon: 3161455,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 2484000
  },
  {
    ma_hang: "P-AYPU077-4",
    ten_hang: "Khung vợt cầu lông Turbo Charging Marshal - 4U Black",
    don_gia_ban_le: 2012727,
    don_gia_ban_buon: 1408909,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 1107000
  },
  {
    ma_hang: "P-AYPJ008-4",
    ten_hang: "Khung vợt cầu lông 80TF",
    don_gia_ban_le: 1620000,
    don_gia_ban_buon: 1134000,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 891000
  },
  {
    ma_hang: "P-AYPM394-4",
    ten_hang: "Khung vợt cầu lông 3D Calibar200",
    don_gia_ban_le: 1423636,
    don_gia_ban_buon: 996545,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 783000
  },
  {
    ma_hang: "P-AYPP032-4",
    ten_hang: "Khung vợt cầu lông TuBo 01D",
    don_gia_ban_le: 1325455,
    don_gia_ban_buon: 927819,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 729000
  },
  {
    ma_hang: "P-AYPP042-3",
    ten_hang: "Khung vợt cầu lông Aeronaut 4000B",
    don_gia_ban_le: 2022545,
    don_gia_ban_buon: 1415782,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 1112400
  },
  {
    ma_hang: "P-AYPR289-3",
    ten_hang: "Khung vợt cầu lông Aeronaut 6000 Max",
    don_gia_ban_le: 2022545,
    don_gia_ban_buon: 1415782,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 1112400
  },
  {
    ma_hang: "P-AYPT293-3",
    ten_hang: "Khung vợt cầu lông Axforce 20 - 3U Blue",
    don_gia_ban_le: 1178182,
    don_gia_ban_buon: 824727,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 648000
  },
  {
    ma_hang: "P-AYPT299-5",
    ten_hang: "Khung vợt cầu lông Axforce JR - 5U Black",
    don_gia_ban_le: 1129091,
    don_gia_ban_buon: 790364,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 621000
  },
  {
    ma_hang: "P-AYPT301-5",
    ten_hang: "Khung vợt cầu lông Axforce JR - 5U White",
    don_gia_ban_le: 1129091,
    don_gia_ban_buon: 790364,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 621000
  },
  {
    ma_hang: "P-AYPT349-3",
    ten_hang: "Khung vợt cầu lông Bladex Sonar - 3U Blue",
    don_gia_ban_le: 2258182,
    don_gia_ban_buon: 1580727,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 1242000
  },
  {
    ma_hang: "P-AYPT357-3",
    ten_hang: "Khung vợt cầu lông Bladex 200 - 3U",
    don_gia_ban_le: 1227273,
    don_gia_ban_buon: 859091,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 675000
  },
  {
    ma_hang: "P-AYPT357-4",
    ten_hang: "Khung vợt cầu lông Bladex 200 - 4U Blue",
    don_gia_ban_le: 1227273,
    don_gia_ban_buon: 859091,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 675000
  },
  {
    ma_hang: "P-AYPT361-4",
    ten_hang: "Khung vợt cầu lông Bladex Spiral - 4U Yellow",
    don_gia_ban_le: 883636,
    don_gia_ban_buon: 618545,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 486000
  },
  {
    ma_hang: "P-AYPT361-5",
    ten_hang: "Khung vợt cầu lông Bladex Spiral - 5U Yellow",
    don_gia_ban_le: 883636,
    don_gia_ban_buon: 618545,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 486000
  },
  {
    ma_hang: "P-AYPT365-5",
    ten_hang: "Khung vợt cầu lông Bladex Spiral - 5U Pink",
    don_gia_ban_le: 883636,
    don_gia_ban_buon: 618545,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 486000
  },
  {
    ma_hang: "P-AYPT377-3",
    ten_hang: "Khung vợt cầu lông Halbertec 2000 - 3U White Gray",
    don_gia_ban_le: 1129091,
    don_gia_ban_buon: 790364,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 621000
  },
  {
    ma_hang: "P-AYPT399-4",
    ten_hang: "Khung vợt cầu lông 3D Calibar 001",
    don_gia_ban_le: 1178182,
    don_gia_ban_buon: 824727,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 648000
  },
  {
    ma_hang: "P-AYPT401-3",
    ten_hang: "Khung vợt cầu lông 3D Calibar 001C",
    don_gia_ban_le: 1178182,
    don_gia_ban_buon: 824727,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 648000
  },
  {
    ma_hang: "P-AYPT411-3",
    ten_hang: "Vợt cầu lông Aeronaut 6000",
    don_gia_ban_le: 2258182,
    don_gia_ban_buon: 1580727,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 1242000
  },
  {
    ma_hang: "P-AYPT455-4",
    ten_hang: "Khung vợt cầu lông Lightning 2000 Red",
    don_gia_ban_le: 1178182,
    don_gia_ban_buon: 824727,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 648000
  },
  {
    ma_hang: "P-AYPT457-4",
    ten_hang: "Khung vợt cầu lông Lightning 2000 Blue",
    don_gia_ban_le: 1178182,
    don_gia_ban_buon: 824727,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 648000
  },
  {
    ma_hang: "P-AYPT467-4",
    ten_hang: "Khung vợt cầu lông Axforce Blackion - 4U Fire Red",
    don_gia_ban_le: 1050545,
    don_gia_ban_buon: 735382,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 577800
  },
  {
    ma_hang: "P-AYPT471-4",
    ten_hang: "Khung vợt cầu lông Axforce Blackion - 4U Pale Gold",
    don_gia_ban_le: 1050545,
    don_gia_ban_buon: 735382,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 577800
  },
  {
    ma_hang: "P-AYPT477-4",
    ten_hang: "Khung vợt cầu lông HC 1000 Black",
    don_gia_ban_le: 1030909,
    don_gia_ban_buon: 721636,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 567000
  },
  {
    ma_hang: "P-AYPT481-4",
    ten_hang: "Khung vợt cầu lông HC 1200",
    don_gia_ban_le: 1129091,
    don_gia_ban_buon: 790364,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 621000
  },
  {
    ma_hang: "P-AYPT563-4",
    ten_hang: "Khung vợt cầu lông Tubo chaging 10B",
    don_gia_ban_le: 1354909,
    don_gia_ban_buon: 948436,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 745200
  },
  {
    ma_hang: "P-AYPT749-4",
    ten_hang: "Khung vợt cầu lông Tubo 20D",
    don_gia_ban_le: 1374545,
    don_gia_ban_buon: 962182,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 756000
  },
  {
    ma_hang: "P-AYPU043-4",
    ten_hang: "Khung vợt cầu lông Bladex Spiral - 4U",
    don_gia_ban_le: 883636,
    don_gia_ban_buon: 618545,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 486000
  },
  {
    ma_hang: "P-AYPU049-4",
    ten_hang: "Khung vợt cầu lông Axforce BigBang New - 4U Black",
    don_gia_ban_le: 2061818,
    don_gia_ban_buon: 1443273,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 1134000
  },
  {
    ma_hang: "P-AYPU049-5",
    ten_hang: "Khung vợt cầu lông Axforce BigBang New - 5U Black",
    don_gia_ban_le: 2061818,
    don_gia_ban_buon: 1443273,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 1134000
  },
  {
    ma_hang: "P-AYPU051-4",
    ten_hang: "Khung vợt cầu lông Axforce BigBang New - 4U White",
    don_gia_ban_le: 2061818,
    don_gia_ban_buon: 1443273,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 1134000
  },
  {
    ma_hang: "P-AYPU051-5",
    ten_hang: "Khung vợt cầu lông Axforce BigBang New - 5U White",
    don_gia_ban_le: 2061818,
    don_gia_ban_buon: 1443273,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 1134000
  },
  {
    ma_hang: "P-AYPU053-4",
    ten_hang: "Khung vợt cầu lông Axforce Cannon - 4U Black",
    don_gia_ban_le: 1080000,
    don_gia_ban_buon: 756000,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 594000
  },
  {
    ma_hang: "P-AYPU053-5",
    ten_hang: "Khung vợt cầu lông Axforce Cannon - 5U Black",
    don_gia_ban_le: 1080000,
    don_gia_ban_buon: 756000,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 594000
  },
  {
    ma_hang: "P-AYPU055-4",
    ten_hang: "Khung vợt cầu lông Axforce Cannon - 4U White",
    don_gia_ban_le: 1080000,
    don_gia_ban_buon: 756000,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 594000
  },
  {
    ma_hang: "P-AYPU055-5",
    ten_hang: "Khung vợt cầu lông Axforce Cannon - 5U White",
    don_gia_ban_le: 1080000,
    don_gia_ban_buon: 756000,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 594000
  },
  {
    ma_hang: "P-AYPU061-4",
    ten_hang: "Khung vợt cầu lông Halbertec Motor - 4U Orange",
    don_gia_ban_le: 932727,
    don_gia_ban_buon: 652909,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 513000
  },
  {
    ma_hang: "P-AYPU063-4",
    ten_hang: "Khung vợt cầu lông Halbertec Motor - 4U Green",
    don_gia_ban_le: 932727,
    don_gia_ban_buon: 652909,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 513000
  },
  {
    ma_hang: "P-AYPU067-4",
    ten_hang: "Khung vợt cầu lông US100 Black",
    don_gia_ban_le: 932727,
    don_gia_ban_buon: 652909,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 513000
  },
  {
    ma_hang: "P-AYPU071-4",
    ten_hang: "Khung vợt cầu lông US120 White",
    don_gia_ban_le: 932727,
    don_gia_ban_buon: 652909,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 513000
  },

  // Bo sung DM01
  {
    ma_hang: "P-AYPT059-4",
    ten_hang: "Khung vợt cầu lông Phong BST Phong-Lâm- Hỏa- Sơn",
    don_gia_ban_le: 3043366,
    don_gia_ban_buon: 2130545,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 1674000
  },
  {
    ma_hang: "P-AYPT061-4",
    ten_hang: "Khung vợt cầu lông Lâm BST Phong-Lâm- Hỏa- Sơn",
    don_gia_ban_le: 3043366,
    don_gia_ban_buon: 2130545,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 1674000
  },
  {
    ma_hang: "P-AYPT293-4A",
    ten_hang: "Khung vợt cầu lông Axforce 20 - 4U Blue",
    don_gia_ban_le: 1178182,
    don_gia_ban_buon: 824727,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 648000
  },
  {
    ma_hang: "P-AYPT413-3",
    ten_hang: "Vợt cầu lông Aeronaut 6000D",
    don_gia_ban_le: 2258182,
    don_gia_ban_buon: 1580727,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 1242000
  },
  {
    ma_hang: "P-AYPT423-4",
    ten_hang: "Vợt cầu lông Tectonic 1 - 4U",
    don_gia_ban_le: 903273,
    don_gia_ban_buon: 632291,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 496800
  },
  {
    ma_hang: "P-AYPT465-3",
    ten_hang: "Khung vợt cầu lông Lightning 3000 Green Purple",
    don_gia_ban_le: 1227273,
    don_gia_ban_buon: 859091,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 675000
  },
  {
    ma_hang: "P-AYPU009-3",
    ten_hang: "Khung vợt cầu lông Bladex 500 - 3U Pearl White",
    don_gia_ban_le: 2601818,
    don_gia_ban_buon: 1821273,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 1431000
  },
  {
    ma_hang: "P-AYPU011-3",
    ten_hang: "Khung vợt cầu lông AXFORCE 40 - 3U Black",
    don_gia_ban_le: 2209091,
    don_gia_ban_buon: 1546364,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 1215000
  },
  {
    ma_hang: "P-AYPJ008-4A",
    ten_hang: "Khung vợt cầu lông 80TF",
    don_gia_ban_le: 1620000,
    don_gia_ban_buon: 1134000,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 891000
  },
  {
    ma_hang: "P-AYPP032-4E",
    ten_hang: "Khung vợt cầu lông TuBo 01D",
    don_gia_ban_le: 1325455,
    don_gia_ban_buon: 927819,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 729000
  },
  {
    ma_hang: "P-AYPT293-3A",
    ten_hang: "Khung vợt cầu lông Axforce 20 - 3U Blue",
    don_gia_ban_le: 1178182,
    don_gia_ban_buon: 824727,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 648000
  },
  {
    ma_hang: "P-AYPT467-4E",
    ten_hang: "Khung vợt cầu lông Axforce Blackion - 4U Fire Red",
    don_gia_ban_le: 1178182,
    don_gia_ban_buon: 824727,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 648000
  },
  {
    ma_hang: "P-AYPT471-4E",
    ten_hang: "Khung vợt cầu lông Axforce Blackion - 4U Pale Gold",
    don_gia_ban_le: 1178182,
    don_gia_ban_buon: 824727,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 648000
  },
  {
    ma_hang: "P-AYPT437-6V",
    ten_hang: "Khung vợt cầu lông WindStorm 72 Black",
    don_gia_ban_le: 2405455,
    don_gia_ban_buon: 1683819,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 1323000
  }
];

export const RAW_CATALOG_2 = [
  {
    ma_hang: "P-AYPU011-1",
    ten_hang: "Khung vợt cầu lông Axforce 90 Max Tiger - 3U Max Tiger",
    don_gia_ban_le: 5007273,
    don_gia_ban_buon: 3505091
  },
  {
    ma_hang: "P-AYPU013-1",
    ten_hang: "Khung vợt cầu lông Axforce 90 Max Dragon - 3U Max Dragon",
    don_gia_ban_le: 5007273,
    don_gia_ban_buon: 3505091
  },
  {
    ma_hang: "P-AYPU015-1",
    ten_hang: "Khung vợt cầu lông Axforce 90 Max Tiger - 4U Max Tiger",
    don_gia_ban_le: 5007273,
    don_gia_ban_buon: 3505091
  },
  {
    ma_hang: "P-AYPT011-1",
    ten_hang: "Khung vợt cầu lông Bladex 800 - 3U Black",
    don_gia_ban_le: 4516364,
    don_gia_ban_buon: 3161455
  },
  {
    ma_hang: "P-AYPT013-1",
    ten_hang: "Khung vợt cầu lông Bladex 800 - 4U Black",
    don_gia_ban_le: 4516364,
    don_gia_ban_buon: 3161455
  },
  {
    ma_hang: "P-AYPT015-1",
    ten_hang: "Khung vợt cầu lông Halbertec 8000 - 3U Green/Pink",
    don_gia_ban_le: 4712727,
    don_gia_ban_buon: 3298909
  },
  {
    ma_hang: "P-AYPT017-1",
    ten_hang: "Khung vợt cầu lông Halbertec 8000 - 4U Green/Pink",
    don_gia_ban_le: 4712727,
    don_gia_ban_buon: 3298909
  },
  {
    ma_hang: "P-AYPT021-1",
    ten_hang: "Khung vợt cầu lông Axforce 80 - 3U Black Gold",
    don_gia_ban_le: 4516364,
    don_gia_ban_buon: 3161455
  },
  {
    ma_hang: "P-AYPT023-1",
    ten_hang: "Khung vợt cầu lông Axforce 80 - 4U Black Gold",
    don_gia_ban_le: 4516364,
    don_gia_ban_buon: 3161455
  },
  {
    ma_hang: "P-AYPT025-1",
    ten_hang: "Khung vợt cầu lông Axforce 80 - 5U Black Gold",
    don_gia_ban_le: 4516364,
    don_gia_ban_buon: 3161455
  },

  // Supplemental DM02 and extra records
  {
    ma_hang: "P-AYPT417-5-DM2",
    ten_hang: "Khung vợt cầu lông Aeronaut 6000I (Mua trọn set DM02)",
    don_gia_ban_le: 2356364,
    don_gia_ban_buon: 1649455
  },
  {
    ma_hang: "P-AYPU109-4-DM2",
    ten_hang: "Khung vợt cầu lông Axforce10 -4U Blue (Mua trọn set DM02)",
    don_gia_ban_le: 932727,
    don_gia_ban_buon: 652909
  },
  {
    ma_hang: "P-AYPT059-4-DM2",
    ten_hang: "Khung vợt cầu lông Phong BST Phong-Lâm- Hỏa- Sơn (Set DM02)",
    don_gia_ban_le: 3043366,
    don_gia_ban_buon: 2130545
  },
  {
    ma_hang: "P-AYPT061-4-DM2",
    ten_hang: "Khung vợt cầu lông Lâm BST Phong-Lâm- Hỏa- Sơn (Set DM02)",
    don_gia_ban_le: 3043366,
    don_gia_ban_buon: 2130545
  },
  {
    ma_hang: "P-AYPT437-6V-DM2",
    ten_hang: "Khung vợt cầu lông WindStorm 72 Black (Set DM02)",
    don_gia_ban_le: 2405455,
    don_gia_ban_buon: 1683819
  },
  {
    ma_hang: "P-AYPT349-4-DM2",
    ten_hang: "Khung vợt cầu lông Bladex Sonar - 4U Blue (Set DM02)",
    don_gia_ban_le: 2258182,
    don_gia_ban_buon: 1580727
  },
  {
    ma_hang: "P-AYPT475-4-DM2",
    ten_hang: "Khung vợt cầu lông HC 1000 White (Set DM02)",
    don_gia_ban_le: 1030909,
    don_gia_ban_buon: 721636
  }
];

export const RAW_CATALOG_3 = [
  {
    ma_hang: "P-APST331-1",
    ten_hang: "Quần tất thi đấu cầu lông đen",
    don_gia_ban_le: 713455,
    don_gia_ban_buon: 499418,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 392400
  },
  {
    ma_hang: "P-APST333-1",
    ten_hang: "Quần tất thi đấu cầu lông đen dầy",
    don_gia_ban_le: 713455,
    don_gia_ban_buon: 499418,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 392400
  },
  {
    ma_hang: "P-AUTC007-1",
    ten_hang: "Băng chặn mồ hôi trán đen",
    don_gia_ban_le: 186545,
    don_gia_ban_buon: 130582,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 102600
  },
  {
    ma_hang: "P-AUTC007-2",
    ten_hang: "Băng chặn mồ hôi trán trắng",
    don_gia_ban_le: 186545,
    don_gia_ban_buon: 130582,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 102600
  },
  {
    ma_hang: "P-AHUT454-1",
    ten_hang: "Băng cổ tay đen chống chấn thương",
    don_gia_ban_le: 245455,
    don_gia_ban_buon: 171818,
    phan_tram_giam_gia: "45%",
    gia_sau_giam: 135000
  }
];

// Helper to determine racket series based on name
const getRacketSeries = (name: string): string => {
  const low = name.toLowerCase();
  if (low.includes("axforce") || low.includes("blackion") || low.includes("cannon") || low.includes("bigbang") || low.includes("jr")) {
    return "Axforce";
  }
  if (low.includes("aeronaut")) {
    return "Aeronaut";
  }
  if (low.includes("bladex") || low.includes("sonar") || low.includes("spiral")) {
    return "Bladex";
  }
  if (low.includes("halbertec") || low.includes("motor")) {
    return "Halbertec";
  }
  if (low.includes("tectonic")) {
    return "Tectonic";
  }
  if (low.includes("lightning")) {
    return "Lightning";
  }
  if (low.includes("windstorm") || low.includes("wind storm")) {
    return "Windstorm";
  }
  if (low.includes("calibar") || low.includes("3d calibar")) {
    return "Calibar";
  }
  if (low.includes("hc") || low.includes("a880") || low.includes("1000") || low.includes("1200")) {
    return "HC Series";
  }
  if (low.includes("turbo") || low.includes("tubo") || low.includes("marshal")) {
    return "Turbo Charging";
  }
  return "Khác";
};

// Helper to determine key specs (3U, 4U, 5U)
const getWeightSpec = (name: string): string => {
  const low = name.toLowerCase();
  if (low.includes("3u")) return "3U";
  if (low.includes("4u")) return "4U";
  if (low.includes("5u")) return "5U";
  if (low.includes("6u")) return "6U";
  if (low.includes("7u") || low.includes("72")) return "5U"; // Windstorm 72 is light, equivalent to 5U/6U
  return "4U"; // standard default for catalog items if not specified
};

export const getCatalog1Products = (): Product[] => {
  return RAW_CATALOG_1.map(p => ({
    ...p,
    series: getRacketSeries(p.ten_hang),
    spec: getWeightSpec(p.ten_hang)
  }));
};

export const getCatalog2Products = (): Product[] => {
  return RAW_CATALOG_2.map(p => ({
    ...p,
    series: getRacketSeries(p.ten_hang),
    spec: getWeightSpec(p.ten_hang)
  }));
};

export const getCatalog3Products = (): Product[] => {
  return RAW_CATALOG_3.map(p => ({
    ...p,
    series: "Phụ Phẩm",
    spec: "N/A"
  }));
};

export const ALL_PRODUCTS = [
  ...getCatalog1Products().map(p => ({ ...p, defaultCatalog: 1 })),
  ...getCatalog2Products().map(p => ({ ...p, defaultCatalog: 2 })),
  ...getCatalog3Products().map(p => ({ ...p, defaultCatalog: 3 }))
];

export const PROMO_C_TIERS = [
  { minWholesalePrice: 0, maxWholesalePrice: 7999999, giftPercent: 0, label: "Dưới 8M (Không áp dụng Quà tặng)" },
  { minWholesalePrice: 8000000, maxWholesalePrice: 19999999, giftPercent: 15, label: "8M - 20M: Tặng tối đa < 15% đặt quà từ DM01" },
  { minWholesalePrice: 20000000, maxWholesalePrice: 34999999, giftPercent: 18, label: "20M - 35M: Tặng tối đa < 18% đặt quà từ DM01" },
  { minWholesalePrice: 35000000, maxWholesalePrice: 49999999, giftPercent: 20, label: "35M - 50M: Tặng tối đa < 20% đặt quà từ DM01" },
  { minWholesalePrice: 50000000, maxWholesalePrice: Infinity, giftPercent: 27, label: "Trên 50M: Tặng tối đa < 27% đặt quà từ DM01" }
];
